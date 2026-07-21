import {
  CARD_RANKS,
  CARD_SUITS,
  getCardCollectionSnapshot,
  getEquippedCardSkin as resolveCollectedCardSkin,
  isFullDeckSkinOwned,
  setFullDeckSkin,
  subscribeToCardCollection
} from "./cardCollection.js?v=167";

const CARD_SKIN_STORAGE_KEY = "cardCrunchCardSkin";
const SKIN_CLASS_PREFIX = "card-skin-";
const PINK_ARCADE_ASSET_ROOT = new URL("../assets/card-sets/pink_arcade/", import.meta.url);
let pinkArcadePreloadPromise = null;
let collectionSkinSyncInstalled = false;

export const CARD_SKINS = Object.freeze({
  classic: { name: "Classic" },
  dark: { name: "Night Ink" },
  pink: { name: "Pink Pop" },
  gold: { name: "Gold Royale" },
  rainbow: { name: "Rainbow Rush" },
  pink_arcade: {
    name: "Pink Arcade",
    premium: true,
    description: "A complete 52-card pixel deck with neon smear trails"
  }
});

export function initializeCardSkin() {
  const skinId = applyCardSkin(getCardCollectionSnapshot().fullDeckSkin, { persist: false });
  if (!collectionSkinSyncInstalled) {
    collectionSkinSyncInstalled = true;
    subscribeToCardCollection((_snapshot, reason) => {
      if (reason === "card-equip" || reason === "card-unequip") syncCardSkinFromCollection();
    });
  }
  return skinId;
}

export function applyCardSkin(cardSkinId, { persist = true } = {}) {
  const requestedId = cardSkinId === "custom" || CARD_SKINS[cardSkinId] ? cardSkinId : "classic";
  const resolvedId = setFullDeckSkin(requestedId);
  document.documentElement.dataset.cardSkin = resolvedId;
  if (resolvedId === "pink_arcade") preloadCardSkinAssets(resolvedId);
  refreshRenderedCardSkins();
  updateCardSkinPicker(resolvedId);

  if (persist) {
    try {
      localStorage.setItem(CARD_SKIN_STORAGE_KEY, resolvedId);
    } catch {
      // Card skins remain selectable when storage is unavailable.
    }
  }

  window.dispatchEvent(new CustomEvent("card-crunch-card-skin-change", { detail: { cardSkinId: resolvedId } }));
  return resolvedId;
}

export function syncCardSkinFromCollection() {
  const skinId = getCardCollectionSnapshot().fullDeckSkin;
  document.documentElement.dataset.cardSkin = skinId;
  refreshRenderedCardSkins();
  updateCardSkinPicker(skinId);
  window.dispatchEvent(new CustomEvent("card-crunch-card-skin-change", { detail: { cardSkinId: skinId } }));
  return skinId;
}

export function getEquippedCardSkin(card) {
  if (card?.powerType && card.powerType !== "charged") return "classic";
  const resolved = resolveCollectedCardSkin(card);
  return CARD_SKINS[resolved] ? resolved : "classic";
}

export function getCardSkinClass(card) {
  return `${SKIN_CLASS_PREFIX}${getEquippedCardSkin(card)}`;
}

export function getCardVisualColorClass(card) {
  const suit = String(card?.suit ?? "").toLowerCase();
  if (suit === "clubs") return "green";
  if (suit === "hearts" || suit === "diamonds") return "red";
  if (suit === "spades") return "black";
  return String(card?.color ?? "black").toLowerCase();
}

export function getCardSkinAssetUrl(card, skinId = getEquippedCardSkin(card)) {
  if (skinId !== "pink_arcade") return "";
  const suit = String(card?.suit ?? "").toLowerCase();
  const rank = String(card?.rank ?? "").toUpperCase();
  if (!CARD_SUITS.includes(suit) || !CARD_RANKS.includes(rank)) return "";
  const rankFile = rank === "A"
    ? "ace"
    : rank === "J"
      ? "jack"
      : rank === "Q"
        ? "queen"
        : rank === "K"
          ? "king"
          : rank.padStart(2, "0");
  return new URL(`cards/${suit}/${rankFile}_${suit}.png`, PINK_ARCADE_ASSET_ROOT).href;
}

export function getCardSkinStyle(card) {
  const assetUrl = getCardSkinAssetUrl(card);
  return assetUrl ? `--card-art-image:url('${assetUrl}')` : "";
}

export function applyCardSkinPresentation(element, card) {
  if (!element) return "classic";
  [...element.classList]
    .filter((className) => className.startsWith(SKIN_CLASS_PREFIX))
    .forEach((className) => element.classList.remove(className));
  const skinId = getEquippedCardSkin(card);
  element.classList.add(`${SKIN_CLASS_PREFIX}${skinId}`);
  element.dataset.equippedSkin = skinId;
  const assetUrl = getCardSkinAssetUrl(card, skinId);
  if (assetUrl) {
    element.style.setProperty("--card-art-image", `url("${assetUrl}")`);
    mountCardSkinArt(element, assetUrl);
  } else {
    element.style.removeProperty("--card-art-image");
    element.classList.remove("card-art-ready");
    element.querySelector(":scope > .card-skin-art")?.remove();
  }
  return skinId;
}

/* Matchmaking previews cycle through Store skins without changing the deck the
   player has equipped. Gameplay cards continue to use collection ownership. */
export function applyPreviewCardSkinPresentation(element, card, requestedSkinId = "classic") {
  if (!element) return "classic";
  const skinId = CARD_SKINS[requestedSkinId] ? requestedSkinId : "classic";
  [...element.classList]
    .filter((className) => className.startsWith(SKIN_CLASS_PREFIX))
    .forEach((className) => element.classList.remove(className));
  element.classList.add(`${SKIN_CLASS_PREFIX}${skinId}`);
  element.dataset.previewSkin = skinId;
  element.dataset.equippedSkin = skinId;
  const assetUrl = getCardSkinAssetUrl(card, skinId);
  if (assetUrl) {
    element.style.setProperty("--card-art-image", `url("${assetUrl}")`);
    mountCardSkinArt(element, assetUrl);
  } else {
    element.style.removeProperty("--card-art-image");
    element.classList.remove("card-art-ready");
    element.querySelector(":scope > .card-skin-art")?.remove();
  }
  return skinId;
}

/* A real image node is more reliable than using a CSS custom property as the
   only renderer. The built-in rank/suit face stays underneath until the PNG
   has decoded, so a slow mobile connection can never produce a blank card. */
function mountCardSkinArt(element, assetUrl) {
  let image = element.querySelector(":scope > .card-skin-art");
  if (!image) {
    image = document.createElement("img");
    image.className = "card-skin-art";
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    element.prepend(image);
  }

  const markReady = () => element.classList.add("card-art-ready");
  const showFallback = () => {
    element.classList.remove("card-art-ready");
    image.remove();
  };
  image.onload = markReady;
  image.onerror = showFallback;

  if (image.src !== assetUrl) {
    element.classList.remove("card-art-ready");
    image.src = assetUrl;
  }
  if (image.complete && image.naturalWidth > 0) markReady();
}

export function preloadCardSkinAssets(skinId) {
  if (skinId !== "pink_arcade") return Promise.resolve([]);
  if (pinkArcadePreloadPromise) return pinkArcadePreloadPromise;
  const urls = CARD_SUITS.flatMap((suit) => CARD_RANKS.map((rank) => getCardSkinAssetUrl({ rank, suit }, skinId)));
  pinkArcadePreloadPromise = Promise.allSettled(urls.map((url) => new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = image.onerror = resolve;
    image.src = url;
  })));
  return pinkArcadePreloadPromise;
}

export function bindCardSkinPicker(bindAction) {
  document.querySelectorAll("[data-card-skin-id]").forEach((button) => {
    bindAction(button, () => {
      const skinId = button.dataset.cardSkinId;
      if (!isFullDeckSkinOwned(skinId)) {
        const status = document.querySelector("#skinStoreStatus");
        if (status) status.textContent = `${CARD_SKINS[skinId]?.name ?? "This deck"} must be purchased before it can be equipped.`;
        document.querySelector("#buyPinkArcadeDeckButton")?.focus({ preventScroll: true });
        return;
      }
      applyCardSkin(skinId);
    });
  });
  updateCardSkinPicker(document.documentElement.dataset.cardSkin || "classic");
}

export function installRainbowCardTrail() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const card = event.target.closest?.(".hand-zone .card, .selected-card-tray .card");
      if (!card || card.disabled) return;
      if (isRainbowCard(card)) spawnRainbowCardTrail(card);
      if (isPinkArcadeCard(card)) spawnPinkArcadeCardTrail(card);
    },
    { passive: true }
  );
}

function refreshRenderedCardSkins() {
  document.querySelectorAll(".card[data-card-rank][data-card-suit], .cutin-card[data-card-rank][data-card-suit]").forEach((card) => {
    applyCardSkinPresentation(card, {
      rank: card.dataset.cardRank,
      suit: card.dataset.cardSuit,
      powerType: card.dataset.powerType || null
    });
  });
}

function updateCardSkinPicker(cardSkinId) {
  document.querySelectorAll("[data-card-skin-id]").forEach((button) => {
    const selected = button.dataset.cardSkinId === cardSkinId;
    const owned = isFullDeckSkinOwned(button.dataset.cardSkinId);
    button.classList.toggle("is-skin-selected", selected);
    button.classList.toggle("is-skin-locked", !owned);
    button.setAttribute("aria-pressed", String(selected));
    const stateLabel = button.querySelector(":scope > em");
    if (stateLabel) stateLabel.textContent = selected ? "Equipped" : owned ? "Equip" : "Buy to Equip";
  });

  const status = document.querySelector("#skinStoreStatus");
  if (status) {
    status.textContent = cardSkinId === "custom"
      ? "Your collected cards are equipped individually."
      : `${CARD_SKINS[cardSkinId]?.name ?? CARD_SKINS.classic.name} full deck equipped.`;
  }
}

function isRainbowCard(card) {
  return card.classList.contains("card-skin-rainbow")
    || card.dataset.equippedSkin === "rainbow"
    || document.documentElement.dataset.cardSkin === "rainbow";
}

function isPinkArcadeCard(card) {
  return card.classList.contains("card-skin-pink_arcade")
    || card.dataset.equippedSkin === "pink_arcade"
    || document.documentElement.dataset.cardSkin === "pink_arcade";
}

function spawnRainbowCardTrail(card) {
  const rect = card.getBoundingClientRect();
  const colors = ["#ff4f81", "#ffbd3e", "#62e88c", "#57c8ff", "#b47cff"];
  const fragment = document.createDocumentFragment();

  colors.forEach((color, index) => {
    const echo = document.createElement("i");
    echo.className = "rainbow-card-trail";
    echo.style.left = `${rect.left}px`;
    echo.style.top = `${rect.top}px`;
    echo.style.width = `${rect.width}px`;
    echo.style.height = `${rect.height}px`;
    echo.style.color = color;
    echo.style.setProperty("--trail-index", String(index));
    echo.style.setProperty("--trail-x", `${(index - 2) * 4}px`);
    echo.style.setProperty("--trail-y", `${10 + index * 5}px`);
    echo.addEventListener("animationend", () => echo.remove(), { once: true });
    fragment.appendChild(echo);
  });

  document.body.appendChild(fragment);
}

function spawnPinkArcadeCardTrail(card) {
  const rect = card.getBoundingClientRect();
  const fragment = document.createDocumentFragment();
  const colors = ["#ff2f92", "#ff74be", "#fff1a6", "#57e5ff"];

  colors.forEach((color, index) => {
    const echo = document.createElement("i");
    echo.className = "pink-arcade-card-trail";
    echo.style.left = `${rect.left}px`;
    echo.style.top = `${rect.top}px`;
    echo.style.width = `${rect.width}px`;
    echo.style.height = `${rect.height}px`;
    echo.style.color = color;
    echo.style.setProperty("--trail-x", `${(index % 2 ? 1 : -1) * (5 + index * 3)}px`);
    echo.style.setProperty("--trail-y", `${-16 - index * 9}px`);
    echo.style.setProperty("--trail-delay", `${index * 22}ms`);
    echo.addEventListener("animationend", () => echo.remove(), { once: true });
    fragment.appendChild(echo);
  });

  document.body.appendChild(fragment);
}
