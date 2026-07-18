import { haptic } from "./haptics.js?v=83";

const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
const SETTINGS_KEY = "cardCrunchSettings";
const MAX_ACTIVE_VOICES = 28;

let context = null;
let master = null;
let musicBus = null;
let noiseBuffer = null;
let musicTimer = null;
let musicStep = 0;
let activeVoices = 0;
let settings = readSettings();

export function installAudioUnlock() {
  const unlock = () => {
    ensureAudio();
    context?.resume?.().catch(() => {});
    syncMusic();
  };
  document.addEventListener("pointerdown", unlock, { capture: true, once: true, passive: true });
  document.addEventListener("keydown", unlock, { capture: true, once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopMusic();
    else syncMusic();
  });
}

export function setAudioSettings(nextSettings = {}) {
  settings = {
    ...settings,
    sound: nextSettings.sound !== false,
    music: nextSettings.music !== false
  };
  syncMusic();
}

export function playGameSfx(name) {
  const hapticName = HAPTIC_BY_SOUND[name];
  if (hapticName) haptic(hapticName);
  if (!settings.sound) return;
  const audio = ensureAudio();
  if (!audio || audio.state === "suspended") audio?.resume?.().catch(() => {});

  const effect = EFFECTS[name] ?? EFFECTS.tap;
  effect?.();

}

function ensureAudio() {
  if (context || !AudioContextClass) return context;
  context = new AudioContextClass({ latencyHint: "interactive" });
  master = context.createGain();
  master.gain.value = 0.48;
  master.connect(context.destination);
  musicBus = context.createGain();
  musicBus.gain.value = 0.09;
  musicBus.connect(master);
  noiseBuffer = createNoiseBuffer(context);
  return context;
}

function tone({ frequency = 440, endFrequency = frequency, duration = 0.1, delay = 0, gain = 0.12, type = "square", destination = master } = {}) {
  if (!context || activeVoices >= MAX_ACTIVE_VOICES) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  activeVoices += 1;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + Math.min(0.016, duration * 0.3));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(destination ?? master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
  oscillator.addEventListener("ended", () => {
    activeVoices = Math.max(0, activeVoices - 1);
    oscillator.disconnect();
    envelope.disconnect();
  }, { once: true });
}

function noise({ duration = 0.08, delay = 0, gain = 0.08, highpass = 500 } = {}) {
  if (!context || !noiseBuffer || activeVoices >= MAX_ACTIVE_VOICES) return;
  const start = context.currentTime + delay;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  activeVoices += 1;
  source.buffer = noiseBuffer;
  filter.type = "highpass";
  filter.frequency.value = highpass;
  envelope.gain.setValueAtTime(Math.max(0.0002, gain), start);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(master);
  source.start(start);
  source.stop(start + duration);
  source.addEventListener("ended", () => {
    activeVoices = Math.max(0, activeVoices - 1);
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  }, { once: true });
}

function chord(frequencies, options = {}) {
  frequencies.forEach((frequency, index) => tone({ ...options, frequency, endFrequency: frequency * (options.rise ?? 1), delay: (options.delay ?? 0) + index * 0.018 }));
}

function arpeggio(frequencies, { duration = 0.12, spacing = 0.055, gain = 0.08, type = "square" } = {}) {
  frequencies.forEach((frequency, index) => tone({ frequency, endFrequency: frequency * 1.01, duration, delay: index * spacing, gain, type }));
}

const EFFECTS = {
  tap: () => tone({ frequency: 260, endFrequency: 220, duration: 0.045, gain: 0.045 }),
  card_select: () => {
    tone({ frequency: 520, endFrequency: 690, duration: 0.055, gain: 0.075, type: "triangle" });
    noise({ duration: 0.035, gain: 0.035, highpass: 2200 });
  },
  card_deselect: () => tone({ frequency: 460, endFrequency: 300, duration: 0.06, gain: 0.06, type: "triangle" }),
  valid_add: () => arpeggio([440, 660], { gain: 0.065 }),
  invalid_card: () => {
    tone({ frequency: 150, endFrequency: 75, duration: 0.18, gain: 0.12, type: "sawtooth" });
    noise({ duration: 0.16, gain: 0.08, highpass: 260 });
  },
  crunch_start: () => {
    tone({ frequency: 110, endFrequency: 46, duration: 0.21, gain: 0.18, type: "square" });
    noise({ duration: 0.09, gain: 0.09, highpass: 1200 });
  },
  card_resolve: () => {
    tone({ frequency: 370, endFrequency: 610, duration: 0.1, gain: 0.08, type: "triangle" });
    noise({ duration: 0.055, gain: 0.05, highpass: 1800 });
  },
  suit_match: () => chord([392, 494], { duration: 0.16, gain: 0.07, type: "triangle", rise: 1.04 }),
  rank_match: () => arpeggio([440, 554, 659], { duration: 0.15, spacing: 0.045, gain: 0.075 }),
  math_combo: () => arpeggio([330, 494, 659, 880], { duration: 0.17, spacing: 0.04, gain: 0.075, type: "triangle" }),
  double_match: () => {
    chord([392, 494, 659], { duration: 0.22, gain: 0.09, type: "square", rise: 1.06 });
    noise({ duration: 0.06, gain: 0.04, highpass: 2500 });
  },
  score_step: () => tone({ frequency: 720, endFrequency: 850, duration: 0.07, gain: 0.055, type: "triangle" }),
  score_total: () => arpeggio([523, 659, 784, 1047], { duration: 0.2, spacing: 0.045, gain: 0.09 }),
  score_arrive: () => {
    chord([523, 659, 784], { duration: 0.24, gain: 0.1, type: "triangle", rise: 1.01 });
    noise({ duration: 0.075, gain: 0.045, highpass: 2800 });
  },
  bank: () => arpeggio([392, 523, 659, 784], { duration: 0.22, spacing: 0.055, gain: 0.09, type: "triangle" }),
  revive: () => arpeggio([262, 330, 392, 523], { duration: 0.2, spacing: 0.07, gain: 0.085 }),
  no_match: () => EFFECTS.invalid_card(),
  bust: () => {
    tone({ frequency: 190, endFrequency: 42, duration: 0.42, gain: 0.2, type: "sawtooth" });
    noise({ duration: 0.3, gain: 0.12, highpass: 180 });
  },
  timer_warning: () => {
    tone({ frequency: 880, endFrequency: 700, duration: 0.09, gain: 0.09, type: "square" });
    tone({ frequency: 880, endFrequency: 700, duration: 0.09, delay: 0.14, gain: 0.09, type: "square" });
  },
  target_clear: () => arpeggio([392, 494, 587, 784, 988], { duration: 0.3, spacing: 0.07, gain: 0.09 }),
  level_clear: () => EFFECTS.target_clear(),
  fever_start: () => arpeggio([330, 440, 554, 659, 880], { duration: 0.22, spacing: 0.04, gain: 0.09, type: "sawtooth" }),
  fever_end: () => tone({ frequency: 660, endFrequency: 160, duration: 0.34, gain: 0.11, type: "triangle" }),
  game_over: () => arpeggio([330, 294, 247, 196], { duration: 0.32, spacing: 0.11, gain: 0.09, type: "triangle" })
};

const HAPTIC_BY_SOUND = {
  card_select: "select",
  card_deselect: "deselect",
  crunch_start: "crunch",
  card_resolve: "match",
  double_match: "match",
  math_combo: "match",
  score_arrive: "score",
  bank: "bank",
  revive: "score",
  timer_warning: "warning",
  bust: "bust",
  game_over: "gameOver"
};

function syncMusic() {
  if (!settings.music || document.hidden || !context || context.state !== "running") {
    stopMusic();
    return;
  }
  if (musicTimer) return;
  scheduleMusicBeat();
  musicTimer = window.setInterval(scheduleMusicBeat, 1450);
}

function scheduleMusicBeat() {
  if (!context || !musicBus || !settings.music) return;
  const progression = [
    [110, 165, 220],
    [98, 147, 196],
    [123.47, 185, 247],
    [82.41, 123.47, 164.81]
  ];
  const chordNotes = progression[musicStep % progression.length];
  chordNotes.forEach((frequency, index) => tone({
    frequency,
    endFrequency: frequency,
    duration: 1.25,
    delay: index * 0.035,
    gain: 0.05,
    type: index === 0 ? "triangle" : "sine",
    destination: musicBus
  }));
  musicStep += 1;
}

function stopMusic() {
  if (!musicTimer) return;
  window.clearInterval(musicTimer);
  musicTimer = null;
}

function createNoiseBuffer(audioContext) {
  const length = Math.floor(audioContext.sampleRate * 0.5);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { sound: saved.sound !== false, music: saved.music !== false };
  } catch {
    return { sound: true, music: true };
  }
}
