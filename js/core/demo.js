// Données de démonstration : 7 mois fictifs sur un compte Caisse d'Épargne et un compte Trade Republic.
// Elles passent par le même circuit d'import que vos vrais fichiers.
import { emptyState, prepareImport, commitImport, addAccount } from './model.js';
import { newLoan } from './debt.js';
import { payeeKey } from '../lib/text.js';
import { demoQuote } from './prices.js';

export function buildDemoState(today = new Date()) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100);
  const iso = d => d.toISOString().slice(0, 10);
  const end = iso(today);
  const ce = [], tr = [], trades = [];
  let n = 0;
  const add = (date, amount, label) => { if (date <= end) ce.push({ date, amount, label, fitid: `demo-ce-${n++}` }); };
  const addTr = (date, amount, label, trType, extra = {}) => { if (date <= end) tr.push({ date, amount, label, fitid: `demo-tr-${n++}`, meta: { trCategory: extra.cat || 'CASH', trType } }); };
  const trade = t => { if (t.date <= end) trades.push({ currency: 'EUR', txid: `demo-trade-${n++}`, fee: 0, tax: 0, ...t }); };

  const ETF = { isin: 'IE00B4L5Y983', name: 'Core MSCI World USD (Acc)', assetClass: 'FUND' };
  const AAPL = { isin: 'US0378331005', name: 'Apple', assetClass: 'STOCK' };
  const MC = { isin: 'FR0000121014', name: 'LVMH', assetClass: 'STOCK' };
  const px = { [ETF.isin]: demoQuote(ETF.isin).history, [AAPL.isin]: demoQuote(AAPL.isin).history, [MC.isin]: demoQuote(MC.isin).history };
  const priceAt = (isin, date) => (px[isin].filter(([d]) => d <= date).at(-1) || px[isin][0])[1];

  for (let k = 6; k >= 0; k--) {
    const m = new Date(Date.UTC(today.getFullYear(), today.getMonth() - k, 1));
    const ym = iso(m).slice(0, 7);
    const D = d => `${ym}-${String(d).padStart(2, '0')}`;
    add(D(1), -85000, 'PRLV SEPA FONCIA LOYER MENSUEL');
    add(D(2), -30000, 'VIR SEPA TRADE REPUBLIC BANK GMBH');
    add(D(4), -between(55, 82), 'PRLV SEPA EDF CLIENTS PARTICULIERS');
    add(D(6), -1999, 'PRLV SEPA FREE MOBILE');
    add(D(8), k <= 1 ? -1549 : -1349, 'PRLV SEPA NETFLIX.COM');
    add(D(12), -1199, 'PRLV SEPA SPOTIFY AB');
    add(D(14), -2999, 'PRLV SEPA BASIC FIT');
    add(D(15), -4230, 'PRLV SEPA MAIF ASSURANCE HABITATION');
    add(D(5), -18940, 'PRLV SEPA CETELEM ECHEANCE CREDIT AUTO');
    add(D(10), -490, 'COTISATION CARTE VISA CLASSIC');
    add(D(10), -250, 'FRAIS TENUE DE COMPTE');
    add(D(18), -6000, 'RETRAIT DAB ' + D(17).slice(8) + '/' + ym.slice(5) + ' PARIS 11');
    add(D(28), 245000, 'VIR SEPA SALAIRE ACME SAS');
    const shops = ['CB CARREFOUR CITY', 'CB LIDL 1234', 'CB MONOPRIX', 'CB PICARD SURGELES', 'CB BOULANGERIE DU MARCHE'];
    for (let w = 0; w < 4; w++) {
      add(D(3 + w * 7), -between(25, 85), shops[Math.floor(rnd() * shops.length)]);
      add(D(5 + w * 7), -between(4, 14), 'CB BOULANGERIE DU MARCHE');
    }
    add(D(9), -between(18, 32), 'CB UBER *EATS');
    add(D(21), -between(22, 45), 'CB UBER *EATS');
    add(D(16), -between(28, 70), 'CB RESTAURANT LE PETIT ZINC');
    add(D(19), -between(15, 60), 'CB AMAZON PAYMENTS');
    if (k % 2 === 0) add(D(11), -between(35, 90), 'CB SNCF INTERNET');
    if (k % 3 === 1) add(D(22), -between(12, 30), 'CB PHARMACIE DE LA GARE');
    if (k % 3 === 1) add(D(26), between(10, 20), 'VIR CPAM PARIS REMB SOINS');
    if (k === 3) add(D(20), -between(250, 320), 'CB AIR FRANCE');
    if (k % 2 === 1) add(D(24), -between(11, 13), 'CB PATHE CINEMAS');
    add(D(25), -between(20, 50), 'CB DECATHLON');
    // Quelques opérations que Pécule ne sait pas classer seul (pour le classement express)
    if (k <= 2) add(D(13), -between(8, 25), 'CB LA FABRIQUE 75011');
    if (k === 1) add(D(23), between(30, 60), 'VIR INST M PIERRE MARTIN');
    if (k <= 1) add(D(7), -between(40, 60), 'CB SC ATELIER NOMADE');

    addTr(D(3), 30000, 'Virement reçu Jean Dupont', 'CUSTOMER_INBOUND');
    const etfPrice = priceAt(ETF.isin, D(4));
    const sh = Math.round((150 / etfPrice) * 1e6) / 1e6;
    addTr(D(4), -15000, `Plan d'investissement ${ETF.name}`, 'SAVINGS_PLAN', { cat: 'TRADING' });
    trade({ ...ETF, date: D(4), kind: 'buy', shares: sh, price: etfPrice, amount: -15000, gross: -15000, source: 'SAVINGS_PLAN' });
    addTr(D(1), between(1.8, 3.2), 'Intérêts', 'INTEREST_PAYMENT');
    if (k === 6 || k === 3) {
      const p = priceAt(AAPL.isin, D(7));
      addTr(D(7), -(Math.round(p * 100) + 100), `Achat ${AAPL.name}`, 'BUY', { cat: 'TRADING' });
      trade({ ...AAPL, date: D(7), kind: 'buy', shares: 1, price: p, amount: -(Math.round(p * 100) + 100), gross: -Math.round(p * 100), fee: -100 });
    }
    if (k === 5) {
      const p = priceAt(MC.isin, D(9));
      addTr(D(9), -(Math.round(p * 100) + 100), `Achat ${MC.name}`, 'BUY', { cat: 'TRADING' });
      trade({ ...MC, date: D(9), kind: 'buy', shares: 1, price: p, amount: -(Math.round(p * 100) + 100), gross: -Math.round(p * 100), fee: -100 });
    }
    if (k === 2) {
      addTr(D(16), 38, `Dividende ${AAPL.name}`, 'DIVIDEND');
      trade({ ...AAPL, date: D(16), kind: 'dividend', shares: 0, price: null, amount: 38, gross: 45, tax: -7 });
    }
    if (k === 1) addTr(D(20), -between(9, 16), 'MONOPRIX PARIS 11', 'CARD_TRANSACTION');
  }

  const state = emptyState();
  const ceParsed = { fileName: 'demo-caisse-epargne.ofx', source: 'caisse-epargne', format: 'OFX', warnings: [], trades: [], accounts: [{ key: 'demo-ce', externalId: 'DEMO-CE', name: 'Compte courant ···6789', institution: "Caisse d'Épargne", type: 'courant', currency: 'EUR', balance: null, transactions: ce }] };
  const trParsed = { fileName: 'demo-trade-republic.csv', source: 'trade-republic', format: 'CSV Trade Republic', warnings: [], trades, accounts: [{ key: 'TR-CASH', externalId: 'TR-CASH', name: 'Trade Republic · espèces', institution: 'Trade Republic', type: 'courant', currency: 'EUR', balance: null, fromInception: true, transactions: tr }] };
  commitImport(state, prepareImport(state, ceParsed, { 'demo-ce': { currentBalance: 184230 } }));
  commitImport(state, prepareImport(state, trParsed));

  // Comptes jamais à découvert dans la démo : on relève le solde de départ si besoin
  for (const a of state.accounts) {
    let bal = a.openingBalance, min = bal;
    for (const t of [...state.transactions].filter(t => t.accountId === a.id).sort((x, y) => (x.date < y.date ? -1 : 1))) { bal += t.amount; min = Math.min(min, bal); }
    if (min < 30000) a.openingBalance += 30000 - min;
  }
  addAccount(state, { name: 'Livret A', institution: "Caisse d'Épargne", type: 'livret', openingBalance: 450000 });
  const endY = today.getFullYear() + 2;
  state.loans = [newLoan({ name: 'Crédit auto Cetelem', type: 'auto', monthly: 18940, insurance: 1200, rate: 4.9, endDate: `${endY}-03-05`, payeeKey: payeeKey('PRLV SEPA CETELEM ECHEANCE CREDIT AUTO') })];
  state.settings.demo = true;
  state.settings.provider = 'demo';
  for (const s of Object.values(state.securities)) s.ticker = s.isin;
  for (const isin of [ETF.isin, AAPL.isin, MC.isin]) state.prices[isin] = demoQuote(isin);
  state.watchlist = [
    { ticker: 'FCHI', name: 'CAC 40' },
    { ticker: 'STOXX50E', name: 'Euro Stoxx 50' },
    { ticker: 'GSPC', name: 'S&P 500' },
  ];
  for (const w of state.watchlist) state.prices['wl:' + w.ticker] = demoQuote(w.ticker);
  state.budgets = { alimentation: 45000, restaurants: 12000, loisirs: 6000, shopping: 8000, transports: 6000 };
  return state;
}
