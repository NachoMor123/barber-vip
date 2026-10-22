const CACHE_NAME = 'barber-vip-shell-v35';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon-192.webp', '/assets/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
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
