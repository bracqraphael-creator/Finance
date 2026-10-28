// Bourse : portefeuille Trade Republic, détail d'une ligne, titres et indices suivis.
import { app, registerView, registerActions, update, render, go } from '../app.js';
import { html, icon, openSheet, closeSheet, toast } from './dom.js';
import { euro, pct, qty, price, dateShort, dateLong } from './format.js';
import { portfolio, assetClassLabel } from '../core/portfolio.js';
import { fetchQuote, tickerForIsin, PROVIDERS } from '../core/prices.js';
import { parseDecimal } from '../lib/parse.js';
import { sparkline, lineChart } from './charts.js';
import { demoBanner } from './home.js';

const CLASS_COLORS = ['var(--brass)', 'var(--ink)', 'var(--pos)', '#5B6FA8', '#C8743A', 'var(--ink-3)'];

const HELP = {
  pru: ['Prix de revient unitaire (PRU)', 'Ce que vous a coûté en moyenne chaque part détenue, frais d\'achat compris. On le compare au cours actuel pour savoir si la ligne gagne ou perd.'],
  latent: ['Plus-value latente', 'Gain ou perte si vous vendiez tout aujourd\'hui : valeur actuelle moins ce que vous avez payé. Rien n\'est encaissé tant que vous ne vendez pas.'],
  realise: ['Plus-value réalisée', 'Gain ou perte déjà encaissé lors de ventes. C\'est ce montant qui est imposable.'],
  tri: ['Rendement annualisé', 'Ce que votre portefeuille a rapporté par an, en tenant compte des dates de chaque achat, vente et dividende (méthode du taux de rendement interne).'],
  etf: ['ETF', 'Un fonds coté qui réplique un indice (par exemple MSCI World : environ 1 500 grandes entreprises). Une seule ligne, beaucoup d\'entreprises.'],
};
const help = k => html`<button class="help" data-act="help" data-k="${k}" aria-label="Qu'est-ce que c'est ?">?</button>`;

registerView('bourse', () => {
  const s = app.state;
  if (app.route.params[0]) return positionView(app.route.params[0]);
  const pf = portfolio(s, app.today);
  const t = pf.totals;
  const prov = s.settings.provider;
  const canFetch = prov !== 'none' && (!PROVIDERS[prov]?.needsKey || s.settings.apiKey);
  const lastFetch = Object.values(s.prices).map(p => p.fetchedAt).filter(Boolean).sort().at(-1);
  const busy = app.ui.fetching;
  return {
    title: 'Bourse', tabs: true,
    html: html`<main class="screen">
      ${demoBanner()}
      <div class="topbar"><h1>Bourse</h1>
        ${canFetch ? html`<button class="iconbtn" data-act="prices-refresh" aria-label="Actualiser les cours" ${busy ? 'disabled' : ''}>${busy ? html`<span class="spinner"></span>` : icon('refresh')}</button>` : ''}</div>
      ${pf.positions.length ? html`
        <section class="pf-head" style="padding:0 4px 8px">
          <div class="muted">Valeur du portefeuille</div>
          <div class="value">${euro(t.value)}</div>
          <div class="delta ${t.latent >= 0 ? 'pos' : 'neg'}"><span class="amount">${euro(t.latent, { sign: true })}</span> (${pct(t.latentPct, true)}) depuis l'achat ${help('latent')}</div>
          ${t.dayChange != null ? html`<div class="delta muted">Dernière séance : <span class="amount ${t.dayChange >= 0 ? 'pos' : 'neg'}">${euro(t.dayChange, { sign: true })}</span></div>` : ''}
        </section>
        ${t.allocation.length > 1 ? html`<div class="allocation">${t.allocation.map(([, v], i) => html`<i style="flex:${v};background:${CLASS_COLORS[i % CLASS_COLORS.length]}"></i>`)}</div>
          <div class="legend-list">${t.allocation.map(([k, v], i) => html`<span style="--c:${CLASS_COLORS[i % CLASS_COLORS.length]}">${k} ${pct(v / t.value)}</span>`)}</div>` : ''}

        <div class="kpis" style="margin-top:16px">
          <div><div class="k">Investi</div><div class="v">${euro(t.cost, { round: true })}</div></div>
          <div><div class="k">Rendement par an ${help('tri')}</div><div class="v ${t.xirr == null ? '' : t.xirr >= 0 ? 'pos' : 'neg'}">${t.xirr == null ? '—' : pct(t.xirr, true)}</div></div>
          <div><div class="k">Dividendes et intérêts</div><div class="v">${euro(t.dividends, { round: true })}</div></div>
          <div><div class="k">Plus-values réalisées ${help('realise')}</div><div class="v">${euro(t.realized, { sign: true, round: true })}</div></div>
        </div>

        <h2 class="section">Vos titres</h2>
        <div class="group">${pf.open.map(p => html`<a class="row" href="#/bourse/${encodeURIComponent(p.isin)}">
          <span class="main"><span class="title">${p.name}</span><span class="sub">${qty(p.shares)} part${p.shares > 1 ? 's' : ''} · ${price(p.price)}</span></span>
          ${sparkline(app.state.prices[p.isin]?.history?.slice(-60).map(x => x[1]))}
          <span class="end"><span class="amount">${euro(p.value)}</span><div class="sub small ${p.latent >= 0 ? 'pos' : 'neg'}">${pct(p.latentPct, true)}</div></span>
        </a>`)}</div>
        ${pf.closed.length ? html`<details class="howto" style="margin-top:10px"><summary>Lignes vendues (${pf.closed.length})</summary>
          ${pf.closed.map(p => html`<a class="row plain" href="#/bourse/${encodeURIComponent(p.isin)}" style="padding:10px 0"><span class="main"><span class="title">${p.name}</span></span><span class="end amount ${p.realized >= 0 ? 'pos' : 'neg'}">${euro(p.realized, { sign: true })}</span></a>`)}</details>` : ''}
        <p class="hint">${canFetch ? (lastFetch ? `Cours mis à jour le ${dateShort(lastFetch.slice(0, 10))} (${PROVIDERS[prov].name}).` : 'Touchez ↻ pour récupérer les cours.') : 'Sans fournisseur de cours, la valeur utilise le dernier prix d\'achat ou de vente. Choisissez un fournisseur dans les réglages.'}</p>`
      : html`<div class="empty"><strong>Aucun titre pour l'instant</strong>Importez l'export CSV de Trade Republic : vos achats, ventes, plans d'investissement et dividendes seront repris.
          <div style="margin-top:16px"><a class="btn brass" href="#/import">Importer depuis Trade Republic</a></div></div>`}

      <h2 class="section">Marchés suivis <button data-act="watch-add">Ajouter</button></h2>
      ${s.watchlist.length ? html`<div class="group">${s.watchlist.map(w => {
        const q = s.prices['wl:' + w.ticker];
        const ch = q?.prevClose ? q.close / q.prevClose - 1 : null;
        return html`<a class="row" href="#/marche/${encodeURIComponent(w.ticker)}">
          <span class="main"><span class="title">${w.name || w.ticker}</span><span class="sub">${w.ticker}</span></span>
          ${sparkline(q?.history?.slice(-60).map(x => x[1]))}
          <span class="end"><span class="num">${q ? q.close.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '—'}</span><div class="sub small ${ch == null ? '' : ch >= 0 ? 'pos' : 'neg'}">${ch == null ? '' : pct(ch, true)}</div></span>
        </a>`;
      })}</div>` : html`<div class="note">Suivez un indice ou une action : CAC 40, S&amp;P 500, un ETF… ${canFetch ? '' : 'Choisissez d\'abord un fournisseur de cours dans les réglages.'}</div>`}
    </main>`,
  };
});

function positionView(isin) {
  const s = app.state;
  const pf = portfolio(s, app.today);
  const p = pf.positions.find(x => x.isin === isin);
  if (!p) { setTimeout(() => go('#/bourse')); return { html: '' }; }
  const q = s.prices[isin];
  const range = app.ui.range || 130;
  const hist = q?.history?.slice(-range) || [];
  const seg = (n, l) => html`<button data-act="range" data-n="${n}" aria-pressed="${range === n}">${l}</button>`;
  return {
    title: p.name, tabs: true, tab: 'bourse',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/bourse" aria-label="Retour">${icon('back')}</a><h1 style="font-size:19px">${p.name}</h1></div>
      <div class="pf-head" style="padding:0 4px">
        <div class="muted small">${isin} · ${assetClassLabel(p.assetClass)}${p.assetClass === 'FUND' ? html` ${help('etf')}` : ''}</div>
        <div class="value">${euro(p.value)}</div>
        ${p.shares ? html`<div class="delta ${p.latent >= 0 ? 'pos' : 'neg'}"><span class="amount">${euro(p.latent, { sign: true })}</span> (${pct(p.latentPct, true)}) ${help('latent')}</div>` : ''}
      </div>
      ${hist.length > 1 ? html`<div style="margin:14px 0 6px">${lineChart(hist, { label: `Cours de ${p.name}` })}</div>
        <div class="seg" role="group" aria-label="Période">${seg(22, '1 mois')}${seg(65, '3 mois')}${seg(130, '6 mois')}${seg(260, '1 an')}</div>` : ''}
      <div class="group" style="margin-top:16px">
        <div class="row plain"><span class="main">Parts détenues</span><span class="end num">${qty(p.shares)}</span></div>
        <div class="row plain"><span class="main">Prix de revient unitaire ${help('pru')}</span><span class="end num">${price(p.pru)}</span></div>
        <div class="row plain"><span class="main">Cours ${p.priceDate ? html`<span class="sub">au ${dateShort(p.priceDate)}</span>` : html`<span class="sub">dernier prix connu</span>`}</span><span class="end num">${price(p.price)}</span></div>
        <div class="row plain"><span class="main">Investi</span><span class="end amount">${euro(p.cost)}</span></div>
        ${p.realized ? html`<div class="row plain"><span class="main">Plus-value réalisée</span><span class="end amount ${p.realized >= 0 ? 'pos' : 'neg'}">${euro(p.realized, { sign: true })}</span></div>` : ''}
        ${p.dividends ? html`<div class="row plain"><span class="main">Dividendes reçus</span><span class="end amount pos">${euro(p.dividends)}</span></div>` : ''}
        <div class="row plain"><span class="main">Frais payés</span><span class="end amount">${euro(p.fees)}</span></div>
      </div>
      <div class="btn-row">
        <button class="btn ghost" data-act="pos-price" data-isin="${isin}">Saisir le cours</button>
        <button class="btn ghost" data-act="pos-ticker" data-isin="${isin}">Code de cotation</button>
      </div>
      <h2 class="section">Historique</h2>
      <div class="group">${[...p.trades].reverse().map(t => html`<div class="row plain">
        <span class="main"><span class="title">${{ buy: 'Achat', sell: 'Vente', dividend: 'Dividende', in: 'Titres reçus', out: 'Titres sortis' }[t.kind]}</span>
          <span class="sub">${dateLong(t.date)}${t.shares ? ` · ${qty(Math.abs(t.shares))} part${Math.abs(t.shares) > 1 ? 's' : ''}` : ''}${t.price ? ` à ${price(t.price)}` : ''}</span></span>
        <span class="end amount ${t.amount > 0 ? 'pos' : ''}">${t.amount ? euro(t.amount, { sign: true }) : '—'}</span></div>`)}</div>
    </main>`,
  };
}

registerView('marche', () => {
  const s = app.state;
  const ticker = app.route.params[0];
  const w = s.watchlist.find(x => x.ticker === ticker);
  const q = s.prices['wl:' + ticker];
  const range = app.ui.range || 130;
  const hist = q?.history?.slice(-range) || [];
  const seg = (n, l) => html`<button data-act="range" data-n="${n}" aria-pressed="${range === n}">${l}</button>`;
  const perf = n => { const h = q?.history; if (!h || h.length <= n) return null; return h.at(-1)[1] / h.at(-1 - n)[1] - 1; };
  return {
    title: w?.name || ticker, tabs: true, tab: 'bourse',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/bourse" aria-label="Retour">${icon('back')}</a><h1>${w?.name || ticker}</h1></div>
      <div class="pf-head" style="padding:0 4px"><div class="muted small">${ticker}${q ? ` · ${dateShort(q.date)}` : ''}</div>
        <div class="value">${q ? q.close.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '—'}</div></div>
      ${hist.length > 1 ? html`<div style="margin:14px 0 6px">${lineChart(hist, { label: `Cours de ${w?.name || ticker}` })}</div>
        <div class="seg" role="group" aria-label="Période">${seg(22, '1 mois')}${seg(65, '3 mois')}${seg(130, '6 mois')}${seg(260, '1 an')}</div>` : html`<div class="note" style="margin-top:12px">Pas encore de cours. Touchez « Actualiser » dans l'onglet Bourse.</div>`}
      ${q ? html`<div class="kpis" style="margin-top:16px">
        ${[[1, '1 séance'], [5, '1 semaine'], [21, '1 mois'], [63, '3 mois']].map(([n, l]) => { const v = perf(n); return html`<div><div class="k">${l}</div><div class="v ${v == null ? '' : v >= 0 ? 'pos' : 'neg'}">${pct(v, true)}</div></div>`; })}
      </div>` : ''}
      <button class="btn danger block" style="margin-top:20px" data-act="watch-remove" data-t="${ticker}">Ne plus suivre</button>
    </main>`,
  };
});

async function refreshPrices() {
  const s = app.state;
  app.ui.fetching = true; render();
  const errors = [];
  let ok = 0;
  const pf = portfolio(s, app.today);
  for (const p of pf.open) {
    const sec = s.securities[p.isin] ||= { isin: p.isin, name: p.name };
    try {
      if (!sec.ticker) sec.ticker = await tickerForIsin(s.settings, p.isin);
      if (!sec.ticker) { errors.push(`${p.name} : indiquez son code de cotation`); continue; }
      s.prices[p.isin] = await fetchQuote(s.settings, sec.ticker);
      ok++;
    } catch (e) { errors.push(`${p.name} : ${e.message}`); if (/Limite|Clé/.test(e.message)) break; }
  }
  for (const w of s.watchlist) {
    try { s.prices['wl:' + w.ticker] = await fetchQuote(s.settings, w.ticker); ok++; } catch (e) { errors.push(`${w.name || w.ticker} : ${e.message}`); if (/Limite|Clé/.test(e.message)) break; }
  }
  app.ui.fetching = false;
  update(() => {});
  if (errors.length) toast(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1})` : ''));
  else toast(`${ok} cours mis à jour`);
}

registerActions({
  'prices-refresh': () => refreshPrices(),
  range: el => { app.ui.range = Number(el.dataset.n); render(); },
  help: el => { const [t, b] = HELP[el.dataset.k]; openSheet(html`<h3>${t}</h3><p style="margin:0 4px 12px;font-size:17px">${b}</p><button class="btn ghost block" data-act="sheet-close">Compris</button>`, { label: t }); },
  'sheet-close': () => closeSheet(),
  'pos-price': el => {
    const isin = el.dataset.isin;
    openSheet(html`<h3>Cours actuel</h3><form data-submit="pos-price-save"><input type="hidden" name="isin" value="${isin}">
      <label class="field"><span>Cours d'une part (€)</span><input class="input big" name="p" inputmode="decimal" data-autofocus></label>
      <p class="hint">Utile sans fournisseur de cours : recopiez le cours affiché dans Trade Republic.</p>
      <button class="btn brass block" style="margin-top:12px">Enregistrer</button></form>`);
  },
  'pos-price-save': form => {
    const v = parseDecimal(form.p.value);
    if (!v) return;
    update(s => {
      const prev = s.prices[form.isin.value];
      const hist = (prev?.history || []).filter(h => h[0] !== app.today).concat([[app.today, v]]);
      s.prices[form.isin.value] = { close: v, prevClose: prev?.close ?? null, date: app.today, history: hist, source: 'manuel', fetchedAt: null };
    });
    closeSheet();
    toast('Cours enregistré');
  },
  'pos-ticker': el => {
    const isin = el.dataset.isin;
    const sec = app.state.securities[isin] || {};
    const prov = PROVIDERS[app.state.settings.provider];
    openSheet(html`<h3>Code de cotation</h3><form data-submit="pos-ticker-save"><input type="hidden" name="isin" value="${isin}">
      <label class="field"><span>Code chez ${prov?.name || 'votre fournisseur'}</span><input class="input" name="t" value="${sec.ticker || ''}" autocapitalize="characters" spellcheck="false" data-autofocus></label>
      <p class="hint">${prov?.hint || ''}</p>
      <button class="btn brass block" style="margin-top:12px">Enregistrer</button></form>`);
  },
  'pos-ticker-save': form => {
    update(s => { (s.securities[form.isin.value] ||= { isin: form.isin.value }).ticker = form.t.value.trim() || null; });
    closeSheet();
    toast('Code enregistré. Actualisez les cours.');
  },
  'watch-add': () => {
    const prov = PROVIDERS[app.state.settings.provider];
    openSheet(html`<h3>Suivre un marché</h3><form data-submit="watch-save">
      <label class="field"><span>Code de cotation</span><input class="input" name="t" required autocapitalize="characters" spellcheck="false" data-autofocus></label>
      <p class="hint">${prov?.hint || 'Choisissez d\'abord un fournisseur de cours dans les réglages.'}</p>
      <label class="field"><span>Nom affiché (facultatif)</span><input class="input" name="n" placeholder="Ex. : CAC 40"></label>
      <button class="btn brass block" style="margin-top:12px">Suivre</button></form>`);
  },
  'watch-save': async form => {
    const ticker = form.t.value.trim().toUpperCase();
    const name = form.n.value.trim();
    if (!ticker) return;
    update(s => { if (!s.watchlist.some(w => w.ticker === ticker)) s.watchlist.push({ ticker, name }); });
    closeSheet();
    try { app.state.prices['wl:' + ticker] = await fetchQuote(app.state.settings, ticker); update(() => {}); }
    catch (e) { toast(e.message); }
  },
  'watch-remove': el => { update(s => { s.watchlist = s.watchlist.filter(w => w.ticker !== el.dataset.t); delete s.prices['wl:' + el.dataset.t]; }, { rerender: false }); go('#/bourse'); },
});
