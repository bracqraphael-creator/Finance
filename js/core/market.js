// Données de marché publiques (crypto, sentiment, BCE) et actualités (Finnhub, clé gratuite).
// Aucune donnée personnelle n'est envoyée : seulement des codes de titres ou de cryptos.
// Les réponses sont gardées dans le coffre chiffré pour un affichage immédiat et hors ligne.

const CG = 'https://api.coingecko.com/api/v3';
const FH = 'https://finnhub.io/api/v1';
const ECB = 'https://data-api.ecb.europa.eu/service/data';

export const SOURCES = {
  coingecko: { name: 'CoinGecko', url: 'https://www.coingecko.com' },
  fng: { name: 'Alternative.me', url: 'https://alternative.me/crypto/fear-and-greed-index/' },
  ecb: { name: 'Banque centrale européenne', url: 'https://data.ecb.europa.eu' },
  finnhub: { name: 'Finnhub', url: 'https://finnhub.io' },
};

const TTL = {
  crypto: 10 * 60e3,
  trending: 30 * 60e3,
  global: 10 * 60e3,
  fng: 3 * 3600e3,
  macro: 12 * 3600e3,
  news: 15 * 60e3,
  coin: 60 * 60e3,
  metric: 24 * 3600e3,
};

async function getJSON(url, label) {
  let r;
  try {
    r = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' });
  } catch {
    throw new Error(`${label} injoignable (hors ligne ou bloqué).`);
  }
  if (r.status === 429) throw new Error(`${label} : trop de demandes, réessayez dans une minute.`);
  if (r.status === 401 || r.status === 403) throw new Error(`${label} : clé refusée ou accès réservé à l'offre payante.`);
  if (!r.ok) throw new Error(`${label} a répondu ${r.status}.`);
  return r.json();
}

export function cached(state, key) {
  return state.market?.[key] || null;
}
export function isFresh(state, key, kind) {
  const c = cached(state, key);
  if (!c) return false;
  // Après une erreur, pas de nouvel essai automatique pendant 2 minutes (bouton « Réessayer » sinon)
  if (c.errorAt && Date.now() - Date.parse(c.errorAt) < 120e3) return true;
  return !!c.at && Date.now() - Date.parse(c.at) < (TTL[kind] || TTL.news);
}
function put(state, key, data) {
  state.market ||= {};
  state.market[key] = { data, at: new Date().toISOString() };
}
function putError(state, key, message) {
  state.market ||= {};
  const prev = state.market[key];
  state.market[key] = { ...(prev || {}), error: message, errorAt: new Date().toISOString() };
}

const thin = (arr, n) => (arr.length <= n ? arr : arr.filter((_, i) => i % Math.ceil(arr.length / n) === 0 || i === arr.length - 1));

// ---------- Crypto (CoinGecko, sans clé) ----------
export async function loadCrypto(state, extraIds = []) {
  const q = 'vs_currency=eur&sparkline=true&price_change_percentage=24h,7d,30d,1y';
  const top = await getJSON(`${CG}/coins/markets?${q}&order=market_cap_desc&per_page=15&page=1`, 'CoinGecko');
  const have = new Set(top.map(c => c.id));
  const missing = extraIds.filter(id => !have.has(id));
  const extra = missing.length ? await getJSON(`${CG}/coins/markets?${q}&ids=${missing.map(encodeURIComponent).join(',')}`, 'CoinGecko') : [];
  const slim = c => ({
    id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name, rank: c.market_cap_rank,
    price: c.current_price, marketCap: c.market_cap,
    ch24h: c.price_change_percentage_24h_in_currency, ch7d: c.price_change_percentage_7d_in_currency,
    ch30d: c.price_change_percentage_30d_in_currency, ch1y: c.price_change_percentage_1y_in_currency,
    ath: c.ath, fromAth: c.ath_change_percentage, spark: thin(c.sparkline_in_7d?.price || [], 42),
  });
  put(state, 'crypto', [...top, ...extra].map(slim));
}

export async function loadTrending(state) {
  const r = await getJSON(`${CG}/search/trending`, 'CoinGecko');
  put(state, 'trending', (r.coins || []).slice(0, 7).map(({ item }) => ({
    id: item.id, name: item.name, symbol: item.symbol, rank: item.market_cap_rank,
    ch24h: item.data?.price_change_percentage_24h?.eur ?? null,
  })));
}

export async function loadGlobal(state) {
  const r = await getJSON(`${CG}/global`, 'CoinGecko');
  const d = r.data || {};
  put(state, 'global', { marketCap: d.total_market_cap?.eur, change24h: d.market_cap_change_percentage_24h_usd, btcDominance: d.market_cap_percentage?.btc });
}

export async function loadCoinChart(state, id) {
  const r = await getJSON(`${CG}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=eur&days=365`, 'CoinGecko');
  const byDay = new Map();
  for (const [ms, p] of r.prices || []) byDay.set(new Date(ms).toISOString().slice(0, 10), p);
  put(state, 'coin:' + id, [...byDay.entries()]);
}

// ---------- Sentiment crypto (Alternative.me, sans clé) ----------
export const FNG_FR = { 'Extreme Fear': 'Peur extrême', Fear: 'Peur', Neutral: 'Neutre', Greed: 'Avidité', 'Extreme Greed': 'Avidité extrême' };
export async function loadFearGreed(state) {
  const r = await getJSON('https://api.alternative.me/fng/?limit=30', 'Alternative.me');
  const data = (r.data || []).map(d => ({ value: Number(d.value), label: FNG_FR[d.value_classification] || d.value_classification, date: new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10) }));
  put(state, 'fng', data.reverse());
}

// ---------- Repères macro (BCE, sans clé) ----------
function sdmxLast(json) {
  const ds = json.dataSets?.[0];
  const series = ds && Object.values(ds.series || {})[0];
  const obs = series?.observations || {};
  const keys = Object.keys(obs).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  const k = keys.at(-1);
  const period = json.structure?.dimensions?.observation?.[0]?.values?.[k]?.id;
  return { value: obs[k][0], period };
}
export const MACRO_SERIES = {
  depot: { label: 'Taux de dépôt BCE', path: 'FM/D.U2.EUR.4F.KR.DFR.LEV' },
  inflationZE: { label: 'Inflation zone euro', path: 'ICP/M.U2.N.000000.4.ANR' },
  inflationFR: { label: 'Inflation France', path: 'ICP/M.FR.N.000000.4.ANR' },
};
export async function loadMacro(state) {
  const out = {};
  for (const [k, s] of Object.entries(MACRO_SERIES)) {
    try {
      out[k] = sdmxLast(await getJSON(`${ECB}/${s.path}?lastNObservations=1&format=jsondata`, 'BCE'));
    } catch (e) {
      out[k] = null;
      if (k === 'depot') throw e;
    }
  }
  put(state, 'macro', out);
}

// ---------- Finnhub (clé gratuite) : actualités et indicateurs d'actions ----------
const fh = (state, path) => `${FH}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(state.settings.finnhubKey)}`;
const slimNews = n => ({ id: n.id, at: n.datetime * 1000, headline: n.headline, summary: (n.summary || '').slice(0, 280), source: n.source, url: n.url, related: n.related || '' });

export async function loadNews(state, category) {
  const r = await getJSON(fh(state, `/news?category=${category}`), 'Finnhub');
  if (!Array.isArray(r)) throw new Error('Finnhub : réponse inattendue.');
  put(state, 'news:' + category, r.slice(0, 40).map(slimNews));
}

/** Trouve le symbole Finnhub d'un titre à partir de son ISIN. */
export async function finnhubSymbol(state, isin) {
  const sec = state.securities[isin] ||= { isin };
  if (sec.finnhub !== undefined) return sec.finnhub;
  const r = await getJSON(fh(state, `/search?q=${encodeURIComponent(isin)}`), 'Finnhub');
  const hit = (r.result || []).find(x => !x.symbol.includes('.')) || (r.result || [])[0];
  sec.finnhub = hit ? hit.symbol : null;
  return sec.finnhub;
}

export async function loadHoldingsNews(state, holdings) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const all = [];
  // Actualités d'entreprise : actions seulement (un ETF n'a pas d'actualité propre)
  for (const h of holdings.filter(x => String(x.assetClass || '').toUpperCase() === 'STOCK').slice(0, 12)) {
    const sym = await finnhubSymbol(state, h.isin);
    if (!sym) continue;
    const r = await getJSON(fh(state, `/company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`), 'Finnhub');
    if (Array.isArray(r)) for (const n of r.slice(0, 8)) all.push({ ...slimNews(n), holding: h.name });
  }
  const seen = new Set();
  put(state, 'news:holdings', all.filter(n => (seen.has(n.url) ? false : seen.add(n.url))).sort((a, b) => b.at - a.at).slice(0, 50));
}

export async function loadStockMetrics(state, symbol) {
  const [m, p] = await Promise.all([
    getJSON(fh(state, `/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`), 'Finnhub'),
    getJSON(fh(state, `/stock/profile2?symbol=${encodeURIComponent(symbol)}`), 'Finnhub'),
  ]);
  const x = m.metric || {};
  put(state, 'metric:' + symbol, {
    name: p.name, industry: p.finnhubIndustry, country: p.country, currency: p.currency, web: p.weburl,
    marketCap: p.marketCapitalization, pe: x.peTTM ?? x.peNormalizedAnnual ?? null,
    dividendYield: x.dividendYieldIndicatedAnnual ?? x.currentDividendYieldTTM ?? null,
    beta: x.beta ?? null, high52: x['52WeekHigh'] ?? null, low52: x['52WeekLow'] ?? null,
    revenueGrowth: x.revenueGrowthTTMYoy ?? null, netMargin: x.netProfitMarginTTM ?? null,
  });
}

/** Exécute un chargement, enregistre l'erreur éventuelle sous la même clé, ne lève jamais. */
export async function safely(state, key, fn) {
  try {
    await fn();
    if (state.market[key]) { delete state.market[key].error; delete state.market[key].errorAt; }
    return true;
  }
  catch (e) { putError(state, key, e.message); return false; }
}

/** Liens pour aller plus loin (pages publiques). */
export function moreLinks({ name, isin, assetClass, coinId }) {
  const links = [];
  if (coinId) links.push({ label: 'Fiche CoinGecko', url: `https://www.coingecko.com/en/coins/${encodeURIComponent(coinId)}` });
  if (isin && /FUND|ETF/i.test(assetClass || '')) links.push({ label: 'Fiche justETF (frais, composition)', url: `https://www.justetf.com/fr/etf-profile.html?isin=${encodeURIComponent(isin)}` });
  if (name) links.push({ label: 'Actualités en français', url: `https://news.google.com/search?q=${encodeURIComponent(name)}&hl=fr&gl=FR&ceid=FR:fr` });
  return links;
}

/** Cours d'une cryptomonnaie détenue (Trade Republic) : identifiant CoinGecko trouvé par son nom, puis historique en euros. */
export async function cryptoQuote(state, sec) {
  if (!sec.coinId) {
    const r = await getJSON(`${CG}/search?query=${encodeURIComponent(sec.name || '')}`, 'CoinGecko');
    const hit = (r.coins || []).find(c => c.name?.toLowerCase() === (sec.name || '').toLowerCase()) || (r.coins || [])[0];
    if (!hit) throw new Error('cryptomonnaie introuvable sur CoinGecko');
    sec.coinId = hit.id;
  }
  const r = await getJSON(`${CG}/coins/${encodeURIComponent(sec.coinId)}/market_chart?vs_currency=eur&days=365`, 'CoinGecko');
  const byDay = new Map();
  for (const [ms, p] of r.prices || []) byDay.set(new Date(ms).toISOString().slice(0, 10), p);
  const history = [...byDay.entries()];
  if (!history.length) throw new Error('aucun cours reçu');
  return { close: history.at(-1)[1], prevClose: history.at(-2)?.[1] ?? null, date: history.at(-1)[0], history, source: 'coingecko', fetchedAt: new Date().toISOString() };
}
