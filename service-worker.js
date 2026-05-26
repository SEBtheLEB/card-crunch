const CACHE_NAME = "card-crunch-v19";
const ASSETS = [
  "./",
  "./index.html",
  "./styles/main.css",
  "./src/main.js",
  "./src/config.js",
  "./src/gameState.js",
  "./src/hand.js",
  "./src/storage.js",
  "./src/timer.js",
  "./src/deck.js",
  "./src/scoring.js",
  "./src/crunchPreview.js",
  "./src/animations.js",
  "./src/resultOverlay.js",
  "./src/ui.js",
  "./src/uiRenderers.js",
  "./src/cardView.js",
  "./src/mobileInput.js",
  "./src/pwa.js",
  "./src/progression.js",
  "./manifest.json",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg"
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
