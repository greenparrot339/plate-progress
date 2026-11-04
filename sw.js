const CACHE_NAME = 'plate-progress-v51-split-share';
const APP_SHELL = [
  './', './index.html', './manifest.json', './exercise-database.js', './stats3d.js', './chart-max.js?v=47', './strength-intelligence.js?v=1', './strength-ui.js?v=3', './body.glb',
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
    // `reload` bypasses the browser's HTTP cache so a new version can never be built from stale files.
    await Promise.all(APP_SHELL.map(async url => {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error('Could not cache ' + url);
      await cache.put(url, response);
    }));

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

// Web Share Target: lets the installed app appear in the Android Share menu (e.g. from WhatsApp)
// for exported split files. The file is stashed in the cache and the app is opened on ?shared=1,
// where index.html reads it and shows the split preview. Nothing is imported automatically.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'POST') return;
  const target = new URL('./share-target', self.registration.scope);
  const url = new URL(req.url);
  if (url.origin !== target.origin || url.pathname !== target.pathname) return;
  event.respondWith((async () => {
    const back = ok => Response.redirect(new URL('./index.html?shared=' + (ok ? '1' : '0'), self.registration.scope).href, 303);
    try {
      const form = await req.formData();
      let text = null;
      for (const v of form.getAll('split')) { if (v && typeof v !== 'string') { text = await v.text(); break; } }
      if (text === null) return back(false);
      const cache = await caches.open(CACHE_NAME);
      await cache.put(new URL('./__shared-split.json', self.registration.scope).href,
        new Response(text, { headers: { 'Content-Type': 'application/json' } }));
      return back(true);
    } catch (error) {
      return back(false);
    }
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
