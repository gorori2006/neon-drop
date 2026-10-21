/* ============================================================
   sw.js — Service Worker
     初回アクセス時に全ファイルをキャッシュし、以降はネットに
     つながっていなくても起動できるようにする。
     ファイルを更新したら VERSION を上げること（古いキャッシュが消える）。
   ============================================================ */
"use strict";

const VERSION = "neon-drop-v1";

const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/fonts.css",
  "./css/style.css",
  "./fonts/orbitron.woff2",
  "./fonts/share-tech-mono.woff2",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./js/config.js",
  "./js/storage.js",
  "./js/audio.js",
  "./js/board.js",
  "./js/piece.js",
  "./js/input.js",
  "./js/render.js",
  "./js/game.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache:"reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* キャッシュ優先。無ければネットから取り、取れたものはキャッシュへ足しておく */
self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch:true }).then(hit => {
      if(hit) return hit;
      return fetch(req).then(res => {
        if(res.ok){
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => req.mode === "navigate" ? caches.match("./index.html") : Response.error());
    })
  );
});
