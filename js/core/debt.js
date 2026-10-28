// Endettement : taux d'endettement, capacité de remboursement et d'emprunt, détection des crédits,
// note de santé financière. Constats chiffrés, pas un accord de prêt : chaque banque décide au cas par cas.
import { monthSummary, dataMonths, addMonths, monthOf, todayISO, subscriptions, savingsRate } from './analytics.js';
import { accountBalance } from './model.js';
import { capitalFor, payment, loanStatus } from './loans.js';
import { payeeKey, payeeDisplay, uid } from '../lib/text.js';

/**
 * Repères datés. Ils changent : l'utilisateur peut modifier les taux dans l'écran Crédits.
 * Sources : HCSF (règle des 35 %, 25 ans), baromètre Pretto du 25 oct. 2026, taux réglementés au 1er août 2026.
 */
export const REFERENCES = {
  asOf: '2026-10-25',
  maxDebtRatio: 0.35,
  maxYears: 25,
  mortgageRates: { 15: 3.5, 20: 3.66, 25: 3.75 },
  insurancePct: 0.25,
  livretA: 1.7,
  lep: 2.5,
};

export const LOAN_TYPES = {
  immo: 'Prêt immobilier',
  auto: 'Crédit auto',
  conso: 'Prêt personnel',
  renouvelable: 'Crédit renouvelable',
  etudiant: 'Prêt étudiant',
  autre: 'Autre crédit',
};

export function debtSettings(state) {
  return {
    incomeOverride: null,   // revenus nets mensuels avant impôt saisis par l'utilisateur
    rentalIncome: 0,        // loyers perçus (retenus à 70 % par les banques)
    rates: { ...REFERENCES.mortgageRates },
    insurancePct: REFERENCES.insurancePct,
    ...(state.debt || {}),
  };
}

/** Revenus réguliers moyens (salaires et aides) sur les 3 derniers mois complets. */
export function regularIncome(state, today = todayISO()) {
  const month = monthOf(today);
  const known = new Set(dataMonths(state));
  const months = [1, 2, 3].map(i => addMonths(month, -i)).filter(m => known.has(m));
  if (!months.length) {
    // Pas encore de mois complet : on retient le salaire et les aides déjà reçus ce mois-ci
    const cur = monthSummary(state, month);
    const amount = (cur.incomeByCategory.salaire || 0) + (cur.incomeByCategory.aides || 0);
    return { amount, months: amount ? 1 : 0, partial: true };
  }
  let total = 0;
  for (const m of months) {
    const s = monthSummary(state, m);
    total += (s.incomeByCategory.salaire || 0) + (s.incomeByCategory.aides || 0);
  }
  return { amount: Math.round(total / months.length), months: months.length };
}

/** Synthèse : revenus retenus, charges de crédit, taux d'endettement, capacité. */
export function debtAnalysis(state, today = todayISO()) {
  const ds = debtSettings(state);
  const detected = regularIncome(state, today);
  const income = (ds.incomeOverride ?? detected.amount) + Math.round((ds.rentalIncome || 0) * 0.7);
  const loans = (state.loans || []).map(l => ({ ...l, status: loanStatus(l, today) })).filter(l => l.status.active);
  const charges = loans.reduce((s, l) => s + (l.monthly || 0), 0);
  const ratio = income > 0 ? charges / income : null;
  const capacity = Math.max(0, Math.floor(income * REFERENCES.maxDebtRatio) - charges);
  const durations = [15, 20, 25].map(years => {
    const rate = ds.rates[years] ?? REFERENCES.mortgageRates[years];
    const capital = capitalFor(capacity, rate, years * 12, ds.insurancePct);
    return { years, rate, capital, monthly: capacity, totalCost: capacity * years * 12 - capital };
  });
  const remaining = loans.reduce((s, l) => s + l.status.remaining, 0);
  const interestLeft = loans.reduce((s, l) => s + l.status.interestLeft, 0);
  return {
    income, incomeDetected: detected.amount, incomeMonths: detected.months, incomePartial: !!detected.partial, incomeIsOverride: ds.incomeOverride != null,
    rentalIncome: ds.rentalIncome || 0, loans, charges, ratio, capacity, durations, remaining, interestLeft,
    resteAVivre: income - charges, settings: ds,
  };
}

/** Simulation d'un nouveau crédit : mensualité, coût, nouveau taux d'endettement. */
export function simulateLoan(state, { amount, years, rate, insurancePct }, today = todayISO()) {
  const a = debtAnalysis(state, today);
  const months = years * 12;
  const hors = payment(amount, rate, months);
  const ins = Math.round((amount * (insurancePct ?? a.settings.insurancePct)) / 100 / 12);
  const monthlyTotal = hors + ins;
  const newRatio = a.income > 0 ? (a.charges + monthlyTotal) / a.income : null;
  return {
    monthly: monthlyTotal, insurance: ins,
    interest: hors * months - amount, insuranceTotal: ins * months,
    totalCost: hors * months - amount + ins * months,
    newRatio, ok: newRatio != null && newRatio <= REFERENCES.maxDebtRatio && years <= REFERENCES.maxYears,
    resteAVivre: a.income - a.charges - monthlyTotal,
  };
}

/**
 * Classement des crédits : du plus coûteux (taux le plus élevé) au moins coûteux.
 * C'est l'ordre dans lequel un remboursement anticipé fait économiser le plus d'intérêts.
 */
export function rankLoans(state, today = todayISO()) {
  return (state.loans || [])
    .map(l => ({ ...l, status: loanStatus(l, today) }))
    .filter(l => l.status.active)
    .sort((a, b) => (b.rate || 0) - (a.rate || 0) || b.status.interestLeft - a.status.interestLeft)
    .map((l, i) => ({ ...l, rank: i + 1, belowSavings: (l.rate || 0) < REFERENCES.livretA }));
}

/** Prélèvements récurrents qui ressemblent à des crédits et ne sont pas encore enregistrés. */
export function detectLoans(state, today = todayISO()) {
  const known = new Set((state.loans || []).map(l => l.payeeKey).filter(Boolean));
  const dismissed = new Set(state.debt?.dismissed || []);
  return subscriptions(state, today)
    .filter(s => s.categoryId === 'credits' && !known.has(s.key) && !dismissed.has(s.key))
    .map(s => ({ key: s.key, name: s.name, monthly: s.amount, lastDate: s.lastDate, count: s.count }));
}

export function newLoan(fields) {
  return { id: uid('loan_'), name: '', type: 'conso', monthly: 0, insurance: 0, rate: 0, endDate: null, payeeKey: null, remainingOverride: null, remainingAt: null, ...fields };
}

export { payeeKey, payeeDisplay };

// ---------- Note de santé financière ----------

/** Jours passés à découvert sur les comptes courants, sur les 90 derniers jours. */
export function overdraftDays(state, today = todayISO()) {
  const since = new Date(Date.parse(today) - 89 * 864e5).toISOString().slice(0, 10);
  let days = 0;
  for (const a of state.accounts.filter(x => x.type === 'courant')) {
    const txs = state.transactions.filter(t => t.accountId === a.id).sort((x, y) => (x.date < y.date ? -1 : 1));
    if (!txs.length) continue;
    let bal = a.openingBalance || 0, k = 0;
    while (k < txs.length && txs[k].date < since) bal += txs[k++].amount;
    for (let d = Date.parse(since); d <= Date.parse(today); d += 864e5) {
      const iso = new Date(d).toISOString().slice(0, 10);
      while (k < txs.length && txs[k].date <= iso) bal += txs[k++].amount;
      if (bal < 0 && iso >= txs[0].date) days++;
    }
  }
  return days;
}

/** Épargne disponible (comptes courants, livrets, espèces) en mois de dépenses. */
export function safetyCushion(state, today = todayISO()) {
  const liquid = state.accounts.filter(a => ['courant', 'livret', 'especes'].includes(a.type)).reduce((s, a) => s + Math.max(0, accountBalance(state, a.id)), 0);
  const sr = savingsRate(state, today);
  const monthlyExp = sr.months ? sr.expenses / sr.months : 0;
  return { liquid, monthlyExpenses: monthlyExp, months: monthlyExp > 0 ? liquid / monthlyExp : null };
}

const band = (v, steps) => { for (const [lim, pts] of steps) if (v <= lim) return pts; return steps.at(-1)[1]; };

/**
 * Note de A à E, sur quatre critères notés sur 100. Échelle propre à Pécule, indicative.
 */
export function healthScore(state, today = todayISO()) {
  const a = debtAnalysis(state, today);
  const sr = savingsRate(state, today);
  const cushion = safetyCushion(state, today);
  const od = overdraftDays(state, today);
  const crit = [];

  if (a.ratio != null) {
    const pts = band(a.ratio, [[0.0001, 100], [0.15, 95], [0.25, 80], [0.33, 60], [0.35, 45], [0.45, 20], [Infinity, 5]]);
    crit.push({ id: 'endettement', label: "Taux d'endettement", value: a.ratio, fmt: 'pct', pts, hint: a.ratio <= 0.35 ? 'Sous la limite de 35 % des banques.' : 'Au-dessus de la limite de 35 % : un nouveau crédit serait difficile à obtenir.' });
  }
  if (sr.rate != null) {
    const pts = band(-sr.rate, [[-0.2, 100], [-0.1, 80], [-0.05, 60], [0, 40], [Infinity, 10]]);
    crit.push({ id: 'epargne', label: "Taux d'épargne", value: sr.rate, fmt: 'pct', pts, hint: sr.rate >= 0.1 ? 'Vous mettez de côté une part régulière de vos revenus.' : 'Mettre de côté 10 % de ses revenus est un premier palier courant.' });
  }
  if (cushion.months != null) {
    const pts = band(-cushion.months, [[-6, 100], [-3, 80], [-1, 50], [Infinity, 15]]);
    crit.push({ id: 'precaution', label: 'Épargne de précaution', value: cushion.months, fmt: 'months', pts, hint: cushion.months >= 3 ? "Vous pourriez couvrir plusieurs mois de dépenses en cas d'imprévu." : "On conseille souvent de garder 3 à 6 mois de dépenses disponibles." });
  }
  if (state.transactions.length) {
    const pts = band(od, [[0, 100], [3, 70], [10, 40], [Infinity, 10]]);
    crit.push({ id: 'decouvert', label: 'Jours à découvert (90 jours)', value: od, fmt: 'days', pts, hint: od === 0 ? 'Aucun découvert sur la période.' : 'Les découverts coûtent des agios et pèsent dans une demande de crédit.' });
  }
  // Moins de 3 critères mesurables : pas assez de données pour une note fiable
  if (crit.length < 3) return null;
  const weights = { endettement: 0.3, epargne: 0.25, precaution: 0.25, decouvert: 0.2 };
  const wsum = crit.reduce((s, c) => s + weights[c.id], 0);
  const score = Math.round(crit.reduce((s, c) => s + c.pts * weights[c.id], 0) / wsum);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'E';
  const label = { A: 'Très solide', B: 'Solide', C: 'Correcte', D: 'Fragile', E: 'Tendue' }[grade];
  return { score, grade, label, criteria: crit.sort((x, y) => x.pts - y.pts), cushion, overdraft: od };
}
