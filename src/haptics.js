const PATTERNS = {
  tap: { style: "LIGHT", fallback: 5 },
  select: { style: "LIGHT", fallback: 8 },
  deselect: { style: "LIGHT", fallback: 5 },
  crunch: { style: "HEAVY", fallback: [18, 24, 34] },
  match: { style: "MEDIUM", fallback: [12, 18, 18] },
  score: { notification: "SUCCESS", fallback: [14, 18, 28] },
  bank: { notification: "SUCCESS", fallback: [18, 24, 38] },
  warning: { notification: "WARNING", fallback: [20, 34, 20] },
  bust: { notification: "ERROR", fallback: [45, 35, 70] },
  gameOver: { notification: "ERROR", fallback: [55, 45, 80] }
};

let lastAt = 0;

export async function haptic(name = "tap", { force = false } = {}) {
  const now = performance.now();
  if (!force && now - lastAt < 28) return;
  lastAt = now;

  const pattern = PATTERNS[name] ?? PATTERNS.tap;
  const native = globalThis.Capacitor?.Plugins?.Haptics;

  try {
    if (native && pattern.notification) {
      await native.notification({ type: pattern.notification });
      return;
    }
    if (native && pattern.style) {
      await native.impact({ style: pattern.style });
      return;
    }
  } catch {
    // Fall through to the browser vibration API.
  }

  try {
    navigator.vibrate?.(pattern.fallback);
  } catch {
    // Haptics are optional and must never interrupt gameplay.
  }
}

export function hapticSelectionStart() {
  const native = globalThis.Capacitor?.Plugins?.Haptics;
  native?.selectionStart?.().catch?.(() => {});
}

export function hapticSelectionChanged() {
  const native = globalThis.Capacitor?.Plugins?.Haptics;
  if (native?.selectionChanged) {
    native.selectionChanged().catch?.(() => {});
  } else {
    haptic("select");
  }
}

export function hapticSelectionEnd() {
  const native = globalThis.Capacitor?.Plugins?.Haptics;
  native?.selectionEnd?.().catch?.(() => {});
}
