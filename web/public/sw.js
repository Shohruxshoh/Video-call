// Service worker: makes the app open instantly (and offline) after the first visit.
// - Hashed build assets (/assets/*) never change: cache-first.
// - The page itself: served from cache right away, refreshed in the background.
// - API and WebSocket traffic is never cached.
const CACHE = 'aloqa-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];
const MAX_ASSETS = 60;

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
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  const assets = keys.filter((req) => new URL(req.url).pathname.startsWith('/assets/'));
  for (const req of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(req);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    void trim(cache);
  }
  return res;
}

async function shell(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match('/');
  const refresh = fetch(event.request)
    .then((res) => {
      if (res.ok) void cache.put('/', res.clone());
      return res;
    })
    .catch(() => cached ?? Response.error());
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  if (request.mode === 'navigate') event.respondWith(shell(event));
  else if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) event.respondWith(cacheFirst(request));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => new URL(c.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow('/');
    }),
  );
});
