/* Pango GO service worker — offline caching */
const CACHE = "pangogo-v13";
const SPRITES = ["Cat","Dog","Chicken","Pigeon","Fish","PinkBlob","GreenBlob","Birb","Mushnub","Cactoro","Yeti","Ninja","Alien","GreenSpikyBlob","Orc","Wizard","Mushnub_Evolved"]
  .map((n) => "./assets/sprites/" + n + ".png");
const WEAPONS = ["Axe","Pan","FlareGun","BearTrap_Open","Shovel","Torch"]
  .map((n) => "./assets/weapons/" + n + ".png");
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/audio.js",
  "./assets/sprites/sprites.js",
  "./assets/sprites/pango_hero.png",
  "./assets/sprites/pango_p1.png","./assets/sprites/pango_p2.png","./assets/sprites/pango_p3.png","./assets/sprites/pango_p4.png","./assets/sprites/pango_p5.png",
  "./js/data.js",
  "./js/game.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  ...SPRITES,
  ...WEAPONS,
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

function putCache(req, res) {
  if (res && res.status === 200 && new URL(req.url).origin === self.location.origin) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}
// HTML/JS/CSS/JSON change between releases → fetch fresh first (fall back to
// cache when offline). Images rarely change → serve from cache for speed.
function isCodeOrDoc(req) {
  if (req.mode === "navigate") return true;
  return /\.(html|js|css|json|webmanifest)$/.test(new URL(req.url).pathname);
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (isCodeOrDoc(req)) {
    e.respondWith(
      fetch(req).then((res) => putCache(req, res))
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
  } else {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => putCache(req, res)))
    );
  }
});
