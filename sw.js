/* Minimal service worker — just enough for PWA installability.
   Shelfmark's data lives in Firestore (with its own offline persistence) and
   localStorage, so this worker doesn't need real offline logic. It only
   caches the static app-shell files with a basic cache-first strategy. */

const CACHE_NAME = 'shelfmark-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const isShellFile = SHELL_FILES.some((f) => event.request.url.endsWith(f.replace('./', '')));
  if (!isShellFile) return; // let everything else (Firestore, fonts, etc.) pass through untouched

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
