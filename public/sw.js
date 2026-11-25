// Moa Calendar Service Worker: Web Push Notifications + Offline Read PWA Cache

const STATIC_CACHE = 'moa-static-v4';
const API_CACHE = 'moa-api-v1';
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isCacheableStaticPath(pathname) {
  return (
    pathname === '/' ||
    pathname === '/en/' ||
    pathname === '/ko/' ||
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/icons/') ||
    /\.(?:css|js|svg|png|ico)$/i.test(pathname)
  );
}

function isCacheableReadApi(pathname) {
  return (
    pathname === '/api/calendars' ||
    /^\/api\/calendars\/[^/]+\/(?:events|monthly-items|notes|month-notes)$/.test(pathname) ||
    pathname === '/api/weather'
  );
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/stream') || url.pathname.startsWith('/auth/')) return;

  // 1. Read-only calendar/event/weather APIs: Network-First with Offline Cache Fallback
  if (isCacheableReadApi(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then(cache => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || new Response(JSON.stringify({ error: '오프라인 상태입니다.' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } })))
    );
    return;
  }

  // 2. Static assets: Stale-While-Revalidate
  if (isCacheableStaticPath(url.pathname)) {
    event.respondWith(
      caches.match(req).then(cached => {
        const networkPromise = fetch(req)
          .then(res => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(STATIC_CACHE).then(cache => cache.put(req, clone)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
  }
});

self.addEventListener('push', event => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || '모아 캘린더';
  const options = {
    body: data.body || '새로운 일정이 도착했어요.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || 'moa-calendar-notification',
    data: {
      url: data.url || '/'
    },
    vibrate: [200, 100, 200]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetPath = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && targetPath && targetPath !== '/') {
            client.navigate(targetPath);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetPath);
      }
    })
  );
});
