// Pécule : contrôleur de l'application (état, sauvegarde chiffrée, navigation, verrouillage).
import { saveState, idbGet, idbDel } from './core/vault.js';
import { todayISO } from './core/analytics.js';
import { closeSheet, sheetOpen, icon, html, toast } from './ui/dom.js';

export const app = {
  state: null,   // données déchiffrées (en mémoire seulement)
  dek: null,     // clé de données (en mémoire seulement)
  route: { name: 'accueil', params: [], query: {} },
  ui: {},        // état d'interface éphémère (filtres, saisie en cours…)
  today: todayISO(),
};

const views = {};
const actions = {};
export function registerView(name, fn) { views[name] = fn; }
export function registerActions(obj) { Object.assign(actions, obj); }

// ---------- Sauvegarde ----------
let saveTimer = null;
export function persist() {
  if (!app.dek || !app.state) return;
  clearTimeout(saveTimer);
  const dek = app.dek, state = app.state;
  saveTimer = setTimeout(() => saveState(dek, state).catch(() => toast("L'enregistrement a échoué. Vérifiez l'espace libre du téléphone.")), 150);
}
export function flush() {
  if (saveTimer && app.dek) { clearTimeout(saveTimer); saveTimer = null; return saveState(app.dek, app.state); }
  return Promise.resolve();
}

/** Modifie les données, enregistre, et redessine l'écran. */
export function update(fn, { rerender = true } = {}) {
  const r = fn(app.state);
  persist();
  if (rerender) render();
  return r;
}

// ---------- Navigation ----------
export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { name: parts[0] || 'accueil', params: parts.slice(1), query };
}
/**
 * Navigation interne. On garde l'adresse à jour quand le navigateur le permet,
 * mais l'écran affiché ne dépend que de app.route (fonctionne aussi dans un cadre restreint).
 */
const routeListeners = [];
export function onRoute(fn) { routeListeners.push(fn); }
export function go(hash) {
  if (sheetOpen()) closeSheet(true);
  app.route = parseHash(hash);
  try { if (location.hash !== hash) history.pushState(null, '', hash); } catch { /* adresse figée : sans importance */ }
  routeListeners.forEach(f => f(app.route));
  render();
}

let lastRouteKey = '';
export function render() {
  const root = document.getElementById('app');
  app.today = todayISO();
  document.documentElement.classList.toggle('discreet', !!app.state?.settings?.discreet);
  applyTheme();
  let name;
  if (!app.dek) name = 'lock';
  else if (!app.state.settings.onboarded) name = 'bienvenue';
  else name = views[app.route.name] ? app.route.name : 'accueil';
  const v = views[name](app);
  const routeKey = name + '/' + app.route.params.join('/');
  const keepScroll = routeKey === lastRouteKey;
  const y = window.scrollY;
  root.innerHTML = String(v.html) + (v.tabs ? String(tabBar(v.tab || name)) : '');
  if (keepScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
  lastRouteKey = routeKey;
  if (v.title) document.title = `${v.title} · Pécule`;
  v.after?.(root);
}

function tabBar(current) {
  const t = (hash, name, ic, label) => html`<a href="${hash}" ${current === name ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  return html`<div class="tabs"><nav aria-label="Navigation principale">
    ${t('#/accueil', 'accueil', 'home', 'Accueil')}
    ${t('#/comptes', 'comptes', 'accounts', 'Comptes')}
    <a class="import" href="#/import" aria-label="Importer un relevé">${icon('plus')}</a>
    ${t('#/budget', 'budget', 'budget', 'Budget')}
    ${t('#/bourse', 'bourse', 'bourse', 'Bourse')}
  </nav></div>`;
}

function applyTheme() {
  const t = app.state?.settings?.theme || localPref('theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
// Le thème est aussi gardé hors du coffre pour l'écran de verrouillage
export function localPref(k, v) {
  try {
    if (v === undefined) return localStorage.getItem('pecule.' + k);
    localStorage.setItem('pecule.' + k, v);
  } catch { /* stockage indisponible */ }
  return null;
}

// ---------- Verrouillage ----------
export function unlocked(dek, state) {
  app.dek = dek;
  app.state = migrate(state);
  app.ui = {};
  resetIdle();
  checkInbox().then(() => render());
}
export async function lock() {
  await flush();
  closeSheet(true);
  app.dek = null;
  app.state = null;
  app.ui = {};
  render();
}

function migrate(state) {
  state.settings = { discreet: false, provider: 'none', apiKey: '', autoLockMinutes: 5, lowBalance: 10000, onboarded: true, demo: false, ...state.settings };
  state.watchlist ||= [];
  state.prices ||= {};
  state.securities ||= {};
  return state;
}

let idleTimer = null, hiddenAt = null;
function resetIdle() {
  clearTimeout(idleTimer);
  if (!app.dek) return;
  const min = app.state?.settings?.autoLockMinutes ?? 5;
  if (min > 0) idleTimer = setTimeout(lock, min * 60000);
}
['pointerdown', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, () => app.dek && resetIdle(), { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); flush(); }
  else if (app.dek && hiddenAt) {
    const min = app.state?.settings?.autoLockMinutes ?? 5;
    if (min > 0 && Date.now() - hiddenAt > min * 60000) lock();
    else if (todayISO() !== app.today) render();
    checkInbox();
  }
});
addEventListener('pagehide', () => { flush(); });

// ---------- Fichiers reçus par « Partager » (Android) ----------
export async function checkInbox() {
  if (!app.dek) return;
  let inbox;
  try { inbox = await idbGet('inbox'); } catch { return; }
  if (!inbox?.length) return;
  await idbDel('inbox');
  app.ui.pendingFiles = inbox;
  go('#/import');
}

// ---------- Délégation d'événements ----------
function findAct(e, attr) {
  const el = e.target.closest(`[${attr}]`);
  return el && document.contains(el) ? el : null;
}
document.addEventListener('click', e => {
  const el = findAct(e, 'data-act');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
  fn(el, e);
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  actions[form.dataset.submit]?.(form, e);
});
document.addEventListener('input', e => {
  const el = findAct(e, 'data-input');
  if (el) actions[el.dataset.input]?.(el, e);
});
document.addEventListener('change', e => {
  const el = findAct(e, 'data-change');
  if (el) actions[el.dataset.change]?.(el, e);
});
const fromAddress = () => {
  if (sheetOpen()) closeSheet(true);
  app.route = parseHash();
  routeListeners.forEach(f => f(app.route));
  render();
};
addEventListener('hashchange', fromAddress);
addEventListener('popstate', fromAddress);
// Liens internes « #/… » : navigation sans recharger
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || a.dataset.act || e.defaultPrevented) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });
