import { economy } from "./economy.js?v=164";

const STORAGE_KEY = "cardCrunchBoostersV1";

export const BOOSTER_DEFINITIONS = Object.freeze({
  "extra-time": Object.freeze({
    id: "extra-time",
    name: "Extra Time",
    description: "+10 seconds every turn",
    icon: "\u23F1",
    coinPrice: 250,
    starterCount: 2
  }),
  "crunch-bonus": Object.freeze({
    id: "crunch-bonus",
    name: "Crunch Bonus",
    description: "+25% Run Cash",
    icon: "\u2726",
    coinPrice: 400,
    starterCount: 2
  }),
  "retry-token": Object.freeze({
    id: "retry-token",
    name: "Retry Token",
    description: "First bust is free",
    icon: "\u2665",
    coinPrice: 500,
    starterCount: 1
  })
});

let state = loadState();
const listeners = new Set();

export const boosterInventory = {
  getSnapshot() {
    return createSnapshot();
  },

  grant(id, amount = 1) {
    if (!BOOSTER_DEFINITIONS[id]) return 0;
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (!safeAmount) return 0;
    state.inventory[id] = Math.min(99, (state.inventory[id] ?? 0) + safeAmount);
    commit();
    return safeAmount;
  },

  purchase(id) {
    const definition = BOOSTER_DEFINITIONS[id];
    if (!definition || !economy.spendCoins(definition.coinPrice)) return false;
    state.inventory[id] = Math.min(99, (state.inventory[id] ?? 0) + 1);
    commit();
    return true;
  },

  consume(ids = []) {
    const uniqueIds = [...new Set(ids)].filter((id) => BOOSTER_DEFINITIONS[id]);
    if (uniqueIds.some((id) => (state.inventory[id] ?? 0) <= 0)) return false;
    uniqueIds.forEach((id) => {
      state.inventory[id] -= 1;
    });
    commit();
    return true;
  },

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  mergeRemoteSnapshot(remote = {}) {
    const inventory = remote?.inventory;
    if (!inventory || typeof inventory !== "object") return false;
    let changed = false;
    Object.keys(BOOSTER_DEFINITIONS).forEach((id) => {
      const merged = Math.max(state.inventory[id] ?? 0, Math.max(0, Math.min(99, Math.floor(Number(inventory[id]) || 0))));
      if (merged === state.inventory[id]) return;
      state.inventory[id] = merged;
      changed = true;
    });
    if (changed) commit();
    return changed;
  },

  reset() {
    state = createDefaultState();
    commit();
  }
};

export function getBoosterRunEffects(ids = []) {
  const selected = new Set(ids);
  return {
    ids: [...selected].filter((id) => BOOSTER_DEFINITIONS[id]),
    extraTurnSeconds: selected.has("extra-time") ? 10 : 0,
    crunchMultiplier: selected.has("crunch-bonus") ? 1.25 : 1,
    retryToken: selected.has("retry-token")
  };
}

function createDefaultState() {
  return {
    version: 1,
    inventory: Object.fromEntries(
      Object.values(BOOSTER_DEFINITIONS).map((definition) => [definition.id, definition.starterCount])
    )
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved?.inventory) return createDefaultState();
    const defaults = createDefaultState();
    Object.keys(BOOSTER_DEFINITIONS).forEach((id) => {
      defaults.inventory[id] = Math.max(0, Math.min(99, Math.floor(Number(saved.inventory[id]) || 0)));
    });
    return defaults;
  } catch {
    return createDefaultState();
  }
}

function createSnapshot() {
  return {
    inventory: { ...state.inventory },
    definitions: BOOSTER_DEFINITIONS
  };
}

function commit() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage failures must not interrupt gameplay.
  }
  const snapshot = createSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}
