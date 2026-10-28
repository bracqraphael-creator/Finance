// Normalisation des libellés bancaires et extraction du « tiers ».

export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Majuscules, sans accents, espaces simples. */
export function norm(s) {
  return stripAccents(s).toUpperCase().replace(/[\s ]+/g, ' ').trim();
}

// Préfixes techniques ajoutés par les banques devant le vrai nom du tiers.
const PREFIXES = [
  /^PAIEMENT (PAR )?CARTE( X?\d{4})?( \d{2}\/\d{2}(\/\d{2,4})?)?/,
  /^PAIEMENT CB( \d{2}\/\d{2}(\/\d{2,4})?)?/,
  /^CB\*?( X?\d{4})?( \d{2}\/\d{2}(\/\d{2,4})?)?/,
  /^CARTE( X?\d{4})?( \d{2}\/\d{2}(\/\d{2,4})?)?/,
  /^FACT(URE)? ?(CARTE|CB)?( DU)?( \d{6})?/,
  /^PRLV( SEPA)?/,
  /^PRELEVEMENT( SEPA)?( EUROPEEN)?/,
  /^ECHEANCE PRET/,
  /^VIR(EMENT)?( SEPA)?( INST(ANTANE)?)?( RECU| EMIS)?(?: (?:DE|A|VERS|POUR)\b)?/,
  /^RETRAIT (DAB|CB)?( \d{2}\/\d{2}(\/\d{2,4})?)?/,
  /^ACHAT CB/,
  /^ACHAT/,
];

const STOP = new Set(['DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET', 'A', 'AU', 'AUX', 'EN', 'PAR', 'POUR']);

/** Clé stable d'un tiers, utilisée pour les règles et la détection d'abonnements. */
export function payeeKey(label) {
  let s = norm(label);
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const p of PREFIXES) s = s.replace(p, '').trim();
    if (s === before) break;
  }
  s = s
    .replace(/\bCARTE\s+X?\d{4}\b/g, ' ')
    .replace(/\bFACT(URE)?\s+\d{6}\b.*$/, ' ') // « CB MAGASIN FACT 090926 » (date de facture des relevés Caisse d'Épargne)
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, ' ') // dates
    .replace(/\bX{2,}\d+\b/g, ' ')
    .replace(/\b(REF|REFERENCE|MOTIF|ID|ICS|RUM|NUM|NO|N°)\b.*$/, ' ') // références de mandat
    .replace(/\b\d{5,}\b/g, ' ') // longs numéros
    .replace(/\b(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE|JANV|FEVR|AVR|JUIL|SEPT|OCT|NOV|DEC)\b/g, ' ') // « SALAIRE OCTOBRE » = « SALAIRE NOVEMBRE »
    .replace(/[*#:;_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter(w => w.length > 1 || /\d/.test(w)).slice(0, 4);
  while (words.length > 1 && STOP.has(words.at(-1))) words.pop();
  return words.join(' ') || norm(label).slice(0, 24);
}

/** Nom lisible du tiers : « FREE MOBILE » → « Free Mobile ». */
export function payeeDisplay(label) {
  const k = payeeKey(label);
  return k
    .toLowerCase()
    .replace(/(^|[\s\-.&/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

export function uid(prefix = '') {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
