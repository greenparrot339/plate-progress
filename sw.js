const CACHE_NAME = 'plate-progress-v19-warmup-final';
const APP_SHELL = [
  './', './index.html', './manifest.json', './exercise-database.js', './stats3d.js', './body.glb',
  './icon-192.png', './icon-512.png'
];

// External runtime dependencies used by the app. These are cached during the
// first online installation so the app can subsequently run without a network.
const OFFLINE_DEPENDENCIES = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Cache CDN/Google Fonts resources when online. If one external service is
    // temporarily unavailable, don't make installation fail: those resources
    // can still be cached by the fetch handler when they are first requested.
    await Promise.all(OFFLINE_DEPENDENCIES.map(async url => {
      try {
        const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
        if (response.ok) await cache.put(url, response.clone());
      } catch (error) {
        console.warn('Offline dependency could not be pre-cached:', url, error);
      }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const dependency = [
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ].includes(url.hostname);

  if (!sameOrigin && !dependency) return;

  // Navigations use network-first so a connected installation gets updates,
  // with the local app shell as the offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
          await cache.put('./', response.clone());
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(event.request) ||
          await caches.match('./index.html') ||
          await caches.match('./');
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // Runtime assets/dependencies use cache-first. A successful online fetch is
  // stored, which covers resources discovered through the Google Fonts CSS.
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const fallback = await caches.match(event.request, { ignoreSearch: true });
      if (fallback) return fallback;
      throw error;
    }
  })());
});
