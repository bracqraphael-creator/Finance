// Modèle de données et opérations métier (import, dédoublonnage, virements internes, règles).
import { DEFAULT_CATEGORIES, categorize } from './categories.js';
import { norm, payeeKey, payeeDisplay, uid } from '../lib/text.js';

export const SCHEMA_VERSION = 2;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    accounts: [],
    transactions: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    rules: [],
    budgets: {},
    imports: [],
    securities: {},
    trades: [],
    prices: {},
    watchlist: [],
    loans: [],
    debt: {},
    market: {},
    settings: {
      discreet: false,
      provider: 'none',
      apiKey: '',
      autoLockMinutes: 5,
      lowBalance: 10000,
      onboarded: false,
      demo: false,
      finnhubKey: '',
      publicMarketData: true,
    },
  };
}

/** Met à niveau des données enregistrées par une version précédente. */
export function migrateState(state) {
  state.settings = { discreet: false, provider: 'none', apiKey: '', autoLockMinutes: 5, lowBalance: 10000, onboarded: true, demo: false, finnhubKey: '', publicMarketData: true, ...state.settings };
  state.watchlist ||= [];
  state.prices ||= {};
  state.securities ||= {};
  state.loans ||= [];
  state.debt ||= {};
  state.market ||= {};
  // Version 2 : noms de bénéficiaires mieux nettoyés (« CB MAGASIN FACT 090926 » → « Magasin »)
  if ((state.version || 1) < 2) {
    for (const t of state.transactions) if (!t.meta?.trType || /^CARD/.test(t.meta.trType)) t.payee = payeeDisplay(t.label);
    state.version = 2;
  }
  // Nouvelles catégories par défaut (ex. « Crédits ») : ajoutées puis appliquées aux opérations classées automatiquement
  const have = new Set(state.categories.map(c => c.id));
  const missing = DEFAULT_CATEGORIES.filter(c => !have.has(c.id));
  if (missing.length) {
    for (const c of missing) state.categories.push({ ...c });
    recategorizeAll(state);
  }
  return state;
}

export const catById = (state, id) => state.categories.find(c => c.id === id) || state.categories.find(c => c.id === 'divers');
export const accountById = (state, id) => state.accounts.find(a => a.id === id);

export function accountBalance(state, accountId, atDate = null) {
  const a = accountById(state, accountId);
  if (!a) return 0;
  let s = a.openingBalance || 0;
  for (const t of state.transactions) if (t.accountId === accountId && (!atDate || t.date <= atDate)) s += t.amount;
  return s;
}

// Sans identifiant bancaire, une opération est un doublon si une opération du même jour et du même montant
// existe déjà (les libellés diffèrent souvent entre OFX, CSV et QIF). Les occurrences sont comptées :
// deux paiements identiques le même jour restent deux paiements.
function acctDigits(id) {
  const d = String(id || '').replace(/\D/g, '');
  return d.length >= 11 ? d.slice(-11) : null;
}

const dedupKey = t => `${t.date}|${t.amount}`;

/**
 * Prépare un import sans rien modifier : compte cible, opérations nouvelles, doublons, contrôle de solde.
 * @param choices { [parsedAccountKey]: { accountId?: string|'new', currentBalance?: number } }
 */
export function prepareImport(state, parsed, choices = {}) {
  const groups = parsed.accounts.map(pa => {
    const choice = choices[pa.key] || {};
    let target = null;
    if (choice.accountId && choice.accountId !== 'new') target = accountById(state, choice.accountId);
    else if (!choice.accountId && pa.externalId) {
      // Même compte, qu'il vienne d'un OFX, d'un CSV ou d'un relevé PDF : on compare les 11 derniers chiffres du n° de compte
      const digits = acctDigits(pa.externalId);
      target = state.accounts.find(a => a.externalId === pa.externalId) || (digits ? state.accounts.find(a => acctDigits(a.externalId) === digits) : null);
    } else if (!choice.accountId && !pa.externalId) {
      // Sans identifiant (CSV récent) : on propose le compte courant de la même banque s'il est unique
      const same = state.accounts.filter(a => a.institution === pa.institution && a.type === (pa.type || 'courant'));
      if (same.length === 1 && pa.institution !== 'Banque') target = same[0];
    }

    const existing = target ? state.transactions.filter(t => t.accountId === target.id) : [];
    const fitids = new Set(existing.map(t => t.fitid).filter(Boolean));
    const counts = new Map();
    for (const t of existing) counts.set(dedupKey(t), (counts.get(dedupKey(t)) || 0) + 1);
    const seen = new Map();
    const fresh = [], dups = [];
    for (const t of pa.transactions) {
      if (t.fitid && fitids.has(t.fitid)) { dups.push(t); continue; }
      const k = dedupKey(t);
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      if (n <= (counts.get(k) || 0)) { dups.push(t); continue; }
      fresh.push(t);
    }
    const dates = pa.transactions.map(t => t.date).sort();
    const sumFresh = fresh.reduce((s, t) => s + t.amount, 0);

    let balanceCheck = null;
    if (target && pa.balance?.date) {
      const computed = accountBalance(state, target.id, pa.balance.date) + fresh.filter(t => t.date <= pa.balance.date).reduce((s, t) => s + t.amount, 0);
      balanceCheck = { expected: pa.balance.amount, computed, diff: pa.balance.amount - computed };
    }
    return {
      key: pa.key,
      parsed: pa,
      target,
      fresh,
      dups,
      from: dates[0] || null,
      to: dates.at(-1) || null,
      sumFresh,
      balanceCheck,
      needsBalance: !target && !pa.balance,
      currentBalance: choice.currentBalance ?? null,
    };
  });

  // Titres (Trade Republic) : même identifiant, ou même jour + même titre + même montant (CSV et relevé PDF se recoupent)
  const tradeKey = t => `${t.date}|${t.isin}|${t.amount}`;
  const knownIds = new Set(state.trades.map(t => t.txid).filter(Boolean));
  const knownCount = new Map();
  for (const t of state.trades) knownCount.set(tradeKey(t), (knownCount.get(tradeKey(t)) || 0) + 1);
  const seenCount = new Map();
  const freshTrades = parsed.trades.filter(t => {
    if (t.txid && knownIds.has(t.txid)) return false;
    const k = tradeKey(t);
    const n = (seenCount.get(k) || 0) + 1;
    seenCount.set(k, n);
    return n > (knownCount.get(k) || 0);
  });
  return {
    fileName: parsed.fileName,
    source: parsed.source,
    format: parsed.format,
    holder: parsed.holder || null,
    warnings: parsed.warnings || [],
    groups,
    trades: freshTrades,
    dupTrades: parsed.trades.length - freshTrades.length,
    totalFresh: groups.reduce((s, g) => s + g.fresh.length, 0),
    totalDups: groups.reduce((s, g) => s + g.dups.length, 0),
  };
}

/** Applique un import préparé. Renvoie l'identifiant du lot d'import. */
export function commitImport(state, prep) {
  const importId = uid('imp_');
  const now = new Date().toISOString();
  let count = 0;
  // Titulaire lu sur un relevé : ses virements vers ses autres comptes deviennent des virements internes
  if (prep.holder) {
    const owners = (state.settings.ownerNames ||= []);
    if (!owners.includes(prep.holder)) { owners.push(prep.holder); recategorizeAll(state); }
  }
  for (const g of prep.groups) {
    let acc = g.target;
    const pa = g.parsed;
    if (!acc) {
      acc = {
        id: uid('acc_'),
        name: uniqueAccountName(state, pa.name),
        institution: pa.institution,
        type: pa.type,
        currency: pa.currency || 'EUR',
        externalId: pa.externalId || null,
        openingBalance: 0,
        createdAt: now,
      };
      const all = g.fresh;
      if (pa.balance) {
        const upTo = pa.balance.date ? all.filter(t => t.date <= pa.balance.date) : all;
        acc.openingBalance = pa.balance.amount - upTo.reduce((s, t) => s + t.amount, 0);
      } else if (g.currentBalance != null) {
        acc.openingBalance = g.currentBalance - all.reduce((s, t) => s + t.amount, 0);
      }
      state.accounts.push(acc);
    } else if (!acc.externalId && pa.externalId) {
      acc.externalId = pa.externalId;
    }
    for (const t of g.fresh) {
      const tx = {
        id: uid('tx_'),
        accountId: acc.id,
        date: t.date,
        amount: t.amount,
        label: t.label,
        payee: t.meta?.trType && !/^CARD/.test(t.meta.trType) ? t.label : payeeDisplay(t.label), // libellés Trade Republic déjà lisibles
        fitid: t.fitid || null,
        importId,
        meta: t.meta || null,
        note: '',
      };
      tx.categoryId = categorize(tx, state.rules, state.settings.ownerNames);
      tx.catSource = 'auto';
      state.transactions.push(tx);
      count++;
    }
    g.accountId = acc.id;
  }

  if (prep.trades.length) {
    let titres = state.accounts.find(a => a.externalId === 'TR-TITRES');
    if (!titres) {
      titres = { id: uid('acc_'), name: 'Trade Republic · titres', institution: 'Trade Republic', type: 'titres', currency: 'EUR', externalId: 'TR-TITRES', openingBalance: 0, createdAt: now };
      state.accounts.push(titres);
    }
    for (const t of prep.trades) {
      state.trades.push({ id: uid('tr_'), accountId: titres.id, importId, ...t });
      if (!state.securities[t.isin]) state.securities[t.isin] = { isin: t.isin, name: t.name, assetClass: t.assetClass, ticker: null };
    }
  }

  state.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  state.imports.push({
    id: importId,
    at: now,
    fileName: prep.fileName,
    format: prep.format,
    source: prep.source,
    count,
    trades: prep.trades.length,
    from: prep.groups.map(g => g.from).filter(Boolean).sort()[0] || null,
    to: prep.groups.map(g => g.to).filter(Boolean).sort().at(-1) || null,
  });
  linkTransfers(state);
  return importId;
}

function uniqueAccountName(state, name) {
  let n = name, i = 2;
  while (state.accounts.some(a => a.name === n)) n = `${name} (${i++})`;
  return n;
}

/** Annule un lot d'import (opérations, titres et comptes devenus vides créés par ce lot). */
export function undoImport(state, importId) {
  const touched = new Set(state.transactions.filter(t => t.importId === importId).map(t => t.accountId));
  state.transactions = state.transactions.filter(t => t.importId !== importId);
  state.trades = state.trades.filter(t => t.importId !== importId);
  state.imports = state.imports.filter(i => i.id !== importId);
  for (const id of touched) {
    if (!state.transactions.some(t => t.accountId === id)) state.accounts = state.accounts.filter(a => a.id !== id);
  }
  const tit = state.accounts.find(a => a.type === 'titres');
  if (tit && !state.trades.some(t => t.accountId === tit.id)) state.accounts = state.accounts.filter(a => a !== tit);
  // Les liens de virement orphelins redeviennent des opérations ordinaires
  const pairs = new Map();
  for (const t of state.transactions) if (t.transferId) pairs.set(t.transferId, (pairs.get(t.transferId) || 0) + 1);
  for (const t of state.transactions) {
    if (t.transferId && pairs.get(t.transferId) < 2) {
      t.transferId = null;
      if (t.catSource === 'transfer') { t.categoryId = categorize(t, state.rules, state.settings.ownerNames); t.catSource = 'auto'; }
    }
  }
}

/**
 * Apparie les virements entre comptes : même montant, signe opposé, à 5 jours près.
 * Ils sortent des dépenses et des revenus.
 */
export function linkTransfers(state) {
  const kinds = Object.fromEntries(state.categories.map(c => [c.id, c.kind]));
  const candidates = state.transactions.filter(
    t => !t.transferId && t.catSource !== 'manual' && (kinds[t.categoryId] === 'transfert' || /\bVIR|VIREMENT|TRANSFER|INBOUND|OUTBOUND|PAYOUT/.test(norm(t.label) + ' ' + (t.meta?.trType || '')))
  );
  const byAmount = new Map();
  for (const t of candidates) {
    const k = Math.abs(t.amount);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(t);
  }
  const day = d => Date.parse(d) / 864e5;
  let linked = 0;
  for (const list of byAmount.values()) {
    const outs = list.filter(t => t.amount < 0), ins = list.filter(t => t.amount > 0);
    for (const o of outs) {
      const match = ins
        .filter(i => !i.transferId && i.accountId !== o.accountId && Math.abs(day(i.date) - day(o.date)) <= 5)
        .sort((a, b) => Math.abs(day(a.date) - day(o.date)) - Math.abs(day(b.date) - day(o.date)))[0];
      if (!match) continue;
      const id = uid('trf_');
      for (const t of [o, match]) {
        t.transferId = id;
        t.categoryId = 'virement-interne';
        t.catSource = 'transfer';
      }
      linked++;
    }
  }
  return linked;
}

/** Opérations semblables (même tiers) à une opération donnée. */
export function similarTransactions(state, tx) {
  const key = payeeKey(tx.label);
  const sign = Math.sign(tx.amount);
  return state.transactions.filter(t => t.id !== tx.id && Math.sign(t.amount) === sign && payeeKey(t.label) === key);
}

/**
 * Change la catégorie d'une opération. Si applyToSimilar, crée une règle pour ce tiers
 * et l'applique aux opérations semblables qui n'ont pas été classées à la main.
 */
export function setCategory(state, txId, categoryId, applyToSimilar = false) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return 0;
  tx.categoryId = categoryId;
  tx.catSource = 'manual';
  let n = 0;
  if (applyToSimilar) {
    const key = payeeKey(tx.label);
    const sign = tx.amount < 0 ? 'out' : 'in';
    state.rules = state.rules.filter(r => !(r.payee === key && r.sign === sign));
    state.rules.unshift({ id: uid('rule_'), payee: key, sign, categoryId, createdAt: new Date().toISOString() });
    for (const t of similarTransactions(state, tx)) {
      if (t.catSource === 'manual' || t.transferId) continue;
      t.categoryId = categoryId;
      t.catSource = 'rule';
      n++;
    }
  }
  return n;
}

export function deleteRule(state, ruleId) {
  state.rules = state.rules.filter(r => r.id !== ruleId);
}

/** Recalcule les catégories automatiques (après modification des règles). */
export function recategorizeAll(state) {
  for (const t of state.transactions) {
    if (t.catSource === 'manual' || t.transferId) continue;
    t.categoryId = categorize(t, state.rules, state.settings.ownerNames);
    t.catSource = 'auto';
  }
}

export function addManualTransaction(state, { accountId, date, amount, label, categoryId, note }) {
  const tx = { id: uid('tx_'), accountId, date, amount, label, payee: payeeDisplay(label), fitid: null, importId: null, meta: null, note: note || '', categoryId, catSource: 'manual' };
  state.transactions.push(tx);
  state.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return tx;
}

export function addAccount(state, { name, institution, type, openingBalance }) {
  const acc = { id: uid('acc_'), name: uniqueAccountName(state, name), institution: institution || 'Autre', type: type || 'courant', currency: 'EUR', externalId: null, openingBalance: openingBalance || 0, createdAt: new Date().toISOString() };
  state.accounts.push(acc);
  return acc;
}

/** Ajuste le solde d'ouverture pour que le solde à une date égale celui de la banque. */
export function adjustBalance(state, accountId, expected, atDate = null) {
  const a = accountById(state, accountId);
  if (!a) return;
  const computed = accountBalance(state, accountId, atDate);
  a.openingBalance += expected - computed;
}

export function deleteAccount(state, accountId) {
  state.transactions = state.transactions.filter(t => t.accountId !== accountId);
  state.trades = state.trades.filter(t => t.accountId !== accountId);
  state.accounts = state.accounts.filter(a => a.id !== accountId);
}
