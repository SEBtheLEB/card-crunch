import { economy } from "./economy.js?v=164";
import { boosterInventory } from "./boosters.js?v=201";

const STORAGE_KEY = "cardCrunchLiveEventsV1";
const DAY_MS = 86_400_000;
const WEEK_MS = DAY_MS * 7;
const SEASON_LEVEL_XP = 500;
const listeners = new Set();

const DAILY_CHALLENGES = Object.freeze([
  { slug: "big-bank", title: "Big Bank Day", description: "Bank 500K Run Cash.", metric: "bankCash", target: 500_000, reward: { coins: 125 }, icon: "\u25C6" },
  { slug: "crunch-rush", title: "Crunch Rush", description: "Land 12 successful Crunches.", metric: "successfulCrunches", target: 12, reward: { coins: 100 }, icon: "\u2726" },
  { slug: "quick-draw", title: "Quick Draw", description: "Land 5 Lightning Crunches.", metric: "lightningCrunches", target: 5, reward: { coins: 125 }, icon: "\u23F1" },
  { slug: "combo-builder", title: "Combo Builder", description: "Reach a 6-Crunch streak.", metric: "bestStreak", target: 6, reward: { coins: 100 }, icon: "\u2668" }
]);

const WEEKLY_CHALLENGES = Object.freeze([
  { slug: "ten-pot-tour", title: "Ten Pot Tour", description: "Finish ten Pot Journey runs.", metric: "potRuns", target: 10, reward: { coins: 500, booster: "retry-token" }, icon: "\u265B" },
  { slug: "millionaire", title: "Millionaire Week", description: "Bank 3M Run Cash across your Pots.", metric: "bankCash", target: 3_000_000, reward: { coins: 500, booster: "crunch-bonus" }, icon: "\u25C6" },
  { slug: "crunch-marathon", title: "Crunch Marathon", description: "Land 75 successful Crunches.", metric: "successfulCrunches", target: 75, reward: { coins: 450, booster: "extra-time" }, icon: "\u2726" }
]);

const LIMITED_CHALLENGES = Object.freeze([
  { slug: "hearts-rush", title: "Hearts Rush", description: "Crunch 15 Heart cards.", metric: "heartCards", target: 15, reward: { coins: 250, booster: "crunch-bonus" }, icon: "\u2665" },
  { slug: "math-mayhem", title: "Math Mayhem", description: "Land 10 Sum or Minus Crunches.", metric: "mathCrunches", target: 10, reward: { coins: 250, booster: "extra-time" }, icon: "\u00B1" },
  { slug: "full-hand-fiesta", title: "Full Hand Fiesta", description: "Power up 2 complete hands.", metric: "fullHands", target: 2, reward: { coins: 300, booster: "retry-token" }, icon: "4X" }
]);

let state = loadState();

export const liveEvents = {
  getSnapshot(now = Date.now()) {
    syncPeriods(now);
    return createSnapshot(now);
  },

  record(type, payload = {}, now = Date.now()) {
    syncPeriods(now);
    const deltas = getMetricDeltas(type, payload);
    let changed = false;
    for (const metricSet of Object.values(state.metrics)) {
      for (const [metric, delta] of Object.entries(deltas)) {
        if (!delta) continue;
        metricSet[metric] = metric === "bestStreak"
          ? Math.max(metricSet[metric] ?? 0, delta)
          : (metricSet[metric] ?? 0) + delta;
        changed = true;
      }
    }
    const xp = getSeasonXp(type, payload);
    if (xp > 0) {
      state.seasonXp += xp;
      grantSeasonLevelRewards();
      changed = true;
    }
    if (changed) commit();
    return createSnapshot(now);
  },

  claim(challengeId, now = Date.now()) {
    syncPeriods(now);
    const challenge = getActiveChallenges(now).find((item) => item.id === challengeId);
    if (!challenge || challenge.claimed || challenge.progress < challenge.target) return null;
    state.claimed[challenge.id] = true;
    const coins = economy.addCoins(challenge.reward.coins ?? 0);
    const booster = challenge.reward.booster
      ? boosterInventory.grant(challenge.reward.booster, 1)
      : 0;
    commit();
    return { coins, boosterId: booster ? challenge.reward.booster : null };
  },

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  mergeRemoteSnapshot(remote = {}, now = Date.now()) {
    syncPeriods(now);
    if (!remote || typeof remote !== "object") return false;
    let changed = false;
    if (remote.dailyId === state.dailyId) changed = mergeMetrics(state.metrics.daily, remote.metrics?.daily) || changed;
    if (remote.weeklyId === state.weeklyId) {
      changed = mergeMetrics(state.metrics.weekly, remote.metrics?.weekly) || changed;
      changed = mergeMetrics(state.metrics.limited, remote.metrics?.limited) || changed;
    }
    if (remote.seasonId === state.seasonId) {
      const mergedXp = Math.max(state.seasonXp, Math.max(0, Number(remote.seasonXp) || 0));
      const mergedRewards = Math.max(state.seasonRewardsGranted, Math.max(0, Math.floor(Number(remote.seasonRewardsGranted) || 0)));
      changed = mergedXp !== state.seasonXp || mergedRewards !== state.seasonRewardsGranted || changed;
      state.seasonXp = mergedXp;
      state.seasonRewardsGranted = mergedRewards;
    }
    Object.entries(remote.claimed ?? {}).forEach(([id, claimed]) => {
      if (!claimed || state.claimed[id]) return;
      state.claimed[id] = true;
      changed = true;
    });
    if (changed) commit();
    return changed;
  },

  reset() {
    state = createDefaultState(Date.now());
    commit();
  }
};

function createDefaultState(now) {
  return {
    version: 1,
    dailyId: getDailyId(now),
    weeklyId: getWeeklyId(now),
    seasonId: getSeasonId(now),
    metrics: createEmptyMetricSets(),
    claimed: {},
    seasonXp: 0,
    seasonRewardsGranted: 0
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return createDefaultState(Date.now());
    return {
      ...createDefaultState(Date.now()),
      ...saved,
      metrics: normalizeMetricSets(saved.metrics),
      claimed: { ...(saved.claimed ?? {}) }
    };
  } catch {
    return createDefaultState(Date.now());
  }
}

function createEmptyMetrics() {
  return {
    bankCash: 0,
    successfulCrunches: 0,
    lightningCrunches: 0,
    bestStreak: 0,
    potRuns: 0,
    heartCards: 0,
    mathCrunches: 0,
    fullHands: 0,
    potsCleared: 0
  };
}

function createEmptyMetricSets() {
  return {
    daily: createEmptyMetrics(),
    weekly: createEmptyMetrics(),
    limited: createEmptyMetrics()
  };
}

function mergeMetrics(target, remote) {
  if (!remote || typeof remote !== "object") return false;
  let changed = false;
  Object.keys(target).forEach((metric) => {
    const merged = Math.max(target[metric] ?? 0, Math.max(0, Number(remote[metric]) || 0));
    if (merged === target[metric]) return;
    target[metric] = merged;
    changed = true;
  });
  return changed;
}

function normalizeMetricSets(savedMetrics) {
  if (savedMetrics?.daily && savedMetrics?.weekly && savedMetrics?.limited) {
    return {
      daily: { ...createEmptyMetrics(), ...savedMetrics.daily },
      weekly: { ...createEmptyMetrics(), ...savedMetrics.weekly },
      limited: { ...createEmptyMetrics(), ...savedMetrics.limited }
    };
  }
  return createEmptyMetricSets();
}

function syncPeriods(now) {
  const dailyId = getDailyId(now);
  const weeklyId = getWeeklyId(now);
  const seasonId = getSeasonId(now);
  let changed = false;
  if (state.dailyId !== dailyId) {
    state.metrics.daily = createEmptyMetrics();
    Object.keys(state.claimed).filter((id) => id.startsWith("daily:")).forEach((id) => delete state.claimed[id]);
    state.dailyId = dailyId;
    changed = true;
  }
  if (state.weeklyId !== weeklyId) {
    state.metrics.weekly = createEmptyMetrics();
    state.metrics.limited = createEmptyMetrics();
    Object.keys(state.claimed)
      .filter((id) => id.startsWith("weekly:") || id.startsWith("limited:"))
      .forEach((id) => delete state.claimed[id]);
    state.weeklyId = weeklyId;
    changed = true;
  }
  if (state.seasonId !== seasonId) {
    state.seasonId = seasonId;
    state.seasonXp = 0;
    state.seasonRewardsGranted = 0;
    changed = true;
  }
  if (changed) commit();
}

function getActiveChallenges(now) {
  const daily = decorateChallenge(DAILY_CHALLENGES[hashPeriod(getDailyId(now)) % DAILY_CHALLENGES.length], "daily", state.dailyId, now);
  const weekly = decorateChallenge(WEEKLY_CHALLENGES[hashPeriod(getWeeklyId(now)) % WEEKLY_CHALLENGES.length], "weekly", state.weeklyId, now);
  const limited = decorateChallenge(LIMITED_CHALLENGES[hashPeriod(getWeeklyId(now) + "-limited") % LIMITED_CHALLENGES.length], "limited", state.weeklyId, now);
  return [daily, weekly, limited];
}

function decorateChallenge(definition, cadence, periodId, now) {
  const id = `${cadence}:${periodId}:${definition.slug}`;
  const progress = Math.min(definition.target, Math.max(0, state.metrics[cadence]?.[definition.metric] ?? 0));
  return {
    ...definition,
    id,
    cadence,
    progress,
    claimed: Boolean(state.claimed[id]),
    expiresAt: cadence === "daily" ? getNextDay(now) : getNextWeek(now)
  };
}

function createSnapshot(now) {
  const challenges = getActiveChallenges(now);
  const seasonLevel = Math.floor(state.seasonXp / SEASON_LEVEL_XP) + 1;
  return {
    challenges,
    daily: challenges[0],
    weekly: challenges[1],
    limited: challenges[2],
    season: {
      id: state.seasonId,
      level: seasonLevel,
      xp: state.seasonXp % SEASON_LEVEL_XP,
      target: SEASON_LEVEL_XP,
      nextRewardCoins: 25 + Math.min(100, seasonLevel * 5),
      endsAt: getNextMonth(now)
    }
  };
}

function getMetricDeltas(type, payload) {
  if (type === "crunch") {
    const matchTypes = Array.isArray(payload.matchTypes) ? payload.matchTypes : [];
    const suits = Array.isArray(payload.suits) ? payload.suits : [];
    return {
      successfulCrunches: 1,
      lightningCrunches: payload.speedLabel === "LIGHTNING" ? 1 : 0,
      bestStreak: Math.max(0, Number(payload.streak) || 0),
      heartCards: suits.filter((suit) => suit === "hearts").length,
      mathCrunches: matchTypes.filter((typeName) => typeName === "add" || typeName === "subtract").length,
      fullHands: payload.fullHand ? 1 : 0
    };
  }
  if (type === "bank") return { bankCash: Math.max(0, Number(payload.amount) || 0) };
  if (type === "run-end" && payload.mode === "pot") return { potRuns: 1 };
  if (type === "pot-clear") return { potsCleared: 1 };
  return {};
}

function getSeasonXp(type, payload) {
  if (type === "crunch") return 10 + Math.min(30, Math.max(1, Number(payload.selectedCount) || 1) * 5) + (payload.fullHand ? 25 : 0);
  if (type === "bank") return 20;
  if (type === "pot-clear") return 100;
  if (type === "run-end") return 10;
  return 0;
}

function grantSeasonLevelRewards() {
  const completedLevels = Math.floor(state.seasonXp / SEASON_LEVEL_XP);
  while (state.seasonRewardsGranted < completedLevels) {
    state.seasonRewardsGranted += 1;
    economy.addCoins(25 + Math.min(100, state.seasonRewardsGranted * 5));
    if (state.seasonRewardsGranted % 5 === 0) boosterInventory.grant("crunch-bonus", 1);
  }
}

function commit() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode/storage quota must not interrupt a run.
  }
  const snapshot = createSnapshot(Date.now());
  listeners.forEach((listener) => listener(snapshot));
}

function getDailyId(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function getWeeklyId(now) {
  const date = new Date(now);
  const utcDay = date.getUTCDay() || 7;
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - utcDay + 1);
  return new Date(monday).toISOString().slice(0, 10);
}

function getSeasonId(now) {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getNextDay(now) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function getNextWeek(now) {
  return new Date(`${getWeeklyId(now)}T00:00:00.000Z`).getTime() + WEEK_MS;
}

function getNextMonth(now) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function hashPeriod(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
