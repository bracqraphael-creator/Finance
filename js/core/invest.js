// Investissements : plans d'investissement, exposition réelle des ETF (pays, secteurs), récapitulatif fiscal, synthèse.
import { portfolio } from './portfolio.js';
import { todayISO, savingsRate, monthOf } from './analytics.js';
import { safetyCushion, debtAnalysis } from './debt.js';

const DAY = 864e5;
const dnum = d => Date.parse(d.slice(0, 10) + 'T00:00:00Z') / DAY;
const up = s => String(s || '').toUpperCase();
const isCrypto = (p, state) => up(state?.securities?.[p.isin]?.assetClass || p.assetClass) === 'CRYPTO';
const isPrivate = p => /^XTR/.test(p.isin) || up(p.assetClass) === 'PRIVATE_FUND';
const isBond = p => up(p.assetClass) === 'BOND';
const isGold = p => /\bGOLD\b|\bOR PHYSIQUE\b|PHYSICAL GOLD/.test(up(p.name));

// ---------- Composition des grands indices ----------
// Poids en %, d'après les fiches des fournisseurs d'indices. « approx » : ordre de grandeur, à titre indicatif.
const T = 'Technologie', F = 'Finance', I = 'Industrie', H = 'Santé', CD = 'Consommation cyclique', CO = 'Communication',
  CS = 'Consommation de base', E = 'Énergie', M = 'Matériaux', U = 'Services publics', RE = 'Immobilier';
export const SECTORS = [T, F, I, H, CD, CO, CS, E, M, U, RE];

export const INDEXES = [
  { id: 'sp500it', label: 'S&P 500 Technologie', match: /S&P ?500 INFO|S&P ?500 INFORMATION|SP ?500 INFO|S&P ?500 IT\b|TECHNOLOGY SELECT/, asOf: '2026-10',
    countries: { 'États-Unis': 100 }, sectors: { [T]: 100 } },
  { id: 'worldit', label: 'MSCI World Technologie', match: /WORLD INFORMATION TECH|WORLD INFO TECH|WORLD IT\b/, asOf: '2026-09',
    countries: { 'États-Unis': 90.7, 'Autres pays développés': 9.3 }, sectors: { [T]: 100 } },
  { id: 'nasdaq', label: 'Nasdaq 100', match: /NASDAQ/, asOf: '2026', approx: true,
    countries: { 'États-Unis': 97, 'Autres pays développés': 3 }, sectors: { [T]: 60, [CO]: 15, [CD]: 13, [H]: 5, [CS]: 4, [I]: 3 } },
  { id: 'sp500', label: 'S&P 500', match: /S&P ?500|SP ?500|S\+P ?500/, asOf: '2026-10',
    countries: { 'États-Unis': 100 },
    sectors: { [T]: 38.7, [F]: 11.8, [H]: 9.7, [CD]: 9.1, [CO]: 8.9, [I]: 8.0, [CS]: 4.6, [E]: 3.8, [U]: 2.1, [RE]: 1.7, [M]: 1.6 } },
  { id: 'em', label: 'MSCI Emerging Markets', match: /EMERGING|EMERGENTS|\bEM\b|MSCI EM/, asOf: '2026-09',
    countries: { 'Taïwan': 28.9, 'Corée du Sud': 21.4, 'Chine': 19.8, 'Inde': 10.7, 'Brésil': 4.1, 'Autres émergents': 15.1 },
    sectors: { [T]: 43.8, [F]: 19.4, [CD]: 7.4, [I]: 6.3, [CO]: 5.9, [M]: 5.8, [E]: 3.4, [H]: 2.7, [CS]: 2.6, [U]: 1.9, [RE]: 0.9 } },
  { id: 'world', label: 'MSCI World', match: /MSCI WORLD|PEA MONDE|\bWORLD\b|\bMONDE\b|ACWI|ALL-WORLD|ALL WORLD/, asOf: '2026-09',
    countries: { 'États-Unis': 72.9, 'Japon': 5.9, 'Royaume-Uni': 3.4, 'Canada': 3.3, 'France': 2.2, 'Autres pays développés': 12.2 },
    sectors: { [T]: 31.8, [F]: 15.7, [I]: 10.8, [H]: 9.2, [CD]: 8.4, [CO]: 8.3, [CS]: 4.8, [E]: 4.0, [M]: 3.2, [U]: 2.3, [RE]: 1.5 } },
  { id: 'cac40', label: 'CAC 40', match: /CAC ?40/, asOf: '2026', approx: true,
    countries: { 'France': 100 }, sectors: { [CD]: 22, [I]: 21, [F]: 12, [H]: 10, [CS]: 9, [M]: 8, [E]: 7, [T]: 5, [U]: 3, [CO]: 2, [RE]: 1 } },
  { id: 'europe', label: 'STOXX Europe 600', match: /STOXX EUROPE 600|STOXX 600|STOXX EUROPE|MSCI EUROPE|EURO STOXX|\bEUROPE\b/, asOf: '2026', approx: true,
    countries: { 'Royaume-Uni': 22, 'France': 16, 'Allemagne': 14, 'Suisse': 14, 'Pays-Bas': 7, 'Suède': 5, 'Danemark': 4, 'Italie': 4.5, 'Espagne': 4.5, 'Autres Europe': 9 },
    sectors: { [F]: 23, [I]: 18, [H]: 14, [CS]: 9, [CD]: 8, [T]: 7, [M]: 5, [E]: 5, [U]: 5, [CO]: 4, [RE]: 2 } },
  { id: 'defence', label: 'Défense (thématique)', match: /DEFEN[CS]E|AEROSPACE|DEFENSE/, asOf: '2026', approx: true,
    countries: { 'États-Unis': 45, 'France': 12, 'Allemagne': 10, 'Royaume-Uni': 10, 'Italie': 5, 'Suède': 5, 'Autres pays développés': 13 },
    sectors: { [I]: 85, [T]: 15 } },
];

const COUNTRY = {
  US: 'États-Unis', FR: 'France', DE: 'Allemagne', NL: 'Pays-Bas', GB: 'Royaume-Uni', CH: 'Suisse', IE: 'Irlande', JP: 'Japon',
  CA: 'Canada', IT: 'Italie', ES: 'Espagne', BE: 'Belgique', DK: 'Danemark', SE: 'Suède', FI: 'Finlande', NO: 'Norvège',
  AT: 'Autriche', PT: 'Portugal', LU: 'Luxembourg', TW: 'Taïwan', KR: 'Corée du Sud', CN: 'Chine', HK: 'Chine', IN: 'Inde',
  BR: 'Brésil', AU: 'Australie',
};
const EUROPE = new Set(['France', 'Allemagne', 'Pays-Bas', 'Royaume-Uni', 'Suisse', 'Irlande', 'Italie', 'Espagne', 'Belgique', 'Danemark', 'Suède', 'Finlande', 'Norvège', 'Autriche', 'Portugal', 'Luxembourg', 'Autres Europe']);
const EMERGING = new Set(['Taïwan', 'Corée du Sud', 'Chine', 'Inde', 'Brésil', 'Autres émergents']);
export function regionOf(country) {
  if (country === 'États-Unis') return 'États-Unis';
  if (EUROPE.has(country)) return 'Europe';
  if (EMERGING.has(country)) return 'Pays émergents';
  if (country === 'Japon') return 'Japon';
  return 'Autres';
}
// Pays de l'Espace économique européen : actions éligibles au PEA
const EEA = new Set(['FR', 'DE', 'NL', 'IT', 'ES', 'BE', 'DK', 'SE', 'FI', 'NO', 'AT', 'PT', 'LU', 'IE', 'GR', 'PL', 'CZ', 'IS', 'LI', 'EE', 'LV', 'LT', 'SK', 'SI', 'HU', 'RO', 'BG', 'HR', 'CY', 'MT']);

// Secteur des actions les plus courantes (nom du titre)
const STOCK_SECTORS = [
  [T, /NVIDIA|APPLE|MICROSOFT|ASML|\bSAP\b|BROADCOM|ADVANCED MICRO|\bAMD\b|INTEL|TAIWAN SEMI|TSMC|ORACLE|SALESFORCE|PALANTIR|CAPGEMINI|DASSAULT SYST|STMICRO|INFINEON|ADOBE|QUALCOMM|MICRON|SOITEC/],
  [CO, /ALPHABET|GOOGLE|META PLATFORMS|NETFLIX|\bORANGE\b|VIVENDI|DEUTSCHE TELEKOM|PUBLICIS|SPOTIFY|UNIVERSAL MUSIC/],
  [CD, /AMAZON|TESLA|LVMH|HERMES|KERING|STELLANTIS|RENAULT|MERCEDES|\bBMW\b|VOLKSWAGEN|FERRARI|NIKE|MCDONALD|ACCOR|\bBYD\b|MICHELIN/],
  [F, /CREDIT AGRICOLE|BNP|SOCIETE GENERALE|\bAXA\b|ALLIANZ|JPMORGAN|BERKSHIRE|\bVISA\b|MASTERCARD|PAYPAL|GOLDMAN|ING GROEP|UNICREDIT|SANTANDER|AMUNDI|EURAZEO|EDENRED|WORLDLINE/],
  [H, /SANOFI|NOVO.?NORDISK|ESSILOR|LILLY|PFIZER|JOHNSON & JOHNSON|\bMERCK\b|ROCHE|NOVARTIS|ASTRAZENECA|MCKESSON|UNITEDHEALTH|ABBVIE|BIOMERIEUX|EUROFINS|IPSEN|SIEMENS HEALTH/],
  [I, /SIEMENS|SCHNEIDER|SAFRAN|AIRBUS|THALES|VINCI|LEGRAND|SAINT.?GOBAIN|DASSAULT AVIATION|RHEINMETALL|BOEING|LOCKHEED|CATERPILLAR|GENERAL ELECTRIC|BOUYGUES|ALSTOM|BUREAU VERITAS|EIFFAGE|HENSOLDT|LEONARDO|BAE SYSTEMS|EXAIL|\bRENK\b/],
  [CS, /L.?OREAL|DANONE|PERNOD|CARREFOUR|NESTLE|UNILEVER|COCA|PEPSI|PROCTER|WALMART|COSTCO|AB INBEV/],
  [E, /TOTALENERGIES|EXXON|CHEVRON|\bSHELL\b|\bBP\b|\bENI\b|EQUINOR|URANIUM|CAMECO/],
  [M, /AIR LIQUIDE|ARCELOR|CONSTELLIUM|LINDE|BASF|ARKEMA|IMERYS|ERAMET|RIO TINTO|\bBHP\b/],
  [U, /ENGIE|\bEDF\b|VEOLIA|IBERDROLA|\bENEL\b|E\.ON|\bRWE\b|NEXTERA/],
  [RE, /UNIBAIL|GECINA|KLEPIERRE|COVIVIO|PROLOGIS|REALTY INCOME/],
];
// Secteurs Finnhub (anglais) → secteurs de Pécule
const FINNHUB_SECTORS = [[T, /semiconductor|technology|software|electronic/i], [CO, /media|telecom|communication/i], [F, /bank|insurance|financial/i], [H, /pharma|health|biotech|life science|medical/i], [I, /aerospace|defense|machinery|industrial|construction|electrical|logistics|airline/i], [CD, /auto|retail|textile|apparel|hotel|restaurant|consumer/i], [CS, /food|beverage|tobacco/i], [E, /energy|oil|gas|coal/i], [M, /chemical|metal|mining|paper|material/i], [U, /utilit/i], [RE, /real estate/i]];

export function indexFor(name) {
  const n = up(name);
  return INDEXES.find(ix => ix.match.test(n)) || null;
}
export function stockSector(state, p) {
  const n = up(p.name);
  for (const [sec, re] of STOCK_SECTORS) if (re.test(n)) return sec;
  const sec = state.securities?.[p.isin];
  // Secteur Finnhub : saisi via le profil de l'entreprise (onglet du titre) quand une clé est configurée
  const ind = sec?.industry || (sec?.finnhub && state.market?.['metric:' + sec.finnhub]?.data?.industry);
  if (ind) for (const [sec, re] of FINNHUB_SECTORS) if (re.test(ind)) return sec;
  return null;
}
export const countryOfIsin = isin => COUNTRY[String(isin).slice(0, 2)] || 'Autres pays développés';
/** Année d'échéance d'une obligation d'après son nom (« FRANKREICH 21/72 » → 2072). */
export function bondMaturity(name) {
  const m = String(name).match(/(\d{2})\/(\d{2})\s*$/) || String(name).match(/\b(20\d{2})\s*$/);
  if (!m) return null;
  return m[2] ? 2000 + Number(m[2]) : Number(m[1]);
}

/** Classe d'actif « économique » d'une ligne (l'or et le non coté sont mis à part). */
export function economicClass(state, p) {
  if (isCrypto(p, state)) return 'Crypto';
  if (isPrivate(p)) return 'Non coté';
  if (isGold(p)) return 'Or';
  if (isBond(p)) return 'Obligations';
  return 'Actions';
}

/**
 * Exposition réelle : ce que contiennent vos ETF, ligne par ligne, rapporté à la valeur de chaque ligne.
 * Pays et secteurs sont calculés sur la seule partie « actions ».
 */
export function exposure(state, today = todayISO(), pf = portfolio(state, today)) {
  const classes = {}, countries = {}, sectors = {}, regions = {};
  let equity = 0, unknownCountry = 0, unknownSector = 0;
  const used = new Map();
  const lines = [];
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  for (const p of pf.open) {
    const v = p.value;
    if (v <= 0) continue;
    const cls = economicClass(state, p);
    add(classes, cls, v);
    const line = { isin: p.isin, name: p.name, value: v, cls, index: null };
    lines.push(line);
    if (cls !== 'Actions') continue;
    equity += v;
    const ix = up(p.assetClass) === 'STOCK' ? null : indexFor(p.name);
    if (ix) {
      line.index = ix;
      used.set(ix.id, ix);
      for (const [c, w] of Object.entries(ix.countries)) { add(countries, c, (v * w) / 100); add(regions, regionOf(c), (v * w) / 100); }
      const sw = Object.values(ix.sectors).reduce((s, x) => s + x, 0);
      for (const [c, w] of Object.entries(ix.sectors)) add(sectors, c, (v * w) / sw);
    } else if (up(p.assetClass) === 'STOCK') {
      const c = countryOfIsin(p.isin);
      add(countries, c, v); add(regions, regionOf(c), v);
      const sec = stockSector(state, p);
      if (sec) add(sectors, sec, v); else { add(sectors, 'Non renseigné', v); unknownSector += v; }
      line.stock = true;
    } else {
      add(countries, 'Non ventilé', v); add(regions, 'Non ventilé', v); add(sectors, 'Non ventilé', v);
      unknownCountry += v; unknownSector += v;
    }
  }
  const total = Object.values(classes).reduce((s, x) => s + x, 0);
  const sorted = o => Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v > 0).sort((a, b) => (/^Non |^Autres/.test(a[0]) - /^Non |^Autres/.test(b[0])) || b[1] - a[1]);
  return {
    total, equity,
    classes: sorted(classes), countries: sorted(countries), sectors: sorted(sectors), regions: sorted(regions),
    share: (o, k) => (equity ? (o[k] || 0) / equity : 0),
    raw: { countries, sectors, regions, classes },
    unknownCountry, unknownSector,
    sources: [...used.values()],
    lines,
  };
}

// ---------- Plans d'investissement ----------

function frequency(gap) {
  if (gap == null) return { label: 'chaque mois', days: 30.4 };
  if (gap <= 9) return { label: 'chaque semaine', days: 7 };
  if (gap <= 18) return { label: 'toutes les deux semaines', days: 15.2 };
  if (gap <= 40) return { label: 'chaque mois', days: 30.4 };
  if (gap <= 70) return { label: 'tous les deux mois', days: 60.8 };
  return { label: 'chaque trimestre', days: 91.3 };
}

/**
 * Plans d'investissement : exécutions marquées « plan » par Trade Republic, ou, à défaut,
 * achats du même titre au moins 3 mois de suite pour un montant proche.
 */
export function plans(state, today = todayISO(), pf = portfolio(state, today)) {
  const buys = state.trades.filter(t => t.kind === 'buy');
  const marked = buys.some(t => t.source === 'SAVINGS_PLAN');
  const groups = new Map();
  for (const t of buys) {
    if (marked && t.source !== 'SAVINGS_PLAN') continue;
    const k = `${t.isin}|${t.wrapper || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const list = [];
  for (const [k, ts] of groups) {
    ts.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!marked) {
      const months = new Set(ts.map(t => monthOf(t.date)));
      if (months.size < 3) continue;
      const amts = ts.map(t => -t.amount).sort((a, b) => a - b);
      const med = amts[Math.floor(amts.length / 2)];
      if (amts.some(a => Math.abs(a - med) / med > 0.2)) continue;
    }
    const gaps = ts.slice(1).map((t, i) => dnum(t.date) - dnum(ts[i].date)).filter(g => g > 3).sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const f = frequency(gap);
    const last = ts.at(-1);
    const amount = -last.amount;
    const active = dnum(today) - dnum(last.date) <= f.days * 1.5 + 5;
    const pos = pf.positions.find(p => p.isin === last.isin);
    list.push({
      key: k, isin: last.isin, name: pos?.name || last.name, wrapper: last.wrapper || null,
      amount, frequency: f.label,
      monthly: Math.round((amount * 30.4) / f.days),
      first: ts[0].date, last: last.date,
      next: active ? new Date((dnum(last.date) + f.days) * DAY).toISOString().slice(0, 10) : null,
      count: ts.length,
      invested: ts.reduce((s, t) => s - t.amount, 0),
      active,
      value: pos?.value ?? null, latentPct: pos?.shares ? pos.latentPct : null,
      heuristic: !marked,
    });
  }
  list.sort((a, b) => b.active - a.active || b.monthly - a.monthly || a.name.localeCompare(b.name));
  const active = list.filter(p => p.active);
  return { list, active, stopped: list.filter(p => !p.active), monthly: active.reduce((s, p) => s + p.monthly, 0), heuristic: !marked && list.length > 0 };
}

// ---------- Récapitulatif fiscal ----------

/** Taux du prélèvement forfaitaire unique (« flat tax ») : 12,8 % d'impôt + prélèvements sociaux (18,6 % depuis 2026). */
export const pfuRate = year => (year >= 2026 ? 0.314 : 0.3);
export const psRate = year => (year >= 2026 ? 0.186 : 0.172);

export function taxYears(state) {
  const ys = new Set();
  for (const t of state.trades) if (t.kind === 'sell' || t.kind === 'dividend') ys.add(Number(t.date.slice(0, 4)));
  for (const t of state.transactions) if (t.categoryId === 'placements-revenus') ys.add(Number(t.date.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
}

export function envelopeOf(state, t) {
  const cls = up(state.securities?.[t.isin]?.assetClass || t.assetClass);
  if (cls === 'CRYPTO') return 'crypto';
  return t.wrapper === 'PEA' ? 'pea' : 'cto';
}

/** Revenus et plus-values d'une année, par enveloppe (compte-titres, PEA, crypto), avec un impôt estimé. */
export function taxSummary(state, year, today = todayISO()) {
  const pf = portfolio(state, today);
  const env = () => ({ dividends: 0, interest: 0, gains: 0, losses: 0, sales: 0, withheld: 0, lines: [] });
  const out = { year, cto: env(), pea: env(), crypto: env(), livrets: 0, cashInterest: 0, incomplete: false };
  const y = String(year);
  for (const t of state.trades) {
    if (!t.date.startsWith(y)) continue;
    const e = out[envelopeOf(state, t)];
    if (t.kind === 'dividend') {
      const interest = /INTEREST/.test(up(t.source)) || up(t.assetClass) === 'BOND';
      const gross = t.gross && t.gross > t.amount ? t.gross : t.amount;
      if (interest) e.interest += gross; else e.dividends += gross;
      e.withheld += -(t.tax || 0);
      e.lines.push({ date: t.date, name: t.name, kind: interest ? 'Intérêts' : 'Dividende', amount: gross });
    } else if (t.kind === 'sell') {
      const r = pf.positions.realizedBy.get(t);
      if (!r) continue;
      if (r.known < 0.999) out.incomplete = true;
      if (r.realized >= 0) e.gains += r.realized; else e.losses += -r.realized;
      e.sales += t.amount;
      e.withheld += -(t.tax || 0);
      e.lines.push({ date: t.date, name: t.name, kind: r.realized >= 0 ? 'Plus-value' : 'Moins-value', amount: r.realized, partial: r.known < 0.999 });
    }
  }
  // Intérêts hors titres : livrets (souvent exonérés) et compte espèces du courtier (imposables)
  for (const t of state.transactions) {
    if (t.categoryId !== 'placements-revenus' || !t.date.startsWith(y) || t.amount <= 0 || t.meta?.isin) continue;
    const a = state.accounts.find(x => x.id === t.accountId);
    if (a?.type === 'livret') out.livrets += t.amount;
    else if (a && a.type !== 'titres') { out.cashInterest += t.amount; out.cto.interest += t.amount; out.cto.lines.push({ date: t.date, name: a.name, kind: 'Intérêts', amount: t.amount }); }
  }
  const rate = pfuRate(year);
  const c = out.cto;
  c.netGains = c.gains - c.losses;
  c.taxable = c.dividends + c.interest + Math.max(0, c.netGains);
  c.estimatedTax = Math.round(c.taxable * rate);
  // Crypto : exonéré si le total des ventes de l'année ne dépasse pas 305 €
  const k = out.crypto;
  k.netGains = k.gains - k.losses;
  k.exempt = k.sales <= 30500;
  k.taxable = k.exempt ? 0 : Math.max(0, k.netGains);
  k.estimatedTax = Math.round(k.taxable * rate);
  const p = out.pea;
  p.netGains = p.gains - p.losses;
  out.rate = rate;
  out.ps = psRate(year);
  out.totalTax = c.estimatedTax + k.estimatedTax;
  for (const e of [c, p, k]) e.lines.sort((a, b) => (a.date < b.date ? 1 : -1));
  // Date d'ouverture du PEA (premier mouvement connu) : l'horloge des 5 ans démarre au premier versement
  const peaDates = state.trades.filter(t => t.wrapper === 'PEA').map(t => t.date)
    .concat(state.transactions.filter(t => /PEA/i.test(state.accounts.find(a => a.id === t.accountId)?.name || '')).map(t => t.date)).sort();
  out.peaSince = peaDates[0] || null;
  return out;
}

// ---------- Synthèse ----------

const pctTxt = v => `${Math.round(v * 100)} %`;
const eur = c => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: c % 100 === 0 || c >= 100000 ? 0 : 2, maximumFractionDigits: c >= 100000 ? 0 : 2 });

/**
 * Synthèse du portefeuille : chiffres clés, constats et pistes à regarder en priorité.
 * Ce sont des repères généraux calculés sur vos relevés, pas des conseils personnalisés.
 */
export function synthese(state, today = todayISO()) {
  const pf = portfolio(state, today);
  if (!pf.open.length) return null;
  const t = pf.totals;
  const ex = exposure(state, today, pf);
  const pl = plans(state, today, pf);
  const sr = savingsRate(state, today);
  const cushion = safetyCushion(state, today);
  const debt = debtAnalysis(state, today);
  const tax = taxSummary(state, Number(today.slice(0, 4)), today);
  const total = t.value || 1;
  const cls = Object.fromEntries(ex.classes);
  const share = k => (cls[k] || 0) / total;
  const us = ex.equity ? (ex.raw.countries['États-Unis'] || 0) / ex.equity : 0;
  const tech = ex.equity ? (ex.raw.sectors[T] || 0) / ex.equity : 0;
  const top = pf.open[0];
  const topShare = top.value / total;
  const monthlySave = sr.months ? Math.round((sr.income - sr.expenses) / sr.months) : null;
  const stocks = pf.open.filter(p => up(p.assetClass) === 'STOCK');
  const stockShare = stocks.reduce((s, p) => s + p.value, 0) / total;
  const small = pf.open.filter(p => p.value < Math.max(5000, total * 0.02));

  const key = [
    { k: 'Lignes', v: String(pf.open.length), s: `${small.length} de moins de ${eur(Math.max(5000, total * 0.02))}` },
    { k: 'Plans actifs', v: pl.active.length ? `${eur(Math.round(pl.monthly / 100) * 100)}` : '—', s: pl.active.length ? `par mois, ${pl.active.length} plan${pl.active.length > 1 ? 's' : ''}` : 'aucun plan détecté' },
    { k: 'Actions américaines', v: ex.equity ? pctTxt(us) : '—', s: 'de la partie actions' },
    { k: 'Technologie', v: ex.equity ? pctTxt(tech) : '—', s: 'de la partie actions' },
    { k: 'Plus grosse ligne', v: pctTxt(topShare), s: top.name.length > 26 ? top.name.slice(0, 25) + '…' : top.name },
    { k: 'Épargne disponible', v: cushion.months == null ? '—' : `${cushion.months.toFixed(1).replace('.', ',')} mois`, s: 'de dépenses' },
  ];

  // Constats : ce que montrent les chiffres, sans jugement
  const facts = [];
  facts.push(`${pf.open.length} lignes pour ${eur(t.value)} : ${ex.classes.map(([k, v]) => `${k.toLowerCase()} ${pctTxt(v / total)}`).join(', ')}.`);
  if (ex.equity) facts.push(`Une fois les ETF « ouverts », vos actions sont à ${pctTxt(us)} américaines${ex.raw.regions['Europe'] ? `, ${pctTxt((ex.raw.regions['Europe'] || 0) / ex.equity)} européennes` : ''}${ex.raw.regions['Pays émergents'] ? ` et ${pctTxt((ex.raw.regions['Pays émergents'] || 0) / ex.equity)} dans les pays émergents` : ''}.`);
  if (pl.active.length) facts.push(`${pl.active.length} plan${pl.active.length > 1 ? 's' : ''} d'investissement actif${pl.active.length > 1 ? 's' : ''} pour ${eur(pl.monthly)} par mois${monthlySave != null && monthlySave > 0 ? `, soit ${pctTxt(pl.monthly / monthlySave)} de ce que vous mettez de côté en moyenne` : ''}.`);
  if (tax.peaSince) {
    const five = String(Number(tax.peaSince.slice(0, 4)) + 5) + tax.peaSince.slice(4);
    facts.push(`PEA ouvert au plus tard le ${new Date(tax.peaSince + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} : ses gains seront exonérés d'impôt sur le revenu à partir du ${new Date(five + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} (les prélèvements sociaux restent dus).`);
  }
  if (t.dividends > 0) facts.push(`${eur(t.dividends)} de dividendes et intérêts reçus sur la période importée.`);

  // Pistes à regarder, par priorité (1 = d'abord)
  const pistes = [];
  const P = (prio, id, title, why, look) => pistes.push({ prio, id, title, why, look });

  if (cushion.months != null && cushion.months < 3) {
    P(1, 'precaution', 'Consolider l\'épargne de précaution',
      `Votre argent disponible (comptes et livrets) couvre ${cushion.months.toFixed(1).replace('.', ',')} mois de dépenses. Un imprévu pourrait vous obliger à vendre des titres au mauvais moment.`,
      ['Viser 3 à 6 mois de dépenses sur des livrets avant d\'augmenter les plans', 'Le Livret A et le LDDS restent disponibles à tout moment et sans impôt']);
  }
  if (debt.ratio != null && debt.ratio > 0.35) {
    P(1, 'dette', 'Taux d\'endettement au-dessus de 35 %', `Vos crédits représentent ${pctTxt(debt.ratio)} de vos revenus réguliers.`, ['Comparer le taux de vos crédits au rendement attendu de vos placements', 'Voir l\'onglet Crédits pour l\'ordre de remboursement']);
  }
  if (pl.active.length && monthlySave != null && pl.monthly > Math.max(0, monthlySave) * 0.9) {
    P(cushion.months != null && cushion.months >= 6 ? 2 : 1, 'plans-capacite', 'Vos plans pèsent lourd dans votre budget',
      monthlySave > 0 ? `Vos plans prélèvent ${eur(pl.monthly)} par mois alors que vous mettez de côté ${eur(monthlySave)} en moyenne : ils puisent dans votre épargne disponible.` : `Vos plans prélèvent ${eur(pl.monthly)} par mois alors que vos dépenses ont dépassé vos revenus ces derniers mois.`,
      ['Ajuster le montant des plans à ce qui reste vraiment chaque mois', 'Regarder l\'échéancier pour la date du prélèvement']);
  }
  // Chevauchement : plusieurs ETF qui contiennent les mêmes grandes entreprises américaines
  const usIdx = new Set(ex.lines.filter(l => l.index && ['world', 'sp500', 'sp500it', 'nasdaq', 'worldit'].includes(l.index.id)).map(l => l.index.id));
  const usTechStocks = stocks.filter(p => countryOfIsin(p.isin) === 'États-Unis' && stockSector(state, p) === T);
  if (usIdx.size >= 2 || (usIdx.size && usTechStocks.length)) {
    const names = ex.lines.filter(l => l.index && usIdx.has(l.index.id)).map(l => l.index.label);
    P(2, 'chevauchement', 'Des ETF qui se recoupent',
      `${[...new Set(names)].join(', ')}${usTechStocks.length ? ` et ${usTechStocks.map(p => p.name).join(', ')}` : ''} contiennent en grande partie les mêmes grandes entreprises américaines. Les accumuler renforce la même exposition sans ajouter de diversification.`,
      ['Comparer leurs principales lignes (Apple, NVIDIA, Microsoft…) sur leurs fiches', 'Se demander si chaque ligne a un rôle distinct dans le portefeuille']);
  }
  if (ex.equity && (us > 0.7 || tech > 0.35)) {
    P(2, 'concentration', tech > 0.35 ? 'Forte exposition à la technologie' : 'Forte exposition aux États-Unis',
      `Partie actions : ${pctTxt(us)} aux États-Unis et ${pctTxt(tech)} dans la technologie (contre environ 73 % et 32 % pour le MSCI World). Le portefeuille dépend beaucoup d'un même marché et d'un même secteur.`,
      ['Voir la répartition par pays et par secteur ci-dessous', 'Le poids de l\'Europe ou des émergents est un levier si vous voulez rééquilibrer']);
  }
  if (pf.open.length >= 10 && (small.length >= pf.open.length / 2)) {
    P(2, 'dispersion', 'Beaucoup de petites lignes',
      `${small.length} lignes sur ${pf.open.length} pèsent moins de ${eur(Math.max(5000, total * 0.02))}. Elles sont difficiles à suivre et changent peu le résultat global : un ETF monde contient déjà ces entreprises.`,
      ['Regrouper les petits plans sur moins de lignes', 'Garder les actions individuelles pour des convictions que vous suivez vraiment']);
  }
  // Titres éligibles au PEA détenus dans le compte-titres (fiscalité moins favorable)
  const peaEligible = pf.open.filter(p => {
    const w = p.trades.every(x => x.wrapper === 'PEA');
    if (w || isCrypto(p, state) || isPrivate(p) || isBond(p)) return false;
    if (up(p.assetClass) === 'STOCK') return EEA.has(p.isin.slice(0, 2));
    return /\bPEA\b/.test(up(p.name));
  });
  if (peaEligible.length) {
    P(2, 'pea', 'Des titres qui pourraient aller dans le PEA',
      `${peaEligible.map(p => p.name).join(', ')} ${peaEligible.length > 1 ? 'sont éligibles' : 'est éligible'} au PEA mais ${peaEligible.length > 1 ? 'sont détenus' : 'est détenu'} sur le compte-titres, où dividendes et plus-values sont taxés à ${pctTxt(pfuRate(Number(today.slice(0, 4))))} chaque année. Dans un PEA de plus de 5 ans, seuls les prélèvements sociaux s'appliquent.`,
      ['Faire les prochains achats de ces titres dans le PEA plutôt que les vendre (une vente déclenche l\'impôt)', 'Les ETF « PEA » répliquent aussi le MSCI World ou le S&P 500']);
  }
  if (share('Non coté') > 0.1) {
    P(2, 'non-cote', 'Une part importante en non coté',
      `${pctTxt(share('Non coté'))} du portefeuille est investi en Private Markets. Ce type de fonds se revend difficilement et rapidement, ses frais sont plus élevés et sa valeur est publiée rarement.`,
      ['Vérifier les conditions et délais de sortie', 'Le garder pour de l\'argent dont vous n\'aurez pas besoin avant plusieurs années']);
  }
  if (share('Or') > 0.15) {
    P(2, 'or', 'Une part d\'or élevée',
      `L'or représente ${pctTxt(share('Or'))} du portefeuille. Il peut amortir certaines crises, mais ne verse ni dividende ni intérêt : sur longue période il rapporte en général moins que les actions.`,
      ['Décider d\'une part cible (souvent entre 5 et 10 %) et s\'y tenir', 'Revoir le plan sur l\'or si la part continue de monter']);
  }
  for (const p of pf.open.filter(isBond)) {
    const mat = bondMaturity(p.name);
    const now = Number(today.slice(0, 4));
    if (mat && mat - now >= 20) {
      P(2, 'obligation-longue', `Obligation à très long terme (${mat})`,
        `${p.name} n'arrive à échéance qu'en ${mat}. Le prix de ce type d'obligation varie fortement avec les taux : une hausse des taux d'un point peut faire perdre de l'ordre de 20 à 30 % de sa valeur avant l'échéance.`,
        ['Vérifier son taux (coupon) et son rendement à l\'achat', 'Garder en tête qu\'il faut la conserver jusqu\'en ' + mat + ' pour être sûr de récupérer le nominal']);
    }
  }
  if (share('Crypto') > 0.1) {
    P(2, 'crypto', 'Part de crypto élevée', `Les cryptomonnaies représentent ${pctTxt(share('Crypto'))} du portefeuille. Elles peuvent perdre plus de 50 % en quelques mois.`, ['Limiter à ce que vous accepteriez de perdre en grande partie']);
  }
  if (stockShare > 0.3 && stocks.length) {
    P(3, 'actions', 'Les actions en direct demandent du suivi', `${pctTxt(stockShare)} du portefeuille est en actions individuelles (${stocks.length}). Une seule entreprise peut chuter fortement, ce qu'un ETF dilue.`, ['Suivre leurs résultats et actualités (onglet Actualités)']);
  }
  if (topShare > 0.3 && pf.open.length > 1 && !indexFor(top.name)) {
    P(2, 'ligne', `${top.name} pèse ${pctTxt(topShare)} du portefeuille`, 'Une seule ligne non diversifiée porte une grande part du résultat.', ['Fixer un poids maximum par ligne et rééquilibrer au besoin']);
  }
  // Frais : achats ponctuels à 1 € pour de petits montants
  const oneOff = state.trades.filter(x => x.kind === 'buy' && x.source !== 'SAVINGS_PLAN' && x.fee < 0 && -x.amount < 10000);
  if (oneOff.length >= 3) {
    const fees = -oneOff.reduce((s, x) => s + x.fee, 0), amt = -oneOff.reduce((s, x) => s + x.amount, 0);
    P(3, 'frais', 'Frais sur les petits achats', `${oneOff.length} achats ponctuels de moins de 100 € ont coûté ${eur(fees)} de frais, soit ${pctTxt(fees / amt)} des montants investis. Les plans d'investissement Trade Republic sont sans frais.`, ['Passer par un plan pour les achats réguliers', 'Grouper les achats ponctuels']);
  }
  if (cushion.months != null && cushion.months > 12 && cushion.liquid > 1000000) {
    P(3, 'dormant', 'Beaucoup d\'argent disponible', `Votre épargne disponible couvre ${Math.round(cushion.months)} mois de dépenses.`, ['La part au-delà de 6 mois de dépenses pourrait être placée selon vos projets et votre horizon']);
  }
  if (t.incomplete) {
    P(3, 'historique', 'Historique incomplet', 'Certaines ventes portent sur des titres achetés avant vos relevés : plus-values et rendement sont partiels.', ['Importer l\'export CSV Trade Republic depuis l\'ouverture du compte']);
  }
  if (pl.stopped.length) {
    P(3, 'plans-arretes', `${pl.stopped.length} plan${pl.stopped.length > 1 ? 's' : ''} arrêté${pl.stopped.length > 1 ? 's' : ''}`, `${pl.stopped.map(p => p.name).join(', ')} : plus d'exécution récente.`, ['Vérifier que c\'est voulu (et non un solde insuffisant au moment du prélèvement)']);
  }

  // Points forts : ce qui va déjà dans le bon sens
  const strengths = [];
  if (pl.active.length) strengths.push('Investir chaque mois par des plans lisse le prix d\'achat et évite d\'avoir à choisir le « bon moment ».');
  if (ex.lines.some(l => l.index && ['world', 'europe', 'em', 'sp500'].includes(l.index.id))) strengths.push('Des ETF larges forment le cœur du portefeuille : des centaines d\'entreprises pour des frais faibles.');
  if (tax.peaSince) strengths.push('Le PEA est ouvert : son compteur des 5 ans tourne déjà.');
  if (sr.rate != null && sr.rate >= 0.1) strengths.push(`Vous mettez de côté ${pctTxt(sr.rate)} de vos revenus.`);
  if (cushion.months != null && cushion.months >= 3) strengths.push('Votre épargne de précaution couvre au moins 3 mois de dépenses.');

  pistes.sort((a, b) => a.prio - b.prio);
  return { totals: t, key, facts, pistes, strengths, exposure: ex, plans: pl, tax, cushion, monthlySave };
}
