const CACHE_NAME = 'plate-progress-v5';

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

async function cacheExternalResources(cache) {
  for (const url of EXTERNAL_RESOURCES) {
    try {
      const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
      if (!response.ok) continue;
      const copy = response.clone();
      await cache.put(url, copy);

      // Google Fonts CSS points to the actual .woff2 files on fonts.gstatic.com.
      // Fetch and cache those too so the exact Oswald/Inter/JetBrains Mono fonts
      // remain available when the app is offline.
      if (url.includes('fonts.googleapis.com')) {
        const css = await response.text();
        const fontUrls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
        await Promise.all(fontUrls.map(async fontUrl => {
          try {
            const fontResponse = await fetch(fontUrl, { mode: 'cors', cache: 'no-cache' });
            if (fontResponse.ok) await cache.put(fontUrl, fontResponse.clone());
          } catch (_) {}
        }));
      }
    } catch (_) {
      // The shell can still install. Any dependency that was not cached will be
      // fetched and cached by the fetch handler on the first online visit.
    }
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await cacheExternalResources(cache);
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
  const isSameOrigin = url.origin === self.location.origin;
  const isDependency =
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

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
      // Navigation fallback keeps the installed app usable if a navigation is
      // attempted while completely offline.
      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
