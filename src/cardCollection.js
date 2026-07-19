export const CARD_COLLECTION_STORAGE_KEY = "cardCrunchCardCollectionV1";

export const CARD_RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
export const CARD_SUITS = Object.freeze(["hearts", "diamonds", "clubs", "spades"]);
export const COLLECTIBLE_SKIN_IDS = Object.freeze(["dark", "pink", "gold", "rainbow"]);
export const PREMIUM_FULL_DECK_SKIN_IDS = Object.freeze(["pink_arcade"]);

const SUIT_SYMBOLS = Object.freeze({
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660"
});

const VALID_FULL_DECK_SKINS = new Set(["classic", ...COLLECTIBLE_SKIN_IDS, ...PREMIUM_FULL_DECK_SKIN_IDS, "custom"]);
let collectionState = null;
const listeners = new Set();

export function initializeCardCollection() {
  collectionState = loadCollection();
  return getCardCollectionSnapshot();
}

export function getCardCollectionSnapshot() {
  const state = ensureCollection();
  return {
    version: state.version,
    owned: Object.fromEntries(COLLECTIBLE_SKIN_IDS.map((skinId) => [skinId, [...state.owned[skinId]]])),
    equippedByCard: { ...state.equippedByCard },
    fullDeckSkin: state.fullDeckSkin,
    purchasedFullDeckSkins: [...state.purchasedFullDeckSkins],
    pendingReward: state.pendingReward ? { ...state.pendingReward } : null
  };
}

export function subscribeToCardCollection(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createCardKey(rank, suit) {
  return `${String(rank).toUpperCase()}|${String(suit).toLowerCase()}`;
}

export function parseCardKey(key) {
  const [rank, suit] = String(key).split("|");
  return {
    key: createCardKey(rank, suit),
    rank,
    suit,
    suitSymbol: SUIT_SYMBOLS[suit] ?? "?"
  };
}

export function getAllCardKeys() {
  return CARD_SUITS.flatMap((suit) => CARD_RANKS.map((rank) => createCardKey(rank, suit)));
}

export function getCollectionProgress(skinId) {
  if (skinId === "classic") return { owned: 52, total: 52, complete: true };
  const owned = ensureCollection().owned[skinId]?.length ?? 0;
  return { owned, total: 52, complete: owned >= 52 };
}

export function isCardSkinOwned(skinId, cardKey) {
  if (skinId === "classic") return true;
  return ensureCollection().owned[skinId]?.includes(cardKey) ?? false;
}

export function getEquippedCardSkin(card) {
  const state = ensureCollection();
  if (state.fullDeckSkin !== "custom") return state.fullDeckSkin;
  const key = createCardKey(card?.rank, card?.suit);
  const equipped = state.equippedByCard[key];
  return equipped && isCardSkinOwned(equipped, key) ? equipped : "classic";
}

export function setFullDeckSkin(skinId) {
  const state = ensureCollection();
  const resolved = VALID_FULL_DECK_SKINS.has(skinId) ? skinId : "classic";
  if (PREMIUM_FULL_DECK_SKIN_IDS.includes(resolved) && !state.purchasedFullDeckSkins.includes(resolved)) {
    return state.fullDeckSkin;
  }
  if (state.fullDeckSkin === resolved) return resolved;
  state.fullDeckSkin = resolved;
  commitCollection("full-deck");
  return resolved;
}

export function isFullDeckSkinOwned(skinId) {
  if (skinId === "classic" || skinId === "custom" || COLLECTIBLE_SKIN_IDS.includes(skinId)) return true;
  return PREMIUM_FULL_DECK_SKIN_IDS.includes(skinId) && ensureCollection().purchasedFullDeckSkins.includes(skinId);
}

export function unlockFullDeckSkin(skinId) {
  const state = ensureCollection();
  if (!PREMIUM_FULL_DECK_SKIN_IDS.includes(skinId)) return false;
  if (state.purchasedFullDeckSkins.includes(skinId)) return true;
  state.purchasedFullDeckSkins.push(skinId);
  commitCollection("premium-deck-unlocked");
  return true;
}

export function equipCollectedCard(skinId, cardKey) {
  const state = ensureCollection();
  if (!COLLECTIBLE_SKIN_IDS.includes(skinId) || !isValidCardKey(cardKey) || !isCardSkinOwned(skinId, cardKey)) {
    return false;
  }
  state.equippedByCard[cardKey] = skinId;
  state.fullDeckSkin = "custom";
  commitCollection("card-equip");
  return true;
}

export function unequipCollectedCard(cardKey) {
  const state = ensureCollection();
  if (!state.equippedByCard[cardKey]) return false;
  delete state.equippedByCard[cardKey];
  state.fullDeckSkin = "custom";
  commitCollection("card-unequip");
  return true;
}

export function createPendingPackReward(randomValue = secureRandom()) {
  const state = ensureCollection();
  if (state.pendingReward) return { ...state.pendingReward };
  const pool = buildCollectiblePool(state.owned);
  if (!pool.length) return null;
  const normalizedRandom = Math.min(0.999999999, Math.max(0, Number(randomValue) || 0));
  const reward = pool[Math.floor(normalizedRandom * pool.length)];
  state.pendingReward = {
    id: `pack-${Date.now()}-${Math.floor(normalizedRandom * 1_000_000)}`,
    ...reward,
    createdAt: Date.now()
  };
  commitCollection("pack-created");
  return { ...state.pendingReward };
}

export function claimPendingPackReward() {
  const state = ensureCollection();
  const reward = state.pendingReward;
  if (!reward || !COLLECTIBLE_SKIN_IDS.includes(reward.skinId) || !isValidCardKey(reward.key)) return null;
  if (!state.owned[reward.skinId].includes(reward.key)) state.owned[reward.skinId].push(reward.key);
  state.pendingReward = null;
  commitCollection("pack-claimed");
  return { ...reward };
}

export function buildCollectiblePool(owned = {}) {
  const cardKeys = getAllCardKeys();
  return COLLECTIBLE_SKIN_IDS.flatMap((skinId) => {
    const ownedSet = new Set(Array.isArray(owned[skinId]) ? owned[skinId] : []);
    return cardKeys
      .filter((key) => !ownedSet.has(key))
      .map((key) => ({ skinId, ...parseCardKey(key) }));
  });
}

export function runCardCollectionSelfTests() {
  const keys = getAllCardKeys();
  const emptyPool = buildCollectiblePool({});
  const oneOwned = { dark: [createCardKey("A", "hearts")] };
  const reducedPool = buildCollectiblePool(oneOwned);
  return [
    { name: "52 unique playing cards", pass: keys.length === 52 && new Set(keys).size === 52 },
    { name: "208 duplicate-protected collectible rewards", pass: emptyPool.length === 208 },
    { name: "owned rewards leave the pack pool", pass: reducedPool.length === 207 && !reducedPool.some((entry) => entry.skinId === "dark" && entry.key === "A|hearts") }
  ];
}

function ensureCollection() {
  if (!collectionState) collectionState = loadCollection();
  return collectionState;
}

function loadCollection() {
  try {
    const saved = JSON.parse(localStorage.getItem(CARD_COLLECTION_STORAGE_KEY) ?? "null");
    return normalizeCollection(saved);
  } catch {
    return normalizeCollection(null);
  }
}

function normalizeCollection(saved) {
  const legacySkin = readLegacyFullDeckSkin();
  const purchasedFullDeckSkins = [...new Set(
    (Array.isArray(saved?.purchasedFullDeckSkins) ? saved.purchasedFullDeckSkins : [])
      .filter((skinId) => PREMIUM_FULL_DECK_SKIN_IDS.includes(skinId))
  )];
  const requestedFullDeckSkin = VALID_FULL_DECK_SKINS.has(saved?.fullDeckSkin) ? saved.fullDeckSkin : legacySkin;
  const fullDeckSkin = PREMIUM_FULL_DECK_SKIN_IDS.includes(requestedFullDeckSkin)
    && !purchasedFullDeckSkins.includes(requestedFullDeckSkin)
    ? "classic"
    : requestedFullDeckSkin;
  const state = {
    version: 2,
    owned: Object.fromEntries(COLLECTIBLE_SKIN_IDS.map((skinId) => [skinId, []])),
    equippedByCard: {},
    fullDeckSkin,
    purchasedFullDeckSkins,
    pendingReward: null
  };

  COLLECTIBLE_SKIN_IDS.forEach((skinId) => {
    const entries = Array.isArray(saved?.owned?.[skinId]) ? saved.owned[skinId] : [];
    state.owned[skinId] = [...new Set(entries.filter(isValidCardKey))];
  });

  if (saved?.equippedByCard && typeof saved.equippedByCard === "object") {
    Object.entries(saved.equippedByCard).forEach(([key, skinId]) => {
      if (isValidCardKey(key) && COLLECTIBLE_SKIN_IDS.includes(skinId) && state.owned[skinId].includes(key)) {
        state.equippedByCard[key] = skinId;
      }
    });
  }

  const pending = saved?.pendingReward;
  if (pending && COLLECTIBLE_SKIN_IDS.includes(pending.skinId) && isValidCardKey(pending.key) && !state.owned[pending.skinId].includes(pending.key)) {
    state.pendingReward = {
      id: String(pending.id || `restored-${Date.now()}`),
      skinId: pending.skinId,
      ...parseCardKey(pending.key),
      createdAt: Number(pending.createdAt) || Date.now()
    };
  }
  return state;
}

function isValidCardKey(key) {
  const [rank, suit, extra] = String(key).split("|");
  return !extra && CARD_RANKS.includes(rank) && CARD_SUITS.includes(suit);
}

function secureRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] / 0x1_0000_0000;
  }
  return Math.random();
}

function readLegacyFullDeckSkin() {
  try {
    const saved = localStorage.getItem("cardCrunchCardSkin") || "classic";
    return VALID_FULL_DECK_SKINS.has(saved) ? saved : "classic";
  } catch {
    return "classic";
  }
}

function commitCollection(reason) {
  const state = ensureCollection();
  try {
    localStorage.setItem(CARD_COLLECTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Collection remains usable for the current session if storage is blocked.
  }
  const snapshot = getCardCollectionSnapshot();
  listeners.forEach((listener) => listener(snapshot, reason));
  globalThis.window?.dispatchEvent?.(new CustomEvent("card-crunch-collection-change", { detail: { snapshot, reason } }));
}
