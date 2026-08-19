const CACHE = "garden-jdp-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./watering.js",
  "./weather.js",
  "./store.js",
  "./glyphs.js",
  "./calendar.js",
  "./library.json",
  "./icon.png",
  "./apple-touch-icon.png",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.hostname.includes("open-meteo.com") || url.pathname.startsWith("/api/")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "WATERING") {
    self.registration.showNotification("garden.jdp", {
      body: event.data.body,
      icon: "./icon.png",
      badge: "./icon.png",
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("./"));
});
