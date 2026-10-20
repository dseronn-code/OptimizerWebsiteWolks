// Service worker mínimo: permite instalar o app e abrir a tela inicial sem rede.
// Dados de estoque (/api) NUNCA são guardados em cache — sempre vêm do servidor.
const CACHE = 'estoque-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Rede primeiro; o cache só é usado se estiver sem conexão.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && (event.request.mode === 'navigate' || url.pathname.startsWith('/assets/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request.mode === 'navigate' ? '/' : event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request.mode === 'navigate' ? '/' : event.request)),
  );
});
