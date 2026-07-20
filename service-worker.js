const CACHE_NAME = "card-crunch-v154";
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
  "./privacy-policy.html",
  "./styles/main.css",
  "./styles/collection.css",
  "./src/main.js",
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
  "./src/economy.js",
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
  "./src/progression.js",
  "./manifest.json",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
  "./assets/fonts/press-start-2p.ttf",
  "./assets/sfx/playing-card.mp3",
  "./assets/sfx/deal-hand-1.mp3",
  "./assets/sfx/deal-hand-2.mp3",
  "./assets/sfx/deal-hand-3.mp3",
  "./assets/sfx/deal-hand-4.mp3",
  ...PINK_ARCADE_ASSETS
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
