// Échéancier, prévision du solde de fin de mois et objectifs d'épargne.
import { payeeKey, payeeDisplay } from '../lib/text.js';
import { accountBalance, catById } from './model.js';
import { monthOf, todayISO, addMonths, daysInMonth, savingsRate } from './analytics.js';
import { portfolio } from './portfolio.js';
import { loanStatus } from './loans.js';

const DAY = 864e5;
const dnum = d => Date.parse(d + 'T00:00:00Z') / DAY;
const iso = n => new Date(n * DAY).toISOString().slice(0, 10);
// Dépenses du quotidien : jamais traitées comme des échéances, elles entrent dans l'estimation « dépenses courantes »
const STRONG = new Set(['salaire', 'aides', 'logement', 'assurances', 'abonnements', 'credits', 'impots']);
const VARIABLE = new Set(['alimentation', 'restaurants', 'especes', 'shopping', 'loisirs', 'voyages', 'transports', 'divers', 'cadeaux', 'sante']);

/** Comptes dont on prévoit le solde : comptes courants et cartes de vos banques (hors Trade Republic). */
export function mainAccounts(state) {
  return state.accounts.filter(a => (a.type === 'courant' || a.type === 'carte') && !/trade republic/i.test(a.institution || a.name));
}

/**
 * Opérations récurrentes des comptes courants : revenus (salaire, aides), prélèvements, virements réguliers vers l'épargne.
 * Même tiers et même sens au moins 3 mois, environ une fois par mois, montant stable.
 */
export function recurring(state, today = todayISO()) {
  const main = new Set(mainAccounts(state).map(a => a.id));
  const since = addMonths(monthOf(today), -13) + '-01';
  const groups = new Map();
  for (const t of state.transactions) {
    if (!main.has(t.accountId) || t.date < since || t.date > today) continue;
    if (t.amount < 0 && VARIABLE.has(t.categoryId)) continue;
    const k = `${t.amount < 0 ? 'out' : 'in'}|${t.transferId ? 'tr|' : ''}${payeeKey(t.label)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    // Un mouvement par mois (le plus important : un salaire n'est versé qu'une fois)
    const byMonth = new Map();
    for (const t of list) {
      const m = monthOf(t.date), prev = byMonth.get(m);
      if (!prev || Math.abs(t.amount) > Math.abs(prev.amount)) byMonth.set(m, t);
    }
    const per = [...byMonth.values()];
    // 3 mois au moins ; 2 suffisent pour un salaire, un loyer, une assurance, un abonnement ou un crédit
    if (per.length < (STRONG.has(per.at(-1).categoryId) ? 2 : 3)) continue;
    const gaps = per.slice(1).map((t, i) => dnum(t.date) - dnum(per[i].date)).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median < 24 || median > 38) continue;
    const amounts = per.map(t => Math.abs(t.amount));
    const recent = amounts.slice(-3);
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    const income = per[0].amount > 0;
    if (Math.max(...recent.map(a => Math.abs(a - mean))) / mean > (income ? 0.35 : 0.25)) continue;
    const last = per.at(-1);
    if (dnum(today) - dnum(last.date) > 45) continue; // arrêté
    // Jour habituel du mois (médiane des derniers mois)
    const days = per.slice(-4).map(t => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    out.push({
      key,
      name: payeeDisplay(last.label),
      amount: (last.amount < 0 ? -1 : 1) * Math.round(mean),
      sign: last.amount < 0 ? 'out' : 'in',
      day: days[Math.floor(days.length / 2)],
      lastDate: last.date,
      categoryId: last.categoryId,
      accountId: last.accountId,
      transfer: !!last.transferId || ['virement-interne', 'epargne'].includes(last.categoryId),
      count: per.length,
    });
  }
  return out.sort((a, b) => a.day - b.day);
}

/** Date d'une échéance pour un mois donné, au jour habituel (borné au dernier jour du mois). */
function dateIn(month, day) {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;
}

/**
 * Échéancier : prochaines opérations prévues sur `days` jours (récurrences, mensualités de crédit non détectées).
 * Une échéance déjà passée ce mois-ci n'est pas reprise ; une échéance en retard de quelques jours est placée aujourd'hui.
 */
export function upcoming(state, today = todayISO(), days = 31) {
  const end = iso(dnum(today) + days);
  const items = [];
  for (const r of recurring(state, today)) {
    for (let i = 0; i <= 2; i++) {
      const m = addMonths(monthOf(today), i);
      let d = dateIn(m, r.day);
      if (monthOf(r.lastDate) >= m) continue; // déjà passé ce mois-ci
      if (d < today) {
        if (dnum(today) - dnum(d) > 6) continue; // trop ancien : sans doute décalé au mois suivant
        d = today;
      }
      if (d > end) break;
      items.push({ ...r, date: d, estimated: true });
    }
  }
  // Mensualités des crédits saisis dans le module Crédits, si elles ne sont pas déjà détectées dans les relevés
  const detectedLoans = items.some(x => x.categoryId === 'credits') || recurring(state, today).some(x => x.categoryId === 'credits');
  if (!detectedLoans) {
    for (const l of state.loans || []) {
      const st = loanStatus(l, today);
      if (!st.active || !l.monthly) continue;
      const day = l.day || 5;
      for (let i = 0; i <= 1; i++) {
        const d = dateIn(addMonths(monthOf(today), i), day);
        if (d >= today && d <= end) items.push({ key: 'loan|' + l.id, name: l.name || 'Crédit', amount: -l.monthly, sign: 'out', date: d, categoryId: 'credits', transfer: false, estimated: true });
      }
    }
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
}

/**
 * Solde prévu à la fin du mois sur les comptes courants :
 * solde actuel + revenus attendus − prélèvements attendus − dépenses courantes restantes (moyenne des mois complets).
 */
export function forecast(state, today = todayISO()) {
  const accounts = mainAccounts(state);
  if (!accounts.length) return null;
  const ids = new Set(accounts.map(a => a.id));
  const month = monthOf(today);
  const dim = daysInMonth(month);
  const endDate = `${month}-${String(dim).padStart(2, '0')}`;
  const balance = accounts.reduce((s, a) => s + accountBalance(state, a.id), 0);
  // Dernière opération connue : au-delà, le solde « actuel » n'est peut-être plus à jour
  const lastTx = state.transactions.filter(t => ids.has(t.accountId)).reduce((m, t) => (t.date > m ? t.date : m), '');
  const items = upcoming(state, today, dnum(endDate) - dnum(today)).filter(x => x.date <= endDate);
  const income = items.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const bills = items.filter(x => x.amount < 0).reduce((s, x) => s - x.amount, 0);
  // Dépenses courantes : moyenne mensuelle des catégories variables sur les mois complets récents
  // Mois complets sur ces comptes : l'historique doit commencer au plus tard le 5 du mois
  const first = state.transactions.filter(t => ids.has(t.accountId)).reduce((m, t) => (!m || t.date < m ? t.date : m), '');
  const prev = [1, 2, 3].map(i => addMonths(month, -i)).filter(m => first && first <= `${m}-05`);
  const varOf = m => state.transactions.filter(t => ids.has(t.accountId) && monthOf(t.date) === m && t.amount < 0 && VARIABLE.has(t.categoryId) && !t.transferId).reduce((s, t) => s - t.amount, 0);
  const avgVar = prev.length ? Math.round(prev.reduce((s, m) => s + varOf(m), 0) / prev.length) : null;
  const spentVar = varOf(month);
  const dayN = Number(today.slice(8, 10));
  // Relevés arrêtés avant aujourd'hui : les dépenses depuis la dernière opération connue ne sont pas encore importées
  const ref = lastTx && monthOf(lastTx) === month && lastTx < today ? Number(lastTx.slice(8, 10)) : dayN;
  // Ce qui reste à dépenser : au moins la moyenne au prorata des jours restants, au plus la moyenne mensuelle non encore dépensée.
  // Sans mois complet, pas de prévision : un début de mois ne dit rien du reste.
  if (avgVar == null) return { balance, income, bills, items, endDate, lastTx, stale: !!lastTx && dnum(today) - dnum(lastTx) > 10, accounts: accounts.length, history: 0, insufficient: true };
  const prorata = Math.round((avgVar * (dim - ref)) / dim);
  const variableLeft = Math.max(prorata, avgVar - spentVar);
  const end = balance + income - bills - variableLeft;
  // Courbe jour par jour (pour le graphique)
  const curve = [];
  let b = balance;
  const perDay = dim > dayN ? variableLeft / (dim - dayN) : 0;
  for (let d = dayN; d <= dim; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    if (d > dayN) b -= perDay;
    for (const x of items) if (x.date === ds) b += x.amount;
    curve.push([ds, Math.round(b)]);
  }
  const low = curve.reduce((m, p) => (p[1] < m[1] ? p : m), curve[0]);
  return { balance, income, bills, variableLeft, avgVariable: avgVar, spentVariable: spentVar, end, endDate, items, curve, low, lastTx, stale: !!lastTx && dnum(today) - dnum(lastTx) > 10, accounts: accounts.length, history: prev.length };
}

// ---------- Objectifs d'épargne ----------

export function monthsBetween(fromISO, toMonth) {
  const [y1, m1] = fromISO.slice(0, 7).split('-').map(Number);
  const [y2, m2] = toMonth.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

/** Avancement d'un objectif : montant atteint (solde du compte lié ou montant saisi), reste, effort mensuel. */
export function goalStatus(state, g, today = todayISO()) {
  let current = g.manual || 0;
  let linked = null;
  if (g.accountId) {
    const a = state.accounts.find(x => x.id === g.accountId);
    if (a) {
      linked = a;
      current = a.type === 'titres' ? portfolio(state, today).totals.value : accountBalance(state, a.id);
    }
  }
  current = Math.max(0, current);
  const left = Math.max(0, g.target - current);
  const months = g.deadline ? Math.max(0, monthsBetween(today, g.deadline)) : null;
  const perMonth = months == null ? null : left === 0 ? 0 : Math.ceil(left / Math.max(1, months));
  const sr = savingsRate(state, today);
  const capacity = sr.months ? Math.round((sr.income - sr.expenses) / sr.months) : null;
  return {
    current, left, linked,
    pct: g.target ? Math.min(1, current / g.target) : 0,
    done: current >= g.target,
    months, perMonth,
    late: months === 0 && left > 0,
    // Effort comparé à ce que vous mettez de côté en moyenne chaque mois
    share: perMonth != null && capacity > 0 ? perMonth / capacity : null,
    capacity,
  };
}

/** Somme des efforts mensuels de tous les objectifs en cours. */
export function goalsEffort(state, today = todayISO()) {
  return (state.goals || []).map(g => goalStatus(state, g, today)).filter(s => !s.done && s.perMonth).reduce((t, s) => t + s.perMonth, 0);
}

// ---------- Rappel d'import ----------

/** Fichier calendrier (.ics) : un rappel chaque mois, le jour choisi, à 19 h. */
export function reminderICS(day = 3, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const y = now.getFullYear(), m = now.getMonth() + 1;
  // Premier rappel : le prochain « day » à venir
  let sy = y, sm = now.getDate() >= day ? m + 1 : m;
  if (sm > 12) { sm = 1; sy++; }
  const start = `${sy}${p(sm)}${p(Math.min(day, 28))}T190000`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pecule//Rappel import//FR', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:pecule-rappel-import-${day}@pecule.app`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Paris:${start}`,
    'DURATION:PT15M',
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${Math.min(day, 28)}`,
    'SUMMARY:Pécule : importer mes relevés',
    'DESCRIPTION:Exportez vos relevés Caisse d\'Épargne et Trade Republic du mois dernier\\, puis importez-les dans Pécule.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Importer mes relevés dans Pécule', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

/** Faut-il rappeler d'importer ? Oui si le dernier import date d'avant le jour de rappel du mois en cours (ou de plus de 35 jours). */
export function importDue(state, today = todayISO()) {
  const last = state.imports.at(-1);
  if (!last || state.settings.demo) return null;
  const lastDay = last.at.slice(0, 10);
  const day = state.settings.reminderDay || 3;
  const thisMonthDue = dateIn(monthOf(today), day);
  const due = (today >= thisMonthDue && lastDay < thisMonthDue) || dnum(today) - dnum(lastDay) > 35;
  return { due, lastDay, days: Math.floor(dnum(today) - dnum(lastDay)) };
}

export { catById };
