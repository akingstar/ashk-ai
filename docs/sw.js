const CACHE = "ashk-v22";
const ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "css/app.css",
  "js/app.js",
  "js/ai.js",
  "js/config.js",
  "js/github.js",
  "js/markdown.js",
  "js/store.js",
  "assets/favicon.svg",
  "assets/logo.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png",
  "icon.svg",
  "legacy.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const isShell = url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
          if (res.ok && isShell) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
