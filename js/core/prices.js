// Cours de bourse. Seuls des identifiants de titres (ticker, ISIN) et votre clé d'API sont envoyés au fournisseur :
// jamais de montant, de quantité ni d'opération.

export const PROVIDERS = {
  none: { name: 'Aucun (saisie manuelle)', needsKey: false },
  eodhd: { name: 'EODHD', needsKey: true, site: 'https://eodhd.com', hint: 'Exemples : IWDA.AS, AAPL.US, MC.PA, FCHI.INDX (CAC 40)' },
  alphavantage: { name: 'Alpha Vantage', needsKey: true, site: 'https://www.alphavantage.co', hint: 'Exemples : AAPL, MSFT, SPY. 25 requêtes par jour en gratuit.' },
  demo: { name: 'Démo (cours fictifs)', needsKey: false },
};

const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function getJSON(url) {
  let r;
  try {
    r = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' });
  } catch {
    throw new Error('Pas de connexion au fournisseur de cours (hors ligne ou bloqué).');
  }
  if (r.status === 401 || r.status === 403) throw new Error('Clé d\'API refusée par le fournisseur.');
  if (r.status === 404) throw new Error('Titre inconnu chez ce fournisseur.');
  if (r.status === 429) throw new Error('Limite de requêtes atteinte. Réessayez plus tard.');
  if (!r.ok) throw new Error(`Le fournisseur a répondu ${r.status}.`);
  return r.json();
}

function fromSeries(series, source) {
  series.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const last = series.at(-1);
  if (!last) throw new Error('Aucun cours reçu pour ce titre.');
  return { close: last[1], prevClose: series.at(-2)?.[1] ?? null, date: last[0], history: series.slice(-260), source, fetchedAt: new Date().toISOString() };
}

/** Cours du jour et historique récent d'un ticker. */
export async function fetchQuote(settings, ticker) {
  const key = encodeURIComponent(settings.apiKey || '');
  const t = encodeURIComponent(ticker.trim());
  if (settings.provider === 'eodhd') {
    const data = await getJSON(`https://eodhd.com/api/eod/${t}?api_token=${key}&fmt=json&from=${daysAgo(380)}`);
    if (!Array.isArray(data)) throw new Error('Réponse inattendue du fournisseur.');
    return fromSeries(data.map(d => [d.date, Number(d.adjusted_close ?? d.close)]), 'eodhd');
  }
  if (settings.provider === 'alphavantage') {
    const data = await getJSON(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${t}&outputsize=compact&apikey=${key}`);
    if (data.Note || data.Information) throw new Error('Limite gratuite Alpha Vantage atteinte (25 requêtes par jour).');
    if (data['Error Message']) throw new Error('Titre inconnu chez Alpha Vantage.');
    const s = data['Time Series (Daily)'];
    if (!s) throw new Error('Réponse inattendue du fournisseur.');
    return fromSeries(Object.entries(s).map(([d, v]) => [d, Number(v['4. close'])]), 'alphavantage');
  }
  if (settings.provider === 'demo') return demoQuote(ticker);
  throw new Error('Choisissez un fournisseur de cours dans les réglages.');
}

/** Trouve le ticker d'un ISIN (EODHD uniquement). Préfère une cotation en euros. */
export async function tickerForIsin(settings, isin) {
  if (settings.provider === 'demo') return isin;
  if (settings.provider !== 'eodhd') return null;
  const data = await getJSON(`https://eodhd.com/api/search/${encodeURIComponent(isin)}?api_token=${encodeURIComponent(settings.apiKey)}&fmt=json`);
  if (!Array.isArray(data) || !data.length) return null;
  const pref = ['XETRA', 'F', 'PA', 'AS', 'MI', 'LSE', 'US'];
  const eur = data.filter(d => d.Currency === 'EUR');
  const pick = (eur.length ? eur : data).sort((a, b) => (pref.indexOf(a.Exchange) + 99) % 99 - (pref.indexOf(b.Exchange) + 99) % 99)[0];
  return `${pick.Code}.${pick.Exchange}`;
}

// Cours fictifs, déterministes, pour la démonstration.
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function demoQuote(ticker) {
  let seed = hash(ticker);
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ Math.imul(seed ^ (seed >>> 13), 3266489909)) >>> 0) / 4294967296;
  const base = { IE00B4L5Y983: 98, US0378331005: 190, FR0000121014: 640, IE00BK5BQT80: 118, FCHI: 7600, STOXX50E: 4950, GSPC: 5800, 'IWDA.AS': 98 }[ticker] || 20 + (hash(ticker) % 300);
  const series = [];
  let p = base * 0.88;
  for (let i = 260; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    p *= 1 + (rnd() - 0.47) * 0.022;
    series.push([d.toISOString().slice(0, 10), Math.round(p * 100) / 100]);
  }
  const k = base / series.at(-1)[1];
  return fromSeries(series.map(([d, v]) => [d, Math.round(v * k * 100) / 100]), 'demo');
}
