// Point d'entrée des imports : reconnaît le format d'un fichier et le lit.
import { decodeBuffer } from '../lib/parse.js';
import { looksLikeOFX, parseOFX } from './ofx.js';
import { looksLikeQIF, parseQIF } from './qif.js';
import { looksLikeTradeRepublic, parseTradeRepublic } from './trade-republic.js';
import { parseBankCSV } from './csv-bank.js';
import { looksLikeCEStatement, parseCEStatementLines } from './ce-pdf.js';
import { looksLikeTRStatement, parseTRStatement } from './tr-pdf.js';

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
  if (isPdf(fileName, buffer)) throw new Error('Utilisez parseFileAsync pour un PDF.');
  const text = decodeBuffer(buffer);
  const lower = fileName.toLowerCase();
  let res;
  if (looksLikeOFX(text) || /\.(ofx|qfx)$/.test(lower)) res = parseOFX(text);
  else if (looksLikeQIF(text) || lower.endsWith('.qif')) res = parseQIF(text);
  else if (looksLikeTradeRepublic(text)) res = parseTradeRepublic(text);
  else res = parseBankCSV(text);
  res.fileName = fileName;
  const n = res.accounts.reduce((s, a) => s + a.transactions.length, 0) + res.trades.length;
  if (!n && !res.needsMapping) res.error = res.error || "Aucune opération n'a été trouvée dans ce fichier.";
  return res;
}

export function isPdf(fileName, buffer) {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return /\.pdf$/i.test(fileName) || (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46); // « %PDF »
}

/** Comme parseFile, mais lit aussi les relevés PDF (pdf.js chargé à la demande). */
export async function parseFileAsync(fileName, buffer) {
  if (!isPdf(fileName, buffer)) return parseFile(fileName, buffer);
  const base = { fileName, source: null, format: 'PDF', accounts: [], trades: [], warnings: [] };
  let pages, lines;
  try {
    const { pdfToPages, itemsToLines } = await import('./pdf.js');
    pages = await pdfToPages(buffer);
    lines = pages.flatMap(itemsToLines);
  } catch (e) {
    return { ...base, error: /password|mot de passe/i.test(e?.message || '') ? 'Ce PDF est protégé par un mot de passe.' : "Ce PDF n'a pas pu être lu sur ce téléphone. Essayez l'export OFX ou CSV de votre espace bancaire." };
  }
  if (!lines.some(l => l.trim())) return { ...base, error: 'Ce PDF ne contient pas de texte (document scanné ?). Pécule ne lit que les relevés téléchargés depuis la banque.' };
  let res;
  if (looksLikeTRStatement(lines)) res = parseTRStatement(pages);
  else if (looksLikeCEStatement(lines)) res = parseCEStatementLines(lines);
  else return { ...base, error: "Pécule lit les relevés PDF de la Caisse d'Épargne et de Trade Republic. Pour une autre banque, utilisez l'export OFX ou CSV." };
  res.fileName = fileName;
  if (!res.accounts.length) res.error = "Aucune opération n'a été trouvée dans ce relevé.";
  return res;
}
