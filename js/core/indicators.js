// Indicateurs calculés sur un historique de cours [[date, cours], …] trié par date croissante.

export function indicators(history, { periodsPerYear = 252 } = {}) {
  if (!history || history.length < 10) return null;
  const px = history.map(h => h[1]).filter(v => v > 0);
  const last = px.at(-1);
  const at = n => (px.length > n ? px.at(-1 - n) : null);
  const ppy = periodsPerYear;
  const perf = n => { const p = at(n); return p ? last / p - 1 : null; };
  // Volatilité annualisée sur un an glissant (écart-type des rendements journaliers)
  const win = px.slice(-Math.min(px.length, ppy + 1));
  const rets = win.slice(1).map((v, i) => Math.log(v / win[i]));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(ppy);
  // Plus forte baisse depuis un plus haut, sur la fenêtre
  let peak = win[0], mdd = 0;
  for (const v of win) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const high = Math.max(...win), low = Math.min(...win);
  const smaN = Math.min(200, Math.round(ppy * 0.8));
  const sma = px.length >= smaN ? px.slice(-smaN).reduce((s, v) => s + v, 0) / smaN : null;
  return {
    last,
    perf1m: perf(Math.round(ppy / 12)),
    perf3m: perf(Math.round(ppy / 4)),
    perf1y: perf(ppy),
    volatility: rets.length > 20 ? vol : null,
    maxDrawdown: mdd,
    fromHigh: last / high - 1,
    high, low,
    sma, smaDays: smaN,
    aboveSma: sma ? last >= sma : null,
    years: win.length / ppy,
  };
}

/** Lecture simple de la volatilité, pour un non-spécialiste. */
export function volatilityLabel(v) {
  if (v == null) return null;
  if (v < 0.08) return 'faible';
  if (v < 0.18) return 'modérée';
  if (v < 0.35) return 'élevée';
  return 'très élevée';
}
