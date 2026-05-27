const RUN_SAVE_KEY = "cardCrunchRunSave";

export function loadRunSave() {
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_SAVE_KEY) ?? "null");
    if (!saved || saved.version !== 1) return null;
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
    version: 1,
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
    sessionCrunches: state.sessionCrunches,
    fever: state.fever,
    timeLeft: state.timeLeft
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
