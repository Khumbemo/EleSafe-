/* HatiAlert service worker: keeps the app itself on the phone so it opens
   without a connection. API calls always go to the network; app.js keeps
   its own saved copies and the send-later queue. Bump VERSION on release. */
declare const self: ServiceWorkerGlobalScope;

const VERSION = "hatialert-v3";
const FONTS = ["atkinson-hyperlegible-latin-400-normal", "atkinson-hyperlegible-latin-700-normal", "atkinson-hyperlegible-latin-400-italic",
  "bricolage-grotesque-latin-600-normal", "bricolage-grotesque-latin-700-normal", "ibm-plex-mono-latin-500-normal"].map((f) => `fonts/${f}.woff2`);
const SHELL = ["./", "index.html", "app.css", "app.js", "nagamese.js", "icon.svg", "map/layers.json", "map/terrain.webp", ...FONTS];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Network first so updates arrive; the saved copy when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")) as Promise<Response>),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow("./#/alerts"))));
});

export {};
