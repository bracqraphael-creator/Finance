// Analyses : mois en cours, budget, abonnements, frais, épargne, alertes.
import { payeeKey, payeeDisplay } from '../lib/text.js';
import { accountBalance, catById } from './model.js';
import { portfolio } from './portfolio.js';

export const monthOf = d => d.slice(0, 7);
export function todayISO(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function kindMap(state) {
  return Object.fromEntries(state.categories.map(c => [c.id, c.kind]));
}

/** Revenus, dépenses et dépenses par catégorie d'un mois (virements entre comptes exclus). */
export function monthSummary(state, month) {
  const kinds = kindMap(state);
  const titres = new Set(state.accounts.filter(a => a.type === 'titres').map(a => a.id));
  let income = 0, expenses = 0;
  const byCategory = {};
  const incomeByCategory = {};
  for (const t of state.transactions) {
    if (titres.has(t.accountId) || monthOf(t.date) !== month) continue;
    const k = kinds[t.categoryId] || (t.amount < 0 ? 'depense' : 'revenu');
    if (k === 'depense') {
      expenses -= t.amount;
      byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) - t.amount;
    } else if (k === 'revenu') {
      income += t.amount;
      incomeByCategory[t.categoryId] = (incomeByCategory[t.categoryId] || 0) + t.amount;
    }
  }
  return { month, income, expenses, saved: income - expenses, byCategory, incomeByCategory };
}

export function monthlySeries(state, endMonth, n = 12) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthSummary(state, addMonths(endMonth, -i)));
  return out;
}

/**
 * Mois complètement couverts par vos imports (pour ne pas comparer à un mois partiel) :
 * l'historique doit commencer au plus tard le 5 du mois.
 */
export function dataMonths(state) {
  const titres = new Set(state.accounts.filter(a => a.type === 'titres').map(a => a.id));
  let first = null;
  for (const t of state.transactions) if (!titres.has(t.accountId) && (!first || t.date < first)) first = t.date;
  if (!first) return [];
  const months = [...new Set(state.transactions.map(t => monthOf(t.date)))].sort();
  return months.filter(m => first <= `${m}-05`);
}

/**
 * « Ce qu'il vous reste » ce mois-ci : revenus attendus − dépenses du mois.
 * Revenus attendus = le plus grand entre les revenus déjà reçus et la moyenne des 3 mois précédents.
 */
export function monthMargin(state, today = todayISO()) {
  const month = monthOf(today);
  const cur = monthSummary(state, month);
  const known = new Set(dataMonths(state));
  const prev = [1, 2, 3].map(i => addMonths(month, -i)).filter(m => known.has(m)).map(m => monthSummary(state, m));
  const avgIncome = prev.length ? Math.round(prev.reduce((s, p) => s + p.income, 0) / prev.length) : 0;
  const expectedIncome = Math.max(cur.income, avgIncome);
  const margin = expectedIncome - cur.expenses;
  const dim = daysInMonth(month);
  const day = Number(today.slice(8, 10));
  const daysLeft = dim - day + 1;
  const budgetTotal = Object.values(state.budgets).reduce((s, v) => s + (v || 0), 0);
  return {
    month,
    income: cur.income,
    expectedIncome,
    incomeIsEstimate: expectedIncome > cur.income,
    history: prev.length, // mois complets précédents disponibles
    expenses: cur.expenses,
    margin,
    perDay: daysLeft > 0 ? Math.floor(margin / daysLeft) : margin,
    daysLeft,
    dayOfMonth: day,
    daysInMonth: dim,
    budgetTotal,
    summary: cur,
  };
}

export function budgetStatus(state, month) {
  const s = monthSummary(state, month);
  return Object.entries(state.budgets)
    .filter(([, v]) => v > 0)
    .map(([categoryId, budget]) => {
      const spent = s.byCategory[categoryId] || 0;
      return { categoryId, budget, spent, left: budget - spent, pct: spent / budget };
    })
    .sort((a, b) => b.pct - a.pct);
}

/** Moyenne mensuelle des dépenses par catégorie sur les 3 derniers mois complets (pour proposer un budget). */
export function averageSpending(state, today = todayISO()) {
  const month = monthOf(today);
  const known = new Set(dataMonths(state));
  const months = [1, 2, 3].map(i => addMonths(month, -i)).filter(m => known.has(m));
  const acc = {};
  for (const m of months) for (const [c, v] of Object.entries(monthSummary(state, m).byCategory)) acc[c] = (acc[c] || 0) + v;
  for (const c of Object.keys(acc)) acc[c] = Math.round(acc[c] / Math.max(months.length, 1));
  return acc;
}

const FIXED = new Set(['logement', 'assurances', 'impots', 'banque', 'sante']);

/**
 * Abonnements et prélèvements récurrents : même tiers, au moins 3 mois différents,
 * intervalle médian proche d'un mois, montants proches.
 */
export function subscriptions(state, today = todayISO()) {
  const kinds = kindMap(state);
  const since = addMonths(monthOf(today), -13) + '-01';
  const groups = new Map();
  for (const t of state.transactions) {
    if (t.amount >= 0 || t.date < since || kinds[t.categoryId] !== 'depense') continue;
    if (['alimentation', 'restaurants', 'especes', 'shopping'].includes(t.categoryId)) continue;
    const k = payeeKey(t.label);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const day = d => Date.parse(d) / 864e5;
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const months = new Set(list.map(t => monthOf(t.date)));
    if (months.size < 3 && !(months.size >= 2 && list[0].categoryId === 'abonnements')) continue;
    // Un seul prélèvement par mois : on garde le dernier de chaque mois
    const perMonth = [...new Map(list.map(t => [monthOf(t.date), t])).values()];
    const gaps = perMonth.slice(1).map((t, i) => day(t.date) - day(perMonth[i].date)).sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 30;
    if (median < 24 || median > 38) continue;
    const amounts = perMonth.map(t => -t.amount);
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const maxDev = Math.max(...amounts.map(a => Math.abs(a - mean))) / mean;
    if (maxDev > 0.25) continue;
    const last = perMonth.at(-1);
    // Abonnement arrêté : rien depuis plus de 45 jours
    if (day(today) - day(last.date) > 45) continue;
    const first = perMonth[0];
    out.push({
      key,
      name: payeeDisplay(last.label),
      amount: -last.amount,
      yearly: -last.amount * 12,
      categoryId: last.categoryId,
      lastDate: last.date,
      nextDate: new Date((day(last.date) + Math.round(median)) * 864e5).toISOString().slice(0, 10),
      count: perMonth.length,
      // Charges fixes (loyer, énergie, assurance, frais) : récurrentes mais rarement résiliables
      fixed: FIXED.has(last.categoryId),
      increase: -last.amount > -first.amount * 1.02 ? { from: -first.amount, to: -last.amount, since: first.date } : null,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Frais bancaires et de courtage des 12 derniers mois. */
export function feesLast12(state, today = todayISO()) {
  const since = addMonths(monthOf(today), -12) + '-' + today.slice(8, 10);
  const bank = state.transactions.filter(t => t.categoryId === 'banque' && t.date > since);
  const bankTotal = -bank.reduce((s, t) => s + t.amount, 0);
  const brokerTotal = -state.trades.filter(t => t.date > since).reduce((s, t) => s + (t.fee || 0), 0);
  const byPayee = {};
  for (const t of bank) {
    const k = payeeDisplay(t.label);
    byPayee[k] = (byPayee[k] || 0) - t.amount;
  }
  return { bankTotal, brokerTotal, total: bankTotal + brokerTotal, byPayee: Object.entries(byPayee).sort((a, b) => b[1] - a[1]) };
}

/** Taux d'épargne sur les 3 derniers mois complets. */
export function savingsRate(state, today = todayISO()) {
  const month = monthOf(today);
  const known = new Set(dataMonths(state));
  const months = [1, 2, 3].map(i => addMonths(month, -i)).filter(m => known.has(m)).map(m => monthSummary(state, m));
  const inc = months.reduce((s, m) => s + m.income, 0);
  const exp = months.reduce((s, m) => s + m.expenses, 0);
  return { months: months.length, income: inc, expenses: exp, rate: inc > 0 ? (inc - exp) / inc : null };
}

export function netWorth(state) {
  let cash = 0;
  for (const a of state.accounts) if (a.type !== 'titres') cash += accountBalance(state, a.id);
  const pf = portfolio(state);
  return { cash, invested: pf.totals.value, total: cash + pf.totals.value };
}

/** Pistes d'économie et alertes, de la plus importante à la moins importante. */
export function alerts(state, today = todayISO()) {
  const list = [];
  const month = monthOf(today);
  for (const b of budgetStatus(state, month)) {
    const c = catById(state, b.categoryId);
    if (b.pct >= 1) list.push({ level: 3, kind: 'budget', title: `Budget ${c.name.toLowerCase()} dépassé`, amount: -b.left, body: `Dépassé de ${fmt(-b.left)} ce mois-ci.`, link: '#/budget' });
    else if (b.pct >= 0.85) list.push({ level: 2, kind: 'budget', title: `Budget ${c.name.toLowerCase()} presque atteint`, body: `Il reste ${fmt(b.left)} jusqu'à la fin du mois.`, link: '#/budget' });
  }
  for (const a of state.accounts) {
    if (a.type !== 'courant') continue;
    const bal = accountBalance(state, a.id);
    if (bal < 0) list.push({ level: 3, kind: 'balance', title: `${a.name} à découvert`, body: `Solde de ${fmt(bal)} : des agios peuvent s'appliquer.`, link: `#/comptes/${a.id}` });
    else if (bal < (state.settings.lowBalance ?? 10000) && state.transactions.some(t => t.accountId === a.id)) list.push({ level: 2, kind: 'balance', title: `Solde bas sur ${a.name}`, body: `Il reste ${fmt(bal)}.`, link: `#/comptes/${a.id}` });
  }
  const subs = subscriptions(state, today);
  for (const s of subs) if (s.increase) list.push({ level: 2, kind: 'sub', title: `${s.name} a augmenté`, body: `${fmt(s.increase.from)} → ${fmt(s.increase.to)} par mois, soit ${fmt((s.increase.to - s.increase.from) * 12)} de plus par an.`, link: '#/analyse' });
  const fees = feesLast12(state, today);
  if (fees.bankTotal > 3000) list.push({ level: 1, kind: 'fees', title: `${fmt(fees.bankTotal)} de frais bancaires en un an`, body: 'Comparez avec une offre sans frais de tenue de compte ni cotisation carte.', link: '#/analyse' });
  const realSubs = subs.filter(x => !x.fixed);
  if (realSubs.length >= 3) {
    const total = realSubs.reduce((s, x) => s + x.amount, 0);
    list.push({ level: 1, kind: 'subs', title: `${realSubs.length} abonnements : ${fmt(total)} par mois`, body: `Soit ${fmt(total * 12)} par an. Vérifiez ceux que vous n'utilisez plus.`, link: '#/analyse' });
  }
  return list.sort((a, b) => b.level - a.level);
}

function fmt(c) {
  return (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
