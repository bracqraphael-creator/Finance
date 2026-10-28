// Lecture des fichiers QIF (format « Quicken »).
import { parseAmount, parseDate } from '../lib/parse.js';

export function looksLikeQIF(text) {
  return /^!(Type|Account|Option)/im.test(text.slice(0, 500));
}

export function parseQIF(text) {
  const warnings = [];
  const txs = [];
  let cur = {};
  let type = 'courant';
  const typeLine = text.match(/^!Type:(\w+)/im);
  if (typeLine && /CCard/i.test(typeLine[1])) type = 'carte';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('!')) continue;
    const code = line[0], val = line.slice(1).trim();
    if (code === '^') {
      if (cur.D) {
        const date = parseDate(cur.D);
        const amount = parseAmount(cur.T ?? cur.U);
        if (date && amount != null) {
          let label = cur.P || '';
          if (cur.M && !label.includes(cur.M)) label = label ? `${label} ${cur.M}` : cur.M;
          txs.push({ date, amount, label: label.trim() || '(sans libellé)', fitid: cur.N ? `qif-${cur.N}` : null });
        } else warnings.push('Une opération illisible a été ignorée.');
      }
      cur = {};
    } else if ('DTUPMNL'.includes(code)) {
      cur[code] = val;
    }
  }
  return {
    source: 'qif',
    format: 'QIF',
    accounts: [{ key: 'qif', externalId: null, name: type === 'carte' ? 'Carte' : 'Compte courant', institution: 'Banque', type, currency: 'EUR', balance: null, transactions: txs }],
    trades: [],
    warnings,
  };
}
