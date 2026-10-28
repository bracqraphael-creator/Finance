// Opérations : liste filtrable, fiche d'une opération, catégorisation d'un geste.
import { app, registerView, registerActions, update, render } from '../app.js';
import { html, icon, openSheet, updateSheet, closeSheet, toast, haptic } from './dom.js';
import { euro, amount, dayLabel, dateLong, monthName, plural } from './format.js';
import { catById, accountById, setCategory, similarTransactions, addManualTransaction } from '../core/model.js';
import { norm } from '../lib/text.js';
import { parseAmount } from '../lib/parse.js';
import { demoBanner } from './home.js';

export function txRow(t, { showDate = false, showAccount = false } = {}) {
  const c = catById(app.state, t.categoryId);
  const acc = showAccount ? accountById(app.state, t.accountId) : null;
  const sub = [c.name, showDate ? shortDate(t.date) : null, acc ? acc.name : null].filter(Boolean).join(' · ');
  return html`<button class="row" data-act="tx-open" data-id="${t.id}">
    <span class="badge">${c.icon}</span>
    <span class="main"><span class="title">${t.payee || t.label}</span><span class="sub">${sub}</span></span>
    <span class="end">${amount(t.amount)}</span>
  </button>`;
}
const shortDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** Liste groupée par jour, avec pagination. */
export function txList(list, { limit = 150, showAccount = true } = {}) {
  if (!list.length) return html`<div class="empty"><strong>Aucune opération</strong>Modifiez la recherche ou les filtres.</div>`;
  const shown = list.slice(0, limit);
  const out = [];
  let day = null, buf = [];
  const flush = () => { if (buf.length) out.push(html`<div class="dayhead">${dayLabel(day, app.today)}</div><div class="group">${buf}</div>`); buf = []; };
  for (const t of shown) {
    if (t.date !== day) { flush(); day = t.date; }
    buf.push(txRow(t, { showAccount }));
  }
  flush();
  if (list.length > limit) out.push(html`<button class="btn ghost block" style="margin-top:16px" data-act="tx-more">Afficher plus (${list.length - limit} restantes)</button>`);
  return html`${out}`;
}

export function filterTx(state, { q = '', cat = '', kind = '', month = '', accountId = '' }) {
  const kinds = Object.fromEntries(state.categories.map(c => [c.id, c.kind]));
  const nq = norm(q);
  const num = parseAmount(q);
  return state.transactions.filter(t => {
    if (accountId && t.accountId !== accountId) return false;
    if (cat && t.categoryId !== cat) return false;
    if (month && !t.date.startsWith(month)) return false;
    if (kind === 'depense' && kinds[t.categoryId] !== 'depense') return false;
    if (kind === 'revenu' && kinds[t.categoryId] !== 'revenu') return false;
    if (kind === 'verifier' && !(t.categoryId === 'divers' || t.categoryId === 'autres-revenus') ) return false;
    if (nq) {
      const hay = norm(t.label + ' ' + (t.payee || '') + ' ' + (t.note || ''));
      if (!hay.includes(nq) && !(num != null && Math.abs(t.amount) === Math.abs(num))) return false;
    }
    return true;
  });
}

registerView('operations', () => {
  const s = app.state;
  const f = (app.ui.ops ||= { q: '', kind: '', limit: 150 });
  const qcat = app.route.query.cat || '';
  const qmonth = app.route.query.mois || '';
  const list = filterTx(s, { q: f.q, kind: f.kind, cat: qcat, month: qmonth });
  const total = list.reduce((t, x) => t + x.amount, 0);
  const chip = (k, label) => html`<button class="chip" data-act="ops-kind" data-kind="${k}" aria-pressed="${f.kind === k}">${label}</button>`;
  const toCheck = filterTx(s, { kind: 'verifier' }).length;
  const title = qcat ? catById(s, qcat).name : 'Opérations';
  return {
    title, tabs: true, tab: 'comptes',
    html: html`<main class="screen">
      ${demoBanner()}
      <div class="topbar"><a class="iconbtn back" href="${qcat ? '#/budget' : '#/comptes'}" aria-label="Retour">${icon('back')}</a><h1>${title}</h1></div>
      ${qmonth ? html`<p class="muted" style="margin:-4px 4px 10px">${monthName(qmonth)} · <span class="amount">${euro(total)}</span></p>` : ''}
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Rechercher un libellé ou un montant" value="${f.q}" data-input="ops-q" aria-label="Rechercher"></div>
      ${qcat ? '' : html`<div class="chips" role="group" aria-label="Filtrer">
        ${chip('', 'Tout')}${chip('depense', 'Dépenses')}${chip('revenu', 'Revenus')}
        ${toCheck ? chip('verifier', `À classer (${toCheck})`) : ''}
      </div>`}
      ${!qcat && f.kind === 'verifier' && toCheck ? html`<a class="btn brass block" href="#/classer" style="margin-bottom:12px">Classement express : une opération à la fois</a>` : ''}
      <div id="ops-list">${txList(list, { limit: f.limit })}</div>
    </main>`,
  };
});

let qTimer;
registerActions({
  'ops-q': el => {
    app.ui.ops.q = el.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const f = app.ui.ops;
      const list = filterTx(app.state, { q: f.q, kind: f.kind, cat: app.route.query.cat || '', month: app.route.query.mois || '', accountId: app.route.name === 'comptes' ? app.route.params[0] : '' });
      document.getElementById('ops-list').innerHTML = String(txList(list, { limit: f.limit, showAccount: app.route.name !== 'comptes' }));
    }, 120);
  },
  'ops-kind': el => { app.ui.ops.kind = el.dataset.kind; app.ui.ops.limit = 150; render(); },
  'tx-more': () => { (app.ui.ops ||= {}).limit = ((app.ui.ops.limit) || 150) + 300; render(); },
  'tx-open': el => openTx(el.dataset.id),
  'tx-cat': el => pickCategory(el.dataset.id, el.dataset.cat),
  'tx-apply-all': el => applySimilar(el.dataset.id, true),
  'tx-apply-one': () => { closeSheet(); render(); },
  'tx-note': el => {
    const t = app.state.transactions.find(x => x.id === el.dataset.id);
    if (t) update(() => { t.note = el.value; }, { rerender: false });
  },
  'tx-delete': el => {
    const id = el.dataset.id;
    const t = app.state.transactions.find(x => x.id === id);
    update(s => { s.transactions = s.transactions.filter(x => x.id !== id); }, { rerender: false });
    closeSheet(); render();
    toast('Opération supprimée', { label: 'Annuler', run: () => update(s => { s.transactions.push(t); s.transactions.sort((a, b) => (a.date < b.date ? 1 : -1)); }) });
  },
  'tx-add': el => openAddTx(el.dataset.account),
  'tx-add-submit': form => {
    const cents = parseAmount(form.amount.value);
    if (!cents) { toast('Indiquez un montant.'); return; }
    const sign = form.sens.value === 'in' ? 1 : -1;
    update(s => addManualTransaction(s, {
      accountId: form.account.value,
      date: form.date.value || app.today,
      amount: sign * Math.abs(cents),
      label: form.label.value.trim() || (sign > 0 ? 'Entrée' : 'Dépense'),
      categoryId: form.cat.value,
    }));
    closeSheet();
    toast('Opération ajoutée');
  },
  'tx-add-sens': el => {
    const form = el.closest('form');
    form.sens.value = el.dataset.sens;
    form.querySelectorAll('[data-act="tx-add-sens"]').forEach(b => b.setAttribute('aria-pressed', b === el));
  },
});

function txSheet(t, step = 'view') {
  const s = app.state;
  const c = catById(s, t.categoryId);
  const acc = accountById(s, t.accountId);
  const cats = s.categories.filter(x => (t.amount < 0 ? x.kind !== 'revenu' : x.kind !== 'depense') || x.id === t.categoryId);
  if (step === 'similar') {
    const n = similarTransactions(s, t).filter(x => x.catSource !== 'manual' && !x.transferId && x.categoryId !== t.categoryId).length;
    return html`<h3>Classé dans ${c.icon} ${c.name}</h3>
      <p class="muted" style="margin:0 4px 16px">Faire de même pour ${plural(n, 'autre opération', 'autres opérations')} « ${t.payee} » et les prochaines ?</p>
      <button class="btn brass block" data-act="tx-apply-all" data-id="${t.id}">Oui, toujours pour « ${t.payee} »</button>
      <button class="btn ghost block" style="margin-top:10px" data-act="tx-apply-one">Juste celle-ci</button>`;
  }
  return html`
    <div style="text-align:center;padding:4px 8px 14px">
      <div class="badge" style="margin:0 auto 10px;width:52px;height:52px;font-size:24px">${c.icon}</div>
      <div style="font:600 19px var(--display)">${t.payee || t.label}</div>
      <div style="font:650 34px/1.2 var(--display);margin-top:6px" class="${t.amount > 0 ? 'pos' : ''}"><span class="amount">${euro(t.amount, { sign: true })}</span></div>
      <div class="muted small">${dateLong(t.date)} · ${acc?.name || ''}</div>
    </div>
    <div class="group">
      <div class="row plain"><span class="main"><span class="sub">Libellé bancaire</span><span style="font-size:14px;word-break:break-word">${t.label}</span></span></div>
      ${t.meta?.detail || t.meta?.from ? html`<div class="row plain"><span class="main"><span class="sub">Détail</span><span style="font-size:14px;word-break:break-word">${[t.meta.detail, t.meta.from && `De : ${t.meta.from}`].filter(Boolean).join(' · ')}</span></span></div>` : ''}
      ${t.transferId ? html`<div class="row plain"><span class="main small muted">Virement entre deux de vos comptes : il ne compte ni en dépense ni en revenu.</span></div>` : ''}
    </div>
    <h2 class="section">Catégorie</h2>
    <div class="catgrid">${cats.map(x => html`<button data-act="tx-cat" data-id="${t.id}" data-cat="${x.id}" aria-pressed="${x.id === t.categoryId}"><span class="e">${x.icon}</span>${x.name}</button>`)}</div>
    <label class="field" style="margin-top:18px"><span>Note</span><input class="input" value="${t.note || ''}" placeholder="Ajouter une note" data-change="tx-note" data-id="${t.id}"></label>
    ${!t.importId ? html`<button class="btn danger block" data-act="tx-delete" data-id="${t.id}">${icon('trash')} Supprimer cette opération</button>` : ''}`;
}

export function openTx(id) {
  const t = app.state.transactions.find(x => x.id === id);
  if (t) openSheet(txSheet(t), { label: 'Détail de l\'opération' });
}

function pickCategory(id, cat) {
  const t = app.state.transactions.find(x => x.id === id);
  if (!t) return;
  haptic();
  update(s => setCategory(s, id, cat, false), { rerender: false });
  const n = similarTransactions(app.state, t).filter(x => x.catSource !== 'manual' && !x.transferId && x.categoryId !== cat).length;
  if (n > 0) updateSheet(txSheet(t, 'similar'));
  else {
    closeSheet();
    render();
    toast(`Classé dans ${catById(app.state, cat).name}`);
  }
}

function applySimilar(id) {
  const t = app.state.transactions.find(x => x.id === id);
  const n = update(s => setCategory(s, id, t.categoryId, true), { rerender: false });
  closeSheet();
  render();
  toast(`${plural(n + 1, 'opération classée', 'opérations classées')}. Les prochaines « ${t.payee} » le seront aussi.`);
}

function openAddTx(accountId) {
  const s = app.state;
  const accs = s.accounts.filter(a => a.type !== 'titres');
  openSheet(html`<h3>Nouvelle opération</h3>
    <form data-submit="tx-add-submit">
      <input type="hidden" name="sens" value="out">
      <div class="seg" role="group" aria-label="Sens">
        <button type="button" data-act="tx-add-sens" data-sens="out" aria-pressed="true">Dépense</button>
        <button type="button" data-act="tx-add-sens" data-sens="in" aria-pressed="false">Entrée d'argent</button>
      </div>
      <label class="field"><span>Montant (€)</span><input class="input big" name="amount" inputmode="decimal" placeholder="0,00" required data-autofocus></label>
      <label class="field"><span>Libellé</span><input class="input" name="label" placeholder="Ex. : marché du dimanche"></label>
      <label class="field"><span>Catégorie</span><select class="input" name="cat">${s.categories.map(c => html`<option value="${c.id}" ${c.id === 'divers' ? 'selected' : ''}>${c.icon} ${c.name}</option>`)}</select></label>
      <label class="field"><span>Compte</span><select class="input" name="account">${accs.map(a => html`<option value="${a.id}" ${a.id === accountId ? 'selected' : ''}>${a.name}</option>`)}</select></label>
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${app.today}"></label>
      <button class="btn brass block">Ajouter</button>
    </form>`, { label: 'Nouvelle opération' });
}
