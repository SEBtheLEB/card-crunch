export const ECONOMY_CONFIG = Object.freeze({
  coinAdReward: 125,
  coinAdsPerDay: 3,
  crunchCashMilestone: 100000,
  coinsPerCrunchMilestone: 10,
  mysteryCardPackCost: 125,
  pinkArcadeDeckCost: 1500,
  shieldCoinCost: 500,
  coinPackAmount: 1500,
  coinPackProductId: "card_crunch_coin_pack_1500"
});

export function calculateCrunchMilestoneCoinReward({ fromCash = 0, toCash = 0 } = {}) {
  const step = ECONOMY_CONFIG.crunchCashMilestone;
  const start = Math.max(0, Number(fromCash) || 0);
  const end = Math.max(start, Number(toCash) || 0);
  const milestones = Math.max(0, Math.floor(end / step) - Math.floor(start / step));
  return {
    milestones,
    coins: milestones * ECONOMY_CONFIG.coinsPerCrunchMilestone
  };
}

const ECONOMY_KEY = "cardCrunchEconomyV1";
const LEGACY_COINS_KEY = "cardCrunchCoins";

export function calculateRunCoinReward({ grossCash = 0, bestStreak = 0, potCleared = false } = {}) {
  const safeCash = Math.max(0, Number(grossCash) || 0);
  const safeStreak = Math.max(0, Math.floor(Number(bestStreak) || 0));
  const scoreCoins = Math.floor(Math.sqrt(safeCash) / 7);
  const streakCoins = Math.min(150, safeStreak * 3);
  const clearBonus = potCleared ? 100 : 0;
  const total = Math.min(5000, scoreCoins + streakCoins + clearBonus);
  return { total, scoreCoins, streakCoins, clearBonus };
}

function createDefaultState(now = Date.now()) {
  return {
    version: 2,
    coins: readLegacyCoins(),
    dailyKey: getDailyKey(now),
    coinAdsWatched: 0
  };
}

function loadState() {
  const now = Date.now();
  try {
    const saved = JSON.parse(localStorage.getItem(ECONOMY_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return createDefaultState(now);
    return normalizeState(saved, now);
  } catch {
    return createDefaultState(now);
  }
}

function normalizeState(saved, now) {
  const state = {
    version: 2,
    coins: Math.max(readLegacyCoins(), clampInteger(saved.coins, 0, Number.MAX_SAFE_INTEGER)),
    dailyKey: typeof saved.dailyKey === "string" ? saved.dailyKey : getDailyKey(now),
    coinAdsWatched: clampInteger(saved.coinAdsWatched, 0, ECONOMY_CONFIG.coinAdsPerDay)
  };
  resetDailyCounters(state, now);
  return state;
}

let state = loadState();
const listeners = new Set();

export const economy = {
  getSnapshot(now = Date.now()) {
    sync(now);
    return createSnapshot(now);
  },

  addCoins(amount) {
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (safeAmount <= 0) return 0;
    state.coins = Math.min(Number.MAX_SAFE_INTEGER, state.coins + safeAmount);
    commit();
    return safeAmount;
  },

  spendCoins(amount) {
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (safeAmount <= 0 || state.coins < safeAmount) return false;
    state.coins -= safeAmount;
    commit();
    return true;
  },

  canClaimCoinAd(now = Date.now()) {
    sync(now);
    return state.coinAdsWatched < ECONOMY_CONFIG.coinAdsPerDay;
  },

  claimCoinAd(now = Date.now()) {
    sync(now);
    if (!this.canClaimCoinAd(now)) return 0;
    state.coinAdsWatched += 1;
    state.coins = Math.min(Number.MAX_SAFE_INTEGER, state.coins + ECONOMY_CONFIG.coinAdReward);
    commit();
    return ECONOMY_CONFIG.coinAdReward;
  },

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  reset() {
    state = createDefaultState();
    commit();
  }
};

function sync(now = Date.now()) {
  const before = `${state.dailyKey}|${state.coinAdsWatched}`;
  resetDailyCounters(state, now);
  const after = `${state.dailyKey}|${state.coinAdsWatched}`;
  if (before !== after) commit();
}

function createSnapshot() {
  return {
    coins: state.coins,
    coinAdsRemaining: Math.max(0, ECONOMY_CONFIG.coinAdsPerDay - state.coinAdsWatched),
    canWatchCoinAd: state.coinAdsWatched < ECONOMY_CONFIG.coinAdsPerDay
  };
}

function commit() {
  try {
    localStorage.setItem(ECONOMY_KEY, JSON.stringify(state));
    localStorage.setItem(LEGACY_COINS_KEY, String(state.coins));
  } catch {
    // Private mode/storage quota must not interrupt a run.
  }
  const snapshot = createSnapshot(Date.now());
  listeners.forEach((listener) => listener(snapshot));
}

function resetDailyCounters(target, now) {
  const key = getDailyKey(now);
  if (target.dailyKey === key) return;
  target.dailyKey = key;
  target.coinAdsWatched = 0;
}

function getDailyKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readLegacyCoins() {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(LEGACY_COINS_KEY)) || 0));
  } catch {
    return 0;
  }
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, Math.floor(Number(value) || 0)));
}
