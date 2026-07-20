import { haptic } from "./haptics.js?v=155";

const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
const SETTINGS_KEY = "cardCrunchSettings";
const MAX_ACTIVE_VOICES = 28;
const CARD_PLAY_SAMPLE_URL = new URL("../assets/sfx/playing-card.mp3", import.meta.url).href;
const DEAL_SAMPLE_URLS = [1, 2, 3, 4].map((index) => new URL(`../assets/sfx/deal-hand-${index}.mp3`, import.meta.url).href);
const CARD_PLAY_MAX_VOICES = 4;
const DEAL_SAMPLE_MAX_VOICES = 3;
const CARD_PLAY_VARIANTS = [
  { rate: .94, gain: .27, pan: -.08, offset: .002 },
  { rate: .985, gain: .3, pan: .04, offset: .006 },
  { rate: 1.025, gain: .255, pan: -.03, offset: 0 },
  { rate: 1.06, gain: .28, pan: .08, offset: .009 }
];

let context = null;
let master = null;
let musicBus = null;
let noiseBuffer = null;
let musicTimer = null;
let musicStep = 0;
let activeVoices = 0;
let shardImpactStep = 0;
let lastShardHapticAt = 0;
let cardPlayBuffer = null;
let cardPlayBufferPromise = null;
let lastCardPlayVariant = -1;
const activeCardPlayVoices = new Set();
let dealBuffers = [];
let dealBufferPromise = null;
let dealSamplePool = [];
let lastDealSampleIndex = -1;
const activeDealVoices = new Set();
let settings = readSettings();
const cardPlayEncodedPromise = fetch(CARD_PLAY_SAMPLE_URL, { cache: "force-cache" })
  .then((response) => {
    if (!response.ok) throw new Error(`Card play sample failed: ${response.status}`);
    return response.arrayBuffer();
  })
  .catch(() => null);
const dealEncodedPromises = DEAL_SAMPLE_URLS.map((url) => fetch(url, { cache: "force-cache" })
  .then((response) => {
    if (!response.ok) throw new Error(`Deal sample failed: ${response.status}`);
    return response.arrayBuffer();
  })
  .catch(() => null));

export function installAudioUnlock() {
  const unlock = () => {
    ensureAudio();
    context?.resume?.().catch(() => {});
    void loadCardPlayBuffer();
    void loadDealBuffers();
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

/* Each physical bank contact gets a very short low-gain voice. The clips are
   intentionally tiny so even a full-hand stream reads as coins without clipping. */
export function playCrunchShardImpact({ progress = 0.5, strength = 1 } = {}) {
  const arrival = Math.max(0, Math.min(1, progress));
  const impactStrength = Math.max(.45, Math.min(1.8, strength));
  const now = performance.now();
  const isFinalImpact = arrival >= .999;
  if (isFinalImpact || now - lastShardHapticAt >= 42) {
    lastShardHapticAt = now;
    haptic(impactStrength >= 1.2 || isFinalImpact ? "bankShardHeavy" : "bankShard", {
      force: isFinalImpact
    });
  }

  if (!settings.sound) return;
  const audio = ensureAudio();
  if (!audio) return;
  if (audio.state === "suspended") audio.resume?.().catch(() => {});

  shardImpactStep += 1;

  const jitter = ((shardImpactStep * 17) % 9) - 4;
  const gain = Math.min(0.021, 0.006 + impactStrength * 0.0065);
  const frequency = 185 + arrival * 82 + jitter * 5;
  tone({
    frequency,
    endFrequency: Math.max(58, frequency * 0.42),
    duration: 0.034,
    gain,
    type: "square"
  });
  noise({
    duration: 0.026,
    gain: Math.min(0.014, 0.003 + impactStrength * 0.0045),
    highpass: 720 + arrival * 540
  });
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

function loadCardPlayBuffer() {
  if (cardPlayBuffer) return Promise.resolve(cardPlayBuffer);
  if (!context) return Promise.resolve(null);
  if (cardPlayBufferPromise) return cardPlayBufferPromise;
  cardPlayBufferPromise = cardPlayEncodedPromise
    .then((encoded) => encoded ? context.decodeAudioData(encoded) : null)
    .then((buffer) => {
      cardPlayBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
  return cardPlayBufferPromise;
}

function loadDealBuffers() {
  if (dealBuffers.length) return Promise.resolve(dealBuffers);
  if (!context) return Promise.resolve([]);
  if (dealBufferPromise) return dealBufferPromise;
  dealBufferPromise = Promise.all(dealEncodedPromises)
    .then((encodedSamples) => Promise.all(encodedSamples.map((encoded) => (
      encoded ? context.decodeAudioData(encoded) : Promise.resolve(null)
    ))))
    .then((buffers) => {
      dealBuffers = buffers.filter(Boolean);
      return dealBuffers;
    })
    .catch(() => []);
  return dealBufferPromise;
}

function playCardThrowSample() {
  if (!context || !cardPlayBuffer || activeVoices >= MAX_ACTIVE_VOICES) {
    void loadCardPlayBuffer();
    return false;
  }

  let variantIndex = Math.floor(Math.random() * (CARD_PLAY_VARIANTS.length - 1));
  if (variantIndex >= lastCardPlayVariant) variantIndex += 1;
  lastCardPlayVariant = variantIndex;
  const variant = CARD_PLAY_VARIANTS[variantIndex];
  const source = context.createBufferSource();
  const envelope = context.createGain();
  const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
  const microVariation = 1 + (Math.random() - .5) * .018;
  const start = context.currentTime;
  const offset = Math.min(variant.offset, Math.max(0, cardPlayBuffer.duration - .04));
  const playbackDuration = Math.max(.04, (cardPlayBuffer.duration - offset) / (variant.rate * microVariation));
  const end = start + playbackDuration;

  if (activeCardPlayVoices.size >= CARD_PLAY_MAX_VOICES) {
    const oldest = activeCardPlayVoices.values().next().value;
    if (oldest && activeCardPlayVoices.delete(oldest)) activeVoices = Math.max(0, activeVoices - 1);
    try { oldest?.stop(start); } catch {}
  }

  activeVoices += 1;
  activeCardPlayVoices.add(source);
  source.buffer = cardPlayBuffer;
  source.playbackRate.setValueAtTime(variant.rate * microVariation, start);
  envelope.gain.setValueAtTime(.0001, start);
  envelope.gain.exponentialRampToValueAtTime(variant.gain, start + .008);
  envelope.gain.setValueAtTime(variant.gain, Math.max(start + .01, end - .025));
  envelope.gain.exponentialRampToValueAtTime(.0001, end);
  if (panner) panner.pan.setValueAtTime(variant.pan, start);

  source.connect(envelope);
  if (panner) {
    envelope.connect(panner);
    panner.connect(master);
  } else {
    envelope.connect(master);
  }
  source.start(start, offset);
  source.addEventListener("ended", () => {
    if (activeCardPlayVoices.delete(source)) activeVoices = Math.max(0, activeVoices - 1);
    source.disconnect();
    envelope.disconnect();
    panner?.disconnect();
  }, { once: true });
  return true;
}

function playDealSample() {
  if (!context || !dealBuffers.length || activeVoices >= MAX_ACTIVE_VOICES) {
    void loadDealBuffers();
    return false;
  }

  if (!dealSamplePool.length) {
    dealSamplePool = dealBuffers.map((_, index) => index);
    for (let index = dealSamplePool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [dealSamplePool[index], dealSamplePool[swapIndex]] = [dealSamplePool[swapIndex], dealSamplePool[index]];
    }
    if (dealSamplePool.length > 1 && dealSamplePool[0] === lastDealSampleIndex) {
      [dealSamplePool[0], dealSamplePool[1]] = [dealSamplePool[1], dealSamplePool[0]];
    }
  }

  const sampleIndex = dealSamplePool.shift();
  const buffer = dealBuffers[sampleIndex];
  if (!buffer) return false;
  lastDealSampleIndex = sampleIndex;

  const start = context.currentTime;
  const source = context.createBufferSource();
  const envelope = context.createGain();
  const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
  const playbackRate = .985 + Math.random() * .03;
  const gain = .255 + Math.random() * .035;
  const end = start + Math.max(.04, buffer.duration / playbackRate);

  if (activeDealVoices.size >= DEAL_SAMPLE_MAX_VOICES) {
    const oldest = activeDealVoices.values().next().value;
    if (oldest && activeDealVoices.delete(oldest)) activeVoices = Math.max(0, activeVoices - 1);
    try { oldest?.stop(start); } catch {}
  }

  activeVoices += 1;
  activeDealVoices.add(source);
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(playbackRate, start);
  envelope.gain.setValueAtTime(.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + .006);
  envelope.gain.setValueAtTime(gain, Math.max(start + .008, end - .024));
  envelope.gain.exponentialRampToValueAtTime(.0001, end);
  if (panner) panner.pan.setValueAtTime((sampleIndex - 1.5) * .035, start);

  source.connect(envelope);
  if (panner) {
    envelope.connect(panner);
    panner.connect(master);
  } else {
    envelope.connect(master);
  }
  source.start(start);
  source.addEventListener("ended", () => {
    if (activeDealVoices.delete(source)) activeVoices = Math.max(0, activeVoices - 1);
    source.disconnect();
    envelope.disconnect();
    panner?.disconnect();
  }, { once: true });
  return true;
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
    if (playCardThrowSample()) return;
    tone({ frequency: 520, endFrequency: 690, duration: 0.055, gain: 0.075, type: "triangle" });
    noise({ duration: 0.035, gain: 0.035, highpass: 2200 });
  },
  card_deselect: () => tone({ frequency: 460, endFrequency: 300, duration: 0.06, gain: 0.06, type: "triangle" }),
  card_deal: () => {
    if (playDealSample()) return;
    tone({ frequency: 390, endFrequency: 520, duration: .045, gain: .045, type: "triangle" });
    noise({ duration: .026, gain: .022, highpass: 1800 });
  },
  pack_buy: () => arpeggio([330, 440, 554], { duration: .11, spacing: .045, gain: .065, type: "triangle" }),
  pack_open: () => {
    tone({ frequency: 148, endFrequency: 74, duration: .22, gain: .11, type: "square" });
    noise({ duration: .18, gain: .075, highpass: 960 });
  },
  card_unlock: () => {
    arpeggio([523, 659, 784, 1047, 1319], { duration: .2, spacing: .055, gain: .085, type: "triangle" });
    noise({ duration: .07, gain: .035, highpass: 3000 });
  },
  valid_add: () => arpeggio([440, 660], { gain: 0.065 }),
  invalid_card: () => {
    tone({ frequency: 150, endFrequency: 75, duration: 0.18, gain: 0.12, type: "sawtooth" });
    noise({ duration: 0.16, gain: 0.08, highpass: 260 });
  },
  crunch_start: () => {
    tone({ frequency: 110, endFrequency: 46, duration: 0.21, gain: 0.18, type: "square" });
    noise({ duration: 0.09, gain: 0.09, highpass: 1200 });
  },
  crunch_vacuum: () => {
    tone({ frequency: 82, endFrequency: 176, duration: 0.42, gain: 0.045, type: "sawtooth" });
    noise({ duration: 0.46, gain: 0.026, highpass: 420 });
  },
  crunch_hit_1: () => {
    tone({ frequency: 178, endFrequency: 82, duration: 0.075, gain: 0.075, type: "square" });
    noise({ duration: 0.065, gain: 0.04, highpass: 920 });
  },
  crunch_hit_2: () => {
    tone({ frequency: 146, endFrequency: 58, duration: 0.095, gain: 0.095, type: "square" });
    noise({ duration: 0.085, gain: 0.055, highpass: 680 });
  },
  crunch_hit_3: () => {
    tone({ frequency: 112, endFrequency: 36, duration: 0.16, gain: 0.13, type: "sawtooth" });
    noise({ duration: 0.14, gain: 0.085, highpass: 430 });
    tone({ frequency: 72, endFrequency: 42, duration: 0.12, delay: 0.025, gain: 0.07, type: "square" });
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
  score_ramp_tick: () => {
    tone({ frequency: 740, endFrequency: 980, duration: 0.1, gain: 0.065, type: "triangle" });
    tone({ frequency: 1480, endFrequency: 1760, duration: 0.075, delay: 0.025, gain: 0.028, type: "sine" });
  },
  score_ramp_peak: () => {
    arpeggio([523, 659, 784, 1047, 1319, 1568], { duration: 0.24, spacing: 0.055, gain: 0.095, type: "triangle" });
    chord([262, 523, 1047], { duration: 0.42, gain: 0.085, type: "square", rise: 1.02 });
    noise({ duration: 0.12, gain: 0.055, highpass: 2600 });
  },
  coin_milestone: () => {
    arpeggio([988, 1319, 1568], { duration: 0.11, spacing: 0.034, gain: 0.052, type: "square" });
    tone({ frequency: 1976, endFrequency: 1568, duration: 0.085, delay: 0.07, gain: 0.035, type: "sine" });
  },
  coin_collect: () => {
    tone({
      frequency: 1180 + Math.random() * 180,
      endFrequency: 860 + Math.random() * 120,
      duration: 0.07,
      gain: 0.035,
      type: "square"
    });
    noise({ duration: 0.035, gain: 0.018, highpass: 2200 });
  },
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
  pack_buy: "select",
  pack_open: "crunch",
  card_unlock: "score",
  crunch_start: "crunch",
  crunch_hit_1: "select",
  crunch_hit_2: "match",
  crunch_hit_3: "crunch",
  card_resolve: "match",
  double_match: "match",
  math_combo: "match",
  score_ramp_peak: "score",
  coin_milestone: "score",
  coin_collect: "score",
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
