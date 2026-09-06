import { adManager } from "./ads.js?v=166";
import { playGameSfx } from "./audio.js?v=166";
import {
  CARD_RANKS,
  CARD_SUITS,
  buildCollectiblePool,
  claimPendingPackReward,
  createCardKey,
  createPendingPackReward,
  getCardCollectionSnapshot,
  getCollectionProgress,
  isCardSkinOwned,
  isFullDeckSkinOwned,
  subscribeToCardCollection,
  unlockFullDeckSkin
} from "./cardCollection.js?v=167";
import { openPendingPackOverlay } from "./cardCollectionUI.js?v=167";
import { applyCardSkin, CARD_SKINS, getCardSkinAssetUrl, getCardVisualColorClass, preloadCardSkinAssets } from "./cardSkins.js?v=167";
import { animateEntrance } from "./motion.js";
import { economy } from "./economy.js?v=166";
import { formatCompactNumber } from "./format.js?v=166";
import { haptic } from "./haptics.js?v=166";
import { purchaseManager } from "./purchases.js?v=166";
import { grantShieldToken, hasShieldToken } from "./save.js?v=166";
import { getNextDailyReset, getStoreProduct, getStoreProductsForTab, STORE_TABS } from "./storeProducts.js?v=167";
import { storeState } from "./storeState.js?v=167";

const SUIT_SYMBOLS = Object.freeze({ hearts: "\u2665", diamonds: "\u2666", clubs: "\u2663", spades: "\u2660" });
const ART_SPRITES = Object.freeze({
  "mystery-pack-purple": [0, 0],
  "mystery-pack-gold": [1, 0],
  "pink-arcade-deck": [2, 0],
  "coin-vault": [3, 0],
  "bank-shield": [0, 1],
  "coin-drop": [1, 1],
  "night-pack": [2, 1],
  "pink-pack": [3, 1],
  "gold-pack": [0, 2],
  "gold-deck": [0, 2],
  "rainbow-pack": [1, 2],
  "prism-deck": [1, 2],
  "flame-trail": [2, 2],
  "holo-back": [3, 2],
  "coin-pile": [0, 3],
  "coin-pouch": [1, 3],
  "coin-crate": [2, 3],
  "coin-mountain": [3, 3],
  "starter-bundle": [2, 0],
  "weekend-bundle": [0, 0]
});

const tabScrollPositions = new Map(STORE_TABS.map((tab) => [tab.id, 0]));
const TAB_ICONS = {
  featured: '<path d="M12 2 15 8 22 9 17 14 18 21 12 18 6 21 7 14 2 9 9 8Z" fill="currentColor"/><path d="m12 6 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z" fill="var(--room-paper)"/>',
  decks: '<path d="M3 5h13v16H3z" fill="currentColor" opacity=".5"/><path d="M7 2h14v17H7z" fill="currentColor"/><path d="m14 5 4 5-4 5-4-5Z" fill="var(--room-paper)"/>',
  coins: '<path d="m12 2 7 0 3 3v7l-3 3h-7l-3-3V5Z" fill="currentColor"/><path d="m4 9 7 0 3 3v7l-3 3H4l-3-3v-7Z" fill="currentColor" stroke="var(--room-paper)" stroke-width="1.5"/><path d="m7.5 12 3 3.5-3 3.5L4.5 15.5Z" fill="var(--room-paper)"/>'
};
const pendingProducts = new Set();
let currentTab = "featured";
let pendingPurchaseId = null;
let elements = null;
let timerId = 0;
let showPage = null;
let tabAnimation = null;

export function initializeStore({ bindAction, showMenuPage } = {}) {
  elements = {
    page: document.querySelector(".store-page"),
    tabs: document.querySelector("#storeTabs"),
    scroll: document.querySelector("#storeScroll"),
    content: document.querySelector("#storeContent"),
    coinValue: document.querySelector("#storeCoinsValue"),
    status: document.querySelector("#storeStatus"),
    collectionPanel: document.querySelector("#storeCollectionPanel"),
    purchaseOverlay: document.querySelector("#storePurchaseOverlay"),
    purchaseBody: document.querySelector("#storePurchaseBody")
  };
  showPage = typeof showMenuPage === "function" ? showMenuPage : null;
  if (!elements.page || !elements.content) return;

  bindAction(elements.page, onStoreAction);
  bindAction(elements.purchaseOverlay, onStoreAction);
  elements.tabs.addEventListener("keydown", (event) => {
    if (!event.target.matches("[role=tab]")) return;
    const index = STORE_TABS.findIndex((tab) => tab.id === currentTab);
    const next = event.key === "ArrowRight" ? (index + 1) % STORE_TABS.length
      : event.key === "ArrowLeft" ? (index + STORE_TABS.length - 1) % STORE_TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? STORE_TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    switchTab(STORE_TABS[next].id);
    elements.tabs.querySelector("[aria-selected=true]")?.focus({ preventScroll: true });
  });
  economy.subscribe(() => renderStore({ preserveScroll: true }));
  storeState.subscribe(() => renderStore({ preserveScroll: true }));
  subscribeToCardCollection(() => renderStore({ preserveScroll: true }));
  window.addEventListener("card-crunch-card-skin-change", () => renderStore({ preserveScroll: true }));
  window.addEventListener("card-crunch-menu-page-change", onMenuPageChange);
  window.addEventListener("card-crunch-pack-buy-another", onPackBuyAnother);
  applyOwnedCosmetics();
  renderStore({ preserveScroll: false });
}

function onMenuPageChange(event) {
  if (event.detail?.pageName !== "shop") {
    window.clearInterval(timerId);
    timerId = 0;
    return;
  }
  renderStore({ preserveScroll: true });
  if (!timerId) timerId = window.setInterval(updateTimers, 1000);
}

function onPackBuyAnother(event) {
  const product = getStoreProduct(event.detail?.productId);
  if (!product) return;
  window.setTimeout(() => buyPack(product), 80);
}

function renderStore({ preserveScroll = true } = {}) {
  if (!elements?.content) return;
  const focused = elements.page.contains(document.activeElement) ? document.activeElement : null;
  const focusAction = focused?.dataset.storeAction;
  const focusProduct = focused?.dataset.productId;
  const focusTab = focused?.dataset.storeTab;
  const previousScroll = preserveScroll ? elements.scroll?.scrollTop ?? 0 : tabScrollPositions.get(currentTab) ?? 0;
  const wallet = economy.getSnapshot();
  const collection = getCardCollectionSnapshot();
  if (elements.coinValue) elements.coinValue.textContent = formatCompactNumber(wallet.coins);
  elements.tabs.innerHTML = STORE_TABS.map((tab) => `
    <button class="store-tab${currentTab === tab.id ? " is-active" : ""}" type="button" role="tab"
      id="store-tab-${tab.id}" aria-controls="storeContent" tabindex="${currentTab === tab.id ? 0 : -1}"
      aria-selected="${currentTab === tab.id}" data-store-action="tab" data-store-tab="${tab.id}">
      <svg class="store-tab-icon" viewBox="0 0 24 24" aria-hidden="true">${TAB_ICONS[tab.id]}</svg><span>${tab.label}</span>
    </button>
  `).join("");
  elements.content.setAttribute("role", "tabpanel");
  elements.content.setAttribute("aria-labelledby", `store-tab-${currentTab}`);

  elements.content.classList.add("is-changing");
  elements.content.innerHTML = currentTab === "decks"
    ? renderDecksTab(wallet, collection)
    : currentTab === "coins"
      ? renderCoinsTab(wallet, collection)
      : renderFeaturedTab(wallet, collection);
  requestAnimationFrame(() => elements.content?.classList.remove("is-changing"));
  if (elements.scroll) elements.scroll.scrollTop = previousScroll;
  if (focusAction && !focused.isConnected) {
    const replacement = [...elements.page.querySelectorAll("[data-store-action]")].find((button) =>
      button.dataset.storeAction === focusAction && button.dataset.productId === focusProduct && button.dataset.storeTab === focusTab && !button.disabled);
    replacement?.focus({ preventScroll: true });
  }
  updateTimers();
}

function renderFeaturedTab(wallet, collection) {
  const daily = getStoreProduct("daily-free-pack");
  const mystery = getStoreProduct("mystery-card-pack");
  const pink = getStoreProduct("pink-arcade-full-deck");
  const shield = getStoreProduct("bank-shield");
  const ad = getStoreProduct("coin-drop-ad");
  const vault = getStoreProduct("coin-vault");
  return `
    ${renderDailyHero(daily, "pack", wallet, collection)}
    ${renderSectionTitle("Daily Picks", "<span class=\"store-live-timer\" data-store-countdown=\"daily\">23h 59m</span>")}
    ${renderProductCard(mystery, "wide", wallet, collection)}
    ${renderProductCard(pink, "wide premium", wallet, collection)}
    <div class="store-utility-grid">
      ${renderProductCard(shield, "compact", wallet, collection)}
      ${renderProductCard(ad, "compact", wallet, collection)}
    </div>
    ${renderProductCard(vault, "wide treasure", wallet, collection)}
    ${renderStoreTrustCopy()}
  `;
}

function renderDecksTab(wallet, collection) {
  const themedPacks = getStoreProductsForTab("decks").filter((product) => product.productType === "themed_card_pack");
  const completeDecks = getStoreProductsForTab("decks").filter((product) => product.productType === "full_deck");
  const cosmetics = getStoreProductsForTab("decks").filter((product) => ["card_back", "trail"].includes(product.productType));
  const featured = getStoreProduct("pink-arcade-full-deck");
  return `
    ${renderSectionTitle("Featured Deck")}
    ${renderProductCard(featured, "hero-deck", wallet, collection)}
    ${renderSectionTitle("Themed Card Packs")}
    <div class="store-product-stack">${themedPacks.map((product) => renderProductCard(product, "wide", wallet, collection)).join("")}</div>
    ${renderSectionTitle("Complete Decks")}
    <div class="store-product-stack">${completeDecks.map((product) => renderProductCard(product, "wide premium", wallet, collection)).join("")}</div>
    ${renderSectionTitle("Owned Collections")}
    ${renderOwnedCollections(collection)}
    ${renderSectionTitle("Card Backs & Trails")}
    <div class="store-utility-grid store-cosmetics-grid">${cosmetics.map((product) => renderProductCard(product, "compact", wallet, collection)).join("")}</div>
    <p class="store-cosmetic-note"><span aria-hidden="true">i</span> Cosmetics do not affect gameplay.</p>
  `;
}

function renderCoinsTab(wallet, collection) {
  const daily = getStoreProduct("daily-coin-bonus");
  const coinBundles = getStoreProductsForTab("coins").filter((product) => product.productType === "coin_bundle");
  const mixed = getStoreProductsForTab("coins").filter((product) => product.productType === "mixed_bundle");
  const exclusive = getStoreProduct("royal-prism-full-deck");
  return `
    ${renderDailyHero(daily, "coins", wallet, collection)}
    ${renderSectionTitle("Coin Bundles")}
    <div class="store-product-stack store-coin-stack">${coinBundles.map((product) => renderProductCard(product, "coin-row", wallet, collection)).join("")}</div>
    ${renderSectionTitle("Special Bundles")}
    <div class="store-utility-grid">${mixed.map((product) => renderProductCard(product, "compact bundle", wallet, collection)).join("")}</div>
    ${renderSectionTitle("Premium Exclusives")}
    ${renderProductCard(exclusive, "wide treasure", wallet, collection)}
    ${renderStoreTrustCopy()}
  `;
}

function renderDailyHero(product, kind, wallet, collection) {
  const claimed = storeState.hasClaimedDaily(product.id);
  const state = getProductUiState(product, wallet, collection);
  const buttonLabel = claimed ? "CLAIMED" : kind === "coins" ? "CLAIM" : "CLAIM FREE";
  return `
    <article class="store-daily-hero store-theme-green${claimed ? " is-claimed" : ""}">
      ${renderArtwork(product)}
      <div class="store-product-copy">
        <h3>${product.displayName}</h3>
        <p>${kind === "pack" ? "1 new card. No duplicates." : `${product.coinAmount} coins, on us.`}</p>
        <small>Next gift in <b data-store-countdown="daily">23h 59m</b></small>
      </div>
      <button class="store-action-button action-green" type="button" data-store-action="product" data-product-id="${product.id}"
        ${claimed || state.disabled ? "disabled" : ""}>${buttonLabel}</button>
    </article>
  `;
}

function renderProductCard(product, variant, wallet, collection) {
  const state = getProductUiState(product, wallet, collection);
  const progress = product.collectionId ? getCollectionProgress(product.collectionId) : null;
  const isPack = ["themed_card_pack", "generic_card_pack", "daily_free_pack"].includes(product.productType);
  const isFullDeck = product.productType === "full_deck" || product.unlockEntireCollection;
  const copy = getProductDisplayCopy(product);
  const productClass = `store-product-card store-theme-${product.backgroundTheme} ${variant}`;
  const metadata = [];
  if (isPack && product.productType === "themed_card_pack" && progress) metadata.push(`${progress.owned} / 52 collected`);
  if (product.productType === "generic_card_pack") {
    const remaining = buildCollectiblePool(collection.owned).length;
    metadata.push(`${remaining} cards left to collect`);
  }
  if (product.productType === "rewarded_ad") metadata.push(`${wallet.coinAdsRemaining} left today`);

  return `
    <article class="${productClass}" data-product-card="${product.id}">
      ${isFullDeck ? '<span class="store-product-badge">52-CARD DECK</span>' : product.badge ? `<span class="store-product-badge">${product.badge}</span>` : ""}
      ${renderArtwork(product)}
      <div class="store-product-copy">
        <h3>${copy.title}</h3>
        <p>${copy.subtitle}</p>
        ${copy.detail ? `<small>${copy.detail}</small>` : ""}
        ${metadata.length ? `<ul>${metadata.map((item) => `<li>${item}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="store-product-actions">
        ${renderPrice(product)}
        <button class="store-action-button ${getActionTone(product)}" type="button" data-store-action="product" data-product-id="${product.id}"
          ${state.disabled || state.loading ? "disabled" : ""} aria-label="${state.ariaLabel}">
          ${state.loading ? "WORKING..." : state.label}
        </button>
        ${product.collectionId && product.productType === "themed_card_pack"
          ? `<button class="store-link-button" type="button" data-store-action="view-collection" data-collection-id="${product.collectionId}" data-product-id="${product.id}">VIEW COLLECTION</button>`
          : ""}
      </div>
    </article>
  `;
}

function getProductDisplayCopy(product) {
  const title = product.displayName.replace(" Full Deck", "").replace("Mystery Card Pack", "Mystery Pack");
  if (product.productType === "full_deck") return { title, subtitle: "All 52 cards", detail: product.contents?.slice(1).join(" + ") };
  if (product.productType === "generic_card_pack") return { title, subtitle: "1 random card. No duplicates.", detail: "Rainbow chance: 3%" };
  if (product.productType === "themed_card_pack") return { title, subtitle: "1 new card from this deck", detail: "No duplicates" };
  if (product.productType === "coin_bundle") return { title, subtitle: product.subtitle, detail: "" };
  if (product.productType === "mixed_bundle") return { title, subtitle: product.contents?.join(" + "), detail: "" };
  if (product.productType === "rewarded_ad") return { title, subtitle: `+${product.rewardAmount} coins per ad`, detail: "" };
  if (product.productType === "utility") return { title, subtitle: product.subtitle, detail: "One shield for your next Pot." };
  return { title, subtitle: product.subtitle, detail: "" };
}

function renderArtwork(product) {
  if (product.productType === "full_deck" && CARD_SKINS[product.collectionId]) {
    const skin = product.collectionId;
    const cards = [{ rank: "7", suit: "hearts", symbol: "\u2665" }, { rank: "A", suit: "spades", symbol: "\u2660" }];
    return `<div class="store-product-art store-deck-fan" aria-hidden="true">${cards.map((card) => {
      const image = getCardSkinAssetUrl(card, skin);
      return image ? `<img class="store-deck-face" src="${image}" alt="" loading="lazy" decoding="async" draggable="false">`
        : `<i class="store-deck-face deck-preview-${skin} ${card.suit}"><b>${card.rank}</b><span>${card.symbol}</span></i>`;
    }).join("")}</div>`;
  }
  const [column, row] = ART_SPRITES[product.artwork] ?? ART_SPRITES["mystery-pack-purple"];
  return `
    <div class="store-product-art art-${product.artwork}" aria-hidden="true">
      <span class="store-art-sprite" style="--sprite-x:${column * 100 / 3}%;--sprite-y:${row * 100 / 3}%"></span>
    </div>
  `;
}

function renderPrice(product) {
  if (product.currencyType === "coins") return `<strong class="store-price coin-price">${formatCompactNumber(product.coinPrice)} <span>COINS</span></strong>`;
  if (product.currencyType === "real_money") return `<strong class="store-price money-price">${product.localizedRealMoneyPrice}</strong>`;
  if (product.currencyType === "rewarded_ad") return `<strong class="store-price ad-price">WATCH AD</strong>`;
  return "<strong class=\"store-price free-price\">FREE</strong>";
}

function getActionTone(product) {
  if (product.currencyType === "real_money") return "action-gold";
  if (product.currencyType === "rewarded_ad") return "action-teal";
  if (["themed_card_pack", "generic_card_pack"].includes(product.productType)) return "action-purple";
  if (product.productType === "utility") return "action-blue";
  return "action-green";
}

function getProductUiState(product, wallet = economy.getSnapshot(), collection = getCardCollectionSnapshot()) {
  const loading = pendingProducts.has(product.id);
  const state = storeState.getSnapshot();
  if (product.productType === "daily_free_pack" || product.productType === "daily_coin_bonus") {
    const claimed = storeState.hasClaimedDaily(product.id);
    return { loading, disabled: claimed, label: claimed ? "CLAIMED" : "CLAIM", ariaLabel: claimed ? `${product.displayName} claimed` : `Claim ${product.displayName}` };
  }
  if (product.productType === "full_deck") {
    const owned = isFullDeckSkinOwned(product.collectionId);
    const equipped = collection.fullDeckSkin === product.collectionId;
    return {
      loading,
      disabled: equipped,
      label: equipped ? "EQUIPPED" : owned ? "EQUIP" : "BUY FULL DECK",
      ariaLabel: equipped ? `${product.displayName} equipped` : owned ? `Equip ${product.displayName}` : `Buy ${product.displayName} for ${product.localizedRealMoneyPrice}`
    };
  }
  if (product.productType === "themed_card_pack") {
    const progress = getCollectionProgress(product.collectionId);
    return {
      loading,
      disabled: progress.complete && !collection.pendingReward,
      label: collection.pendingReward?.productId === product.id ? "OPEN PACK" : progress.complete ? "COMPLETE" : "BUY PACK",
      ariaLabel: `Buy ${product.displayName} for ${product.coinPrice} coins. Awards one random card.`
    };
  }
  if (product.productType === "generic_card_pack") {
    const remaining = buildCollectiblePool(collection.owned).length;
    return {
      loading,
      disabled: remaining === 0 && !collection.pendingReward,
      label: collection.pendingReward?.productId === product.id ? "OPEN PACK" : remaining ? "BUY PACK" : "COMPLETE",
      ariaLabel: `Buy Mystery Card Pack for ${product.coinPrice} coins. Awards one random card.`
    };
  }
  if (product.productType === "utility") {
    const owned = hasShieldToken();
    return { loading, disabled: owned, label: owned ? "ARMED" : "BUY", ariaLabel: owned ? "Bank Shield armed" : `Buy Bank Shield for ${product.coinPrice} coins` };
  }
  if (product.productType === "rewarded_ad") {
    return { loading, disabled: !wallet.canWatchCoinAd, label: wallet.canWatchCoinAd ? "WATCH AD" : "DAILY LIMIT", ariaLabel: "Watch a rewarded ad for 125 coins" };
  }
  if (["trail", "card_back"].includes(product.productType)) {
    const owned = state.ownedCosmetics.includes(product.cosmeticId);
    const equipped = state.equippedCosmetics[product.cosmeticSlot] === product.cosmeticId;
    return { loading, disabled: equipped, label: equipped ? "EQUIPPED" : owned ? "EQUIP" : "BUY", ariaLabel: equipped ? `${product.displayName} equipped` : owned ? `Equip ${product.displayName}` : `Buy ${product.displayName} for ${product.coinPrice} coins` };
  }
  return { loading, disabled: false, label: product.currencyType === "real_money" ? "BUY NOW" : "BUY", ariaLabel: `Buy ${product.displayName}` };
}

function renderOwnedCollections(collection) {
  const collections = ["classic", "dark", "pink", "gold", "rainbow", "pink_arcade"];
  return `<div class="store-owned-grid">${collections.map((collectionId) => {
    const progress = getCollectionProgress(collectionId);
    const complete = progress.complete || isFullDeckSkinOwned(collectionId);
    const equipped = collection.fullDeckSkin === collectionId;
    const name = CARD_SKINS[collectionId]?.name ?? (collectionId === "classic" ? "Starter Classic" : collectionId);
    return `
      <article class="store-owned-card skin-${collectionId}${complete ? " is-complete" : " is-partial"}">
        <span class="owned-deck-icon" aria-hidden="true">${complete ? "\u2713" : "?"}</span>
        <div><strong>${name}</strong><small>${progress.owned} / ${progress.total} collected</small><b>${complete ? "COMPLETE" : "INCOMPLETE"}</b></div>
        ${complete
          ? `<button type="button" data-store-action="equip-deck" data-collection-id="${collectionId}" ${equipped ? "disabled" : ""}>${equipped ? "EQUIPPED" : "EQUIP"}</button>`
          : `<button type="button" data-store-action="view-collection" data-collection-id="${collectionId}">VIEW</button>`}
      </article>
    `;
  }).join("")}</div>`;
}

function renderSectionTitle(title, accessory = "") {
  return `<header class="store-section-title"><h3>${title}</h3>${accessory}</header>`;
}

function renderStoreTrustCopy() {
  const copy = purchaseManager.isDevelopmentMock()
    ? "Development billing mock active. No real payment is processed."
    : "Google Play items unlock only after a verified Android purchase.";
  return `<p class="store-trust-copy"><span aria-hidden="true">\u25a3</span>${copy}</p>`;
}

async function onStoreAction(event) {
  const target = event.target.closest?.("[data-store-action]");
  if (!target) return;
  const action = target.dataset.storeAction;
  if (action === "tab") return switchTab(target.dataset.storeTab);
  if (action === "product") return handleProduct(getStoreProduct(target.dataset.productId));
  if (action === "view-collection") return openCollectionPanel(target.dataset.collectionId, target.dataset.productId);
  if (action === "close-collection") return closeCollectionPanel();
  if (action === "buy-collection-pack") return handleProduct(getStoreProduct(target.dataset.productId));
  if (action === "equip-deck") return equipDeck(target.dataset.collectionId);
  if (action === "confirm-purchase") return confirmRealMoneyPurchase();
  if (action === "cancel-purchase") return closePurchaseDialog();
  if (action === "restore-purchases") return restorePurchases();
  if (action === "open-coins") return switchTab("coins");
}

function switchTab(tabId) {
  if (!STORE_TABS.some((tab) => tab.id === tabId) || tabId === currentTab) return;
  tabScrollPositions.set(currentTab, elements.scroll?.scrollTop ?? 0);
  currentTab = tabId;
  closeCollectionPanel();
  playGameSfx("card_select");
  haptic("tap");
  renderStore({ preserveScroll: false });
  tabAnimation?.cancel();
  tabAnimation = animateEntrance(elements.content, { duration: 180 });
}

async function handleProduct(product) {
  if (!product || pendingProducts.has(product.id)) return;
  const uiState = getProductUiState(product);
  if (uiState.disabled) return;
  if (product.productType === "full_deck" && isFullDeckSkinOwned(product.collectionId)) return equipDeck(product.collectionId);
  if (["themed_card_pack", "generic_card_pack"].includes(product.productType)) return buyPack(product);
  if (product.productType === "daily_free_pack") return claimDailyPack(product);
  if (product.productType === "daily_coin_bonus") return claimDailyCoins(product);
  if (product.productType === "utility") return buyUtility(product);
  if (product.productType === "rewarded_ad") return claimRewardedCoins(product);
  if (["trail", "card_back"].includes(product.productType)) return buyOrEquipCosmetic(product);
  if (product.currencyType === "real_money") return openPurchaseDialog(product);
}

function buyPack(product) {
  const collection = getCardCollectionSnapshot();
  if (collection.pendingReward) {
    if (collection.pendingReward.productId !== product.id) {
      setStatus(`Open your waiting ${collection.pendingReward.productName} before buying another pack.`, "neutral");
    }
    openPendingPackOverlay();
    return;
  }
  if (product.collectionId && getCollectionProgress(product.collectionId).complete) {
    setStatus(`${product.displayName.replace(" Pack", "")} collection is already complete.`, "good");
    return;
  }
  if (!economy.spendCoins(product.coinPrice)) {
    const missing = Math.max(0, product.coinPrice - economy.getSnapshot().coins);
    setStatus(`You need ${formatCompactNumber(missing)} more coins for ${product.displayName}.`, "bad");
    playGameSfx("invalid_card");
    return;
  }
  const reward = createPendingPackReward({ collectionId: product.collectionId, productId: product.id, productName: product.displayName });
  if (!reward) {
    economy.addCoins(product.coinPrice);
    setStatus("That collection is complete. Your coins were returned.", "good");
    return;
  }
  storeState.recordPurchase(product.id);
  playGameSfx("pack_buy");
  setStatus(`${formatCompactNumber(product.coinPrice)} coins spent. Pack ready to open.`, "good");
  openPendingPackOverlay();
}

function claimDailyPack(product) {
  if (storeState.hasClaimedDaily(product.id)) return;
  const collection = getCardCollectionSnapshot();
  if (collection.pendingReward) {
    setStatus(`Open your waiting ${collection.pendingReward.productName} first.`, "neutral");
    openPendingPackOverlay();
    return;
  }
  const reward = createPendingPackReward({ productId: product.id, productName: product.displayName });
  if (!reward) {
    storeState.claimDaily(product.id);
    economy.addCoins(125);
    setStatus("All card collections are complete, so your Daily Pack became 125 coins.", "good");
    return;
  }
  if (!storeState.claimDaily(product.id)) return;
  playGameSfx("pack_buy");
  openPendingPackOverlay();
  renderStore({ preserveScroll: true });
}

function claimDailyCoins(product) {
  if (!storeState.claimDaily(product.id)) return;
  economy.addCoins(product.coinAmount);
  playGameSfx("score_arrive");
  haptic("score");
  setStatus(`+${formatCompactNumber(product.coinAmount)} daily coins claimed.`, "good");
  renderStore({ preserveScroll: true });
}

function buyUtility(product) {
  if (hasShieldToken()) return;
  if (!economy.spendCoins(product.coinPrice)) {
    setStatus(`You need ${formatCompactNumber(product.coinPrice - economy.getSnapshot().coins)} more coins for Bank Shield.`, "bad");
    return;
  }
  grantShieldToken();
  storeState.recordPurchase(product.id);
  playGameSfx("bank");
  setStatus("Safe Bank Shield armed for your next Pot run.", "good");
  renderStore({ preserveScroll: true });
}

async function claimRewardedCoins(product) {
  if (!economy.canClaimCoinAd() || !adManager.canShowRewardedAd()) return;
  pendingProducts.add(product.id);
  renderStore({ preserveScroll: true });
  setStatus("Loading rewarded Coin Drop...", "neutral");
  const earned = await adManager.showRewardedAd("coinDrop");
  pendingProducts.delete(product.id);
  if (!earned) {
    setStatus("The ad closed before its reward completed.", "bad");
    renderStore({ preserveScroll: true });
    return;
  }
  const amount = economy.claimCoinAd();
  playGameSfx("score_arrive");
  haptic("score");
  setStatus(`+${formatCompactNumber(amount)} coins added.`, "good");
  renderStore({ preserveScroll: true });
}

function buyOrEquipCosmetic(product) {
  const snapshot = storeState.getSnapshot();
  if (snapshot.ownedCosmetics.includes(product.cosmeticId)) {
    storeState.equipCosmetic(product.cosmeticSlot, product.cosmeticId);
    applyOwnedCosmetics();
    setStatus(`${product.displayName} equipped.`, "good");
    playGameSfx("card_select");
    return;
  }
  if (!economy.spendCoins(product.coinPrice)) {
    setStatus(`You need ${formatCompactNumber(product.coinPrice - economy.getSnapshot().coins)} more coins.`, "bad");
    return;
  }
  storeState.unlockCosmetic(product.cosmeticId);
  storeState.equipCosmetic(product.cosmeticSlot, product.cosmeticId);
  storeState.recordPurchase(product.id);
  applyOwnedCosmetics();
  setStatus(`${product.displayName} unlocked and equipped.`, "good");
  playGameSfx("card_unlock");
}

function equipDeck(collectionId) {
  if (!isFullDeckSkinOwned(collectionId)) {
    setStatus("Complete or purchase this collection before equipping the full deck.", "bad");
    return;
  }
  applyCardSkin(collectionId);
  preloadCardSkinAssets(collectionId);
  playGameSfx("card_unlock");
  setStatus(`${CARD_SKINS[collectionId]?.name ?? "Deck"} equipped.`, "good");
  renderStore({ preserveScroll: true });
}

function openPurchaseDialog(product) {
  if (!elements.purchaseOverlay || !elements.purchaseBody) return;
  pendingPurchaseId = product.id;
  elements.purchaseBody.innerHTML = `
    <span class="store-dialog-kicker">${product.unlockEntireCollection ? "REAL-MONEY FULL DECK" : "GOOGLE PLAY PURCHASE"}</span>
    <h2>${product.displayName}</h2>
    <strong class="store-dialog-price">${product.localizedRealMoneyPrice}</strong>
    <p>${product.description}</p>
    ${product.contents?.length ? `<ul>${product.contents.map((item) => `<li>${item}</li>`).join("")}</ul>` : ""}
    <p class="store-dialog-warning">${purchaseManager.isDevelopmentMock()
      ? "Development billing mock: no real payment will be processed."
      : "Your item unlocks only after Google Play confirms the purchase."}</p>
  `;
  elements.purchaseOverlay.hidden = false;
  elements.purchaseOverlay.setAttribute("aria-hidden", "false");
  elements.purchaseOverlay.querySelector("[data-store-action=confirm-purchase]")?.focus({ preventScroll: true });
}

function closePurchaseDialog() {
  pendingPurchaseId = null;
  if (!elements?.purchaseOverlay) return;
  elements.purchaseOverlay.hidden = true;
  elements.purchaseOverlay.setAttribute("aria-hidden", "true");
}

async function confirmRealMoneyPurchase() {
  const product = getStoreProduct(pendingPurchaseId);
  if (!product || pendingProducts.has(product.id)) return;
  pendingProducts.add(product.id);
  closePurchaseDialog();
  renderStore({ preserveScroll: true });
  setStatus(`Opening Google Play for ${product.displayName}...`, "neutral");
  const result = await purchaseManager.buy(product.platformProductId);
  if (!result.success) {
    pendingProducts.delete(product.id);
    setStatus(result.reason === "unavailable"
      ? "This preview is ready, but Google Play Billing must be connected in the Android release build."
      : "Purchase was cancelled or could not be verified. Nothing was charged or unlocked.", "bad");
    renderStore({ preserveScroll: true });
    return;
  }
  const recorded = storeState.registerVerifiedTransaction(product.id, result.transactionId);
  if (!recorded) {
    pendingProducts.delete(product.id);
    setStatus("This verified transaction was already granted.", "neutral");
    renderStore({ preserveScroll: true });
    return;
  }
  await grantVerifiedProduct(product);
  pendingProducts.delete(product.id);
  setStatus(`${product.displayName} unlocked from a verified purchase.`, "good");
  playGameSfx("card_unlock");
  haptic("score");
  renderStore({ preserveScroll: true });
}

async function grantVerifiedProduct(product) {
  if (product.coinAmount) economy.addCoins(product.coinAmount);
  if (product.unlockEntireCollection && product.collectionId) {
    unlockFullDeckSkin(product.collectionId);
    applyCardSkin(product.collectionId);
    preloadCardSkinAssets(product.collectionId);
  }
  if (product.cardsAwarded && product.productType === "mixed_bundle") {
    for (let index = 0; index < product.cardsAwarded; index += 1) {
      const reward = createPendingPackReward({ productId: product.id, productName: `${product.displayName} Pack ${index + 1}` });
      if (!reward) break;
      claimPendingPackReward();
    }
  }
}

async function restorePurchases() {
  setStatus("Checking Google Play purchase history...", "neutral");
  const result = await purchaseManager.restorePurchases();
  if (!result.success) {
    setStatus("Purchase restore is available after Google Play Billing is connected.", "neutral");
    return;
  }
  let restored = 0;
  for (const purchase of result.purchases) {
    const product = getStoreProductsForTab("decks").concat(getStoreProductsForTab("coins"))
      .find((entry) => entry.platformProductId === purchase.productId);
    if (!product || !storeState.registerVerifiedTransaction(product.id, purchase.transactionId)) continue;
    await grantVerifiedProduct(product);
    restored += 1;
  }
  setStatus(restored ? `${restored} verified purchase${restored === 1 ? "" : "s"} restored.` : "Everything is already restored.", "good");
  renderStore({ preserveScroll: true });
}

function openCollectionPanel(collectionId, productId = "") {
  if (!elements.collectionPanel || !collectionId || collectionId === "classic" || collectionId === "pink_arcade") {
    showPage?.("themes");
    return;
  }
  const progress = getCollectionProgress(collectionId);
  const product = getStoreProduct(productId) ?? getStoreProductsForTab("decks").find((entry) => entry.collectionId === collectionId && entry.productType === "themed_card_pack");
  const rows = CARD_SUITS.map((suit) => `
    <div class="store-collection-row"><span aria-label="${suit}">${SUIT_SYMBOLS[suit]}</span><div>
      ${CARD_RANKS.map((rank) => {
        const key = createCardKey(rank, suit);
        const owned = isCardSkinOwned(collectionId, key);
        return `<i class="store-mini-card card-${getCardVisualColorClass({ suit })}${owned ? " is-owned" : " is-missing"}" aria-label="${owned ? `${rank} of ${suit} owned` : `${rank} of ${suit} missing`}"><b>${owned ? rank : "?"}</b><em>${owned ? SUIT_SYMBOLS[suit] : ""}</em></i>`;
      }).join("")}
    </div></div>
  `).join("");
  elements.collectionPanel.innerHTML = `
    <div class="store-collection-sheet store-theme-${product?.backgroundTheme ?? "purple"}" role="dialog" aria-modal="true" aria-labelledby="storeCollectionTitle">
      <button class="store-sheet-close" type="button" data-store-action="close-collection" aria-label="Close collection">\u00d7</button>
      <span class="store-dialog-kicker">THEMED CARD COLLECTION</span>
      <h2 id="storeCollectionTitle">${CARD_SKINS[collectionId]?.name ?? collectionId}</h2>
      <strong>${progress.owned} / 52 COLLECTED</strong>
      <div class="store-collection-progress"><i style="--store-collection-progress:${(progress.owned / 52) * 100}%"></i></div>
      <p>Owned cards are in full color. Missing exact rank-and-suit cards stay sealed and use Default in-game.</p>
      <div class="store-rarity-line"><span>${product?.displayName ?? "Card Pack"}</span><b>No duplicate cards</b><em>${product ? `${formatCompactNumber(product.coinPrice)} Coins` : ""}</em></div>
      <div class="store-collection-matrix">${rows}</div>
      ${product ? `<button class="store-action-button action-purple" type="button" data-store-action="buy-collection-pack" data-product-id="${product.id}" ${progress.complete ? "disabled" : ""}>${progress.complete ? "COLLECTION COMPLETE" : "BUY PACK"}</button>` : ""}
    </div>
  `;
  elements.collectionPanel.hidden = false;
  elements.collectionPanel.setAttribute("aria-hidden", "false");
  elements.collectionPanel.querySelector(".store-sheet-close")?.focus({ preventScroll: true });
}

function closeCollectionPanel() {
  if (!elements?.collectionPanel) return;
  elements.collectionPanel.hidden = true;
  elements.collectionPanel.setAttribute("aria-hidden", "true");
  elements.collectionPanel.replaceChildren();
}

function applyOwnedCosmetics() {
  const snapshot = storeState.getSnapshot();
  document.documentElement.dataset.equippedTrail = snapshot.equippedCosmetics.trail ?? "default";
  document.documentElement.dataset.equippedCardBack = snapshot.equippedCosmetics.cardBack ?? "default";
}

function setStatus(message, tone = "neutral") {
  if (!elements?.status) return;
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function updateTimers() {
  const remaining = Math.max(0, getNextDailyReset() - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  document.querySelectorAll("[data-store-countdown=daily]").forEach((element) => {
    element.textContent = `${hours}h ${String(minutes).padStart(2, "0")}m`;
  });
}
