export const SCORE_SURGE_CONFIG = Object.freeze({
  minimumScore: 10_000,
  milestoneStep: 10_000,
  maximumVisibleMilestones: 120
});

const SCORE_SURGE_TIERS = Object.freeze([
  { minimum: 1_000_000, tier: 6, name: "Million Crunch", peakDuration: 660 },
  { minimum: 500_000, tier: 5, name: "Mega Crunch", peakDuration: 570 },
  { minimum: 100_000, tier: 4, name: "Cash Burst", peakDuration: 490 },
  { minimum: 50_000, tier: 3, name: "Big Crunch", peakDuration: 410 },
  { minimum: 20_000, tier: 2, name: "Hot Crunch", peakDuration: 330 },
  { minimum: 10_000, tier: 1, name: "Score Surge", peakDuration: 250 }
]);

export function getScoreSurgeTier(score = 0) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  return SCORE_SURGE_TIERS.find(({ minimum }) => safeScore >= minimum)
    ?? { minimum: Number.POSITIVE_INFINITY, tier: 0, name: "", peakDuration: 0 };
}

export function buildScoreSurgeMilestones(score = 0) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  if (safeScore < SCORE_SURGE_CONFIG.minimumScore) return [];

  const milestoneCount = Math.floor(safeScore / SCORE_SURGE_CONFIG.milestoneStep);
  if (milestoneCount <= SCORE_SURGE_CONFIG.maximumVisibleMilestones) {
    return Array.from(
      { length: milestoneCount },
      (_, index) => (index + 1) * SCORE_SURGE_CONFIG.milestoneStep
    );
  }

  const sampledIndexes = [1];
  const interiorSlots = SCORE_SURGE_CONFIG.maximumVisibleMilestones - 2;
  for (let index = 1; index <= interiorSlots; index += 1) {
    const sourceIndex = 1 + Math.round(index * (milestoneCount - 1) / (interiorSlots + 1));
    if (sourceIndex > sampledIndexes[sampledIndexes.length - 1]) sampledIndexes.push(sourceIndex);
  }
  if (sampledIndexes[sampledIndexes.length - 1] !== milestoneCount) sampledIndexes.push(milestoneCount);
  return sampledIndexes.map((index) => index * SCORE_SURGE_CONFIG.milestoneStep);
}

export function createScoreSurgePlan(score = 0) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const tier = getScoreSurgeTier(safeScore);
  return {
    score: safeScore,
    tier: tier.tier,
    name: tier.name,
    peakDuration: tier.peakDuration,
    milestones: buildScoreSurgeMilestones(safeScore)
  };
}
