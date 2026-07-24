import { playGameSfx } from "./audio.js?v=166";
import {
  CARD_RANKS,
  CARD_SUITS,
  COLLECTIBLE_SKIN_IDS,
  claimPendingPackReward,
  createCardKey,
  equipCollectedCard,
  getCardSkinRarity,
  getCardCollectionSnapshot,
  getCollectionProgress,
  isCardSkinOwned,
  parseCardKey,
  subscribeToCardCollection,
  unequipCollectedCard
} from "./cardCollection.js?v=167";
import { applyCardSkin, CARD_SKINS, getCardVisualColorClass } from "./cardSkins.js?v=167";

const SUIT_SYMBOLS = Object.freeze({ hearts: "\u2665", diamonds: "\u2666", clubs: "\u2663", spades: "\u2660" });
const SKIN_ICONS = Object.freeze({ dark: "\u263E", pink: "\u2665", gold: "\u2605", rainbow: "\u25C6" });
const PACK_RARITY_CLASSES = Object.freeze(["rarity-rare", "rarity-epic", "rarity-legendary", "rarity-mythic"]);
let selectedCollectionSkin = "dark";
let packOpening = false;
let packRevealed = false;
let revealedProductId = "mystery-card-pack";
let elements = null;

export function initializeCardCollectionUI(bindAction) {
  elements = {
    storeStatus: document.querySelector("#storeStatus"),
    collectionDeckList: document.querySelector("#collectionDeckList"),
    collectionDetail: document.querySelector("#collectionDetail"),
    collectionStatus: document.querySelector("#collectionStatus"),
    overlay: document.querySelector("#packOpeningOverlay"),
    packShell: document.querySelector("#mysteryPackShell"),
    packPrompt: document.querySelector("#packOpeningPrompt"),
    packReward: document.querySelector("#packReward"),
    openButton: document.querySelector("#openPackButton"),
    collectButton: document.querySelector("#collectPackRewardButton"),
    equipButton: document.querySelector("#equipPackRewardButton"),
    viewButton: document.querySelector("#viewPackCollectionButton"),
    buyAnotherButton: document.querySelector("#buyAnotherPackButton")
  };

  bindAction(elements.openButton, revealPendingPack);
  bindAction(elements.collectButton, () => claimAndClosePack(false));
  bindAction(elements.equipButton, () => claimAndClosePack(true));
  bindAction(elements.viewButton, viewRewardCollection);
  bindAction(elements.buyAnotherButton, buyAnotherPack);
  bindAction(elements.collectionDeckList, onCollectionDeckAction);
  bindAction(elements.collectionDetail, onCollectionCardAction);

  subscribeToCardCollection(() => {
    renderCardCollection();
  });
  window.addEventListener("card-crunch-card-skin-change", renderCardCollection);

  renderCardCollection();
  if (getCardCollectionSnapshot().pendingReward) showPackOverlay();
}

export function openPendingPackOverlay() {
  if (!getCardCollectionSnapshot().pendingReward) return false;
  showPackOverlay();
  return true;
}

function showPackOverlay() {
  if (!elements?.overlay) return;
  packOpening = false;
  packRevealed = false;
  elements.overlay.hidden = false;
  elements.overlay.setAttribute("aria-hidden", "false");
  elements.overlay.classList.remove("is-opening", "is-revealed", "is-collecting");
  elements.overlay.classList.remove(...PACK_RARITY_CLASSES);
  delete elements.overlay.dataset.rarity;
  elements.packShell.hidden = false;
  elements.packReward.hidden = true;
  elements.openButton.hidden = false;
  elements.openButton.disabled = false;
  elements.collectButton.hidden = true;
  elements.equipButton.hidden = true;
  if (elements.viewButton) elements.viewButton.hidden = true;
  if (elements.buyAnotherButton) elements.buyAnotherButton.hidden = true;
  const pending = getCardCollectionSnapshot().pendingReward;
  elements.packPrompt.textContent = `Tap to open ${pending?.productName ?? "your card pack"}`;
  document.body.classList.add("pack-overlay-open");
  elements.openButton.focus({ preventScroll: true });
}

function revealPendingPack() {
  if (packOpening || packRevealed) return;
  const reward = getCardCollectionSnapshot().pendingReward;
  if (!reward) {
    closePackOverlay();
    return;
  }
  packOpening = true;
  elements.openButton.disabled = true;
  elements.overlay.classList.add("is-opening");
  elements.packPrompt.textContent = "Cracking the seal...";
  playGameSfx("pack_open");

  const reduceMotion = document.documentElement.classList.contains("reduce-motion");
  const openedBefore = localStorage.getItem("cardCrunchPackOpeningSeen") === "1";
  const revealDelay = reduceMotion ? 40 : openedBefore ? 280 : 520;
  localStorage.setItem("cardCrunchPackOpeningSeen", "1");
  window.setTimeout(() => {
    if (!elements.overlay || elements.overlay.hidden) return;
    packOpening = false;
    packRevealed = true;
    elements.overlay.classList.remove("is-opening");
    elements.overlay.classList.add("is-revealed");
    elements.packShell.hidden = true;
    elements.openButton.hidden = true;
    const rarity = getCardSkinRarity(reward.skinId);
    renderPackReward(reward);
    elements.packReward.hidden = false;
    elements.collectButton.hidden = false;
    elements.equipButton.hidden = false;
    if (elements.viewButton) elements.viewButton.hidden = false;
    if (elements.buyAnotherButton) elements.buyAnotherButton.hidden = false;
    revealedProductId = reward.productId ?? "mystery-card-pack";
    elements.packPrompt.textContent = `${rarity.label.toUpperCase()} \u2022 NEW CARD`;
    spawnPackBurst(reward);
    playGameSfx("card_unlock");
    elements.equipButton.focus({ preventScroll: true });
  }, revealDelay);
}

function renderPackReward(reward) {
  const colorClass = getSuitColorClass(reward.suit);
  const skinName = CARD_SKINS[reward.skinId]?.name ?? reward.skinId;
  const rarity = getCardSkinRarity(reward.skinId);
  const progress = getCollectionProgress(reward.skinId);
  elements.overlay.classList.add(`rarity-${rarity.id}`);
  elements.overlay.dataset.rarity = rarity.id;
  elements.overlay.style.setProperty("--pack-rarity-color", rarity.color);
  elements.packReward.innerHTML = `
    <div class="pack-reward-card card-${colorClass} card-${reward.suit} card-skin-${reward.skinId}" data-card-rank="${reward.rank}" data-card-suit="${reward.suit}">
      <span>${reward.rank}${reward.suitSymbol}</span>
      <strong>${reward.rank}</strong>
      <i>${reward.suitSymbol}</i>
    </div>
    <div class="pack-reward-copy">
      <span class="pack-rarity-label rarity-${rarity.id}">${rarity.label}</span>
      <h2>${reward.rank} of ${capitalize(reward.suit)}</h2>
      <p>${skinName} &bull; ${Math.min(52, progress.owned + 1)} / 52 collected</p>
      <small>NEW &bull; Duplicate protected</small>
    </div>
  `;
}

function claimAndClosePack(shouldEquip) {
  if (!packRevealed) return;
  const reward = claimPendingPackReward();
  if (!reward) {
    closePackOverlay();
    return;
  }
  if (shouldEquip) {
    equipCollectedCard(reward.skinId, reward.key);
  }
  elements.overlay.classList.add("is-collecting");
  playGameSfx(shouldEquip ? "card_select" : "score_arrive");
  setStoreStatus(shouldEquip
    ? `${CARD_SKINS[reward.skinId].name} ${reward.rank} of ${capitalize(reward.suit)} collected and equipped by itself.`
    : `${CARD_SKINS[reward.skinId].name} ${reward.rank} of ${capitalize(reward.suit)} added to your collection.`);
  window.setTimeout(closePackOverlay, 260);
}

function viewRewardCollection() {
  if (!packRevealed) return;
  const reward = claimPendingPackReward();
  if (!reward) return closePackOverlay();
  closePackOverlay();
  window.dispatchEvent(new CustomEvent("card-crunch-request-menu-page", { detail: { pageName: "themes", collectionId: reward.skinId } }));
}

function buyAnotherPack() {
  if (!packRevealed) return;
  const productId = revealedProductId;
  const reward = claimPendingPackReward();
  if (!reward) return closePackOverlay();
  closePackOverlay();
  window.dispatchEvent(new CustomEvent("card-crunch-pack-buy-another", { detail: { productId } }));
}

function closePackOverlay() {
  if (!elements?.overlay) return;
  elements.overlay.hidden = true;
  elements.overlay.setAttribute("aria-hidden", "true");
  elements.overlay.classList.remove("is-opening", "is-revealed", "is-collecting");
  elements.overlay.classList.remove(...PACK_RARITY_CLASSES);
  delete elements.overlay.dataset.rarity;
  elements.overlay.style.removeProperty("--pack-rarity-color");
  elements.packReward.replaceChildren();
  document.body.classList.remove("pack-overlay-open");
  renderCardCollection();
}

function renderCardCollection({ preserveMatrixScroll = true } = {}) {
  if (!elements?.collectionDeckList || !elements?.collectionDetail) return;
  const viewportState = preserveMatrixScroll ? captureCollectionViewportState() : null;
  const snapshot = getCardCollectionSnapshot();
  if (!COLLECTIBLE_SKIN_IDS.includes(selectedCollectionSkin)) selectedCollectionSkin = "dark";

  elements.collectionDeckList.innerHTML = COLLECTIBLE_SKIN_IDS.map((skinId) => {
    const progress = getCollectionProgress(skinId);
    const rarity = getCardSkinRarity(skinId);
    const selected = skinId === selectedCollectionSkin;
    return `
      <button class="collection-deck-pack skin-${skinId}${selected ? " is-selected" : ""}" data-collection-skin="${skinId}" type="button" aria-pressed="${selected}">
        <span class="collection-pack-art" aria-hidden="true"><i>${SKIN_ICONS[skinId]}</i></span>
        <strong>${CARD_SKINS[skinId].name}</strong>
        <small>${progress.owned} / ${progress.total}</small>
        <em class="collection-rarity rarity-${rarity.id}">${rarity.label} \u00b7 ${rarity.weight}%</em>
      </button>
    `;
  }).join("");

  const progress = getCollectionProgress(selectedCollectionSkin);
  const selectedRarity = getCardSkinRarity(selectedCollectionSkin);
  const suitRows = CARD_SUITS.map((suit) => `
    <div class="collection-suit-row" role="row">
      <span class="collection-suit-label" aria-label="${capitalize(suit)}">${SUIT_SYMBOLS[suit]}</span>
      <div class="collection-card-row">
        ${CARD_RANKS.map((rank) => renderCollectionCard(selectedCollectionSkin, rank, suit, snapshot)).join("")}
      </div>
    </div>
  `).join("");

  const fullDeckActive = snapshot.fullDeckSkin === selectedCollectionSkin;
  elements.collectionDetail.innerHTML = `
    <header class="collection-detail-heading">
      <div><span>Deck Collection</span><h3>${CARD_SKINS[selectedCollectionSkin].name}</h3></div>
      <strong>${progress.owned} / 52</strong>
    </header>
    <div class="collection-detail-rarity rarity-${selectedRarity.id}"><strong>${selectedRarity.label}</strong><span>${selectedRarity.weight}% pack chance</span></div>
    <div class="collection-progress-track"><i style="--collection-progress:${(progress.owned / progress.total) * 100}%"></i></div>
    <p>Tap an owned card to equip only that rank and suit. Tap it again to return that card to Default.</p>
    <button class="collection-full-deck-button${fullDeckActive ? " is-active" : ""}" data-test-full-deck="${selectedCollectionSkin}" type="button" ${progress.complete ? "" : "disabled"}>
      ${fullDeckActive ? "FULL DECK ACTIVE" : progress.complete ? "EQUIP COMPLETE DECK" : "COLLECT ALL 52 TO EQUIP"}
    </button>
    <div class="collection-card-matrix" role="table" aria-label="${CARD_SKINS[selectedCollectionSkin].name} card collection">
      ${suitRows}
    </div>
  `;
  restoreCollectionViewportState(viewportState);

  if (elements.collectionStatus && !elements.collectionStatus.textContent.trim()) {
    elements.collectionStatus.textContent = "Open packs to build a deck, or equip a full deck for testing.";
  }
}

function captureCollectionViewportState() {
  const matrix = elements?.collectionDetail?.querySelector(".collection-card-matrix");
  const focusedCard = document.activeElement?.closest?.("[data-collection-card-key]");
  if (!matrix) return null;
  return {
    left: matrix.scrollLeft,
    top: matrix.scrollTop,
    focusedKey: focusedCard?.dataset.collectionCardKey ?? null,
    focusedSkin: focusedCard?.dataset.collectionCardSkin ?? null
  };
}

function restoreCollectionViewportState(viewportState) {
  if (!viewportState) return;
  const matrix = elements?.collectionDetail?.querySelector(".collection-card-matrix");
  if (!matrix) return;

  const restore = () => {
    matrix.scrollLeft = viewportState.left;
    matrix.scrollTop = viewportState.top;
  };
  restore();
  window.requestAnimationFrame(restore);

  if (viewportState.focusedKey && viewportState.focusedSkin) {
    const card = matrix.querySelector(
      `[data-collection-card-key="${viewportState.focusedKey}"][data-collection-card-skin="${viewportState.focusedSkin}"]`
    );
    card?.focus({ preventScroll: true });
  }
}

function renderCollectionCard(skinId, rank, suit, snapshot) {
  const key = createCardKey(rank, suit);
  const owned = isCardSkinOwned(skinId, key);
  const equipped = snapshot.fullDeckSkin === "custom" && snapshot.equippedByCard[key] === skinId;
  const colorClass = getSuitColorClass(suit);
  return `
    <button class="collection-card-slot card-${colorClass} card-${suit} card-skin-${skinId}${owned ? " is-owned" : " is-locked"}${equipped ? " is-equipped" : ""}"
      data-collection-card-key="${key}" data-collection-card-skin="${skinId}" type="button" ${owned ? "" : "disabled"}
      aria-label="${owned ? equipped ? `Unequip ${CARD_SKINS[skinId].name} ${rank} of ${capitalize(suit)} and restore Default` : `Equip only ${CARD_SKINS[skinId].name} ${rank} of ${capitalize(suit)}` : `Locked ${rank} of ${capitalize(suit)}`}">
      <span>${owned ? rank : "?"}</span><i>${owned ? SUIT_SYMBOLS[suit] : ""}</i>
      ${equipped ? "<b aria-hidden=\"true\">ON</b>" : ""}
    </button>
  `;
}

function onCollectionDeckAction(event) {
  const button = event.target.closest?.("[data-collection-skin]");
  if (!button) return;
  selectedCollectionSkin = button.dataset.collectionSkin;
  playGameSfx("card_select");
  renderCardCollection({ preserveMatrixScroll: false });
}

function onCollectionCardAction(event) {
  const fullDeckButton = event.target.closest?.("[data-test-full-deck]");
  if (fullDeckButton) {
    const skinId = fullDeckButton.dataset.testFullDeck;
    if (!getCollectionProgress(skinId).complete) return;
    applyCardSkin(skinId);
    setCollectionStatus(`${CARD_SKINS[skinId].name} full deck equipped for testing.`);
    renderCardCollection();
    playGameSfx("card_unlock");
    return;
  }

  const cardButton = event.target.closest?.("[data-collection-card-key]");
  if (!cardButton || cardButton.disabled) return;
  const skinId = cardButton.dataset.collectionCardSkin;
  const key = cardButton.dataset.collectionCardKey;
  const snapshot = getCardCollectionSnapshot();
  const isEquipped = snapshot.fullDeckSkin === "custom" && snapshot.equippedByCard[key] === skinId;
  const changed = isEquipped ? unequipCollectedCard(key) : equipCollectedCard(skinId, key);
  if (!changed) return;
  const card = parseCardKey(key);
  setCollectionStatus(isEquipped
    ? `${card.rank} of ${capitalize(card.suit)} returned to the Default card.`
    : `${CARD_SKINS[skinId].name} ${card.rank} of ${capitalize(card.suit)} equipped by itself.`);
  renderCardCollection();
  playGameSfx(isEquipped ? "card_deselect" : "card_select");
}

function spawnPackBurst(reward) {
  if (!elements?.overlay) return;
  const rarity = getCardSkinRarity(reward?.skinId);
  const particleCount = 18 + rarity.order * 8;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < particleCount; index += 1) {
    const spark = document.createElement("i");
    const angle = (Math.PI * 2 * index) / particleCount + Math.random() * .2;
    const distance = 72 + Math.random() * (130 + rarity.order * 18);
    spark.className = "pack-reveal-spark";
    spark.style.color = rarity.color;
    spark.style.setProperty("--pack-x", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--pack-y", `${Math.sin(angle) * distance}px`);
    spark.style.setProperty("--pack-delay", `${Math.random() * 90}ms`);
    fragment.appendChild(spark);
  }
  elements.overlay.appendChild(fragment);
  window.setTimeout(() => elements.overlay?.querySelectorAll(".pack-reveal-spark").forEach((spark) => spark.remove()), 950);
}

function setStoreStatus(message) {
  if (elements?.storeStatus) elements.storeStatus.textContent = message;
}

function setCollectionStatus(message) {
  if (elements?.collectionStatus) elements.collectionStatus.textContent = message;
}

function getSuitColorClass(suit) {
  return getCardVisualColorClass({ suit });
}

function capitalize(value) {
  const text = String(value);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
