const RUN_SAVE_KEY = "cardCrunchRunSave";
const SHIELD_TOKEN_KEY = "cardCrunchShieldToken";

export function loadRunSave() {
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_SAVE_KEY) ?? "null");
    if (!saved || saved.version !== 2) return null;
    if (!Array.isArray(saved.deck) || !Array.isArray(saved.discard) || !Array.isArray(saved.stack) || !Array.isArray(saved.hand)) {
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export function saveRunState(state) {
  if (!state.activePot) {
    clearRunSave();
    return;
  }

  if (state.status !== "playing") return;

  const save = {
    version: 2,
    savedAt: Date.now(),
    activePotId: state.activePot.id,
    deck: state.deck,
    discard: state.discard,
    stack: state.stack,
    hand: state.hand,
    selectedHandIndexes: state.selectedHandIndexes,
    score: state.score,
    bestScore: state.bestScore,
    streak: state.streak,
    misses: state.misses,
    level: state.level,
    target: state.target,
    fever: state.fever,
    timeLeft: state.timeLeft,
    bankMultiplier: state.bankMultiplier,
    bestRunMultiplier: state.bestRunMultiplier,
    bestRunStreak: state.bestRunStreak,
    bankedThisRun: state.bankedThisRun,
    runGrossCash: state.runGrossCash,
    coinsEarnedThisRun: state.coinsEarnedThisRun,
    coinRewardGranted: state.coinRewardGranted,
    lastBankDeposit: state.lastBankDeposit,
    bonusBankAdUsedForLastDeposit: state.bonusBankAdUsedForLastDeposit,
    reviveAdUsedThisRun: state.reviveAdUsedThisRun,
    hintAdUsedThisRun: state.hintAdUsedThisRun,
    safeBankShieldActive: state.safeBankShieldActive
  };

  try {
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(save));
  } catch {
    // Ignore storage quota/private-mode errors; gameplay should continue.
  }
}

export function clearRunSave() {
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/* Safe Bank Shield token: earned via rewarded ad on the pots screen,
   consumed the first time it triggers at 0 lives. */

export function hasShieldToken() {
  try {
    return localStorage.getItem(SHIELD_TOKEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function grantShieldToken() {
  try {
    localStorage.setItem(SHIELD_TOKEN_KEY, "1");
  } catch {
    // Ignore storage errors.
  }
}

export function consumeShieldToken() {
  try {
    localStorage.removeItem(SHIELD_TOKEN_KEY);
  } catch {
    // Ignore storage errors.
  }
}
