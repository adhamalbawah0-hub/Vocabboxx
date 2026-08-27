/*
 * Real Service Worker for offline-first app-shell caching.
 * Strategy:
 *   - Static assets (JS/CSS/fonts/icons/HTML): cache-first, falling back to network.
 *   - /api/* (live AI calls): always network — these require connectivity by
 *     nature, and the app already handles failures gracefully (fallback
 *     dictionary, "pending" word status, retry buttons).
 * Bump CACHE_NAME on every deploy to invalidate old caches automatically.
 */

const CACHE_NAME = 'vocabbox-shell-v1';
const APP_SHELL = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache live API calls — they need real connectivity every time.
  if (url.pathname.startsWith('/api/')) return;

  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Cache same-origin, successful responses for next time (app shell + built assets).
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline and not cached — request will simply fail
    })
  );
});
