const CACHE_NAME = "card-crunch-v207";
const PINK_ARCADE_SUITS = ["hearts", "diamonds", "clubs", "spades"];
const PINK_ARCADE_RANKS = ["ace", "02", "03", "04", "05", "06", "07", "08", "09", "10", "jack", "queen", "king"];
const PINK_ARCADE_ASSETS = [
  "./assets/card-sets/pink_arcade/card-set.json",
  "./assets/card-sets/pink_arcade/backs/default_back.png",
  "./assets/card-sets/pink_arcade/previews/card-back-preview.png",
  "./assets/card-sets/pink_arcade/previews/full-deck-preview.png",
  "./assets/card-sets/pink_arcade/atlas/cards-atlas.png",
  "./assets/card-sets/pink_arcade/atlas/cards-atlas.json",
  ...PINK_ARCADE_SUITS.flatMap((suit) => PINK_ARCADE_RANKS.map((rank) => `./assets/card-sets/pink_arcade/cards/${suit}/${rank}_${suit}.png`))
];
const ASSETS = [
  "./",
  "./index.html",
  "./build-config.js",
  "./platform-config.js",
  "./src/vendor/capacitor-secure-storage.js",
  "./privacy-policy.html",
  "./styles/main.css",
  "./styles/collection.css",
  "./styles/store.css",
  "./styles/multiplayer.css",
  "./styles/app-shell.css",
  "./styles/presentation.css",
  "./src/motion.js",
  "./src/screenAccessibility.js",
  "./src/main.js",
  "./src/appShell.js",
  "./src/launchGate.js",
  "./src/stlPlatformConfig.js",
  "./src/stlPlatformClient.js",
  "./src/stlCloudSave.js",
  "./src/stlPlatform.js",
  "./src/tutorial.js",
  "./src/audio.js",
  "./src/haptics.js",
  "./src/input.js",
  "./src/cardGestures.js",
  "./src/dealTiming.js",
  "./src/playGames.js",
  "./src/fullscreen.js",
  "./src/themes.js",
  "./src/cardSkins.js",
  "./src/cardCollection.js",
  "./src/cardCollectionUI.js",
  "./src/store.js",
  "./src/storeProducts.js",
  "./src/storeState.js",
  "./src/multiplayer.js",
  "./src/multiplayerBot.js",
  "./src/realtimeMultiplayer.js",
  "./src/multiplayerMode.js",
  "./src/economy.js",
  "./src/boosters.js",
  "./src/liveEvents.js",
  "./src/scoreSurge.js",
  "./src/purchases.js",
  "./src/ads.js",
  "./src/gameState.js",
  "./src/arcadeMode.js",
  "./src/deck.js",
  "./src/scoring.js",
  "./src/save.js",
  "./src/format.js",
  "./src/handSafety.js",
  "./src/animations.js",
  "./src/crunchCutscene.js",
  "./src/ui.js",
  "./src/potInfo.js",
  "./src/progression.js",
  "./manifest.json",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
  "./assets/icons/suits/heart.svg",
  "./assets/icons/suits/diamond.svg",
  "./assets/icons/suits/club.svg",
  "./assets/icons/suits/spade.svg",
  "./assets/ui/store-items.svg",
  "./assets/ui/pot-journey-atlas.svg",
  "./assets/ui/shell-ui-atlas.svg",
  "./assets/ui/game-controls-atlas.svg",
  "./assets/fonts/press-start-2p.ttf",
  "./assets/sfx/playing-card.mp3",
  "./assets/sfx/deal-hand-1.mp3",
  "./assets/sfx/deal-hand-2.mp3",
  "./assets/sfx/deal-hand-3.mp3",
  "./assets/sfx/deal-hand-4.mp3",
  ...PINK_ARCADE_ASSETS
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("card-crunch-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const STATIC_PATHS = new Set(ASSETS.map((asset) => new URL(asset, self.location.href).pathname));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === "navigate";
  // API responses, OAuth exchanges, and other origins never enter the game cache.
  if (url.origin !== self.location.origin || (!STATIC_PATHS.has(url.pathname) && !(isNavigation && url.pathname === "/auth/callback"))) return;
  const cacheKey = new URL(isNavigation ? "/index.html" : url.pathname, self.location.origin).href;
  const network = fetch(event.request);
  event.waitUntil(network.then(async (response) => {
    if (!response.ok || (isNavigation && url.search)) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey, response.clone());
  }).catch(() => {}));
  event.respondWith(network.catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(cacheKey) || Response.error();
  }));
});
