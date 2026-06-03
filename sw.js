/* Pango GO service worker — offline caching */
const CACHE = "pangogo-v4";
const SPRITES = ["Cat","Dog","Chicken","Pigeon","Fish","PinkBlob","GreenBlob","Birb","Mushnub","Cactoro","Yeti","Ninja","Alien","GreenSpikyBlob","Orc","Wizard","Mushnub_Evolved"]
  .map((n) => "./assets/sprites/" + n + ".png");
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/audio.js",
  "./assets/sprites/sprites.js",
  "./js/data.js",
  "./js/game.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  ...SPRITES,
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // cache same-origin successful responses
          if (res && res.status === 200 && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
