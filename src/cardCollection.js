export const CARD_COLLECTION_STORAGE_KEY = "cardCrunchCardCollectionV1";

export const CARD_RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
export const CARD_SUITS = Object.freeze(["hearts", "diamonds", "clubs", "spades"]);
export const COLLECTIBLE_SKIN_IDS = Object.freeze(["dark", "pink", "gold", "rainbow"]);
export const PREMIUM_FULL_DECK_SKIN_IDS = Object.freeze(["pink_arcade"]);

// Pack odds are applied per skin first, then a random missing rank/suit is
// chosen from that skin. This keeps a nearly-complete common set from making
// Mythic Rainbow cards artificially common.
export const CARD_SKIN_RARITIES = Object.freeze({
  gold: Object.freeze({ id: "rare", label: "Rare", weight: 60, order: 1, color: "#f3ca58" }),
  pink: Object.freeze({ id: "epic", label: "Epic", weight: 25, order: 2, color: "#ff72b4" }),
  dark: Object.freeze({ id: "legendary", label: "Legendary", weight: 12, order: 3, color: "#9eb8ff" }),
  rainbow: Object.freeze({ id: "mythic", label: "Mythic", weight: 3, order: 4, color: "#b98cff" })
});

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

export function getCardSkinRarity(skinId) {
  return CARD_SKIN_RARITIES[skinId] ?? Object.freeze({ id: "default", label: "Default", weight: 0, order: 0, color: "#f4edcf" });
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
  state.fullDeckSkin = Object.keys(state.equippedByCard).length > 0 ? "custom" : "classic";
  commitCollection("card-unequip");
  return true;
}

export function createPendingPackReward(randomValue = secureRandom()) {
  const state = ensureCollection();
  if (state.pendingReward) return { ...state.pendingReward };
  const reward = selectWeightedPackReward(state.owned, randomValue);
  if (!reward) return null;
  const normalizedRandom = normalizeRandom(randomValue);
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

export function selectWeightedPackReward(owned = {}, randomValue = 0) {
  const cardKeys = getAllCardKeys();
  const availableSkins = COLLECTIBLE_SKIN_IDS
    .map((skinId) => {
      const ownedSet = new Set(Array.isArray(owned[skinId]) ? owned[skinId] : []);
      const cards = cardKeys.filter((key) => !ownedSet.has(key));
      return { skinId, cards, rarity: getCardSkinRarity(skinId) };
    })
    .filter((entry) => entry.cards.length > 0)
    .sort((a, b) => a.rarity.order - b.rarity.order);
  if (!availableSkins.length) return null;

  const totalWeight = availableSkins.reduce((sum, entry) => sum + entry.rarity.weight, 0);
  let roll = normalizeRandom(randomValue) * totalWeight;
  let selected = availableSkins.at(-1);

  for (const entry of availableSkins) {
    if (roll < entry.rarity.weight) {
      selected = entry;
      break;
    }
    roll -= entry.rarity.weight;
  }

  const localRoll = selected.rarity.weight > 0
    ? Math.min(0.999999999, Math.max(0, roll / selected.rarity.weight))
    : 0;
  const key = selected.cards[Math.floor(localRoll * selected.cards.length)];
  return {
    skinId: selected.skinId,
    rarityId: selected.rarity.id,
    rarityLabel: selected.rarity.label,
    ...parseCardKey(key)
  };
}

export function runCardCollectionSelfTests() {
  const keys = getAllCardKeys();
  const emptyPool = buildCollectiblePool({});
  const oneOwned = { dark: [createCardKey("A", "hearts")] };
  const reducedPool = buildCollectiblePool(oneOwned);
  const rare = selectWeightedPackReward({}, 0.1);
  const epic = selectWeightedPackReward({}, 0.7);
  const legendary = selectWeightedPackReward({}, 0.9);
  const mythic = selectWeightedPackReward({}, 0.99);
  return [
    { name: "52 unique playing cards", pass: keys.length === 52 && new Set(keys).size === 52 },
    { name: "208 duplicate-protected collectible rewards", pass: emptyPool.length === 208 },
    { name: "owned rewards leave the pack pool", pass: reducedPool.length === 207 && !reducedPool.some((entry) => entry.skinId === "dark" && entry.key === "A|hearts") },
    { name: "rarity ladder uses weighted skin rolls", pass: rare?.skinId === "gold" && epic?.skinId === "pink" && legendary?.skinId === "dark" && mythic?.skinId === "rainbow" },
    { name: "rainbow is the highest rarity", pass: getCardSkinRarity("rainbow").order > getCardSkinRarity("dark").order && getCardSkinRarity("dark").order > getCardSkinRarity("pink").order }
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
    version: 3,
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
      rarityId: getCardSkinRarity(pending.skinId).id,
      rarityLabel: getCardSkinRarity(pending.skinId).label,
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

function normalizeRandom(value) {
  return Math.min(0.999999999, Math.max(0, Number(value) || 0));
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
