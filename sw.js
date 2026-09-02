const CACHE_NAME = 'plate-progress-v15';
const APP_SHELL = [
  './', './index.html', './manifest.json', './exercise-database.js', './stats3d.js', './body.glb',
  './icon-192.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Only cache same-origin app files during installation. This prevents a
    // phone's PWA installer from waiting on third-party CDN/font requests.
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
  const dependency = ['cdnjs.cloudflare.com','cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
  if (!sameOrigin && !dependency) return;

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
      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
