// Lecture des CSV bancaires : Caisse d'Épargne (anciens et nouveaux formats) et CSV génériques.
import { parseCSV, detectSeparator, parseAmount, parseDate, headerKey } from '../lib/parse.js';

// Synonymes de colonnes (normalisés : minuscules, sans accents).
const COLS = {
  date: ['date de comptabilisation', 'date comptable', 'date operation', 'date d operation', 'date', 'date de l operation', 'booking date'],
  valueDate: ['date de valeur', 'date valeur'],
  label: ['libelle operation', 'libelle', 'libelle simplifie', 'intitule', 'description', 'label', 'nature de l operation', 'operation'],
  detail: ['informations complementaires', 'detail', 'details', 'complement', 'libelle complementaire'],
  debit: ['debit', 'debit euros', 'debit eur', 'montant debit', 'sortie', 'depenses'],
  credit: ['credit', 'credit euros', 'credit eur', 'montant credit', 'entree', 'recettes'],
  amount: ['montant', 'montant eur', 'montant euros', 'montant de l operation', 'amount', 'somme'],
  ref: ['reference', 'numero d operation', 'numero operation', 'n d operation', 'id', 'reference de l operation'],
};

function findCol(headers, names) {
  const keys = headers.map(headerKey);
  for (const n of names) {
    const i = keys.indexOf(n);
    if (i > -1) return i;
  }
  for (const n of names) {
    const i = keys.findIndex(k => k.startsWith(n));
    if (i > -1) return i;
  }
  return -1;
}

/** Repère la ligne d'en-tête : la première qui contient une colonne date et une colonne montant. */
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    const hasDate = findCol(r, COLS.date) > -1;
    const hasMoney = findCol(r, COLS.debit) > -1 || findCol(r, COLS.amount) > -1 || findCol(r, COLS.credit) > -1;
    if (hasDate && hasMoney) return i;
  }
  return -1;
}

export function guessMapping(headers) {
  return {
    date: findCol(headers, COLS.date),
    label: findCol(headers, COLS.label),
    detail: findCol(headers, COLS.detail),
    debit: findCol(headers, COLS.debit),
    credit: findCol(headers, COLS.credit),
    amount: findCol(headers, COLS.amount),
    ref: findCol(headers, COLS.ref),
  };
}

/** Applique une correspondance de colonnes à des lignes CSV. */
export function rowsToTransactions(rows, map) {
  const txs = [];
  let skipped = 0;
  for (const r of rows) {
    const date = parseDate(r[map.date]);
    let amount = null;
    if (map.amount > -1 && r[map.amount] != null && String(r[map.amount]).trim() !== '') {
      amount = parseAmount(r[map.amount]);
    } else {
      const d = map.debit > -1 ? parseAmount(r[map.debit]) : null;
      const c = map.credit > -1 ? parseAmount(r[map.credit]) : null;
      if (d != null || c != null) amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
    }
    if (!date || amount == null) { skipped++; continue; }
    let label = map.label > -1 ? r[map.label] : '';
    const detail = map.detail > -1 ? r[map.detail] : '';
    if (detail && !label.includes(detail)) label = label ? `${label} ${detail}` : detail;
    const ref = map.ref > -1 ? r[map.ref] : '';
    txs.push({ date, amount, label: label.replace(/\s+/g, ' ').trim() || '(sans libellé)', fitid: ref ? `ref-${ref}` : null });
  }
  return { txs, skipped };
}

export function looksLikeBankCSV(text) {
  const sep = detectSeparator(text);
  const rows = parseCSV(text.split(/\r?\n/).slice(0, 40).join('\n'), sep);
  return findHeader(rows) > -1;
}

export function parseBankCSV(text) {
  const warnings = [];
  const sep = detectSeparator(text);
  const rows = parseCSV(text, sep);
  const h = findHeader(rows);
  const preamble = rows.slice(0, Math.max(h, 0)).map(r => r.join(';')).join('\n');
  const isCE = /caisse d.?epargne|caisse d.?épargne|numero de compte|numéro de compte|libelle simplifie|code de la banque/i.test(
    preamble + ' ' + (rows[h] || []).join(';')
  );

  if (h < 0) {
    // En-tête non reconnu : l'utilisateur fera la correspondance des colonnes.
    return { source: 'csv', format: 'CSV', accounts: [], trades: [], warnings, needsMapping: { sep, rows: rows.slice(0, 400) } };
  }
  const headers = rows[h];
  const map = guessMapping(headers);
  const { txs, skipped } = rowsToTransactions(rows.slice(h + 1), map);
  if (skipped) warnings.push(`${skipped} ligne${skipped > 1 ? 's' : ''} sans date ou sans montant ignorée${skipped > 1 ? 's' : ''} (totaux, soldes…).`);

  // Préambule de l'ancien format Caisse d'Épargne : numéro de compte et solde final.
  let externalId = null, balance = null;
  const acc = preamble.match(/Num[ée]ro de compte\s*:?\s*;?\s*([A-Z0-9 ]{5,})/i);
  if (acc) externalId = acc[1].replace(/\s/g, '');
  for (const r of rows.slice(0, h).concat(rows.slice(-4))) {
    const line = r.join(';');
    if (/solde (en fin de p[ée]riode|final|au)/i.test(line)) {
      const nums = r.map(parseAmount).filter(v => v != null);
      const date = r.map(parseDate).find(Boolean);
      if (nums.length) balance = { amount: nums.at(-1), date: date || null };
    }
  }
  const last4 = externalId ? externalId.slice(-4) : '';
  return {
    source: isCE ? 'caisse-epargne' : 'csv',
    format: 'CSV',
    accounts: [{
      key: externalId || 'csv',
      externalId: externalId ? `CE-${externalId}` : null,
      name: `Compte courant${last4 ? ' ···' + last4 : ''}`,
      institution: isCE ? "Caisse d'Épargne" : 'Banque',
      type: 'courant',
      currency: 'EUR',
      balance,
      transactions: txs,
    }],
    trades: [],
    warnings,
    mapping: { headers, map, sep },
  };
}
