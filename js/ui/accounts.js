// Comptes : liste, détail d'un compte, ajout d'un compte saisi à la main.
import { app, registerView, registerActions, update, render, go } from '../app.js';
import { html, icon, openSheet, closeSheet, toast, ask } from './dom.js';
import { euro, amount } from './format.js';
import { accountBalance, accountById, addAccount, adjustBalance, deleteAccount } from '../core/model.js';
import { portfolio } from '../core/portfolio.js';
import { parseAmount } from '../lib/parse.js';
import { filterTx, txList } from './transactions.js';
import { demoBanner } from './home.js';

const TYPES = { courant: 'Compte courant', livret: 'Livret / épargne', carte: 'Carte', especes: 'Espèces', titres: 'Titres', autre: 'Autre' };

function initials(inst) {
  if (/caisse/i.test(inst)) return 'CE';
  if (/trade republic/i.test(inst)) return 'TR';
  return (inst || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function accountValue(s, a, pf) {
  return a.type === 'titres' ? pf.totals.value : accountBalance(s, a.id);
}

registerView('comptes', () => {
  const s = app.state;
  const id = app.route.params[0];
  if (id) return accountDetail(id);
  const pf = portfolio(s, app.today);
  const groups = {};
  for (const a of s.accounts) (groups[a.institution] ||= []).push(a);
  const total = s.accounts.reduce((t, a) => t + accountValue(s, a, pf), 0);
  return {
    title: 'Comptes', tabs: true,
    html: html`<main class="screen">
      ${demoBanner()}
      <div class="topbar"><h1>Comptes</h1><button class="iconbtn" data-act="acc-add" aria-label="Ajouter un compte">${icon('plus')}</button></div>
      <div class="acc-head"><div class="inst">Total de vos comptes et placements</div><div class="bal">${euro(total)}</div></div>
      ${s.accounts.length ? '' : html`<div class="empty"><strong>Aucun compte</strong>Importez un relevé : le compte est créé automatiquement.<div style="margin-top:16px"><a class="btn brass" href="#/import">Importer un relevé</a></div></div>`}
      ${Object.entries(groups).map(([inst, accs]) => html`
        <h2 class="section">${inst}</h2>
        <div class="group">${accs.map(a => html`<a class="row" href="${a.type === 'titres' ? '#/bourse' : `#/comptes/${a.id}`}">
          <span class="badge ink">${initials(inst)}</span>
          <span class="main"><span class="title">${a.name}</span><span class="sub">${TYPES[a.type] || a.type}</span></span>
          <span class="end">${amount(accountValue(s, a, pf), { sign: false, color: false })}</span>
          ${icon('chev', 'chev')}
        </a>`)}</div>`)}
      ${s.transactions.length ? html`<a class="btn ghost block" style="margin-top:20px" href="#/operations">Toutes les opérations</a>` : ''}
    </main>`,
  };
});

function accountDetail(id) {
  const s = app.state;
  const a = accountById(s, id);
  if (!a) { setTimeout(() => go('#/comptes')); return { html: '' }; }
  const f = (app.ui.ops ||= { q: '', kind: '', limit: 150 });
  const list = filterTx(s, { q: f.q, accountId: id });
  return {
    title: a.name, tabs: true, tab: 'comptes',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/comptes" aria-label="Retour">${icon('back')}</a><h1></h1>
        <button class="iconbtn" data-act="acc-menu" data-id="${id}" aria-label="Options du compte">${icon('gear')}</button></div>
      <div class="acc-head"><div class="inst">${a.institution} · ${a.name}</div><div class="bal">${euro(accountBalance(s, id))}</div></div>
      <div class="btn-row" style="margin:0 0 16px">
        <button class="btn ghost" data-act="tx-add" data-account="${id}">${icon('plus')} Opération</button>
        <a class="btn ghost" href="#/import">${icon('upload')} Importer</a>
      </div>
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Rechercher dans ce compte" value="${f.q}" data-input="ops-q" aria-label="Rechercher"></div>
      <div id="ops-list">${txList(list, { limit: f.limit, showAccount: false })}</div>
    </main>`,
  };
}

registerActions({
  'acc-add': () => openSheet(html`<h3>Nouveau compte</h3>
    <p class="muted" style="margin:-6px 4px 10px">Pour un compte sans export (espèces, livret, prêt). Les comptes importés sont créés automatiquement.</p>
    <form data-submit="acc-add-submit">
      <label class="field"><span>Nom</span><input class="input" name="name" required placeholder="Ex. : Livret A" data-autofocus></label>
      <label class="field"><span>Type</span><select class="input" name="type">${Object.entries(TYPES).filter(([k]) => k !== 'titres').map(([k, v]) => html`<option value="${k}" ${k === 'livret' ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field"><span>Établissement</span><input class="input" name="inst" placeholder="Ex. : Caisse d'Épargne"></label>
      <label class="field"><span>Solde actuel (€)</span><input class="input" name="bal" inputmode="decimal" placeholder="0,00"></label>
      <button class="btn brass block">Créer le compte</button>
    </form>`, { label: 'Nouveau compte' }),
  'acc-add-submit': form => {
    update(s => addAccount(s, { name: form.name.value.trim(), type: form.type.value, institution: form.inst.value.trim() || 'Autre', openingBalance: parseAmount(form.bal.value) || 0 }));
    closeSheet();
    toast('Compte créé');
  },
  'acc-menu': el => {
    const a = accountById(app.state, el.dataset.id);
    openSheet(html`<h3>${a.name}</h3>
      <form data-submit="acc-save" data-id="${a.id}">
        <input type="hidden" name="id" value="${a.id}">
        <label class="field"><span>Nom du compte</span><input class="input" name="name" value="${a.name}" required></label>
        <label class="field"><span>Solde affiché par votre banque aujourd'hui (€)</span><input class="input" name="bal" inputmode="decimal" placeholder="${euro(accountBalance(app.state, a.id))}"></label>
        <p class="hint">Si le solde ne correspond pas, indiquez celui de votre banque : Pécule corrige le point de départ du compte, sans toucher aux opérations.</p>
        <button class="btn brass block" style="margin-top:14px">Enregistrer</button>
      </form>
      <button class="btn danger block" style="margin-top:10px" data-act="acc-delete" data-id="${a.id}">${icon('trash')} Supprimer ce compte et ses opérations</button>`, { label: 'Options du compte' });
  },
  'acc-save': form => {
    const id = form.id.value;
    const bal = parseAmount(form.bal.value);
    update(s => {
      const a = accountById(s, id);
      a.name = form.name.value.trim() || a.name;
      if (bal != null) adjustBalance(s, id, bal);
    });
    closeSheet();
    toast(bal != null ? 'Solde ajusté' : 'Compte renommé');
  },
  'acc-delete': async el => {
    const a = accountById(app.state, el.dataset.id);
    closeSheet(true);
    if (!(await ask(`Supprimer « ${a.name} » ?`, 'Le compte et toutes ses opérations seront supprimés. Cette action est définitive.', { ok: 'Supprimer', danger: true }))) return;
    update(s => deleteAccount(s, a.id), { rerender: false });
    closeSheet();
    go('#/comptes');
    toast('Compte supprimé');
  },
});

export { render };
