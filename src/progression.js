export const LEVEL_TARGETS = [5000, 15000, 35000, 75000, 150000];

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
