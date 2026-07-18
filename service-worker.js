const CACHE_NAME = "card-crunch-v78";
const ASSETS = [
  "./",
  "./index.html",
  "./privacy-policy.html",
  "./styles/main.css",
  "./src/main.js",
  "./src/audio.js",
  "./src/haptics.js",
  "./src/input.js",
  "./src/playGames.js",
  "./src/ads.js",
  "./src/gameState.js",
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
  "./assets/fonts/press-start-2p.ttf"
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
