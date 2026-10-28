// Calculs de crédit (fonctions pures) : mensualité, capital restant dû, capacité d'emprunt.
// Montants en centimes, taux annuels en pourcentage (3,66 = 3,66 %).

const monthly = rate => rate / 100 / 12;

export function monthsBetween(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  let n = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) n -= 1;
  return n;
}

/** Mensualité hors assurance d'un prêt amortissable. */
export function payment(capital, ratePct, months) {
  if (months <= 0) return capital;
  const i = monthly(ratePct);
  if (i === 0) return Math.round(capital / months);
  return Math.round((capital * i) / (1 - Math.pow(1 + i, -months)));
}

/** Capital que l'on peut emprunter pour une mensualité donnée (assurance calculée sur le capital initial). */
export function capitalFor(monthlyBudget, ratePct, months, insurancePct = 0) {
  if (monthlyBudget <= 0 || months <= 0) return 0;
  const i = monthly(ratePct);
  const factor = i === 0 ? 1 / months : i / (1 - Math.pow(1 + i, -months));
  return Math.floor(monthlyBudget / (factor + insurancePct / 100 / 12));
}

/** Valeur actuelle des mensualités restantes (hors assurance) = capital restant dû. */
export function presentValue(paymentHorsAssurance, ratePct, months) {
  if (months <= 0) return 0;
  const i = monthly(ratePct);
  if (i === 0) return paymentHorsAssurance * months;
  return Math.round((paymentHorsAssurance * (1 - Math.pow(1 + i, -months))) / i);
}

/**
 * État d'un crédit à une date : mensualités restantes, capital restant dû, intérêts restants.
 * loan : { monthly (assurance comprise), insurance, rate, endDate, remainingOverride?, remainingAt? }
 */
export function loanStatus(loan, today) {
  const left = Math.max(0, monthsBetween(today, loan.endDate) + 1);
  const hors = Math.max(0, (loan.monthly || 0) - (loan.insurance || 0));
  let remaining = presentValue(hors, loan.rate || 0, left);
  // Capital restant dû saisi par l'utilisateur (tableau d'amortissement) : il prime, réduit des mensualités écoulées depuis
  if (loan.remainingOverride != null && loan.remainingAt) {
    const elapsed = Math.max(0, monthsBetween(loan.remainingAt, today));
    let r = loan.remainingOverride;
    const i = monthly(loan.rate || 0);
    for (let k = 0; k < elapsed && r > 0; k++) r = Math.max(0, Math.round(r * (1 + i) - hors));
    remaining = r;
  }
  const paymentsLeft = hors * left;
  const interestLeft = Math.max(0, paymentsLeft - remaining);
  return { monthsLeft: left, remaining: left ? remaining : 0, interestLeft: left ? interestLeft : 0, insuranceLeft: (loan.insurance || 0) * left, active: left > 0 };
}

/** Intérêts économisés en remboursant `amount` par anticipation (durée réduite, mensualité inchangée). */
export function prepaymentSaving(loan, amount, today) {
  const st = loanStatus(loan, today);
  if (!st.active || amount <= 0) return { saved: 0, monthsSaved: 0 };
  const hors = Math.max(1, loan.monthly - (loan.insurance || 0));
  const i = monthly(loan.rate || 0);
  let r = Math.max(0, st.remaining - amount), n = 0, interest = 0;
  while (r > 0 && n < 600) {
    const it = r * i;
    interest += it;
    r = r + it - hors;
    n++;
  }
  return { saved: Math.max(0, Math.round(st.interestLeft - interest)), monthsSaved: Math.max(0, st.monthsLeft - n) };
}
