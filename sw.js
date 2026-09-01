const CACHE_NAME = 'plate-progress-v14';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './exercise-database.js',
  './stats3d.js',
  './body.glb'
];

// External libraries/fonts are deliberately NOT downloaded during
// service-worker installation. Waiting for third-party CDNs can leave
// Android/Chrome stuck on "Installing...". They are cached lazily below
// when the app requests them.
const DEPENDENCY_HOSTS = new Set([
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Only same-origin app files are part of the install-critical shell.
    // This keeps PWA installation fast and reliable.
    await cache.addAll(APP_SHELL);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isDependency = DEPENDENCY_HOSTS.has(url.hostname);

  if (!isSameOrigin && !isDependency) return;

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
