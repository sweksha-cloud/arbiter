/* global self, caches */
// Arbiter's service worker: only an offline page (TRADEOFFS.md 28). Pages,
// data and live updates always come from the network; when a page can't load
// at all, this shows a friendly "you're offline" page instead of the
// browser's error. Nothing else is cached, so a deploy is never hidden behind
// a stale copy.
const CACHE = 'arbiter-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
