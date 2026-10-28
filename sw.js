// Service worker : fonctionnement hors ligne et réception des fichiers partagés (Android).
const VERSION = 'pecule-v1.5.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './fonts/bricolage.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './js/main.js', './js/app.js',
  './js/lib/text.js', './js/lib/parse.js',
  './js/import/index.js', './js/import/ofx.js', './js/import/qif.js', './js/import/csv-bank.js', './js/import/trade-republic.js', './js/import/ce-pdf.js', './js/import/tr-pdf.js', './js/import/pdf.js',
  './js/core/model.js', './js/core/categories.js', './js/core/analytics.js', './js/core/portfolio.js', './js/core/prices.js', './js/core/vault.js', './js/core/demo.js', './js/core/loans.js', './js/core/debt.js', './js/core/indicators.js', './js/core/market.js', './js/core/translate.js', './js/core/planning.js', './js/core/invest.js', './js/core/triage.js',
  './js/ui/dom.js', './js/ui/format.js', './js/ui/charts.js', './js/ui/lock.js', './js/ui/onboarding.js', './js/ui/home.js',
  './js/ui/transactions.js', './js/ui/accounts.js', './js/ui/budget.js', './js/ui/analyse.js', './js/ui/bourse.js', './js/ui/import.js', './js/ui/settings.js', './js/ui/credits.js', './js/ui/marches.js', './js/ui/classer.js', './js/ui/prevision.js', './js/ui/synthese.js',
];

self.addEventListener('install', e => {
  // cache: 'reload' : ignore le cache HTTP pour ne pas mélanger ancienne et nouvelle version
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Fichiers partagés depuis une autre app : ils sont gardés le temps que Pécule soit déverrouillé, puis effacés.
function idbPut(key, val) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pecule', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    };
    r.onerror = () => rej(r.error);
  });
}

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter(f => typeof f !== 'string');
    const items = [];
    for (const f of files) items.push({ name: f.name || 'releve.csv', type: f.type, buffer: await f.arrayBuffer() });
    if (items.length) await idbPut('inbox', items);
  } catch { /* rien à importer */ }
  return Response.redirect('./#/import', 303);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // les cours de bourse passent par le réseau
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
