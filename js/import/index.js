// Point d'entrée des imports : reconnaît le format d'un fichier et le lit.
import { decodeBuffer } from '../lib/parse.js';
import { looksLikeOFX, parseOFX } from './ofx.js';
import { looksLikeQIF, parseQIF } from './qif.js';
import { looksLikeTradeRepublic, parseTradeRepublic } from './trade-republic.js';
import { parseBankCSV } from './csv-bank.js';

export const SOURCE_LABELS = {
  'caisse-epargne': "Caisse d'Épargne",
  'trade-republic': 'Trade Republic',
  ofx: 'Fichier OFX',
  qif: 'Fichier QIF',
  csv: 'Fichier CSV',
};

/**
 * @param {string} fileName
 * @param {ArrayBuffer|Uint8Array} buffer
 */
export function parseFile(fileName, buffer) {
  const text = decodeBuffer(buffer);
  const lower = fileName.toLowerCase();
  let res;
  if (looksLikeOFX(text) || /\.(ofx|qfx)$/.test(lower)) res = parseOFX(text);
  else if (looksLikeQIF(text) || lower.endsWith('.qif')) res = parseQIF(text);
  else if (looksLikeTradeRepublic(text)) res = parseTradeRepublic(text);
  else if (/\.pdf$/.test(lower)) {
    return { fileName, source: null, format: 'PDF', accounts: [], trades: [], warnings: [], error: 'Les relevés PDF ne sont pas encore lus. Exportez plutôt vos opérations en OFX ou en CSV depuis votre espace bancaire.' };
  } else res = parseBankCSV(text);
  res.fileName = fileName;
  const n = res.accounts.reduce((s, a) => s + a.transactions.length, 0) + res.trades.length;
  if (!n && !res.needsMapping) res.error = res.error || "Aucune opération n'a été trouvée dans ce fichier.";
  return res;
}
