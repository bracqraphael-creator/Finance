// Démarrage : charge les écrans, enregistre le service worker, affiche l'écran de verrouillage.
import { app, parseHash, localPref, flush } from './app.js';
import { toast } from './ui/dom.js';
import { initLock } from './ui/lock.js';
import './ui/onboarding.js';
import './ui/home.js';
import './ui/transactions.js';
import './ui/accounts.js';
import './ui/budget.js';
import './ui/analyse.js';
import './ui/bourse.js';
import './ui/import.js';
import './ui/settings.js';
import './ui/credits.js';
import './ui/classer.js';
import './ui/prevision.js';

const t = localPref('theme');
if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t);

app.route = parseHash();
initLock();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* hors ligne indisponible, l'app fonctionne quand même */ });
  // Nouvelle version installée : proposer de recharger (les données restent sur le téléphone)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    toast('Nouvelle version de Pécule disponible', { label: 'Recharger', run: async () => { await flush(); location.reload(); } });
  });
}
// Demande au navigateur de ne pas effacer les données en cas de manque d'espace
navigator.storage?.persist?.().catch(() => {});
