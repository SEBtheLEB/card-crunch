import {
  getCardCollectionSnapshot,
  getEquippedCardSkin as resolveCollectedCardSkin,
  setFullDeckSkin
} from "./cardCollection.js?v=141";

const CARD_SKIN_STORAGE_KEY = "cardCrunchCardSkin";
const SKIN_CLASS_PREFIX = "card-skin-";

export const CARD_SKINS = Object.freeze({
  classic: { name: "Classic" },
  dark: { name: "Night Ink" },
  pink: { name: "Pink Pop" },
  gold: { name: "Gold Royale" },
  rainbow: { name: "Rainbow Rush" }
});

export function initializeCardSkin() {
  return applyCardSkin(getCardCollectionSnapshot().fullDeckSkin, { persist: false });
}

export function applyCardSkin(cardSkinId, { persist = true } = {}) {
  const resolvedId = cardSkinId === "custom" || CARD_SKINS[cardSkinId] ? cardSkinId : "classic";
  setFullDeckSkin(resolvedId);
  document.documentElement.dataset.cardSkin = resolvedId;
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
  const resolved = resolveCollectedCardSkin(card);
  return CARD_SKINS[resolved] ? resolved : "classic";
}

export function getCardSkinClass(card) {
  return `${SKIN_CLASS_PREFIX}${getEquippedCardSkin(card)}`;
}

export function bindCardSkinPicker(bindAction) {
  document.querySelectorAll("[data-card-skin-id]").forEach((button) => {
    bindAction(button, () => applyCardSkin(button.dataset.cardSkinId));
  });
  updateCardSkinPicker(document.documentElement.dataset.cardSkin || "classic");
}

export function installRainbowCardTrail() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const card = event.target.closest?.(".hand-zone .card, .selected-card-tray .card");
      if (!card || card.disabled || !isRainbowCard(card)) return;
      spawnRainbowCardTrail(card);
    },
    { passive: true }
  );
}

function refreshRenderedCardSkins() {
  document.querySelectorAll(".card[data-card-rank][data-card-suit], .cutin-card[data-card-rank][data-card-suit]").forEach((card) => {
    [...card.classList]
      .filter((className) => className.startsWith(SKIN_CLASS_PREFIX))
      .forEach((className) => card.classList.remove(className));
    const skinId = getEquippedCardSkin({ rank: card.dataset.cardRank, suit: card.dataset.cardSuit });
    card.classList.add(`${SKIN_CLASS_PREFIX}${skinId}`);
    card.dataset.equippedSkin = skinId;
  });
}

function updateCardSkinPicker(cardSkinId) {
  document.querySelectorAll("[data-card-skin-id]").forEach((button) => {
    const selected = button.dataset.cardSkinId === cardSkinId;
    button.classList.toggle("is-skin-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    const stateLabel = button.querySelector(":scope > em");
    if (stateLabel) stateLabel.textContent = selected ? "Testing" : "Test Deck";
  });

  const status = document.querySelector("#skinStoreStatus");
  if (status) {
    status.textContent = cardSkinId === "custom"
      ? "Your collected cards are equipped individually."
      : `${CARD_SKINS[cardSkinId]?.name ?? CARD_SKINS.classic.name} full deck active for testing.`;
  }
}

function isRainbowCard(card) {
  return card.classList.contains("card-skin-rainbow")
    || card.dataset.equippedSkin === "rainbow"
    || document.documentElement.dataset.cardSkin === "rainbow";
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
