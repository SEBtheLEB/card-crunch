export const LEVEL_TARGETS = [1000000, 1500000, 2500000, 4000000, 6500000, 10000000];

export function getTargetForLevel(level) {
  if (level <= LEVEL_TARGETS.length) return LEVEL_TARGETS[level - 1];
  const extraLevel = level - LEVEL_TARGETS.length;
  return LEVEL_TARGETS[LEVEL_TARGETS.length - 1] + extraLevel * 90000;
}

export function getLevelProgress(score, level) {
  const target = getTargetForLevel(level);
  return {
    target,
    progress: Math.min(1, score / target),
    remaining: Math.max(0, target - score)
  };
}

export function createDefaultPots() {
  return LEVEL_TARGETS.map((target, index) => ({
    id: index + 1,
    target,
    progress: 0,
    complete: false
  }));
}

export function isPotUnlocked(pots, potId) {
  if (potId <= 1) return true;
  const previousPot = pots.find((pot) => pot.id === potId - 1);
  return Boolean(previousPot?.complete);
}

export function getPotCheckpoint(pot) {
  if (!pot?.target) return 0;
  const interval = pot.target / 5;
  return Math.min(pot.target, Math.floor((pot.progress ?? 0) / interval) * interval);
}

export function getNextPotCheckpoint(pot) {
  if (!pot?.target) return 0;
  const interval = pot.target / 5;
  return Math.min(pot.target, (Math.floor((pot.progress ?? 0) / interval) + 1) * interval);
}
