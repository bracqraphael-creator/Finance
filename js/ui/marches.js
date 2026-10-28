// Onglet Bourse > Marchés et Actualités : repères économiques, crypto, sentiment, indicateurs, actualités.
import { app, registerView, registerActions, update, render } from '../app.js';
import { html, icon, toast } from './dom.js';
import { euro, pct, dateShort } from './format.js';
import { sparkline, lineChart } from './charts.js';
import { indicators, volatilityLabel } from '../core/indicators.js';
import { portfolio } from '../core/portfolio.js';
import { translate, cachedTranslation, translatedPageUrl, translationQuotaReached } from '../core/translate.js';
import { REFERENCES } from '../core/debt.js';
import {
  SOURCES, cached, isFresh, safely, loadCrypto, loadTrending, loadGlobal, loadFearGreed, loadMacro,
  loadNews, loadHoldingsNews, loadCoinChart, loadStockMetrics, finnhubSymbol, moreLinks, MACRO_SERIES,
} from '../core/market.js';

const DISCLAIMER = html`<p class="hint disclaimer">Informations à titre indicatif, pas un conseil en investissement. Les performances passées ne préjugent pas des performances futures.</p>`;
const eur = v => (v == null ? '—' : v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: v < 1 ? 4 : v < 100 ? 2 : 0 }));
const bigEur = v => (v == null ? '—' : v >= 1e12 ? `${(v / 1e12).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} billions €` : `${(v / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} milliards €`);
const pctPts = v => (v == null ? '—' : pct(v / 100, true));
const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `il y a ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};
const sourceLine = (keys, at) => html`<p class="source">Données ${keys.map((k, i) => html`${i ? ', ' : ''}<a href="${SOURCES[k].url}" target="_blank" rel="noopener noreferrer">${SOURCES[k].name}</a>`)}${at ? ` · mises à jour ${ago(Date.parse(at))}` : ''}</p>`;
const errLine = key => { const e = cached(app.state, key)?.error; return e ? html`<p class="error small">${e} <button class="link inline" data-act="mk-retry" data-key="${key}">Réessayer</button></p>` : ''; };

export const HELP_MK = {
  vol: ['Volatilité', 'Mesure l\'ampleur des variations du cours sur un an. Une volatilité de 15 % signifie que, une année sur trois environ, le cours peut s\'écarter de plus de 15 % de sa tendance. Plus elle est élevée, plus le risque est grand.'],
  mdd: ['Plus forte baisse', 'La chute la plus importante entre un plus haut et un plus bas sur la période. Elle donne une idée de ce qu\'il aurait fallu supporter.'],
  sma: ['Tendance', 'Compare le cours à sa moyenne des 200 derniers jours de cotation (environ 10 mois). Au-dessus : tendance de fond haussière. En dessous : baissière. C\'est un repère, pas une prévision.'],
  fng: ['Indice peur et avidité', 'Indice de 0 à 100 calculé chaque jour sur le marché des cryptomonnaies (volatilité, volumes, réseaux sociaux…). Proche de 0 : les investisseurs ont peur. Proche de 100 : euphorie.'],
  pe: ['PER', 'Prix de l\'action divisé par le bénéfice par action. Un PER de 20 signifie que l\'action vaut 20 années de bénéfices actuels. À comparer avec les entreprises du même secteur.'],
  beta: ['Bêta', 'Sensibilité de l\'action aux mouvements du marché. 1 : bouge comme le marché. 1,5 : bouge 50 % plus fort. 0,5 : deux fois moins.'],
  dom: ['Dominance du bitcoin', 'Part du bitcoin dans la valeur totale de toutes les cryptomonnaies.'],
};

// ---------- Chargements en arrière-plan ----------
let loading = new Set();
async function refresh(keys, force = false) {
  const s = app.state;
  const isPublic = k => /^(crypto|trending|global|fng|macro|coin:)/.test(k);
  if (!s.settings.publicMarketData) keys = keys.filter(k => !isPublic(k));
  const jobs = [];
  const want = (key, kind, fn) => {
    if (loading.has(key) || (!force && isFresh(s, key, kind))) return;
    loading.add(key);
    jobs.push(safely(s, key, fn).finally(() => loading.delete(key)));
  };
  for (const k of keys) {
    if (k === 'crypto') want('crypto', 'crypto', () => loadCrypto(s, s.market.followCoins || []));
    if (k === 'trending') want('trending', 'trending', () => loadTrending(s));
    if (k === 'global') want('global', 'global', () => loadGlobal(s));
    if (k === 'fng') want('fng', 'fng', () => loadFearGreed(s));
    if (k === 'macro') want('macro', 'macro', () => loadMacro(s));
    if (k.startsWith('coin:')) want(k, 'coin', () => loadCoinChart(s, k.slice(5)));
    if (k.startsWith('metric:')) want(k, 'metric', () => loadStockMetrics(s, k.slice(7)));
    if (k === 'news:general' || k === 'news:crypto') want(k, 'news', () => loadNews(s, k.slice(5)));
    if (k === 'news:holdings') want(k, 'news', () => loadHoldingsNews(s, portfolio(s, app.today).open));
  }
  if (!jobs.length) return;
  app.ui.mkBusy = true;
  render();
  await Promise.all(jobs);
  app.ui.mkBusy = loading.size > 0;
  if (app.state === s) update(() => {});
}

// ---------- Indicateurs d'un historique ----------
export function indicatorsBlock(history, { crypto = false, help } = {}) {
  const ind = indicators(history, { periodsPerYear: crypto ? 365 : 252 });
  if (!ind) return '';
  const pc = v => html`<span class="${v == null ? '' : v >= 0 ? 'pos' : 'neg'}">${pct(v, true)}</span>`;
  const short = ind.years < 0.95;
  return html`<h2 class="section">Indicateurs${short ? html` <span class="muted small" style="font-weight:400">sur ${Math.round(ind.years * 12)} mois d'historique</span>` : ''}</h2>
    <div class="kpis">
      <div><div class="k">1 mois</div><div class="v">${pc(ind.perf1m)}</div></div>
      <div><div class="k">${short ? '3 mois' : '1 an'}</div><div class="v">${pc(short ? ind.perf3m : ind.perf1y)}</div></div>
      <div><div class="k">Volatilité ${help('vol')}</div><div class="v">${ind.volatility == null ? '—' : pct(ind.volatility)}</div><div class="s">${volatilityLabel(ind.volatility) || ''}</div></div>
      <div><div class="k">Plus forte baisse ${help('mdd')}</div><div class="v neg">${pct(ind.maxDrawdown)}</div></div>
      <div><div class="k">Écart au plus haut</div><div class="v">${pct(ind.fromHigh)}</div><div class="s">plus haut ${eur(ind.high)}</div></div>
      <div><div class="k">Tendance ${help('sma')}</div><div class="v ${ind.aboveSma == null ? '' : ind.aboveSma ? 'pos' : 'neg'}">${ind.aboveSma == null ? '—' : ind.aboveSma ? 'Haussière' : 'Baissière'}</div><div class="s">${ind.sma ? `moyenne ${ind.smaDays} j : ${eur(ind.sma)}` : 'historique trop court'}</div></div>
    </div>`;
}

export function linksBlock(opts) {
  const links = moreLinks(opts);
  if (!links.length) return '';
  return html`<h2 class="section">Pour aller plus loin</h2><div class="group">${links.map(l => html`<a class="row plain" href="${l.url}" target="_blank" rel="noopener noreferrer"><span class="main"><span class="title">${l.label}</span></span>${icon('chev', 'chev')}</a>`)}</div>`;
}

/** Données fondamentales d'une action (Finnhub, clé gratuite). */
export function metricsBlock(symbol, help) {
  const s = app.state;
  if (!s.settings.finnhubKey || !symbol) return '';
  const key = 'metric:' + symbol;
  const c = cached(s, key);
  if (!isFresh(s, key, 'metric')) setTimeout(() => refresh([key]));
  const m = c?.data;
  if (!m) return html`<h2 class="section">L'entreprise</h2>${c?.error ? errLine(key) : html`<div class="note">Chargement des données de l'entreprise…</div>`}`;
  const n = (v, d = 1) => (v == null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: d }));
  return html`<h2 class="section">L'entreprise</h2>
    <div class="group" style="padding:4px 16px">
      ${m.industry ? html`<div class="stat-line"><span>Secteur</span><span>${m.industry}${m.country ? ` · ${m.country}` : ''}</span></div>` : ''}
      <div class="stat-line"><span>Capitalisation</span><span>${m.marketCap ? `${n(m.marketCap / 1000, 1)} milliards ${m.currency || ''}` : '—'}</span></div>
      <div class="stat-line"><span>PER ${help('pe')}</span><span class="num">${n(m.pe)}</span></div>
      <div class="stat-line"><span>Rendement du dividende</span><span class="num">${m.dividendYield == null ? '—' : `${n(m.dividendYield, 2)} %`}</span></div>
      <div class="stat-line"><span>Bêta ${help('beta')}</span><span class="num">${n(m.beta, 2)}</span></div>
      ${m.netMargin != null ? html`<div class="stat-line"><span>Marge nette</span><span class="num">${n(m.netMargin)} %</span></div>` : ''}
      ${m.revenueGrowth != null ? html`<div class="stat-line"><span>Croissance du chiffre d'affaires sur un an</span><span class="num">${n(m.revenueGrowth)} %</span></div>` : ''}
    </div>${sourceLine(['finnhub'], c.at)}`;
}

// ---------- Marchés ----------
export function marketsView(header, help, watchlist) {
  const s = app.state;
  if (s.settings.publicMarketData) setTimeout(() => refresh(['macro', 'fng', 'global', 'crypto', 'trending']));
  const macro = cached(s, 'macro')?.data;
  const fng = cached(s, 'fng')?.data;
  const glob = cached(s, 'global')?.data;
  const coins = cached(s, 'crypto')?.data || [];
  const trend = cached(s, 'trending')?.data || [];
  const follow = new Set(s.market.followCoins || []);
  const pf = portfolio(s, app.today);
  const mine = pf.open.map(p => ({ name: p.name, href: `#/bourse/${encodeURIComponent(p.isin)}`, ind: indicators(s.prices[p.isin]?.history) })).filter(x => x.ind);
  const loadingNote = html`<div class="note">${app.ui.mkBusy ? 'Chargement…' : 'Pas encore de données.'}</div>`;
  const m = (k, unit = '%') => { const x = macro?.[k]; return x ? html`<div class="v">${x.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${unit}</div><div class="s">${periodLabel(x.period)}</div>` : html`<div class="v">—</div>`; };
  const fngNow = fng?.at(-1);

  return html`${header}
    ${!s.settings.publicMarketData ? html`<div class="note">Les données de marché publiques sont désactivées. <a href="#/reglages">Les activer dans les réglages</a>.</div>` : ''}

    <h2 class="section">Repères</h2>
    <div class="kpis">
      <div><div class="k">${MACRO_SERIES.depot.label}</div>${m('depot')}</div>
      <div><div class="k">${MACRO_SERIES.inflationFR.label}</div>${m('inflationFR')}</div>
      <div><div class="k">Livret A · LEP</div><div class="v">${REFERENCES.livretA.toLocaleString('fr-FR')} % · ${REFERENCES.lep.toLocaleString('fr-FR')} %</div><div class="s">depuis le 1er août 2026</div></div>
      <div><div class="k">Crédit immobilier 20 ans</div><div class="v">${REFERENCES.mortgageRates[20].toLocaleString('fr-FR')} %</div><div class="s">moyenne d'octobre 2026</div></div>
    </div>
    ${macro?.inflationFR && macro?.depot ? html`<p class="hint">${realRateNote(macro)}</p>` : ''}
    ${errLine('macro')}${macro ? sourceLine(['ecb'], cached(s, 'macro').at) : ''}

    ${mine.length ? html`<h2 class="section">Vos titres en un coup d'œil</h2>
      <div class="group">${mine.map(x => html`<a class="row" href="${x.href}">
        <span class="main"><span class="title">${x.name}</span>
          <span class="sub">${[x.ind.aboveSma == null ? null : x.ind.aboveSma ? 'Tendance haussière' : 'Tendance baissière', x.ind.volatility != null ? `volatilité ${volatilityLabel(x.ind.volatility)}` : null].filter(Boolean).join(' · ')}</span></span>
        <span class="end"><span class="${(x.ind.perf1y ?? x.ind.perf3m) >= 0 ? 'pos' : 'neg'}">${pct(x.ind.perf1y ?? x.ind.perf3m, true)}</span><div class="sub small">${x.ind.perf1y != null ? 'sur 1 an' : 'sur 3 mois'}</div></span>
      </a>`)}</div>` : ''}

    ${watchlist}

    <h2 class="section">Cryptomonnaies</h2>
    ${glob || fngNow ? html`<div class="kpis">
      <div><div class="k">Valeur totale du marché</div><div class="v">${glob ? bigEur(glob.marketCap) : '—'}</div><div class="s ${glob?.change24h >= 0 ? 'pos' : 'neg'}">${glob ? `${pctPts(glob.change24h)} sur 24 h` : ''}</div></div>
      <div><div class="k">Sentiment ${help('fng')}</div><div class="v">${fngNow ? html`${fngNow.value} <span class="small muted">/ 100</span>` : '—'}</div><div class="s">${fngNow ? fngNow.label : ''}</div>
        ${fng ? html`<div class="fng-bar" aria-hidden="true"><i style="left:${fngNow.value}%"></i></div>` : ''}</div>
      ${glob ? html`<div><div class="k">Dominance du bitcoin ${help('dom')}</div><div class="v">${glob.btcDominance?.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</div></div>` : ''}
      ${fng?.length > 7 ? html`<div><div class="k">Sentiment sur 30 jours</div><div style="margin-top:6px">${sparkline(fng.map(d => d.value), { w: 120, h: 30, color: 'var(--brass)' })}</div></div>` : ''}
    </div>` : ''}
    ${coins.length ? html`<div class="group" style="margin-top:10px">${coins.map(c => html`<a class="row" href="#/crypto/${encodeURIComponent(c.id)}">
        <span class="badge ink" style="font-size:12px">${c.symbol.slice(0, 4)}</span>
        <span class="main"><span class="title">${follow.has(c.id) ? '★ ' : ''}${c.name}</span><span class="sub">n° ${c.rank ?? '—'} · 7 j ${pctPts(c.ch7d)}</span></span>
        ${sparkline(c.spark)}
        <span class="end"><span class="num">${eur(c.price)}</span><div class="sub small ${c.ch24h >= 0 ? 'pos' : 'neg'}">${pctPts(c.ch24h)} 24 h</div></span>
      </a>`)}</div>` : loadingNote}
    ${trend.length ? html`<h2 class="section">Les plus recherchées aujourd'hui</h2>
      <div class="chips">${trend.map(t => html`<a class="chip" href="#/crypto/${encodeURIComponent(t.id)}">${t.name}${t.ch24h != null ? html` <span class="${t.ch24h >= 0 ? 'pos' : 'neg'}">${pctPts(t.ch24h)}</span>` : ''}</a>`)}</div>
      <p class="hint">Recherches les plus nombreuses sur CoinGecko : un signe d'intérêt, pas de qualité. Beaucoup de petites cryptomonnaies sont très spéculatives.</p>` : ''}
    ${errLine('crypto')}${errLine('fng')}
    ${coins.length || fng ? sourceLine(['coingecko', 'fng'], cached(s, 'crypto')?.at) : ''}
    ${DISCLAIMER}`;
}

function periodLabel(p) {
  if (!p) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return `au ${dateShort(p)}`;
  if (/^\d{4}-\d{2}$/.test(p)) return new Date(p + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return p;
}
function realRateNote(macro) {
  const real = REFERENCES.livretA - macro.inflationFR.value;
  return real < 0
    ? `Avec une inflation de ${macro.inflationFR.value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %, le Livret A à ${REFERENCES.livretA.toLocaleString('fr-FR')} % fait perdre environ ${Math.abs(real).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % de pouvoir d'achat par an.`
    : `Le Livret A rapporte ${real.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % de plus que l'inflation.`;
}

// ---------- Actualités ----------
export function newsView(header) {
  const s = app.state;
  const hasKey = !!s.settings.finnhubKey;
  const hasStocks = portfolio(s, app.today).open.some(p => String(p.assetClass || '').toUpperCase() === 'STOCK');
  const tab = app.ui.newsTab || (hasStocks ? 'holdings' : 'general');
  const key = 'news:' + tab;
  if (hasKey) setTimeout(() => refresh([key]));
  const items = cached(s, key)?.data || [];
  if (s.settings.translateNews !== false && items.length) setTimeout(() => translateNews(items));
  const chip = (k, l) => html`<button class="chip" data-act="news-tab" data-t="${k}" aria-pressed="${tab === k}">${l}</button>`;
  const pf = portfolio(s, app.today);
  const frLinks = [...pf.open.map(p => ({ name: p.name })), { name: 'Bourse de Paris CAC 40' }, { name: 'bitcoin' }];
  return html`${header}
    ${hasKey ? html`<div class="chips" role="group" aria-label="Actualités">${hasStocks ? chip('holdings', 'Mes actions') : ''}${chip('general', 'Marchés')}${chip('crypto', 'Crypto')}</div>
      ${items.length ? html`<div class="news">${items.map((n, i) => newsItem(n, i))}</div>`
        : html`<div class="note">${app.ui.mkBusy ? 'Chargement des actualités…' : tab === 'holdings' ? 'Aucune actualité récente trouvée pour vos titres. Les petites valeurs et les ETF européens sont peu couverts.' : 'Aucune actualité pour le moment.'}</div>`}
      ${errLine(key)}
      ${items.length ? sourceLine(['finnhub'], cached(s, key)?.at) : ''}
      <p class="hint">${s.settings.translateNews !== false
        ? html`Actualités fournies en anglais par Finnhub, traduites automatiquement en français${translationQuotaReached(s) ? ' (limite de traduction gratuite atteinte pour aujourd\'hui : les suivantes restent en anglais jusqu\'à demain)' : ''}. « Lire en français » ouvre l'article traduit par Google Traduction.`
        : 'Actualités en anglais, fournies par Finnhub.'} Seuls les codes de vos titres sont envoyés.</p>`
    : html`<div class="note"><strong>Activez les actualités en 2 minutes.</strong> Créez une clé gratuite sur <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer">finnhub.io</a> (adresse e-mail seulement), puis collez-la dans les réglages. Vous aurez les actualités des marchés, des cryptomonnaies et de vos titres, et des données sur les entreprises.
        <div style="margin-top:12px"><a class="btn brass" href="#/reglages">Ajouter ma clé</a></div></div>`}
    <h2 class="section">Actualités en français</h2>
    <div class="group">${frLinks.map(l => html`<a class="row plain" href="${moreLinks({ name: l.name }).at(-1).url}" target="_blank" rel="noopener noreferrer"><span class="main"><span class="title">${l.name}</span><span class="sub">Google Actualités</span></span>${icon('chev', 'chev')}</a>`)}</div>
    ${DISCLAIMER}`;
}

// Titres traduits automatiquement pour toute la liste, résumés pour les 8 premières (le reste à la demande),
// pour rester dans la limite gratuite d'environ 5 000 caractères par jour.
const AUTO_SUMMARIES = 8;
let translating = false;
async function translateNews(items) {
  const s = app.state;
  if (translating || !s || translationQuotaReached(s)) return;
  const todo = [];
  items.forEach((n, i) => {
    if (!cachedTranslation(s, n.headline)) todo.push(n.headline);
    if (n.summary && (i < AUTO_SUMMARIES || app.ui.trOpen?.[n.url]) && !cachedTranslation(s, n.summary)) todo.push(n.summary);
  });
  if (!todo.length) return;
  translating = true;
  let changed = false;
  try {
    for (const text of todo.slice(0, 40)) {
      try { await translate(s, text); changed = true; }
      catch (e) { if (e.message === 'quota' || e.message === 'offline') break; }
    }
  } finally {
    translating = false;
    if (changed && app.state === s) update(() => {});
  }
}

function newsItem(n, i) {
  const s = app.state;
  const on = s.settings.translateNews !== false;
  const h = on ? cachedTranslation(s, n.headline) : null;
  const sum = on && n.summary ? cachedTranslation(s, n.summary) : null;
  const canTranslateSummary = on && n.summary && !sum && i >= AUTO_SUMMARIES && !translationQuotaReached(s);
  return html`<article class="news-item">
    <span class="meta">${n.source} · ${ago(n.at)}${n.holding ? html` · <b>${n.holding}</b>` : ''}</span>
    <a class="h" href="${on ? translatedPageUrl(n.url) : n.url}" target="_blank" rel="noopener noreferrer">${h || n.headline}</a>
    ${n.summary ? html`<span class="sum">${sum || n.summary}</span>` : ''}
    <span class="links">
      ${on ? html`<a href="${translatedPageUrl(n.url)}" target="_blank" rel="noopener noreferrer">Lire en français</a>` : ''}
      <a href="${n.url}" target="_blank" rel="noopener noreferrer">${on ? 'Article original' : 'Lire l\'article'}</a>
      ${canTranslateSummary ? html`<button class="link inline" data-act="news-translate" data-url="${n.url}">Traduire le résumé</button>` : ''}
      ${h ? html`<span class="tr-badge">traduit</span>` : ''}
    </span>
  </article>`;
}

// ---------- Fiche d'une cryptomonnaie ----------
registerView('crypto', () => {
  const s = app.state;
  const id = app.route.params[0];
  const coin = (cached(s, 'crypto')?.data || []).find(c => c.id === id) || (cached(s, 'trending')?.data || []).find(c => c.id === id) || { id, name: id };
  const key = 'coin:' + id;
  setTimeout(() => refresh([key]));
  const hist = cached(s, key)?.data || [];
  const range = app.ui.range || 130;
  const days = Math.round(range * 365 / 252);
  const seg = (n, l) => html`<button data-act="range" data-n="${n}" aria-pressed="${range === n}">${l}</button>`;
  const followed = (s.market.followCoins || []).includes(id);
  const { help } = cryptoHelp;
  return {
    title: coin.name, tabs: true, tab: 'bourse',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/bourse?vue=marches" aria-label="Retour">${icon('back')}</a><h1>${coin.name}</h1>
        <button class="iconbtn" data-act="coin-follow" data-id="${id}" aria-pressed="${followed}" aria-label="${followed ? 'Ne plus suivre' : 'Suivre'}" style="font-size:22px;color:var(--brass)">${followed ? '★' : '☆'}</button></div>
      <div class="pf-head" style="padding:0 4px"><div class="muted small">${coin.symbol || ''}${coin.rank ? ` · n° ${coin.rank} par capitalisation` : ''}</div>
        <div class="value">${eur(coin.price ?? hist.at(-1)?.[1])}</div>
        ${coin.ch24h != null ? html`<div class="delta ${coin.ch24h >= 0 ? 'pos' : 'neg'}">${pctPts(coin.ch24h)} sur 24 h</div>` : ''}</div>
      ${hist.length > 1 ? html`<div style="margin:14px 0 6px">${lineChart(hist.slice(-days), { label: `Cours de ${coin.name}` })}</div>
        <div class="seg" role="group" aria-label="Période">${seg(22, '1 mois')}${seg(65, '3 mois')}${seg(130, '6 mois')}${seg(260, '1 an')}</div>`
        : html`<div class="note" style="margin-top:12px">${cached(s, key)?.error ? '' : 'Chargement du cours…'}</div>`}
      ${errLine(key)}
      ${indicatorsBlock(hist, { crypto: true, help })}
      ${coin.ath ? html`<div class="note" style="margin-top:10px">Record historique : <strong>${eur(coin.ath)}</strong>, soit ${pctPts(coin.fromAth)} par rapport au cours actuel.</div>` : ''}
      ${linksBlock({ name: coin.name, coinId: id })}
      ${hist.length ? sourceLine(['coingecko'], cached(s, key)?.at) : ''}
      ${DISCLAIMER}
    </main>`,
  };
});
const cryptoHelp = { help: k => html`<button class="help" data-act="help" data-k="${k}" aria-label="Qu'est-ce que c'est ?">?</button>` };

registerActions({
  'news-tab': el => { app.ui.newsTab = el.dataset.t; render(); },
  'news-translate': async el => {
    (app.ui.trOpen ||= {})[el.dataset.url] = true;
    el.textContent = 'Traduction…';
    const s = app.state;
    const n = Object.values(s.market).flatMap(c => (Array.isArray(c?.data) ? c.data : [])).find(x => x.url === el.dataset.url);
    if (!n) return;
    try { await translate(s, n.summary); update(() => {}); }
    catch (e) { toast(e.message === 'quota' ? 'Limite de traduction gratuite atteinte pour aujourd\'hui.' : 'Traduction impossible pour le moment.'); render(); }
  },
  'mk-retry': el => { const c = app.state.market[el.dataset.key]; if (c) delete c.errorAt; refresh([el.dataset.key], true); },
  'mk-refresh': () => refresh(app.ui.bourseTab === 'actus' ? ['news:' + (app.ui.newsTab || 'holdings')] : ['macro', 'fng', 'global', 'crypto', 'trending'], true),
  'coin-follow': el => {
    const id = el.dataset.id;
    update(s => {
      const f = new Set(s.market.followCoins || []);
      if (f.has(id)) f.delete(id); else f.add(id);
      s.market.followCoins = [...f];
      if (s.market.crypto) s.market.crypto.at = '1970-01-01T00:00:00Z'; // recharger la liste avec cette crypto
    });
    toast((app.state.market.followCoins || []).includes(id) ? 'Ajoutée à vos cryptos suivies' : 'Retirée de vos cryptos suivies');
  },
});

export { finnhubSymbol, refresh };
