const CACHE_NAME = 'barber-vip-shell-v73-count-free-directory';
const APP_SHELL = ['/', '/index.html', '/profile-utils.js', '/customer-roster.js', '/manifest.webmanifest', '/assets/icon-192.webp', '/assets/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // A temporary icon/cache fetch failure must not prevent PWA installation.
    try {
      const cache = await caches.open(CACHE_NAME);
      const results = await Promise.allSettled(APP_SHELL.map(async path => {
        const response = await fetch(new Request(new URL(path, self.location.origin), { cache: 'reload' }));
        if (!response.ok) throw new Error(`App shell returned ${response.status}: ${path}`);
        await cache.put(path, response);
      }));
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) {
        console.warn('[Barber VIP] Some app shell files could not be cached. The app can still be installed online.', failures.length);
      }
    } catch (error) {
      console.warn('[Barber VIP] Offline cache preparation failed; continuing with online installation.', error?.message || error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    const cachePath = '/index.html';
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(cachePath, response.clone()));
      return response;
    }).catch(() => caches.match(cachePath).then(hit => hit || caches.match('/index.html') || caches.match('/'))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
