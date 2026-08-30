const CACHE_NAME = 'plate-progress-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png'
];

const EXTERNAL_RESOURCES = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(APP_SHELL);
      // Cache external dependencies when online. Failure here must not
      // prevent the app shell from installing.
      await Promise.allSettled(EXTERNAL_RESOURCES.map(url =>
        fetch(url, { mode: 'cors' }).then(response => {
          if (response.ok) return cache.put(url, response.clone());
        })
      ));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isFontOrChart =
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

  if (!isSameOrigin && !isFontOrChart) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        // If an uncached resource is unavailable offline, let the browser's
        // normal failure behavior occur rather than returning unrelated data.
        throw new Error('Offline resource unavailable');
      });
    })
  );
});
