// Lecture des fichiers OFX/QFX (format « Money »), versions SGML 1.x et XML 2.x.
import { parseAmount, parseDate } from '../lib/parse.js';

// Codes banque (BANKID) des Caisses d'Épargne régionales.
const CE_BANK_CODES = new Set(['11315', '11425', '12135', '13135', '13335', '13485', '13825', '14265', '14445', '14505', '15135', '16275', '17515', '18025', '18315', '18715', '43199']);

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}

function blocks(text, name) {
  const out = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)(?=<\\/${name}>|<${name}>|$)`, 'gi');
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

export function looksLikeOFX(text) {
  return /OFXHEADER|<OFX>/i.test(text.slice(0, 2000));
}

export function parseOFX(text) {
  const warnings = [];
  const org = tag(text, 'ORG') || '';
  const stmts = [...blocks(text, 'STMTRS').map(b => ({ b, card: false })), ...blocks(text, 'CCSTMTRS').map(b => ({ b, card: true }))];
  const accounts = [];
  for (const { b, card } of stmts) {
    const bankId = tag(b, 'BANKID') || '';
    const branch = tag(b, 'BRANCHID') || '';
    const acct = tag(b, 'ACCTID') || '';
    const acctType = (tag(b, 'ACCTTYPE') || '').toUpperCase();
    const currency = tag(b, 'CURDEF') || 'EUR';
    const isCE = CE_BANK_CODES.has(bankId) || /CAISSE|EPARGNE|CEPAC/i.test(org);
    const institution = isCE ? "Caisse d'Épargne" : (org || 'Banque');
    const txs = [];
    for (const t of blocks(b, 'STMTTRN')) {
      const date = parseDate(tag(t, 'DTPOSTED') || tag(t, 'DTUSER'));
      const amount = parseAmount(tag(t, 'TRNAMT'));
      if (!date || amount == null) { warnings.push('Une opération illisible a été ignorée.'); continue; }
      const name = decodeEntities(tag(t, 'NAME') || tag(t, 'PAYEE') || '');
      const memo = decodeEntities(tag(t, 'MEMO') || '');
      let label = name;
      if (memo && !name.includes(memo) && !memo.includes(name)) label = name ? `${name} ${memo}` : memo;
      else if (memo.length > name.length) label = memo;
      txs.push({
        date,
        amount,
        label: label.replace(/\s+/g, ' ').trim() || '(sans libellé)',
        fitid: tag(t, 'FITID') || null,
        meta: { trntype: tag(t, 'TRNTYPE') },
      });
    }
    let balance = null;
    const ledger = blocks(b, 'LEDGERBAL')[0];
    if (ledger) {
      const amt = parseAmount(tag(ledger, 'BALAMT'));
      const d = parseDate(tag(ledger, 'DTASOF'));
      if (amt != null) balance = { amount: amt, date: d };
    }
    const last4 = acct.replace(/\D/g, '').slice(-4);
    let type = 'courant';
    if (card) type = 'carte';
    else if (/SAVINGS|MONEYMRKT/.test(acctType)) type = 'livret';
    accounts.push({
      key: `${bankId}-${branch}-${acct}`,
      externalId: `${bankId}-${acct}`,
      name: `${type === 'livret' ? 'Épargne' : type === 'carte' ? 'Carte' : 'Compte courant'}${last4 ? ' ···' + last4 : ''}`,
      institution,
      type,
      currency,
      balance,
      transactions: txs,
    });
  }
  if (!accounts.length) warnings.push('Aucun relevé trouvé dans ce fichier OFX.');
  return { source: accounts.some(a => a.institution === "Caisse d'Épargne") ? 'caisse-epargne' : 'ofx', format: 'OFX', accounts, trades: [], warnings };
}
