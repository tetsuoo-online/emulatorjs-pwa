// RetroPlay : les fichiers EmulatorJS, y compris les décompresseurs, sont locaux.
const BASE = new URL(self.registration.scope);
const DATA = new URL('data/', BASE);
const PREFIX = 'retroplay:' + BASE.pathname + ':';
const SHELL = PREFIX + 'shell-v2.1';
const RUNTIME = PREFIX + 'runtime-v2.1';
const APP_FILES = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const shellURLs = new Set(APP_FILES.map(path => new URL(path, BASE).href));

self.addEventListener('install', event => {
  // La nouvelle version attend la validation via le bouton de l'application.
  event.waitUntil(caches.open(SHELL).then(cache =>
    cache.addAll(APP_FILES.map(path => new Request(new URL(path, BASE), { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== SHELL && key !== RUNTIME)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range') ||
      url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;

  const navigation = request.mode === 'navigate' &&
    (url.pathname === BASE.pathname || url.pathname === new URL('index.html', BASE).pathname);
  const dataAsset = url.pathname.startsWith(DATA.pathname);
  if (!navigation && !dataAsset && !shellURLs.has(url.href)) return;

  const cache = caches.open(dataAsset ? RUNTIME : SHELL);
  let write = Promise.resolve();
  const result = fetch(request, { cache: 'no-cache' }).then(response => {
    // Un 404 en ligne doit rester visible, et ne pas se transformer en un ancien
    // core ou en une page HTML. Le cache ne sert que si le réseau échoue.
    if (response.status === 200) {
      const copy = response.clone();
      write = cache.then(store => store.put(request, copy)).catch(error => {
        console.warn('RetroPlay: mise en cache impossible', request.url, error);
      });
    }
    return response;
  }).catch(async () => {
    const store = await cache;
    const fallback = await store.match(request) || (navigation && await store.match(BASE.href));
    return fallback || Response.error();
  });
  event.respondWith(result);
  event.waitUntil(result.then(() => write));
});
