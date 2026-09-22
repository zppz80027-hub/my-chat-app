/* Ping Chat service worker — makes the app installable and resilient offline. */
const CACHE = 'ping-chat-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add('/').catch(() => {})).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
const isApi = (url) => url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io');
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }
  const dest = request.destination;
  const isStatic = dest === 'script' || dest === 'style' || dest === 'image' || dest === 'font' || /\.(js|css|png|jpg|jpeg|svg|webp|woff2?|webmanifest)$/i.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
