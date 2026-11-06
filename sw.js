const CACHE_NAME = 'barber-vip-shell-v70-core-only';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon-192.webp', '/assets/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const results = await Promise.allSettled(APP_SHELL.map(async path => {
        const response = await fetch(new Request(new URL(path, self.location.origin), { cache: 'reload' }));
        if (!response.ok) throw new Error(`App shell returned ${response.status}: ${path}`);
        await cache.put(path, response);
      }));
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) console.warn('[Barber VIP] No se pudieron guardar algunos recursos para uso sin conexión.', failures.length);
    } catch (error) {
      console.warn('[Barber VIP] No se pudo preparar el contenido sin conexión.', error?.message || error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response?.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
      }
      return response;
    }).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response?.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    });
  }));
});
