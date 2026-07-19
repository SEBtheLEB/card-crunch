export const SCORE_SURGE_CONFIG = Object.freeze({
  minimumScore: 10_000,
  baseMilestones: Object.freeze([
    10_000,
    20_000,
    30_000,
    50_000,
    80_000,
    120_000,
    200_000,
    350_000,
    500_000,
    750_000,
    1_000_000
  ]),
  maximumVisibleMilestones: 18
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

  const milestones = SCORE_SURGE_CONFIG.baseMilestones.filter((milestone) => milestone <= safeScore);
  let magnitude = 1_000_000;
  while (magnitude < safeScore) {
    for (const multiplier of [2, 3, 5, 8, 10]) {
      const milestone = magnitude * multiplier;
      if (milestone > 1_000_000 && milestone <= safeScore && !milestones.includes(milestone)) {
        milestones.push(milestone);
      }
    }
    magnitude *= 10;
  }

  milestones.sort((left, right) => left - right);
  if (milestones.length <= SCORE_SURGE_CONFIG.maximumVisibleMilestones) return milestones;

  const sampled = [milestones[0]];
  const interiorSlots = SCORE_SURGE_CONFIG.maximumVisibleMilestones - 2;
  for (let index = 1; index <= interiorSlots; index += 1) {
    const sourceIndex = Math.round(index * (milestones.length - 1) / (interiorSlots + 1));
    const milestone = milestones[sourceIndex];
    if (milestone > sampled[sampled.length - 1]) sampled.push(milestone);
  }
  if (sampled[sampled.length - 1] !== milestones[milestones.length - 1]) {
    sampled.push(milestones[milestones.length - 1]);
  }
  return sampled;
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
