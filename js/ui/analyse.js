// Analyse : abonnements, frais, évolution revenus/dépenses, épargne, argent qui dort.
import { app, registerView } from '../app.js';
import { html, icon } from './dom.js';
import { euro, pct, dateShort, monthShort, plural } from './format.js';
import { subscriptions, feesLast12, monthlySeries, savingsRate, monthOf, dataMonths } from '../core/analytics.js';
import { accountBalance, catById } from '../core/model.js';
import { incomeExpenseBars } from './charts.js';

registerView('analyse', () => {
  const s = app.state;
  const today = app.today;
  const all = subscriptions(s, today);
  const subs = all.filter(x => !x.fixed), fixed = all.filter(x => x.fixed);
  const subsTotal = subs.reduce((t, x) => t + x.amount, 0);
  const fixedTotal = fixed.reduce((t, x) => t + x.amount, 0);
  const recurringList = list => html`<div class="group">${list.map(x => html`<a class="row" href="#/operations?cat=${x.categoryId}">
          <span class="badge">${catById(s, x.categoryId).icon}</span>
          <span class="main"><span class="title">${x.name}</span>
            <span class="sub ${x.increase ? 'neg' : ''}">${x.increase ? `Passé de ${euro(x.increase.from)} à ${euro(x.increase.to)}` : `Prochain vers le ${dateShort(x.nextDate)}`}</span></span>
          <span class="end"><span class="amount">${euro(x.amount)}</span><div class="sub small">${euro(x.yearly, { round: true })} / an</div></span>
        </a>`)}</div>`;
  const fees = feesLast12(s, today);
  const known = new Set(dataMonths(s));
  const series = monthlySeries(s, monthOf(today), 6).filter(m => known.has(m.month));
  const sr = savingsRate(s, today);
  const avgExp = sr.months ? sr.expenses / sr.months : 0;
  const idle = s.accounts.filter(a => a.type === 'courant').map(a => ({ a, bal: accountBalance(s, a.id) })).filter(x => avgExp && x.bal > avgExp * 2);

  return {
    title: 'Analyse', tabs: true, tab: 'accueil',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/accueil" aria-label="Retour">${icon('back')}</a><h1>Où optimiser</h1></div>

      <h2 class="section">Abonnements</h2>
      ${subs.length ? html`
        <div class="kpis" style="margin-bottom:10px"><div><div class="k">Par mois</div><div class="v">${euro(subsTotal)}</div></div><div><div class="k">Par an</div><div class="v">${euro(subsTotal * 12, { round: true })}</div></div></div>
        ${recurringList(subs)}
        <p class="hint">Détectés automatiquement : même bénéficiaire chaque mois, montant proche. Résilier un abonnement à 10 € fait économiser 120 € par an.</p>`
      : html`<div class="note">Aucun abonnement détecté. Il faut au moins 3 mois d'historique.</div>`}

      ${fixed.length ? html`<h2 class="section">Charges fixes <span class="amount" style="font-weight:500">${euro(fixedTotal)} / mois</span></h2>
        ${recurringList(fixed)}
        <p class="hint">Loyer, énergie, assurances : difficiles à supprimer, mais à renégocier ou comparer une fois par an.</p>` : ''}

      <h2 class="section">Frais sur 12 mois</h2>
      <div class="kpis"><div><div class="k">Frais bancaires</div><div class="v">${euro(fees.bankTotal)}</div></div><div><div class="k">Frais de courtage</div><div class="v">${euro(fees.brokerTotal)}</div></div></div>
      ${fees.byPayee.length ? html`<div class="group" style="margin-top:10px">${fees.byPayee.slice(0, 6).map(([name, v]) => html`<div class="row plain"><span class="main"><span class="title">${name}</span></span><span class="end amount">${euro(v)}</span></div>`)}</div>` : ''}
      ${fees.bankTotal > 3000 ? html`<p class="hint">Cotisation carte et frais de tenue de compte se négocient : demandez une offre sans frais à votre conseiller ou comparez avec une banque en ligne.</p>` : ''}

      ${series.length > 1 ? html`<h2 class="section">Revenus et dépenses</h2>
        <div class="group" style="padding:14px 12px 8px">${incomeExpenseBars(series, { labelOf: m => monthShort(m.month) })}
          <div class="legend-list" style="padding:4px 4px 6px"><span style="--c:var(--pos)">Revenus</span><span style="--c:var(--ink)">Dépenses</span></div></div>` : ''}

      <h2 class="section">Épargne</h2>
      <div class="note">${sr.rate == null
        ? 'Pas encore assez de mois complets pour calculer votre taux d\'épargne.'
        : html`Sur ${plural(sr.months, 'mois', 'mois')}, vous avez mis de côté <strong>${pct(sr.rate)}</strong> de vos revenus, soit <strong class="amount">${euro((sr.income - sr.expenses) / sr.months, { round: true })}</strong> par mois en moyenne. ${sr.rate < 0.1 ? 'Viser 10 % est un premier palier courant.' : sr.rate >= 0.2 ? 'C\'est un très bon rythme.' : ''}`}</div>

      ${idle.length ? html`<h2 class="section">Argent qui dort</h2>
        ${idle.map(x => html`<div class="note" style="margin-bottom:8px"><strong>${x.a.name}</strong> : <span class="amount">${euro(x.bal, { round: true })}</span>, soit plus de deux mois de dépenses. La part au-delà d'un mois de dépenses pourrait être placée sur un livret ou un compte rémunéré.</div>`)}` : ''}
    </main>`,
  };
});
