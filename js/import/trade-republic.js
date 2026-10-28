// Lecture de l'export officiel Trade Republic (Profil → Relevés → Export des transactions), CSV depuis avril 2026.
// Colonnes : datetime, date, account_type, category, type, asset_class, name, symbol, shares, price, amount, fee, tax,
// currency, original_amount, original_currency, fx_rate, description, transaction_id, counterparty_name,
// counterparty_iban, payment_reference, mcc_code (+ value_date dans les versions récentes).
import { parseCSV, detectSeparator, parseAmount, parseDecimal, parseDate, headerKey } from '../lib/parse.js';

export function looksLikeTradeRepublic(text) {
  const head = headerKey(text.split(/\r?\n/)[0] || '');
  return head.includes('account type') && head.includes('asset class') && (head.includes('transaction id') || head.includes('symbol'));
}

const TYPE_LABELS = {
  CUSTOMER_INBOUND: 'Virement reçu',
  CUSTOMER_INPAYMENT: 'Dépôt',
  CUSTOMER_INBOUND_REQUEST: 'Virement reçu',
  TRANSFER_INBOUND: 'Virement reçu',
  CUSTOMER_OUTBOUND: 'Virement émis',
  CUSTOMER_OUTBOUND_REQUEST: 'Virement émis',
  TRANSFER_OUTBOUND: 'Virement émis',
  PAYOUT: 'Retrait vers votre banque',
  INTEREST_PAYMENT: 'Intérêts',
  INTEREST: 'Intérêts',
  DIVIDEND: 'Dividende',
  DISTRIBUTION: 'Distribution',
  BUY: 'Achat',
  SELL: 'Vente',
  SAVINGS_PLAN: 'Plan d\'investissement',
  SAVINGS_PLAN_EXECUTION: 'Plan d\'investissement',
  SAVEBACK: 'Saveback',
  ROUND_UP: 'Arrondi',
  CARD_TRANSACTION: 'Carte',
  CARD_REFUND: 'Remboursement carte',
  FEE: 'Frais',
  TAX: 'Impôt',
  TAX_REFUND: 'Remboursement d\'impôt',
  BONUS: 'Bonus',
};

function humanType(category, type) {
  if (TYPE_LABELS[type]) return TYPE_LABELS[type];
  const t = String(type || category || 'Opération').replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function parseTradeRepublic(text) {
  const warnings = [];
  const sep = detectSeparator(text);
  const rows = parseCSV(text, sep);
  const headers = rows[0].map(headerKey).map(h => h.replace(/ /g, '_'));
  const col = name => headers.indexOf(name);
  const C = Object.fromEntries(
    ['datetime', 'date', 'value_date', 'account_type', 'category', 'type', 'asset_class', 'name', 'symbol', 'shares', 'price', 'amount', 'fee', 'tax', 'currency', 'original_amount', 'original_currency', 'fx_rate', 'description', 'transaction_id', 'counterparty_name', 'counterparty_iban', 'payment_reference', 'mcc_code'].map(n => [n, col(n)])
  );
  const get = (r, n) => (C[n] > -1 ? r[C[n]] ?? '' : '');
  // Montants TR : point décimal, jusqu'à 6 décimales
  const money = v => (v === '' || v == null ? 0 : Math.round(Number(String(v).replace(',', '.')) * 100) || 0);

  const cash = [];
  const trades = [];
  let ignored = 0;
  for (const r of rows.slice(1)) {
    const category = get(r, 'category').toUpperCase();
    const type = get(r, 'type').toUpperCase();
    const date = parseDate(get(r, 'date')) || parseDate(get(r, 'datetime'));
    if (!date) { ignored++; continue; }
    const amount = money(get(r, 'amount'));
    const fee = money(get(r, 'fee'));
    const tax = money(get(r, 'tax'));
    const total = amount + fee + tax;
    const name = get(r, 'name');
    const isin = get(r, 'symbol');
    const shares = parseDecimal(get(r, 'shares')) || 0;
    const price = parseDecimal(get(r, 'price'));
    const txid = get(r, 'transaction_id') || null;
    const counterparty = get(r, 'counterparty_name');
    const description = get(r, 'description');
    const cancelled = type.endsWith('CANCELLED') || type.endsWith('CANCELED');

    // Mouvement sur le compte espèces
    if (total !== 0) {
      const base = humanType(category, type);
      let label;
      if (type === 'CARD_TRANSACTION' || type === 'CARD_REFUND') label = counterparty || description || base;
      else if (name) label = `${base} ${name}`;
      else if (counterparty) label = `${base} ${counterparty}`;
      else label = description ? `${base} ${description}` : base;
      if (cancelled) label = `Annulation · ${label}`;
      cash.push({
        date,
        amount: total,
        label: label.trim(),
        fitid: txid ? `tr-${txid}` : null,
        meta: { trCategory: category, trType: type, mcc: get(r, 'mcc_code') || null, isin: isin || null },
      });
    }

    // Mouvement de titres (portefeuille)
    if (isin && (shares !== 0 || /DIVIDEND|DISTRIBUTION/.test(type))) {
      let kind;
      if (/DIVIDEND|DISTRIBUTION/.test(type)) kind = 'dividend';
      else if (shares > 0 && total < 0) kind = 'buy';
      else if (shares < 0 && total > 0) kind = 'sell';
      else if (shares > 0) kind = 'in'; // titres reçus sans paiement (actions gratuites, scission…)
      else kind = 'out';
      if (cancelled && kind !== 'dividend') kind = shares > 0 ? 'in' : 'out';
      trades.push({
        date,
        isin,
        name: name || isin,
        assetClass: get(r, 'asset_class') || null,
        kind,
        shares: kind === 'dividend' ? 0 : shares,
        price: price ?? null,
        amount: total, // effet espèces net (négatif pour un achat)
        gross: amount,
        fee,
        tax,
        currency: get(r, 'original_currency') || get(r, 'currency') || 'EUR',
        txid: txid ? `tr-${txid}` : null,
        wrapper: /PEA/i.test(get(r, 'account_type')) ? 'PEA' : null,
        source: type || null, // SAVINGS_PLAN = exécution d'un plan d'investissement
      });
    } else if (total === 0 && !isin) {
      ignored++;
    }
  }
  if (ignored) warnings.push(`${ignored} ligne${ignored > 1 ? 's' : ''} sans effet sur vos comptes ignorée${ignored > 1 ? 's' : ''}.`);

  return {
    source: 'trade-republic',
    format: 'CSV Trade Republic',
    accounts: [{
      key: 'TR-CASH',
      externalId: 'TR-CASH',
      name: 'Trade Republic · espèces',
      institution: 'Trade Republic',
      type: 'courant',
      currency: 'EUR',
      balance: null,
      fromInception: true,
      transactions: cash,
    }],
    trades,
    warnings,
  };
}
