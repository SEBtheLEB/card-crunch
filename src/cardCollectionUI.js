import { playGameSfx } from "./audio.js?v=143";
import { economy, ECONOMY_CONFIG } from "./economy.js?v=145";
import {
  CARD_RANKS,
  CARD_SUITS,
  COLLECTIBLE_SKIN_IDS,
  buildCollectiblePool,
  claimPendingPackReward,
  createCardKey,
  createPendingPackReward,
  equipCollectedCard,
  getCardCollectionSnapshot,
  getCollectionProgress,
  isFullDeckSkinOwned,
  isCardSkinOwned,
  parseCardKey,
  subscribeToCardCollection,
  unlockFullDeckSkin
} from "./cardCollection.js?v=145";
import { applyCardSkin, CARD_SKINS, preloadCardSkinAssets, syncCardSkinFromCollection } from "./cardSkins.js?v=147";

const SUIT_SYMBOLS = Object.freeze({ hearts: "\u2665", diamonds: "\u2666", clubs: "\u2663", spades: "\u2660" });
const SKIN_ICONS = Object.freeze({ dark: "\u263E", pink: "\u2665", gold: "\u2605", rainbow: "\u25C6" });
let selectedCollectionSkin = "dark";
let packOpening = false;
let packRevealed = false;
let elements = null;

export function initializeCardCollectionUI(bindAction) {
  elements = {
    buyPackButton: document.querySelector("#buyMysteryPackButton"),
    buyPackPrice: document.querySelector("#mysteryPackPrice"),
    buyPinkArcadeDeckButton: document.querySelector("#buyPinkArcadeDeckButton"),
    pinkArcadeDeckPrice: document.querySelector("#pinkArcadeDeckPrice"),
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
    equipButton: document.querySelector("#equipPackRewardButton")
  };

  bindAction(elements.buyPackButton, buyOrResumePack);
  bindAction(elements.buyPinkArcadeDeckButton, buyOrEquipPinkArcadeDeck);
  bindAction(elements.openButton, revealPendingPack);
  bindAction(elements.collectButton, () => claimAndClosePack(false));
  bindAction(elements.equipButton, () => claimAndClosePack(true));
  bindAction(elements.collectionDeckList, onCollectionDeckAction);
  bindAction(elements.collectionDetail, onCollectionCardAction);

  economy.subscribe(renderPackStoreState);
  subscribeToCardCollection(() => {
    renderPackStoreState();
    renderCardCollection();
  });
  window.addEventListener("card-crunch-card-skin-change", renderCardCollection);

  renderPackStoreState();
  renderCardCollection();
  if (getCardCollectionSnapshot().pendingReward) showPackOverlay();
}

function buyOrResumePack() {
  const snapshot = getCardCollectionSnapshot();
  if (snapshot.pendingReward) {
    showPackOverlay();
    return;
  }
  if (!buildCollectiblePool(snapshot.owned).length) {
    setStoreStatus("Collection complete. Every mystery card has been found!");
    playGameSfx("score_total");
    return;
  }
  if (!economy.spendCoins(ECONOMY_CONFIG.mysteryCardPackCost)) {
    const missing = Math.max(0, ECONOMY_CONFIG.mysteryCardPackCost - economy.getSnapshot().coins);
    setStoreStatus(`You need ${missing} more coin${missing === 1 ? "" : "s"} for a Mystery Pack.`);
    playGameSfx("invalid_card");
    return;
  }
  const reward = createPendingPackReward();
  if (!reward) {
    economy.addCoins(ECONOMY_CONFIG.mysteryCardPackCost);
    setStoreStatus("Collection complete. Your coins were returned.");
    return;
  }
  playGameSfx("pack_buy");
  showPackOverlay();
}

function buyOrEquipPinkArcadeDeck() {
  const skinId = "pink_arcade";
  const alreadyOwned = isFullDeckSkinOwned(skinId);
  if (!alreadyOwned && !economy.spendCoins(ECONOMY_CONFIG.pinkArcadeDeckCost)) {
    const missing = Math.max(0, ECONOMY_CONFIG.pinkArcadeDeckCost - economy.getSnapshot().coins);
    setStoreStatus(`You need ${missing.toLocaleString()} more coins for the Pink Arcade deck.`);
    playGameSfx("invalid_card");
    return;
  }

  if (!alreadyOwned && !unlockFullDeckSkin(skinId)) {
    economy.addCoins(ECONOMY_CONFIG.pinkArcadeDeckCost);
    setStoreStatus("Pink Arcade could not be unlocked. Your coins were returned.");
    return;
  }

  applyCardSkin(skinId);
  preloadCardSkinAssets(skinId);
  renderPackStoreState();
  setStoreStatus(alreadyOwned ? "Pink Arcade deck equipped." : "Pink Arcade unlocked and equipped. Neon trail online!");
  playGameSfx(alreadyOwned ? "card_select" : "card_unlock");
}

function showPackOverlay() {
  if (!elements?.overlay) return;
  packOpening = false;
  packRevealed = false;
  elements.overlay.hidden = false;
  elements.overlay.setAttribute("aria-hidden", "false");
  elements.overlay.classList.remove("is-opening", "is-revealed", "is-collecting");
  elements.packShell.hidden = false;
  elements.packReward.hidden = true;
  elements.openButton.hidden = false;
  elements.openButton.disabled = false;
  elements.collectButton.hidden = true;
  elements.equipButton.hidden = true;
  elements.packPrompt.textContent = "Tap the pack to reveal one new card";
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

  window.setTimeout(() => {
    if (!elements.overlay || elements.overlay.hidden) return;
    packOpening = false;
    packRevealed = true;
    elements.overlay.classList.remove("is-opening");
    elements.overlay.classList.add("is-revealed");
    elements.packShell.hidden = true;
    elements.openButton.hidden = true;
    renderPackReward(reward);
    elements.packReward.hidden = false;
    elements.collectButton.hidden = false;
    elements.equipButton.hidden = false;
    elements.packPrompt.textContent = "NEW CARD SKIN";
    spawnPackBurst();
    playGameSfx("card_unlock");
    elements.equipButton.focus({ preventScroll: true });
  }, 520);
}

function renderPackReward(reward) {
  const colorClass = getSuitColorClass(reward.suit);
  const skinName = CARD_SKINS[reward.skinId]?.name ?? reward.skinId;
  elements.packReward.innerHTML = `
    <div class="pack-reward-card card-${colorClass} card-${reward.suit} card-skin-${reward.skinId}" data-card-rank="${reward.rank}" data-card-suit="${reward.suit}">
      <span>${reward.rank}${reward.suitSymbol}</span>
      <strong>${reward.rank}</strong>
      <i>${reward.suitSymbol}</i>
    </div>
    <div class="pack-reward-copy">
      <span>${skinName}</span>
      <h2>${reward.rank} of ${capitalize(reward.suit)}</h2>
      <p>1 of 52 in this deck</p>
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
    syncCardSkinFromCollection();
  }
  elements.overlay.classList.add("is-collecting");
  playGameSfx(shouldEquip ? "card_select" : "score_arrive");
  setStoreStatus(`${CARD_SKINS[reward.skinId].name} ${reward.rank} of ${capitalize(reward.suit)} added to your collection.`);
  window.setTimeout(closePackOverlay, 260);
}

function closePackOverlay() {
  if (!elements?.overlay) return;
  elements.overlay.hidden = true;
  elements.overlay.setAttribute("aria-hidden", "true");
  elements.overlay.classList.remove("is-opening", "is-revealed", "is-collecting");
  elements.packReward.replaceChildren();
  document.body.classList.remove("pack-overlay-open");
  renderPackStoreState();
  renderCardCollection();
  elements.buyPackButton?.focus({ preventScroll: true });
}

function renderPackStoreState() {
  if (!elements?.buyPackButton) return;
  const collection = getCardCollectionSnapshot();
  const wallet = economy.getSnapshot();
  const pending = Boolean(collection.pendingReward);
  const remaining = buildCollectiblePool(collection.owned).length;
  elements.buyPackButton.disabled = remaining === 0 && !pending;
  elements.buyPackButton.classList.toggle("has-waiting-pack", pending);
  elements.buyPackButton.classList.toggle("cannot-afford", !pending && wallet.coins < ECONOMY_CONFIG.mysteryCardPackCost);
  elements.buyPackPrice.textContent = pending ? "OPEN WAITING PACK" : `${ECONOMY_CONFIG.mysteryCardPackCost} Coins`;
  const small = elements.buyPackButton.querySelector("small");
  if (small) small.textContent = remaining ? `${remaining} new cards remain` : "Collection complete";
  renderPinkArcadeDeckStoreState(collection, wallet);
}

function renderPinkArcadeDeckStoreState(collection = getCardCollectionSnapshot(), wallet = economy.getSnapshot()) {
  if (!elements?.buyPinkArcadeDeckButton) return;
  const owned = collection.purchasedFullDeckSkins.includes("pink_arcade");
  const equipped = collection.fullDeckSkin === "pink_arcade";
  elements.buyPinkArcadeDeckButton.classList.toggle("is-owned", owned);
  elements.buyPinkArcadeDeckButton.classList.toggle("is-equipped", equipped);
  elements.buyPinkArcadeDeckButton.classList.toggle("cannot-afford", !owned && wallet.coins < ECONOMY_CONFIG.pinkArcadeDeckCost);
  elements.buyPinkArcadeDeckButton.setAttribute("aria-label", equipped
    ? "Pink Arcade deck equipped"
    : owned
      ? "Equip Pink Arcade deck"
      : `Buy Pink Arcade deck for ${ECONOMY_CONFIG.pinkArcadeDeckCost} coins`);
  if (elements.pinkArcadeDeckPrice) {
    elements.pinkArcadeDeckPrice.textContent = equipped
      ? "EQUIPPED"
      : owned
        ? "EQUIP DECK"
        : `${ECONOMY_CONFIG.pinkArcadeDeckCost.toLocaleString()} Coins`;
  }
  const detail = elements.buyPinkArcadeDeckButton.querySelector("small");
  if (detail) detail.textContent = owned ? "52 cards + custom neon trail" : "Complete 52-card pixel deck";
}

function renderCardCollection() {
  if (!elements?.collectionDeckList || !elements?.collectionDetail) return;
  const snapshot = getCardCollectionSnapshot();
  if (!COLLECTIBLE_SKIN_IDS.includes(selectedCollectionSkin)) selectedCollectionSkin = "dark";

  elements.collectionDeckList.innerHTML = COLLECTIBLE_SKIN_IDS.map((skinId) => {
    const progress = getCollectionProgress(skinId);
    const selected = skinId === selectedCollectionSkin;
    return `
      <button class="collection-deck-pack skin-${skinId}${selected ? " is-selected" : ""}" data-collection-skin="${skinId}" type="button" aria-pressed="${selected}">
        <span class="collection-pack-art" aria-hidden="true"><i>${SKIN_ICONS[skinId]}</i></span>
        <strong>${CARD_SKINS[skinId].name}</strong>
        <small>${progress.owned} / ${progress.total}</small>
      </button>
    `;
  }).join("");

  const progress = getCollectionProgress(selectedCollectionSkin);
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
    <div class="collection-progress-track"><i style="--collection-progress:${(progress.owned / progress.total) * 100}%"></i></div>
    <p>Find individual cards in Mystery Packs. Tap an owned card to equip it.</p>
    <button class="collection-full-deck-button${fullDeckActive ? " is-active" : ""}" data-test-full-deck="${selectedCollectionSkin}" type="button">
      ${fullDeckActive ? "FULL DECK ACTIVE" : "EQUIP FULL DECK (TEST)"}
    </button>
    <div class="collection-card-matrix" role="table" aria-label="${CARD_SKINS[selectedCollectionSkin].name} card collection">
      ${suitRows}
    </div>
  `;

  if (elements.collectionStatus && !elements.collectionStatus.textContent.trim()) {
    elements.collectionStatus.textContent = "Open packs to build a deck, or equip a full deck for testing.";
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
      aria-label="${owned ? `${equipped ? "Equipped" : "Equip"} ${CARD_SKINS[skinId].name} ${rank} of ${capitalize(suit)}` : `Locked ${rank} of ${capitalize(suit)}`}">
      <span>${owned ? rank : "?"}</span><i>${owned ? SUIT_SYMBOLS[suit] : ""}</i>
      ${equipped ? "<b aria-hidden=\"true\">E</b>" : ""}
    </button>
  `;
}

function onCollectionDeckAction(event) {
  const button = event.target.closest?.("[data-collection-skin]");
  if (!button) return;
  selectedCollectionSkin = button.dataset.collectionSkin;
  playGameSfx("card_select");
  renderCardCollection();
}

function onCollectionCardAction(event) {
  const fullDeckButton = event.target.closest?.("[data-test-full-deck]");
  if (fullDeckButton) {
    const skinId = fullDeckButton.dataset.testFullDeck;
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
  if (!equipCollectedCard(skinId, key)) return;
  syncCardSkinFromCollection();
  const card = parseCardKey(key);
  setCollectionStatus(`${CARD_SKINS[skinId].name} ${card.rank} of ${capitalize(card.suit)} equipped.`);
  renderCardCollection();
  playGameSfx("card_select");
}

function spawnPackBurst() {
  if (!elements?.overlay) return;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 22; index += 1) {
    const spark = document.createElement("i");
    const angle = (Math.PI * 2 * index) / 22 + Math.random() * .2;
    const distance = 72 + Math.random() * 150;
    spark.className = "pack-reveal-spark";
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
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

function capitalize(value) {
  const text = String(value);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
