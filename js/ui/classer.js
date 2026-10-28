// Classement express : une opération à la fois, trois suggestions, glisser pour passer ou accepter.
import { app, registerView, registerActions, update, render, go } from '../app.js';
import { html, icon, toast, haptic } from './dom.js';
import { euro, dateLong, plural } from './format.js';
import { catById, accountById, similarTransactions } from '../core/model.js';
import { triageQueue, suggestCategories, classify, undoClassify, needsReview, reviewCount } from '../core/triage.js';

function session() {
  // La file est figée à l'ouverture : classer une opération ne doit pas faire sauter les cartes
  if (!app.ui.triage) app.ui.triage = { queue: triageQueue(app.state), i: 0, done: 0, history: [], more: false, similar: true };
  return app.ui.triage;
}

/** Prochaine carte encore à classer (une autre carte a pu la classer entre-temps). */
function current(tr) {
  while (tr.i < tr.queue.length) {
    const t = app.state.transactions.find(x => x.id === tr.queue[tr.i]);
    if (t && needsReview(t)) return t;
    tr.i++;
  }
  return null;
}

registerView('classer', () => {
  const s = app.state;
  const tr = session();
  const t = current(tr);
  const total = tr.queue.length;
  const back = html`<a class="iconbtn back" href="#/operations" aria-label="Retour" data-act="triage-exit">${icon('back')}</a>`;
  if (!t) {
    const left = reviewCount(s);
    return {
      title: 'Classement express', tabs: true, tab: 'operations',
      html: html`<main class="screen">
        <div class="topbar">${back}<h1>Classement express</h1></div>
        <div class="empty" style="padding-top:40px">
          <div class="done-mark">${icon('check')}</div>
          <strong>${tr.done ? 'C\'est classé' : 'Rien à classer'}</strong>
          ${tr.done ? `${plural(tr.done, 'opération classée', 'opérations classées')}. Les prochaines opérations de ces bénéficiaires seront classées automatiquement.` : 'Toutes vos opérations ont une catégorie.'}
          ${left ? html`<p class="hint">${plural(left, 'opération passée', 'opérations passées')} : vous pourrez y revenir.</p>` : ''}
          <div class="btn-row" style="justify-content:center;margin-top:18px">
            ${left ? html`<button class="btn ghost" data-act="triage-restart">Revoir les passées</button>` : ''}
            <a class="btn brass" href="#/accueil" data-act="triage-exit">Terminer</a>
          </div>
        </div></main>`,
    };
  }
  const sims = similarTransactions(s, t).filter(x => needsReview(x));
  const sugg = suggestCategories(s, t);
  const acc = accountById(s, t.accountId);
  const pos = Math.min(tr.i + 1, total);
  const choice = id => { const c = catById(s, id); return html`<button class="pick" data-act="triage-pick" data-cat="${id}"><span class="e">${c.icon}</span>${c.name}</button>`; };
  const others = s.categories.filter(c => !sugg.includes(c.id) && !['divers', 'autres-revenus'].includes(c.id) && (t.amount < 0 ? c.kind !== 'revenu' : c.kind !== 'depense'));
  return {
    title: 'Classement express', tabs: true, tab: 'operations',
    html: html`<main class="screen">
      <div class="topbar">${back}<h1>Classement express</h1></div>
      <div class="triage-progress" aria-label="${`Carte ${pos} sur ${total}`}"><div class="progress"><i style="width:${((pos - 1) / Math.max(1, total)) * 100}%"></i></div><span class="small muted">${pos} / ${total}</span></div>
      <article class="tcard" data-swipe="triage">
        <div class="small muted">${dateLong(t.date)} · ${acc?.name || ''}</div>
        <div class="payee">${t.payee || t.label}</div>
        <div class="amt amount ${t.amount > 0 ? 'pos' : ''}">${euro(t.amount, { sign: true })}</div>
        <div class="lbl">${t.label}</div>
        ${sims.length ? html`<div class="chip-s warn" style="margin-top:10px">+ ${plural(sims.length, 'opération semblable', 'opérations semblables')}</div>` : ''}
      </article>
      <p class="hint" style="text-align:center">Glissez à droite pour choisir « ${catById(s, sugg[0] || 'divers').name} », à gauche pour passer.</p>
      <div class="picks">${sugg.map(choice)}</div>
      <div class="group" style="margin-top:6px"><label class="row plain"><span class="main"><span class="title" style="font-size:15px">Retenir pour « ${t.payee || 'ce bénéficiaire'} »</span><span class="sub">${sims.length ? `Classe aussi les ${sims.length} autres et les prochaines` : 'Les prochaines seront classées automatiquement'}</span></span>
        <span class="switch"><input type="checkbox" data-change="triage-similar" ${tr.similar ? 'checked' : ''}><span></span></span></label></div>
      <button class="btn ghost block" data-act="triage-more" aria-expanded="${tr.more}" style="margin-top:10px">${tr.more ? 'Moins de catégories' : 'Autre catégorie'}</button>
      ${tr.more ? html`<div class="catgrid" style="margin-top:10px">${others.map(c => html`<button data-act="triage-pick" data-cat="${c.id}"><span class="e">${c.icon}</span>${c.name}</button>`)}</div>` : ''}
      <div class="btn-row" style="margin-top:14px">
        <button class="btn ghost" data-act="triage-undo" ${tr.history.length ? '' : 'disabled'}>Annuler</button>
        <button class="btn ghost" data-act="triage-skip">Passer</button>
      </div>
    </main>`,
  };
});

function pick(cat) {
  const tr = session();
  const t = current(tr);
  if (!t) return;
  haptic();
  let res;
  update(s => { res = classify(s, t.id, cat, tr.similar); }, { rerender: false });
  tr.history.push({ i: tr.i, undo: res.undo, count: tr.similar ? res.count : 1 });
  tr.done += tr.similar ? res.count : 1;
  tr.i++;
  tr.more = false;
  animateOut('right', () => render());
}

function skip() {
  const tr = session();
  tr.history.push({ i: tr.i, undo: null, count: 0 });
  tr.i++;
  tr.more = false;
  animateOut('left', () => render());
}

function animateOut(dir, then) {
  const card = document.querySelector('.tcard');
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) { then(); return; }
  card.classList.add(dir === 'right' ? 'out-right' : 'out-left');
  setTimeout(then, 170);
}

registerActions({
  'triage-pick': el => pick(el.dataset.cat),
  'triage-skip': () => skip(),
  'triage-more': () => { session().more = !session().more; render(); },
  'triage-similar': el => { session().similar = el.checked; },
  'triage-undo': () => {
    const tr = session();
    const h = tr.history.pop();
    if (!h) return;
    if (h.undo) update(s => undoClassify(s, h.undo), { rerender: false });
    tr.done -= h.count;
    tr.i = h.i;
    render();
    toast('Annulé');
  },
  'triage-restart': () => { app.ui.triage = null; render(); },
  'triage-exit': el => { app.ui.triage = null; go(el.getAttribute('href')); },
});

// Glisser la carte : à droite = première suggestion, à gauche = passer
let sx = null, sy = null, card = null;
document.addEventListener('touchstart', e => {
  card = e.target.closest?.('[data-swipe="triage"]');
  if (!card) return;
  sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  card.style.transition = 'none';
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!card || sx == null) return;
  const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
  if (Math.abs(dy) > Math.abs(dx) * 1.2) return;
  card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
  card.dataset.dir = dx > 40 ? 'right' : dx < -40 ? 'left' : '';
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!card || sx == null) return;
  const dx = e.changedTouches[0].clientX - sx;
  const c = card;
  card = null; sx = null;
  c.style.transition = '';
  if (Math.abs(dx) < 90) { c.style.transform = ''; c.dataset.dir = ''; return; }
  c.style.transform = '';
  if (dx > 0) {
    const first = document.querySelector('.picks [data-cat]');
    if (first) pick(first.dataset.cat);
  } else skip();
});

export function triageLink(state) {
  const n = reviewCount(state);
  return n ? { n, href: '#/classer' } : null;
}
