/* GENERATED from web-ts/src/sw.ts by `npm run build` in web-ts/. Do not edit here: edit the TypeScript there. */
"use strict";
(() => {
  // src/sw.ts
  var VERSION = "hatialert-v3";
  var FONTS = [
    "atkinson-hyperlegible-latin-400-normal",
    "atkinson-hyperlegible-latin-700-normal",
    "atkinson-hyperlegible-latin-400-italic",
    "bricolage-grotesque-latin-600-normal",
    "bricolage-grotesque-latin-700-normal",
    "ibm-plex-mono-latin-500-normal"
  ].map((f) => `fonts/${f}.woff2`);
  var SHELL = ["./", "index.html", "app.css", "app.js", "nagamese.js", "icon.svg", "map/layers.json", "map/terrain.webp", ...FONTS];
  self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
  });
  self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
  });
  self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
    );
  });
  self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs[0] ? cs[0].focus() : self.clients.openWindow("./#/alerts")));
  });
})();
