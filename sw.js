const CACHE_NAME = 'barber-vip-shell-v50-web-push';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon-192.webp', '/assets/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      const response = await fetch(new Request(new URL(path, self.location.origin), { cache: 'reload' }));
      if (!response.ok) throw new Error(`Could not refresh app shell: ${path}`);
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  const title = String(payload.title || 'Barber VIP').slice(0, 90);
  const body = String(payload.body || 'Hay una novedad en tu tarjeta VIP.').slice(0, 220);
  const tag = String(payload.tag || 'barber-vip-update').slice(0, 120);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/assets/icon-192.webp',
    badge: '/assets/icon-192.webp',
    tag,
    renotify: false,
    requireInteraction: false,
    timestamp: Date.now(),
    data: { url: payload.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let targetUrl = self.location.origin + '/';
  try {
    const parsed = new URL(event.notification.data?.url || '/', self.location.origin);
    if (parsed.origin === self.location.origin) targetUrl = parsed.href;
  } catch (_) {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client && client.url !== targetUrl) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
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
