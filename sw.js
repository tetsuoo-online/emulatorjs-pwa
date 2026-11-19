// Service worker RetroPlay
//  - App shell : pré-cache + cache d'abord + màj en arrière-plan.
//  - CDN EmulatorJS : stale-while-revalidate (cache les cœurs WASM pour le offline,
//    même en opaque cross-origin). Ça permet de rejouer hors-ligne après une 1re partie.

const SHELL = 'retro-shell-v1';
const RUNTIME = 'retro-runtime-v1';
const CDN = 'https://cdn.emulatorjs.org/';

const APP_FILES = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) CDN EmulatorJS → stale-while-revalidate (cache pour offline)
  if (url.origin === new URL(CDN).origin) {
    e.respondWith(
      caches.open(RUNTIME).then(c =>
        c.match(req).then(hit => {
          const net = fetch(req).then(res => {
            // On ne cache QUE les réponses valides (status 200) — pas les opaques
            // d'erreurs. Les cross-origin 200 sont stockables en mode 'cors' si le
            // CDN l'autorise, sinon en opaque (status 0) qu'on garde aussi.
            if (res && (res.ok || res.status === 0 || res.type === 'opaque')) {
              c.put(req, res.clone());
            }
            return res;
          }).catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  // 2) Same-origin (app shell) → cache d'abord, màj en arrière-plan
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => {
          if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
