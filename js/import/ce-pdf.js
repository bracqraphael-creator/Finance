// Lecture des relevés de compte PDF de la Caisse d'Épargne (« Votre relevé de comptes N° … »).
// Entrée : les lignes de texte du PDF, dans l'ordre de lecture (voir pdf.js). Fonction pure, testable sans PDF.
import { parseAmount } from '../lib/parse.js';

const DATE = '(\\d{2}\\/\\d{2}\\/\\d{4})';
const AMOUNT = '([+-])\\s*(\\d{1,3}(?:[ .\\u00a0]\\d{3})*,\\d{2})';
const RE = {
  synth: /^SYNTHESE DE VOS COMPTES/,
  detail: /^DETAIL DE VOS OPERATIONS/,
  holder: /^(MR|M\.|MME|MLLE|MONSIEUR|MADAME|MR OU MME|M OU MME)\s+([A-ZÀ-Ÿ' \-]+)$/,
  synthLine: new RegExp(`^(.+?)\\s+N°\\s*(\\d{5})\\s+(\\d{5})\\s+(\\d{11})\\s+Solde au\\s+${DATE}\\s+${AMOUNT}`),
  section: /^(.+?)\s+-\s+N°\s*(\d{6,11})$/,
  suite: /N°\s*(\d{5})\s+\d{5}\s+(\d{11})\s+\(suite\)/,
  solde: new RegExp(`SOLDE (CREDITEUR|DEBITEUR) AU ${DATE}\\s+([+-])?\\s*(\\d{1,3}(?:[ .\\u00a0]\\d{3})*,\\d{2})`),
  op: new RegExp(`^${DATE}\\s+${DATE}\\s+(.+?)\\s+${AMOUNT}$`),
  stop: /^VOS SERVICES ASSOCIES|^INFORMATIONS? (SUR|RELATIVES)/,
  furniture: /^(EN\d{6,}|GB[+ ]|DATE\b|D'OPERATION|\* Les lignes|Relevé n°|Page \d|Caisse d'Epargne|Téléphone|"Transactions|-Intermédiaire|et suivants|BIC :|JE CONSERVE|CE DOCUMENT)/,
};

/** Recolle les dates découpées en morceaux par le PDF (« 09 / 10 / 20 26 » → « 09/10/2026 »). */
function normalize(line) {
  return line
    .replace(/(\d{2}) ?\/ ?(\d{2}) ?\/ ?(\d{2}) ?(\d{2})\b/g, '$1/$2/$3$4')
    .replace(/\s+/g, ' ')
    .trim();
}
const iso = d => { const [j, m, y] = d.split('/'); return `${y}-${m}-${j}`; };
const signed = (sign, num) => { const v = parseAmount(num); return sign === '-' ? -v : v; };

const ACCOUNT_NAMES = [
  [/COMPTE DE DEPOT|COMPTE CHEQUES|CPTE CHEQUES/, 'Compte de dépôt', 'courant'],
  [/LIV\.?\s?A\b|LIVRET A\b/, 'Livret A', 'livret'],
  [/L\.?\s?JEUNE|LIVRET JEUNE/, 'Livret Jeune', 'livret'],
  [/\bLDDS?\b|DEV(ELOPPEMENT)? DURABLE/, 'LDDS', 'livret'],
  [/\bLEP\b|EPARGNE POPULAIRE/, 'LEP', 'livret'],
  [/\bCEL\b|EPARGNE LOGEMENT/, 'Compte épargne logement', 'livret'],
  [/\bPEL\b|PLAN EPARGNE LOGEMENT/, 'Plan épargne logement', 'livret'],
  [/LIVRET/, 'Livret', 'livret'],
];
function describe(label) {
  const L = label.toUpperCase();
  for (const [re, name, type] of ACCOUNT_NAMES) if (re.test(L)) return { name, type };
  return { name: label.charAt(0) + label.slice(1).toLowerCase(), type: 'courant' };
}

export function looksLikeCEStatement(lines) {
  const head = lines.slice(0, 80).join('\n');
  return /DETAIL DE VOS OPERATIONS|SYNTHESE DE VOS COMPTES/.test(head) || (/Caisse d'Epargne/i.test(lines.join('\n')) && lines.some(l => RE.op.test(normalize(l))));
}

export function parseCEStatementLines(rawLines) {
  const warnings = [];
  const synth = new Map();   // n° de compte → { label, bank, balance, date }
  const acc = new Map();     // n° de compte → { label, ops, opening, closing }
  let holder = null, inSynth = false, cur = null, last = null, statementDate = null, bank = null;
  const get = n => { if (!acc.has(n)) acc.set(n, { label: synth.get(n)?.label || '', ops: [], opening: null, closing: null }); return acc.get(n); };

  for (const raw of rawLines) {
    const line = normalize(raw);
    if (!line) continue;
    let m;
    if ((m = line.match(/relevé de comptes N° \d+ au (\d{2}\/\d{2}\/\d{4})/i))) statementDate = iso(m[1]);
    if (RE.stop.test(line)) { cur = null; last = null; continue; }
    if (RE.synth.test(line)) { inSynth = true; continue; }
    if (RE.detail.test(line)) { inSynth = false; continue; }
    if ((m = line.match(RE.holder)) && !RE.op.test(line)) { if (!holder) holder = m[2].trim(); continue; }
    if (inSynth && (m = line.match(RE.synthLine))) {
      bank = bank || m[2];
      synth.set(m[4], { label: m[1].trim(), bank: m[2], date: iso(m[5]), balance: signed(m[6], m[7]) });
      continue;
    }
    if ((m = line.match(RE.suite))) { cur = m[2]; bank = bank || m[1]; last = null; continue; }
    if ((m = line.match(RE.section))) {
      const n = m[2].padStart(11, '0');
      cur = n;
      const a = get(n);
      if (!a.label) a.label = m[1].trim();
      last = null;
      continue;
    }
    if ((m = line.match(RE.solde))) {
      if (cur) {
        const a = get(cur);
        const v = Math.abs(parseAmount(m[4]));
        const b = { amount: m[1] === 'DEBITEUR' || m[3] === '-' ? -v : v, date: iso(m[2]) };
        if (!a.opening && !a.ops.length) a.opening = b; else a.closing = b;
      }
      last = null;
      continue;
    }
    if ((m = line.match(RE.op))) {
      if (!cur) continue;
      let label = m[3].trim();
      const bankFee = label.startsWith('*');
      if (bankFee) label = label.replace(/^\*\s*/, '');
      last = { date: iso(m[1]), valueDate: iso(m[2]), label, amount: signed(m[4], m[5]), bankFee, details: [], refs: [] };
      get(cur).ops.push(last);
      continue;
    }
    if (last && !RE.furniture.test(line) && !/^\d+( \d+)*$/.test(line) && line.length < 100) {
      if (/^-(Réf|Ref)/.test(line)) last.refs.push(line.replace(/^-/, ''));
      else if (/^-Provenance/.test(line)) last.from = line.replace(/^-Provenance\s*:\s*/, '');
      else last.details.push(line.replace(/^-/, ''));
    }
  }

  const numbers = [...new Set([...synth.keys(), ...acc.keys()])];
  const accounts = numbers.map(n => {
    const s = synth.get(n), a = acc.get(n) || { label: s?.label || '', ops: [], opening: null, closing: null };
    const { name, type } = describe(a.label || s?.label || 'Compte');
    const balance = a.closing || (s ? { amount: s.balance, date: s.date } : null);
    if (a.opening && a.closing) {
      const sum = a.ops.reduce((t, o) => t + o.amount, 0);
      const diff = a.closing.amount - (a.opening.amount + sum);
      if (diff !== 0) warnings.push(`${name} : les opérations lues ne retombent pas sur le solde du relevé (écart de ${(diff / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}). Vérifiez-les après l'import.`);
    }
    return {
      key: n,
      externalId: `${s?.bank || bank || 'CE'}-${n}`,
      name: `${name} ···${n.slice(-4)}`,
      institution: "Caisse d'Épargne",
      type,
      currency: 'EUR',
      balance,
      transactions: a.ops.map(o => ({
        date: o.date,
        amount: o.amount,
        label: o.label,
        fitid: null,
        meta: { valueDate: o.valueDate, detail: o.details.join(' · ') || null, from: o.from || null, bankFee: o.bankFee || undefined },
      })),
    };
  });
  if (!accounts.length) warnings.push("Aucun compte reconnu dans ce relevé.");
  return { source: 'caisse-epargne', format: 'Relevé PDF', accounts, trades: [], warnings, holder, statementDate };
}
