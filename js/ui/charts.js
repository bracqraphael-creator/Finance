// Graphiques SVG légers, sans bibliothèque (l'app fonctionne hors ligne).
import { raw, esc } from './dom.js';

/** Petite courbe de tendance. */
export function sparkline(values, { w = 72, h = 28, color = null } = {}) {
  if (!values || values.length < 2) return raw('');
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`);
  const up = values.at(-1) >= values[0];
  const c = color || (up ? 'var(--pos)' : 'var(--neg)');
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`);
}

/** Courbe de cours avec axe des valeurs min/max et dates de début/fin. */
export function lineChart(series, { w = 340, h = 170, label = '' } = {}) {
  if (!series || series.length < 2) return raw('');
  const vals = series.map(s => s[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const padL = 4, padR = 4, padT = 14, padB = 22;
  const x = i => padL + (i / (series.length - 1)) * (w - padL - padR);
  const y = v => padT + (1 - (v - min) / span) * (h - padT - padB);
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[1]).toFixed(1)}`).join('');
  const up = vals.at(-1) >= vals[0];
  const c = up ? 'var(--pos)' : 'var(--neg)';
  const area = `${d}L${x(series.length - 1).toFixed(1)} ${h - padB}L${x(0)} ${h - padB}Z`;
  const fmt = v => v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 3 : 2 });
  const day = s => new Date(s + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
    <path d="${area}" fill="${c}" opacity="0.08"/>
    <path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>
    <line x1="${padL}" x2="${w - padR}" y1="${y(max)}" y2="${y(max)}" stroke="var(--line)" stroke-dasharray="3 4"/>
    <line x1="${padL}" x2="${w - padR}" y1="${y(min)}" y2="${y(min)}" stroke="var(--line)" stroke-dasharray="3 4"/>
    <text x="${w - padR}" y="${y(max) - 4}" text-anchor="end" font-size="11" fill="var(--ink-2)">${esc(fmt(max))}</text>
    <text x="${w - padR}" y="${y(min) - 4}" text-anchor="end" font-size="11" fill="var(--ink-2)">${esc(fmt(min))}</text>
    <text x="${padL}" y="${h - 4}" font-size="11" fill="var(--ink-2)">${esc(day(series[0][0]))}</text>
    <text x="${w - padR}" y="${h - 4}" text-anchor="end" font-size="11" fill="var(--ink-2)">${esc(day(series.at(-1)[0]))}</text>
  </svg>`);
}

/** Barres mensuelles revenus / dépenses. */
export function incomeExpenseBars(months, { w = 340, h = 150, labelOf } = {}) {
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expenses]));
  const n = months.length;
  const slot = (w - 8) / n;
  const bw = Math.min(12, slot / 3);
  const base = h - 22;
  const bars = months.map((m, i) => {
    const cx = 4 + slot * i + slot / 2;
    const hi = (m.income / max) * (base - 8);
    const he = (m.expenses / max) * (base - 8);
    return `<rect x="${(cx - bw - 1).toFixed(1)}" y="${(base - hi).toFixed(1)}" width="${bw}" height="${hi.toFixed(1)}" rx="3" fill="var(--pos)"/>
      <rect x="${(cx + 1).toFixed(1)}" y="${(base - he).toFixed(1)}" width="${bw}" height="${he.toFixed(1)}" rx="3" fill="var(--ink)"/>
      <text x="${cx.toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${esc(labelOf(m))}</text>`;
  });
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Revenus et dépenses par mois">
    <line x1="0" x2="${w}" y1="${base}" y2="${base}" stroke="var(--line)"/>${bars.join('')}</svg>`);
}

/** Anneau de répartition. parts : [{ value, color }] */
export function donut(parts, { size = 132, stroke = 18, center = '' } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = parts.map(p => {
    const len = (p.value / total) * c;
    const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${stroke}" stroke-dasharray="${Math.max(len - 2, 0.1)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    off += len;
    return s;
  });
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${arcs.join('')}${center}</svg>`);
}
