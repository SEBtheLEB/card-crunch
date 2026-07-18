const CARD_SKIN_STORAGE_KEY = "cardCrunchCardSkin";

export const CARD_SKINS = Object.freeze({
  classic: { name: "Classic" },
  dark: { name: "Night Ink" },
  pink: { name: "Pink Pop" },
  gold: { name: "Gold Royale" },
  rainbow: { name: "Rainbow Rush" }
});

export function initializeCardSkin() {
  return applyCardSkin(readSavedCardSkin(), { persist: false });
}

export function applyCardSkin(cardSkinId, { persist = true } = {}) {
  const resolvedId = CARD_SKINS[cardSkinId] ? cardSkinId : "classic";
  document.documentElement.dataset.cardSkin = resolvedId;
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
      if (document.documentElement.dataset.cardSkin !== "rainbow") return;
      const card = event.target.closest?.(".hand-zone .card");
      if (!card || card.disabled) return;
      spawnRainbowCardTrail(card);
    },
    { passive: true }
  );
}

function updateCardSkinPicker(cardSkinId) {
  document.querySelectorAll("[data-card-skin-id]").forEach((button) => {
    const selected = button.dataset.cardSkinId === cardSkinId;
    button.classList.toggle("is-skin-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    const stateLabel = button.querySelector(":scope > em");
    if (stateLabel) stateLabel.textContent = selected ? "Equipped" : "Equip";
  });

  const status = document.querySelector("#skinStoreStatus");
  if (status) status.textContent = `${CARD_SKINS[cardSkinId]?.name ?? CARD_SKINS.classic.name} deck equipped.`;
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

function readSavedCardSkin() {
  try {
    return localStorage.getItem(CARD_SKIN_STORAGE_KEY) || "classic";
  } catch {
    return "classic";
  }
}
