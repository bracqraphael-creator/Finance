// Portefeuille : positions, prix de revient moyen pondéré (PRU), plus-values, dividendes, rendement annualisé.
import { todayISO } from './analytics.js';

const ORDER = { buy: 0, in: 1, dividend: 2, sell: 3, out: 4 };

export function positions(state) {
  const trades = [...state.trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER[a.kind] - ORDER[b.kind]));
  const map = new Map();
  const knownBy = new Map(); // part des parts vendues dont le prix d'achat est connu
  const realizedBy = new Map(); // plus-value de chaque vente (partie connue)
  for (const t of trades) {
    if (!map.has(t.isin)) {
      const sec = state.securities[t.isin] || {};
      map.set(t.isin, { isin: t.isin, name: sec.name || t.name, assetClass: sec.assetClass || t.assetClass, shares: 0, cost: 0, realized: 0, dividends: 0, fees: 0, invested: 0, lastTradePrice: null, firstDate: t.date, trades: [] });
    }
    const p = map.get(t.isin);
    p.trades.push(t);
    p.fees += -(t.fee || 0);
    if (t.kind === 'buy' || t.kind === 'in') {
      p.shares += t.shares;
      if (t.kind === 'buy') { p.cost += -t.amount; p.invested += -t.amount; }
      if (t.price) p.lastTradePrice = t.price;
    } else if (t.kind === 'sell' || t.kind === 'out') {
      const asked = -t.shares;
      const sold = Math.min(asked, p.shares);
      const costOut = p.shares > 0 ? (p.cost * sold) / p.shares : 0;
      p.shares -= sold;
      p.cost -= costOut;
      // Vente de parts achetées avant le début de l'historique importé : leur prix d'achat est inconnu,
      // on ne compte que la partie connue dans la plus-value (sinon tout le prix de vente passerait pour un gain)
      const known = asked > 0 ? sold / asked : 1;
      if (known < 0.999) p.incomplete = true;
      if (t.kind === 'sell') {
        const r = Math.round(t.amount * known) - costOut;
        p.realized += r;
        realizedBy.set(t, { realized: r, cost: costOut, known });
      }
      knownBy.set(t, known);
      if (t.price) p.lastTradePrice = t.price;
      if (p.shares < 1e-9) { p.shares = 0; p.cost = 0; }
    } else if (t.kind === 'dividend') {
      p.dividends += t.amount;
    }
  }
  const out = [];
  for (const p of map.values()) {
    const q = state.prices[p.isin];
    const price = q?.close ?? p.lastTradePrice ?? (p.shares ? p.cost / 100 / p.shares : 0);
    p.price = price;
    p.priceDate = q?.date || null;
    p.priceSource = q ? q.source : 'last-trade';
    p.prevClose = q?.prevClose ?? null;
    p.value = Math.round(p.shares * price * 100);
    p.pru = p.shares ? p.cost / 100 / p.shares : 0;
    p.latent = p.value - p.cost;
    p.latentPct = p.cost ? p.latent / p.cost : 0;
    p.dayChange = p.prevClose ? Math.round(p.shares * (price - p.prevClose) * 100) : null;
    p.ticker = state.securities[p.isin]?.ticker || null;
    out.push(p);
  }
  out.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  out.known = knownBy;
  out.realizedBy = realizedBy;
  return out;
}

export function portfolio(state, today = todayISO()) {
  const pos = positions(state);
  const open = pos.filter(p => p.shares > 0);
  const totals = {
    value: open.reduce((s, p) => s + p.value, 0),
    cost: open.reduce((s, p) => s + p.cost, 0),
    realized: pos.reduce((s, p) => s + p.realized, 0),
    dividends: pos.reduce((s, p) => s + p.dividends, 0),
    fees: pos.reduce((s, p) => s + p.fees, 0),
    dayChange: open.every(p => p.dayChange != null) && open.length ? open.reduce((s, p) => s + p.dayChange, 0) : null,
  };
  totals.latent = totals.value - totals.cost;
  totals.latentPct = totals.cost ? totals.latent / totals.cost : 0;
  // Rendement annualisé (TRI) : achats, ventes et dividendes datés + valeur actuelle aujourd'hui
  totals.incomplete = pos.some(p => p.incomplete);
  const flows = state.trades.filter(t => t.kind !== 'in' && t.kind !== 'out').map(t => ({ date: t.date, amount: t.kind === 'sell' ? Math.round(t.amount * (pos.known.get(t) ?? 1)) : t.amount }));
  if (totals.value) flows.push({ date: today, amount: totals.value });
  totals.xirr = flows.length > 1 && !totals.incomplete ? xirr(flows) : null;
  const byClass = {};
  for (const p of open) {
    const k = assetClassLabel(p.assetClass);
    byClass[k] = (byClass[k] || 0) + p.value;
  }
  totals.allocation = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
  return { positions: pos, open, closed: pos.filter(p => p.shares === 0), totals };
}

export function assetClassLabel(c) {
  return { STOCK: 'Actions', FUND: 'ETF et fonds', ETF: 'ETF et fonds', BOND: 'Obligations', CRYPTO: 'Crypto', DERIVATIVE: 'Dérivés', PRIVATE_FUND: 'Fonds privés' }[String(c || '').toUpperCase()] || 'Autres';
}

/** Taux de rendement interne annualisé (XIRR). Renvoie null s'il n'existe pas. */
export function xirr(flows) {
  if (!flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) return null;
  const t0 = Date.parse(flows[0].date);
  const ts = flows.map(f => (Date.parse(f.date) - t0) / (365.25 * 864e5));
  const span = Math.max(...ts) - Math.min(...ts);
  if (span < 30 / 365) return null; // trop court pour annualiser
  const npv = r => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, ts[i]), 0);
  let lo = -0.99, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1e-6) return mid;
    if (f * flo < 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; }
  }
  return (lo + hi) / 2;
}
