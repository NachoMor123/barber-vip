const CACHE_NAME = 'barber-vip-shell-v65-subscription-rules';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon-192.webp', '/assets/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // A temporary icon/cache fetch failure must not prevent the browser from
    // installing the service worker and offering the PWA installation.
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
    // Reuse an existing Barber VIP window when possible. If navigating/focusing it fails,
    // fall back to openWindow so tapping the notification still opens the app.
    let windows = [];
    try {
      windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    } catch (_) {}

    const sameOrigin = windows.filter(client => {
      try { return new URL(client.url).origin === self.location.origin; }
      catch (_) { return false; }
    });
    // Prefer the focused client; otherwise matchAll returns the most recently focused clients first.
    const client = sameOrigin.find(item => item.focused) || sameOrigin[0];
    if (client) {
      try {
        if ('navigate' in client && client.url !== targetUrl) {
          const navigatedClient = await client.navigate(targetUrl);
          if (navigatedClient && 'focus' in navigatedClient) {
            await navigatedClient.focus();
            return;
          }
        } else if ('focus' in client) {
          await client.focus();
          return;
        }
      } catch (_) {
        // A stale/closed window must not prevent opening Barber VIP below.
      }
    }

    try {
      const openedClient = await self.clients.openWindow(targetUrl);
      if (openedClient && 'focus' in openedClient) await openedClient.focus();
    } catch (error) {
      console.warn('[Barber VIP] Could not open the app from a notification click.');
    }
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
