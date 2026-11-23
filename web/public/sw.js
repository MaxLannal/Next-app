// The hub's service worker, there for one job: when the Mac is asleep or offline,
// a page that would otherwise fail to load shows the calm "Hub unreachable" page
// instead of the browser's error. It caches that page, the fonts and the fog photo,
// and nothing else. `/api/*` is never touched: no caching, no replaying stale data.

const CACHE = 'hub-offline-v1';
const OFFLINE_PAGE = '/offline.html';
// Vite builds the font files under /assets with a content hash in the name, so
// they're found at fetch time and saved as they're used, not listed here.
const SHELL = [OFFLINE_PAGE, '/photos/fog.jpg'];
/** Same-origin font files: the offline page and the app both draw type with them. */
const isFont = (url) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.woff2');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** A font or the photo: the fresh copy when the network answers (and it's saved), the saved one when it doesn't. */
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const saved = await caches.match(request);
    if (saved) return saved;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // A page: the hub's answer, or the offline page when it can't answer.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE)));
    return;
  }
  if (isFont(url) || url.pathname === '/photos/fog.jpg') {
    event.respondWith(networkFirst(request));
  }
});
