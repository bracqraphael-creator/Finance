// Lecture des montants, des dates et des fichiers CSV.

/** Texte d'un fichier : UTF-8 si valide, sinon Windows-1252 (fréquent dans les exports bancaires). */
export function decodeBuffer(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

/**
 * Montant en centimes. Accepte « -1 234,56 », « 1.234,56 », « -12.5 », « +3,00 € ».
 * Renvoie null si vide ou illisible.
 */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[\s  €]|EUR/g, '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(/,/g, '.');
    // « 1,234,567 » improbable en France : on garde la dernière comme décimale
    const parts = s.split('.');
    if (parts.length > 2) s = parts.slice(0, -1).join('') + '.' + parts.at(-1);
  }
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
  const v = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

/** Nombre décimal (quantités de titres, cours). */
export function parseDecimal(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[\s  €]/g, '').trim();
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma > -1) s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

const pad = n => String(n).padStart(2, '0');

/** Date en « AAAA-MM-JJ ». Accepte JJ/MM/AAAA, JJ/MM/AA, JJ-MM-AAAA, AAAA-MM-JJ, AAAAMMJJ, ISO avec heure. */
export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-'](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y > 70 ? 1900 : 2000;
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

/** Devine le séparateur d'un CSV à partir de ses premières lignes. */
export function detectSeparator(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
  const cands = [';', ',', '\t', '|'];
  let best = ';', bestScore = -1;
  for (const c of cands) {
    const counts = lines.map(l => splitLine(l, c).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    const consistent = counts.filter(n => n === max).length;
    const score = consistent * max;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function splitLine(line, sep) {
  return parseCSV(line, sep)[0] || [];
}

/** Analyse CSV conforme RFC 4180 (guillemets, retours ligne dans les champs). */
export function parseCSV(text, sep = ';') {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      inQ = true; field = '';
    } else if (ch === sep) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows.map(r => r.map(f => f.trim()));
}

export function headerKey(h) {
  return String(h).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
