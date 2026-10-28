// Formats français : montants, dates, pourcentages.
import { raw, esc } from './dom.js';

const nf = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const nf0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const pf = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const MINUS = '−';

/** 123456 → « 1 234,56 € » ; signe typographique pour les négatifs. */
export function euro(cents, { sign = false, round = false } = {}) {
  const v = (cents || 0) / 100;
  // Espace insécable classique : l'espace fine n'est pas lisible dans toutes les polices
  let s = (round ? nf0 : nf).format(Math.abs(v)).replace(/\u202f/g, '\u00a0');
  if (v < 0 || Object.is(v, -0) && cents < 0) s = MINUS + s;
  else if (sign && v > 0) s = '+' + s;
  return s;
}

/** Montant coloré (vert si entrée d'argent) dans un <span class="amount">. */
export function amount(cents, { sign = true, color = true, round = false } = {}) {
  const cls = color ? (cents > 0 ? 'pos' : '') : '';
  return raw(`<span class="amount ${cls}">${esc(euro(cents, { sign, round }))}</span>`);
}

/** « 1 351 » et « ,66 € » séparés pour le grand chiffre de l'accueil. */
export function euroParts(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const ints = Math.floor(abs / 100).toLocaleString('fr-FR').replace(/\u202f/g, '\u00a0');
  const dec = String(abs % 100).padStart(2, '0');
  return { neg, ints: (neg ? MINUS : '') + ints, dec: `,${dec} €` };
}

export const pct = (v, sign = false) => (v == null ? '—' : (sign && v > 0 ? '+' : '') + pf.format(v).replace('-', MINUS));
export const qty = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 }).format(v);
export const price = v => (v == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: v < 10 ? 4 : 2 }).format(v));

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const parts = d => d.split('-').map(Number);
export function dateShort(d) {
  const [, m, j] = parts(d);
  return `${j} ${MONTHS_SHORT[m - 1]}`;
}
export function dateLong(d) {
  const [y, m, j] = parts(d);
  return `${j} ${MONTHS[m - 1]} ${y}`;
}
export function monthName(ym, withYear = true) {
  const [y, m] = parts(ym);
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}
export const monthShort = ym => MONTHS_SHORT[parts(ym)[1] - 1];
export function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** En-tête de jour dans la liste des opérations. */
export function dayLabel(d, today) {
  if (d === today) return "Aujourd'hui";
  const t = Date.parse(today), x = Date.parse(d);
  const diff = Math.round((t - x) / 864e5);
  if (diff === 1) return 'Hier';
  const [y, m, j] = parts(d);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, j)).getUTCDay()];
  const ty = Number(today.slice(0, 4));
  return capitalize(`${wd} ${j} ${MONTHS[m - 1]}${y !== ty ? ' ' + y : ''}`);
}

export function plural(n, one, many) {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
}
