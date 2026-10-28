// Budget du mois par catégorie et revenus.
import { app, registerView, registerActions, update, render } from '../app.js';
import { html, icon, openSheet, closeSheet, toast } from './dom.js';
import { euro, monthName, capitalize } from './format.js';
import { monthSummary, budgetStatus, averageSpending, addMonths, monthOf } from '../core/analytics.js';
import { catById } from '../core/model.js';
import { parseAmount } from '../lib/parse.js';
import { donut } from './charts.js';
import { demoBanner } from './home.js';

registerView('budget', () => {
  const s = app.state;
  const month = app.ui.budgetMonth || monthOf(app.today);
  const sum = monthSummary(s, month);
  const status = Object.fromEntries(budgetStatus(s, month).map(b => [b.categoryId, b]));
  const avg = averageSpending(s, app.today);
  const expenseCats = s.categories.filter(c => c.kind === 'depense');
  const rows = expenseCats
    .map(c => ({ c, spent: sum.byCategory[c.id] || 0, budget: s.budgets[c.id] || 0 }))
    .filter(r => r.spent > 0 || r.budget > 0)
    .sort((a, b) => (b.budget ? b.spent / b.budget : 0) - (a.budget ? a.spent / a.budget : 0) || b.spent - a.spent);
  const budgetTotal = Object.values(s.budgets).reduce((t, v) => t + (v || 0), 0);
  const budgetedSpent = rows.filter(r => r.budget).reduce((t, r) => t + r.spent, 0);
  const isCurrent = month === monthOf(app.today);
  const parts = Object.entries(sum.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ value: v, color: catById(s, id).color }));
  const incomes = Object.entries(sum.incomeByCategory).sort((a, b) => b[1] - a[1]);
  const hasAvg = Object.keys(avg).length > 0;

  return {
    title: 'Budget', tabs: true,
    html: html`<main class="screen">
      ${demoBanner()}
      <div class="topbar">
        <button class="iconbtn back" data-act="budget-month" data-d="-1" aria-label="Mois précédent">${icon('back')}</button>
        <h1 style="text-align:center">${capitalize(monthName(month))}</h1>
        <button class="iconbtn" data-act="budget-month" data-d="1" aria-label="Mois suivant" ${isCurrent ? 'disabled style="opacity:.3"' : ''}>${icon('chev')}</button>
      </div>
      <div style="display:flex;align-items:center;gap:20px;padding:8px 4px 4px">
        ${donut(parts.length ? parts : [{ value: 1, color: 'var(--surface-2)' }], { size: 112, stroke: 16 })}
        <div>
          <div class="muted small">Dépensé</div>
          <div style="font:650 30px/1.1 var(--display)" class="amount">${euro(sum.expenses)}</div>
          <div class="muted small" style="margin-top:6px">Revenus <span class="amount pos">${euro(sum.income)}</span></div>
          ${budgetTotal ? html`<div class="muted small">Budgets <span class="amount">${euro(budgetedSpent, { round: true })} / ${euro(budgetTotal, { round: true })}</span></div>` : ''}
        </div>
      </div>
      ${!budgetTotal && hasAvg ? html`<div class="note" style="margin-top:16px"><strong>Fixez vos budgets en un geste.</strong> Pécule propose pour chaque catégorie votre moyenne des 3 derniers mois, arrondie.
        <div style="margin-top:12px"><button class="btn brass" data-act="budget-auto">Proposer mes budgets</button></div></div>` : ''}

      <h2 class="section">Dépenses par catégorie</h2>
      ${rows.length ? html`<div class="group">${rows.map(({ c, spent, budget }) => {
        const b = status[c.id];
        const w = budget ? Math.min(spent / budget, 1) : 0;
        const over = budget && spent > budget;
        return html`<button class="row" data-act="budget-edit" data-cat="${c.id}">
          <span class="badge">${c.icon}</span>
          <span class="main"><span class="title">${c.name}</span>
            ${budget ? html`<span class="catbar"><i style="width:${w * 100}%;background:${over ? 'var(--neg)' : b && b.pct > 0.85 ? 'var(--warn)' : c.color}"></i></span>`
                     : html`<span class="sub">Pas de budget · toucher pour en fixer un</span>`}
          </span>
          <span class="end"><span class="amount">${euro(spent)}</span>
            ${budget ? html`<div class="sub small ${over ? 'neg' : ''}">${over ? `${euro(spent - budget, { round: true })} de trop` : `reste ${euro(budget - spent, { round: true })}`}</div>` : ''}</span>
        </button>`;
      })}</div>` : html`<div class="note">Aucune dépense ce mois-ci.</div>`}
      <button class="link" style="margin:8px 4px" data-act="budget-edit" data-cat="">+ Fixer un budget pour une autre catégorie</button>

      ${incomes.length ? html`<h2 class="section">Revenus</h2>
        <div class="group">${incomes.map(([id, v]) => {
          const c = catById(s, id);
          return html`<a class="row" href="#/operations?cat=${id}&mois=${month}"><span class="badge">${c.icon}</span><span class="main"><span class="title">${c.name}</span></span><span class="end amount pos">${euro(v)}</span></a>`;
        })}</div>` : ''}
    </main>`,
  };
});

registerActions({
  'budget-month': el => {
    const cur = app.ui.budgetMonth || monthOf(app.today);
    const next = addMonths(cur, Number(el.dataset.d));
    if (next > monthOf(app.today)) return;
    app.ui.budgetMonth = next;
    render();
  },
  'budget-auto': () => {
    const avg = averageSpending(app.state, app.today);
    const skip = new Set(['banque', 'impots', 'logement', 'assurances', 'abonnements']);
    let n = 0;
    update(s => {
      for (const [id, v] of Object.entries(avg)) {
        if (skip.has(id) || v < 1000) continue;
        s.budgets[id] = Math.ceil(v / 1000) * 1000; // arrondi à 10 € au-dessus
        n++;
      }
    });
    toast(`${n} budgets proposés. Touchez une catégorie pour l'ajuster.`);
  },
  'budget-edit': el => {
    const s = app.state;
    const id = el.dataset.cat;
    const avg = averageSpending(s, app.today);
    const cats = s.categories.filter(c => c.kind === 'depense');
    const c = id ? catById(s, id) : null;
    const month = app.ui.budgetMonth || monthOf(app.today);
    openSheet(html`<h3>${c ? html`${c.icon} ${c.name}` : 'Nouveau budget'}</h3>
      <form data-submit="budget-save">
        ${c ? html`<input type="hidden" name="cat" value="${c.id}">`
            : html`<label class="field"><span>Catégorie</span><select class="input" name="cat">${cats.map(x => html`<option value="${x.id}">${x.icon} ${x.name}</option>`)}</select></label>`}
        <label class="field"><span>Budget par mois (€)</span>
          <input class="input big" name="amount" inputmode="decimal" placeholder="0" value="${c && s.budgets[c.id] ? String(s.budgets[c.id] / 100).replace('.', ',') : ''}" data-autofocus></label>
        ${c && avg[c.id] ? html`<p class="hint">Vous dépensez en moyenne ${euro(avg[c.id])} par mois dans cette catégorie.
          <button type="button" class="link" data-act="budget-fill" data-v="${Math.ceil(avg[c.id] / 1000) * 10}">Utiliser ${euro(Math.ceil(avg[c.id] / 1000) * 1000, { round: true })}</button></p>` : ''}
        <button class="btn brass block" style="margin-top:12px">Enregistrer</button>
        ${c && s.budgets[c.id] ? html`<button type="button" class="btn ghost block" style="margin-top:10px" data-act="budget-remove" data-cat="${c.id}">Retirer ce budget</button>` : ''}
        ${c ? html`<a class="btn ghost block" style="margin-top:10px" href="#/operations?cat=${c.id}&mois=${month}">Voir les opérations</a>` : ''}
      </form>`, { label: 'Budget' });
  },
  'budget-fill': el => { el.closest('form').amount.value = el.dataset.v; },
  'budget-save': form => {
    const v = parseAmount(form.amount.value);
    update(s => { if (v > 0) s.budgets[form.cat.value] = Math.abs(v); else delete s.budgets[form.cat.value]; });
    closeSheet();
    toast('Budget enregistré');
  },
  'budget-remove': el => { update(s => { delete s.budgets[el.dataset.cat]; }); closeSheet(); },
});
