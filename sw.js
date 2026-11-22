// RetroPlay v2.3 — auto-hébergement complet + préchargement intégral.
//
//  Install : précharge TOUT en une fois — shell (index.html, icônes, manifest) +
//  runtime EmulatorJS (loader.js, emulator.min.js, css, localization) + les 16 cœurs
//  WASM (8 systèmes × variantes standard + legacy, ~31 Mo). Dès la 1re utilisation,
//  tout est local : PLUS AUCUN téléchargement à la demande au lancement d'un jeu.
//  (EmulatorJS garde en outre son propre cache IndexedDB par cœur.)
//
//  Stratégie :
//   - data/ (runtime + cœurs) : CACHE-FIRST. Sert le fichier préchargé instantanément
//     (offline OK), màj arrière-plan. Robuste : un 404 réseau ne bloque plus le jeu,
//     le cœur préchargé répond depuis le cache.
//   - Navigations (index.html) : NETWORK-FIRST (une màj poussée est visible au reload).
//   - Range requests : laissées au navigateur (le Cache API ne gère pas le 206 partiel).
//
//  Update : nouveau SW en "waiting" jusqu'au SKIP_WAITING de la page (bouton "Màj
//  disponible"), puis activation → reload. 1re visite : activation immédiate.

const BASE = new URL(self.registration.scope);
const DATA = new URL('data/', BASE);
const PREFIX = 'retroplay:' + BASE.pathname + ':';
const SHELL = PREFIX + 'shell-v2.3';
const RUNTIME = PREFIX + 'runtime-v2.3';

const SHELL_FILES = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const RUNTIME_FILES = [
  'data/loader.js',
  'data/emulator.min.js',
  'data/emulator.min.css',
  'data/localization/en-US.json',
  // 16 cœurs : 8 systèmes × (standard WebGL2 + legacy logiciel)
  'data/cores/fceumm-wasm.data',           'data/cores/fceumm-legacy-wasm.data',
  'data/cores/snes9x-wasm.data',           'data/cores/snes9x-legacy-wasm.data',
  'data/cores/mgba-wasm.data',             'data/cores/mgba-legacy-wasm.data',
  'data/cores/gambatte-wasm.data',         'data/cores/gambatte-legacy-wasm.data',
  'data/cores/genesis_plus_gx-wasm.data',  'data/cores/genesis_plus_gx-legacy-wasm.data',
  'data/cores/smsplus-wasm.data',          'data/cores/smsplus-legacy-wasm.data',
  'data/cores/fbneo-wasm.data',            'data/cores/fbneo-legacy-wasm.data',
  'data/cores/mednafen_pce-wasm.data',     'data/cores/mednafen_pce-legacy-wasm.data',
];
const shellURLs = new Set(SHELL_FILES.map(p => new URL(p, BASE).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = caches.open(SHELL);
    const runtime = caches.open(RUNTIME);
    // Précharge shell + runtime en parallèle (séquentiel dans chaque cache pour ne pas
    // saturer le serveur). Un fichier manquant (404 ponctuel) ne fait pas échouer
    // toute l'install — il sera récupéré à la demande via le cache-first.
    const precache = async (files, cacheP) => {
      const cache = await cacheP;
      for (const p of files) {
        try { await cache.add(new Request(new URL(p, BASE), { cache: 'reload' })); }
        catch (e) { console.warn('RetroPlay: précachage échoué', p, e.message); }
      }
    };
    await Promise.all([precache(SHELL_FILES, shell), precache(RUNTIME_FILES, runtime)]);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith(PREFIX) && k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' ||
      url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;

  // Range requests (lectures partielles des gros cœurs) : le Cache API ne gère pas
  // le 206 Partial Content → on laisse le navigateur faire (réseau direct).
  if (request.headers.has('range')) return;

  const navigation = request.mode === 'navigate' &&
    (url.pathname === BASE.pathname || url.pathname === new URL('index.html', BASE).pathname);
  const dataAsset = url.pathname.startsWith(DATA.pathname);
  if (!navigation && !dataAsset && !shellURLs.has(url.href)) return;

  if (dataAsset) {
    // CACHE-FIRST : sert le cœur préchargé tout de suite ; màj arrière-plan.
    // Robuste : même si le réseau 404, le cœur préchargé répond depuis le cache.
    event.respondWith((async () => {
      const c = await caches.open(RUNTIME);
      const hit = await c.match(request);
      const net = fetch(request, { cache: 'no-cache' })
        .then(res => { if (res && res.status === 200) c.put(request, res.clone()); return res; })
        .catch(() => null);
      return hit || net;   // cache d'abord (instantané), sinon réseau
    })());
    return;
  }

  // Navigations + shell : NETWORK-FIRST (freshness), fallback cache (offline).
  event.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch(request, { cache: 'no-cache' });
      if (res && res.status === 200) c.put(request, res.clone());
      return res;
    } catch {
      return (await c.match(request)) || (await c.match(BASE.href)) || Response.error();
    }
  })());
});
