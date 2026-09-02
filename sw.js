const CACHE_NAME = 'plate-progress-v16';
const APP_SHELL = [
  './', './index.html', './manifest.json', './exercise-database.js', './stats3d.js', './body.glb',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache only same-origin app files during installation. Third-party
    // dependencies are fetched on demand by the fetch handler.
    await cache.addAll(APP_SHELL);
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

  // App navigations must check the network first so an installed PWA picks up
  // a newly deployed index.html instead of indefinitely serving an old shell.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          // Keep both common navigation keys fresh for offline fallback.
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

  // Other assets remain cache-first for fast/offline operation.
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
      throw error;
    }
  })());
});
