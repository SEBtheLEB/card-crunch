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
