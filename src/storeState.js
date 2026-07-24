import { getStoreDayKey } from "./storeProducts.js?v=166";

const STORE_STATE_KEY = "cardCrunchStoreV1";
const MAX_TRANSACTION_HISTORY = 80;
const listeners = new Set();
let state = loadStoreState();

export const storeState = {
  getSnapshot(now = Date.now()) {
    syncDay(now);
    return snapshot();
  },

  claimDaily(productId, now = Date.now()) {
    syncDay(now);
    if (state.dailyClaims[productId] === state.dailyKey) return false;
    state.dailyClaims[productId] = state.dailyKey;
    commit("daily-claimed");
    return true;
  },

  unclaimDaily(productId) {
    if (!state.dailyClaims[productId]) return;
    delete state.dailyClaims[productId];
    commit("daily-claim-reverted");
  },

  hasClaimedDaily(productId, now = Date.now()) {
    syncDay(now);
    return state.dailyClaims[productId] === state.dailyKey;
  },

  getPurchaseCount(productId) {
    return Math.max(0, Number(state.purchaseCounts[productId]) || 0);
  },

  recordPurchase(productId) {
    state.purchaseCounts[productId] = this.getPurchaseCount(productId) + 1;
    commit("purchase-recorded");
  },

  registerVerifiedTransaction(productId, transactionId) {
    const id = String(transactionId || "").trim();
    if (!id || state.verifiedTransactions.some((entry) => entry.transactionId === id)) return false;
    state.verifiedTransactions.push({ productId, transactionId: id, verifiedAt: Date.now() });
    state.verifiedTransactions = state.verifiedTransactions.slice(-MAX_TRANSACTION_HISTORY);
    this.recordPurchase(productId);
    return true;
  },

  ownsCosmetic(cosmeticId) {
    return state.ownedCosmetics.includes(cosmeticId);
  },

  unlockCosmetic(cosmeticId) {
    if (!cosmeticId || state.ownedCosmetics.includes(cosmeticId)) return false;
    state.ownedCosmetics.push(cosmeticId);
    commit("cosmetic-unlocked");
    return true;
  },

  equipCosmetic(slot, cosmeticId) {
    if (!slot || !cosmeticId || !this.ownsCosmetic(cosmeticId)) return false;
    state.equippedCosmetics[slot] = cosmeticId;
    commit("cosmetic-equipped");
    return true;
  },

  mergeRemoteSnapshot(remote = {}) {
    if (!remote || typeof remote !== "object") return false;
    const before = JSON.stringify(state);
    syncDay();

    if (remote.dailyClaims && typeof remote.dailyClaims === "object") {
      Object.entries(remote.dailyClaims).forEach(([productId, dayKey]) => {
        if (typeof dayKey !== "string") return;
        if (dayKey === state.dailyKey || dayKey > String(state.dailyClaims[productId] ?? "")) {
          state.dailyClaims[productId] = dayKey;
        }
      });
    }

    if (remote.purchaseCounts && typeof remote.purchaseCounts === "object") {
      Object.entries(remote.purchaseCounts).forEach(([productId, count]) => {
        state.purchaseCounts[productId] = Math.max(this.getPurchaseCount(productId), Math.max(0, Number(count) || 0));
      });
    }

    const remoteCosmetics = Array.isArray(remote.ownedCosmetics) ? remote.ownedCosmetics.map(String) : [];
    state.ownedCosmetics = [...new Set([...state.ownedCosmetics, ...remoteCosmetics])];

    if (remote.equippedCosmetics && typeof remote.equippedCosmetics === "object") {
      Object.entries(remote.equippedCosmetics).forEach(([slot, cosmeticId]) => {
        if (cosmeticId === "default" || state.ownedCosmetics.includes(cosmeticId)) state.equippedCosmetics[slot] = cosmeticId;
      });
    }

    const transactions = Array.isArray(remote.verifiedTransactions) ? remote.verifiedTransactions : [];
    const transactionIds = new Set(state.verifiedTransactions.map((entry) => entry.transactionId));
    transactions.forEach((entry) => {
      const transactionId = String(entry?.transactionId ?? "").trim();
      if (!transactionId || transactionIds.has(transactionId)) return;
      transactionIds.add(transactionId);
      state.verifiedTransactions.push({
        productId: String(entry?.productId ?? "unknown"),
        transactionId,
        verifiedAt: Math.max(0, Number(entry?.verifiedAt) || 0)
      });
    });
    state.verifiedTransactions = state.verifiedTransactions.slice(-MAX_TRANSACTION_HISTORY);
    state.offerEpoch = Math.min(state.offerEpoch, Math.max(0, Number(remote.offerEpoch) || state.offerEpoch));

    if (before === JSON.stringify(state)) return false;
    commit("cloud-merge");
    return true;
  },

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  reset() {
    state = createDefaultState();
    commit("reset");
  }
};

function createDefaultState(now = Date.now()) {
  return {
    version: 1,
    dailyKey: getStoreDayKey(now),
    dailyClaims: {},
    purchaseCounts: {},
    ownedCosmetics: [],
    equippedCosmetics: { trail: "default", cardBack: "default" },
    verifiedTransactions: [],
    offerEpoch: now
  };
}

function loadStoreState() {
  const fallback = createDefaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_STATE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      ...fallback,
      dailyKey: typeof saved.dailyKey === "string" ? saved.dailyKey : fallback.dailyKey,
      dailyClaims: saved.dailyClaims && typeof saved.dailyClaims === "object" ? { ...saved.dailyClaims } : {},
      purchaseCounts: saved.purchaseCounts && typeof saved.purchaseCounts === "object" ? { ...saved.purchaseCounts } : {},
      ownedCosmetics: [...new Set(Array.isArray(saved.ownedCosmetics) ? saved.ownedCosmetics.map(String) : [])],
      equippedCosmetics: saved.equippedCosmetics && typeof saved.equippedCosmetics === "object"
        ? { ...fallback.equippedCosmetics, ...saved.equippedCosmetics }
        : fallback.equippedCosmetics,
      verifiedTransactions: Array.isArray(saved.verifiedTransactions)
        ? saved.verifiedTransactions.filter((entry) => entry?.transactionId).slice(-MAX_TRANSACTION_HISTORY)
        : [],
      offerEpoch: Math.max(0, Number(saved.offerEpoch) || fallback.offerEpoch)
    };
  } catch {
    return fallback;
  }
}

function syncDay(now = Date.now()) {
  const key = getStoreDayKey(now);
  if (state.dailyKey === key) return;
  state.dailyKey = key;
  commit("daily-reset");
}

function snapshot() {
  return {
    version: state.version,
    dailyKey: state.dailyKey,
    dailyClaims: { ...state.dailyClaims },
    purchaseCounts: { ...state.purchaseCounts },
    ownedCosmetics: [...state.ownedCosmetics],
    equippedCosmetics: { ...state.equippedCosmetics },
    verifiedTransactions: state.verifiedTransactions.map((entry) => ({ ...entry })),
    offerEpoch: state.offerEpoch
  };
}

function commit(reason) {
  try {
    localStorage.setItem(STORE_STATE_KEY, JSON.stringify(state));
  } catch {
    // The session remains usable when browser storage is unavailable.
  }
  const current = snapshot();
  listeners.forEach((listener) => listener(current, reason));
  globalThis.window?.dispatchEvent?.(new CustomEvent("card-crunch-store-change", { detail: { snapshot: current, reason } }));
}
