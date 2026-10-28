// Accueil : ce qu'il reste ce mois-ci, une alerte, les chiffres clés, les dernières opérations.
import { app, registerView, registerActions, update, go } from '../app.js';
import { html, icon, ask } from './dom.js';
import { euro, euroParts, amount, monthName, pct, dateShort } from './format.js';
import { monthMargin, alerts, netWorth, savingsRate, subscriptions, budgetStatus } from '../core/analytics.js';
import { portfolio } from '../core/portfolio.js';
import { catById } from '../core/model.js';
import { emptyState } from '../core/model.js';
import { txRow } from './transactions.js';
import { debtAnalysis, healthScore } from '../core/debt.js';
import { forecast, importDue, goalStatus } from '../core/planning.js';
import { reviewCount } from '../core/triage.js';

export function demoBanner() {
  if (!app.state.settings.demo) return '';
  return html`<div class="demo-banner"><span>Données fictives de démonstration</span><button data-act="demo-clear">Effacer et commencer</button></div>`;
}

registerView('accueil', () => {
  const s = app.state;
  const today = app.today;
  const greeting = new Date().getHours() < 18 ? 'Bonjour' : 'Bonsoir';
  const top = html`<div class="hello">
      <div><p>${greeting}</p><p style="color:var(--ink);font:600 20px var(--display)">${capitalizeDate(today)}</p></div>
      <div style="display:flex">
        <button class="iconbtn" data-act="toggle-discreet" aria-label="${s.settings.discreet ? 'Afficher les montants' : 'Masquer les montants'}" aria-pressed="${s.settings.discreet}">${icon(s.settings.discreet ? 'eyeoff' : 'eye')}</button>
        <a class="iconbtn" href="#/reglages" aria-label="Réglages">${icon('gear')}</a>
      </div>
    </div>`;

  if (!s.transactions.length) {
    return {
      title: 'Accueil', tabs: true,
      html: html`<main class="screen">${top}
        <div class="empty" style="padding-top:48px">
          <strong>Commencez par importer un relevé</strong>
          Un fichier OFX de la Caisse d'Épargne ou l'export CSV de Trade Republic suffit.
          <div style="margin-top:20px"><a class="btn brass" href="#/import">${icon('upload')} Importer un relevé</a></div>
        </div></main>`,
    };
  }

  const mm = monthMargin(s, today);
  // Sans mois complet avant celui-ci et sans salaire reçu, « ce qu'il reste » n'aurait pas de sens
  const noBaseline = mm.history === 0 && mm.income < mm.expenses;
  const parts = euroParts(noBaseline ? mm.expenses : mm.margin);
  const ratio = mm.expectedIncome > 0 ? mm.expenses / mm.expectedIncome : mm.expenses > 0 ? 1 : 0;
  const nowPos = ((mm.dayOfMonth - 0.5) / mm.daysInMonth) * 100;
  const ticks = Array.from({ length: mm.daysInMonth }, (_, i) => html`<i class="${(i + 1) % 7 === 1 ? 'w' : ''}"></i>`);
  const al = alerts(s, today)[0];
  const nw = netWorth(s);
  const pf = portfolio(s, today);
  const sr = savingsRate(s, today);
  const subs = subscriptions(s, today).filter(x => !x.fixed);
  const subsTotal = subs.reduce((t, x) => t + x.amount, 0);
  const lastDay = `${mm.daysInMonth} ${monthName(mm.month, false)}`;
  const debt = debtAnalysis(s, today);
  const hs = healthScore(s, today);

  // Dépenses du mois par catégorie (5 premières)
  const budgets = Object.fromEntries(budgetStatus(s, mm.month).map(b => [b.categoryId, b]));
  const cats = Object.entries(mm.summary.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCat = Math.max(1, ...cats.map(([, v]) => v));
  const recent = s.transactions.slice(0, 5);

  const perDay = noBaseline
    ? html`<p class="perday muted">Importez au moins un mois complet de relevés pour voir ce qu'il vous reste jusqu'à la fin du mois.</p>`
    : mm.margin > 0
    ? html`<p class="perday">Soit <strong>${euro(mm.perDay)}</strong> par jour jusqu'au ${lastDay}.</p>`
    : html`<p class="perday neg">Vos dépenses dépassent vos revenus${mm.incomeIsEstimate ? ' attendus' : ''} ce mois-ci.</p>`;

  return {
    title: 'Accueil',
    tabs: true,
    html: html`<main class="screen">
      ${demoBanner()}
      ${top}
      <section class="reste" aria-labelledby="reste-l">
        <p class="label" id="reste-l">${noBaseline ? `Dépensé en ${monthName(mm.month, false)}` : `Ce qu'il vous reste en ${monthName(mm.month, false)}`}</p>
        <p class="figure ${parts.neg ? 'neg' : ''}">${parts.ints}<span class="cents">${parts.dec}</span></p>
        ${perDay}
      </section>
      ${noBaseline ? '' : html`<div class="ruler" role="img" aria-label="${`Dépensé ${euro(mm.expenses)} sur ${euro(mm.expectedIncome)} de revenus, jour ${mm.dayOfMonth} sur ${mm.daysInMonth}`}">
        <div class="track">
          <div class="bed"></div>
          <div class="spent ${ratio > 1 ? 'over' : ''}" style="width:${Math.min(ratio, 1) * 100}%"></div>
          <div class="ticks" aria-hidden="true">${ticks}</div>
          <div class="now" style="left:${nowPos}%"></div>
        </div>
        <div class="legend">
          <span><span class="dot" style="background:var(--ink)"></span>Dépensé <b class="amount">${euro(mm.expenses, { round: true })}</b> sur <b class="amount">${euro(mm.expectedIncome, { round: true })}</b>${mm.incomeIsEstimate ? ' attendus' : ''}</span>
          <span><span class="dot" style="background:var(--brass)"></span>Jour ${mm.dayOfMonth}/${mm.daysInMonth}</span>
        </div>
      </div>`}
      ${importReminder()}
      ${al ? html`<a class="alert ${al.level >= 3 ? 'l3' : ''}" href="${al.link}"><div><div class="t">${al.title}</div><div class="b">${al.body}</div></div></a>` : ''}
      ${shortcuts()}

      <h2 class="section">En un coup d'œil</h2>
      <div class="kpis">
        <a href="#/comptes"><div class="k">Patrimoine</div><div class="v">${euro(nw.total, { round: true })}</div><div class="s">${nw.debt ? `crédits déduits (${euro(nw.debt, { round: true })})` : pf.open.length ? `dont ${euro(nw.invested, { round: true })} investis` : 'comptes et livrets'}</div></a>
        <a href="#/bourse"><div class="k">Portefeuille</div><div class="v">${pf.open.length ? euro(pf.totals.value, { round: true }) : '—'}</div>
          <div class="s ${pf.totals.latent >= 0 ? 'pos' : 'neg'}">${pf.open.length ? `${euro(pf.totals.latent, { sign: true, round: true })} (${pct(pf.totals.latentPct, true)})` : 'aucun titre'}</div></a>
        <a href="#/analyse"><div class="k">Épargne mise de côté</div><div class="v">${sr.rate == null ? '—' : pct(sr.rate)}</div><div class="s">${sr.rate == null ? 'il faut un mois complet' : `de vos revenus, ${sr.months > 1 ? `sur ${sr.months} mois` : 'le mois dernier'}`}</div></a>
        <a href="#/analyse"><div class="k">Abonnements</div><div class="v">${euro(subsTotal, { round: true })}</div><div class="s">${subs.length} par mois</div></a>
        <a href="#/credits"><div class="k">Endettement</div><div class="v ${debt.ratio > 0.35 ? 'neg' : ''}">${debt.ratio == null ? '—' : pct(debt.ratio)}</div><div class="s">${debt.ratio == null ? 'indiquez vos revenus' : debt.capacity > 0 ? `marge ${euro(debt.capacity, { round: true })} / mois` : 'limite de 35 % atteinte'}</div></a>
        <a href="#/credits"><div class="k">Santé financière</div><div class="v">${hs ? html`<span class="grade-mini g-${hs.grade}">${hs.grade}</span> ${hs.label}` : '—'}</div><div class="s">${hs ? 'voir le détail' : 'il faut plus de données'}</div></a>
      </div>

      <h2 class="section">Dépenses de ${monthName(mm.month, false)} <a href="#/budget">Budget</a></h2>
      ${cats.length
        ? html`<div class="group">${cats.map(([id, v]) => {
            const c = catById(s, id), b = budgets[id];
            const w = b ? Math.min(b.pct, 1) : v / maxCat;
            return html`<a class="row" href="#/operations?cat=${id}&mois=${mm.month}">
              <span class="badge">${c.icon}</span>
              <span class="main"><span class="title">${c.name}</span>
                <span class="catbar"><i style="width:${w * 100}%;background:${b && b.pct >= 1 ? 'var(--neg)' : c.color}"></i></span></span>
              <span class="end"><span class="amount">${euro(v)}</span>${b ? html`<div class="sub small">sur ${euro(b.budget, { round: true })}</div>` : ''}</span>
            </a>`;
          })}</div>`
        : html`<div class="note">Aucune dépense ce mois-ci pour l'instant.</div>`}

      <h2 class="section">Dernières opérations <a href="#/operations">Tout voir</a></h2>
      <div class="group">${recent.map(t => txRow(t, { showDate: true }))}</div>
      ${lastImport()}
    </main>`,
  };
});

function lastImport() {
  const last = app.state.imports.at(-1);
  if (!last || app.state.settings.demo) return '';
  return html`<p class="hint" style="text-align:center;margin-top:18px">Dernier import le ${dateShort(last.at.slice(0, 10))}</p>`;
}

/** Rappel d'import : le mois a changé depuis le dernier import (jour réglable dans les réglages). */
function importReminder() {
  const s = app.state;
  if (s.settings.importReminder === false) return '';
  const d = importDue(s, app.today);
  if (!d?.due) return '';
  return html`<a class="alert" href="#/import"><div><div class="t">C'est le moment d'importer vos relevés</div><div class="b">Dernier import il y a ${d.days} jour${d.days > 1 ? 's' : ''}. Exportez ceux du mois écoulé depuis vos banques.</div></div></a>`;
}

/** Raccourcis : opérations à classer, fin de mois prévue, objectifs. */
function shortcuts() {
  const s = app.state;
  const n = reviewCount(s);
  const f = forecast(s, app.today);
  const goals = s.goals || [];
  const g = goals.map(x => goalStatus(s, x, app.today));
  const avg = g.length ? g.reduce((t, x) => t + x.pct, 0) / g.length : null;
  return html`<div class="shortcuts">
    <a href="#/classer" class="${n ? 'hot' : ''}"><span class="t">À classer</span><span class="v">${n || '✓'}</span><span class="s">${n ? 'opération' + (n > 1 ? 's' : '') : 'tout est classé'}</span></a>
    <a href="#/prevision"><span class="t">Fin de mois</span><span class="v amount ${f && !f.insufficient && f.end < 0 ? 'neg' : ''}">${f && !f.insufficient ? euro(f.end, { round: true }) : '—'}</span><span class="s">${f && !f.insufficient ? 'solde prévu' : 'échéancier'}</span></a>
    <a href="#/objectifs"><span class="t">Objectifs</span><span class="v">${avg == null ? '+' : pct(avg)}</span><span class="s">${avg == null ? 'en créer un' : `${goals.length} en cours`}</span></a>
  </div>`;
}

function capitalizeDate(d) {
  const s = new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

registerActions({
  'toggle-discreet': () => update(s => { s.settings.discreet = !s.settings.discreet; }),
  'demo-clear': async () => {
    if (!(await ask('Effacer la démo ?', 'Les données fictives seront effacées. Vous pourrez ensuite importer vos propres relevés.', { ok: 'Effacer et commencer' }))) return;
    update(s => {
      const keep = { theme: s.settings.theme, autoLockMinutes: s.settings.autoLockMinutes };
      Object.assign(s, emptyState());
      s.settings = { ...s.settings, ...keep, onboarded: true };
    }, { rerender: false });
    go('#/import');
  },
});

export { amount };
