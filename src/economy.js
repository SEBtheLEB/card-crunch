export const ECONOMY_CONFIG = Object.freeze({
  energyMax: 30,
  energyPerRun: 5,
  energyRegenMs: 12 * 60 * 1000,
  energyAdReward: 5,
  energyAdsPerDay: 4,
  energyCoinRefill: 5,
  energyCoinCost: 75,
  coinAdReward: 125,
  coinAdsPerDay: 3,
  shieldCoinCost: 500,
  coinPackAmount: 1500,
  coinPackProductId: "card_crunch_coin_pack_1500"
});

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

export function calculateRegeneratedEnergy({ energy, updatedAt, now = Date.now() }) {
  const safeEnergy = clampInteger(energy, 0, ECONOMY_CONFIG.energyMax);
  const safeUpdatedAt = Math.min(now, Math.max(0, Number(updatedAt) || now));
  if (safeEnergy >= ECONOMY_CONFIG.energyMax) {
    return { energy: ECONOMY_CONFIG.energyMax, updatedAt: now, gained: 0 };
  }

  const elapsed = Math.max(0, now - safeUpdatedAt);
  const gained = Math.floor(elapsed / ECONOMY_CONFIG.energyRegenMs);
  if (gained <= 0) return { energy: safeEnergy, updatedAt: safeUpdatedAt, gained: 0 };

  const nextEnergy = Math.min(ECONOMY_CONFIG.energyMax, safeEnergy + gained);
  const nextUpdatedAt = nextEnergy >= ECONOMY_CONFIG.energyMax
    ? now
    : safeUpdatedAt + gained * ECONOMY_CONFIG.energyRegenMs;
  return { energy: nextEnergy, updatedAt: nextUpdatedAt, gained: nextEnergy - safeEnergy };
}

function createDefaultState(now = Date.now()) {
  return {
    version: 1,
    coins: readLegacyCoins(),
    energy: ECONOMY_CONFIG.energyMax,
    energyUpdatedAt: now,
    dailyKey: getDailyKey(now),
    energyAdsWatched: 0,
    coinAdsWatched: 0
  };
}

function loadState() {
  const now = Date.now();
  try {
    const saved = JSON.parse(localStorage.getItem(ECONOMY_KEY) ?? "null");
    if (!saved || saved.version !== 1) return createDefaultState(now);
    return normalizeState(saved, now);
  } catch {
    return createDefaultState(now);
  }
}

function normalizeState(saved, now) {
  const state = {
    version: 1,
    coins: Math.max(readLegacyCoins(), clampInteger(saved.coins, 0, Number.MAX_SAFE_INTEGER)),
    energy: clampInteger(saved.energy, 0, ECONOMY_CONFIG.energyMax),
    energyUpdatedAt: Math.min(now, Math.max(0, Number(saved.energyUpdatedAt) || now)),
    dailyKey: typeof saved.dailyKey === "string" ? saved.dailyKey : getDailyKey(now),
    energyAdsWatched: clampInteger(saved.energyAdsWatched, 0, ECONOMY_CONFIG.energyAdsPerDay),
    coinAdsWatched: clampInteger(saved.coinAdsWatched, 0, ECONOMY_CONFIG.coinAdsPerDay)
  };
  resetDailyCounters(state, now);
  const regenerated = calculateRegeneratedEnergy({ energy: state.energy, updatedAt: state.energyUpdatedAt, now });
  state.energy = regenerated.energy;
  state.energyUpdatedAt = regenerated.updatedAt;
  return state;
}

let state = loadState();
const listeners = new Set();

export const economy = {
  getSnapshot(now = Date.now()) {
    sync(now);
    return createSnapshot(now);
  },

  spendRunEnergy(now = Date.now()) {
    sync(now);
    if (state.energy < ECONOMY_CONFIG.energyPerRun) return false;
    const wasFull = state.energy >= ECONOMY_CONFIG.energyMax;
    state.energy -= ECONOMY_CONFIG.energyPerRun;
    if (wasFull) state.energyUpdatedAt = now;
    commit();
    return true;
  },

  addEnergy(amount, now = Date.now()) {
    sync(now);
    const before = state.energy;
    state.energy = Math.min(ECONOMY_CONFIG.energyMax, state.energy + Math.max(0, Math.floor(amount)));
    if (state.energy >= ECONOMY_CONFIG.energyMax) state.energyUpdatedAt = now;
    if (state.energy !== before) commit();
    return state.energy - before;
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

  buyEnergyRefill(now = Date.now()) {
    sync(now);
    if (!hasEnergyRefillRoom(ECONOMY_CONFIG.energyCoinRefill)
      || state.coins < ECONOMY_CONFIG.energyCoinCost) return false;
    state.coins -= ECONOMY_CONFIG.energyCoinCost;
    const wasEmpty = state.energy <= 0;
    state.energy = Math.min(ECONOMY_CONFIG.energyMax, state.energy + ECONOMY_CONFIG.energyCoinRefill);
    if (wasEmpty && state.energy < ECONOMY_CONFIG.energyMax) state.energyUpdatedAt = now;
    if (state.energy >= ECONOMY_CONFIG.energyMax) state.energyUpdatedAt = now;
    commit();
    return true;
  },

  canClaimEnergyAd(now = Date.now()) {
    sync(now);
    return hasEnergyRefillRoom(ECONOMY_CONFIG.energyAdReward)
      && state.energyAdsWatched < ECONOMY_CONFIG.energyAdsPerDay;
  },

  claimEnergyAd(now = Date.now()) {
    sync(now);
    if (!this.canClaimEnergyAd(now)) return 0;
    state.energyAdsWatched += 1;
    const before = state.energy;
    state.energy = Math.min(ECONOMY_CONFIG.energyMax, state.energy + ECONOMY_CONFIG.energyAdReward);
    if (state.energy >= ECONOMY_CONFIG.energyMax) state.energyUpdatedAt = now;
    commit();
    return state.energy - before;
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
  const before = `${state.energy}|${state.energyUpdatedAt}|${state.dailyKey}|${state.energyAdsWatched}|${state.coinAdsWatched}`;
  resetDailyCounters(state, now);
  const regenerated = calculateRegeneratedEnergy({ energy: state.energy, updatedAt: state.energyUpdatedAt, now });
  state.energy = regenerated.energy;
  state.energyUpdatedAt = regenerated.updatedAt;
  const after = `${state.energy}|${state.energyUpdatedAt}|${state.dailyKey}|${state.energyAdsWatched}|${state.coinAdsWatched}`;
  if (before !== after) commit();
}

function createSnapshot(now = Date.now()) {
  const missingEnergy = Math.max(0, ECONOMY_CONFIG.energyMax - state.energy);
  const elapsed = Math.max(0, now - state.energyUpdatedAt);
  const nextEnergyInMs = missingEnergy > 0
    ? Math.max(0, ECONOMY_CONFIG.energyRegenMs - (elapsed % ECONOMY_CONFIG.energyRegenMs))
    : 0;
  return {
    coins: state.coins,
    energy: state.energy,
    energyMax: ECONOMY_CONFIG.energyMax,
    energyPerRun: ECONOMY_CONFIG.energyPerRun,
    energyProgress: state.energy / ECONOMY_CONFIG.energyMax,
    nextEnergyInMs,
    energyAdsRemaining: Math.max(0, ECONOMY_CONFIG.energyAdsPerDay - state.energyAdsWatched),
    coinAdsRemaining: Math.max(0, ECONOMY_CONFIG.coinAdsPerDay - state.coinAdsWatched),
    canBuyEnergy: hasEnergyRefillRoom(ECONOMY_CONFIG.energyCoinRefill)
      && state.coins >= ECONOMY_CONFIG.energyCoinCost,
    canWatchEnergyAd: hasEnergyRefillRoom(ECONOMY_CONFIG.energyAdReward)
      && state.energyAdsWatched < ECONOMY_CONFIG.energyAdsPerDay,
    canWatchCoinAd: state.coinAdsWatched < ECONOMY_CONFIG.coinAdsPerDay
  };
}

function hasEnergyRefillRoom(amount) {
  return state.energy <= ECONOMY_CONFIG.energyMax - amount;
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
  target.energyAdsWatched = 0;
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
