// Fuel Log service worker — offline caching
const CACHE = 'fuel-log-v9';

// Local app shell + the CDN React files (cached on first fetch).
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  // Leaflet library is cached so the map page's chrome works offline.
  // (Map tiles are network-only and will not render without a connection.)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install: pre-cache the app shell. Don't fail install if a CDN file misses.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.allSettled(PRECACHE.map(function (url) {
        return cache.add(url);
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

// Activate: clear old caches.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Fetch: cache-first, fall back to network, then update cache.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        // Cache successful same-origin and CDN responses for next time.
        if (response && (response.status === 200 || response.type === 'opaque')) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () {
        // Offline and not cached — for navigations, serve the app shell.
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
