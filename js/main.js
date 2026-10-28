// Démarrage : charge les écrans, enregistre le service worker, affiche l'écran de verrouillage.
import { app, parseHash, localPref } from './app.js';
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

const t = localPref('theme');
if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t);

app.route = parseHash();
initLock();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* hors ligne indisponible, l'app fonctionne quand même */ });
}
// Demande au navigateur de ne pas effacer les données en cas de manque d'espace
navigator.storage?.persist?.().catch(() => {});
