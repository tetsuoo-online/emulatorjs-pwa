// Service worker RetroPlay
//  - App shell :
//      * navigations (index.html) en network-first + fallback cache → une màj
//        poussée sur GitHub est visible au lancement suivant, sans attendre 3 lancers.
//      * autres assets same-origin (icônes, manifest) en cache-first + màj arrière-plan.
//  - CDN EmulatorJS : stale-while-revalidate (cache les cœurs WASM pour le offline).
//  - Update : le nouveau SW reste en attente (waiting) jusqu'à recevoir
//    {type:'SKIP_WAITING'} de la page, puis s'active → controllerchange → reload auto.

const SHELL = 'retro-shell-v2';
const RUNTIME = 'retro-runtime-v1';
const CDN = 'https://cdn.emulatorjs.org/';

const APP_FILES = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // Pas de skipWaiting() ici : on laisse le nouveau SW en "waiting" jusqu'à ce que
  // la page le déclenche (SKIP_WAITING), sinon on perderait le contrôle de l'update.
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(APP_FILES)));
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

// La page envoie {type:'SKIP_WAITING'} quand une màj est prête (auto au lancement
// suivant, ou manuel via le bouton "Mettre à jour").
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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

  // 2) Same-origin
  if (url.origin !== location.origin) return;

  // 2a) Navigations (HTML) → network-first. Au lancement online, on récupère la
  //     dernière version d'index.html ; si le réseau échoue, on sert le cache
  //     (offline). C'est CE point qui rend les màj visibles au prochain lancer.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./')))
    );
    return;
  }

  // 2b) Autres assets same-origin (icônes, manifest) → cache-first + màj arrière-plan
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
