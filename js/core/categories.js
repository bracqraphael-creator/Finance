// Catégories par défaut et catégorisation automatique.
import { norm, payeeKey } from '../lib/text.js';

// kind : 'depense' | 'revenu' | 'transfert' (les transferts ne comptent ni en dépenses ni en revenus)
export const DEFAULT_CATEGORIES = [
  { id: 'alimentation', name: 'Courses', icon: '🛒', kind: 'depense', color: '#4E8A5B' },
  { id: 'restaurants', name: 'Restaurants', icon: '🍽️', kind: 'depense', color: '#C8743A' },
  { id: 'logement', name: 'Logement', icon: '🏠', kind: 'depense', color: '#5B6FA8' },
  { id: 'transports', name: 'Transports', icon: '🚆', kind: 'depense', color: '#3D8C99' },
  { id: 'abonnements', name: 'Abonnements', icon: '📱', kind: 'depense', color: '#8A5BA8' },
  { id: 'sante', name: 'Santé', icon: '💊', kind: 'depense', color: '#B5525E' },
  { id: 'assurances', name: 'Assurances', icon: '🛡️', kind: 'depense', color: '#6A7A86' },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', kind: 'depense', color: '#B8893A' },
  { id: 'loisirs', name: 'Loisirs', icon: '🎟️', kind: 'depense', color: '#D06A8C' },
  { id: 'voyages', name: 'Voyages', icon: '✈️', kind: 'depense', color: '#2F7FB8' },
  { id: 'banque', name: 'Frais bancaires', icon: '🏦', kind: 'depense', color: '#7D6B5D' },
  { id: 'impots', name: 'Impôts et taxes', icon: '🧾', kind: 'depense', color: '#8C4A3A' },
  { id: 'especes', name: 'Retraits d\'espèces', icon: '💶', kind: 'depense', color: '#5E8A7A' },
  { id: 'cadeaux', name: 'Cadeaux et dons', icon: '🎁', kind: 'depense', color: '#C25A7C' },
  { id: 'divers', name: 'Divers', icon: '•', kind: 'depense', color: '#8E979E' },
  { id: 'salaire', name: 'Salaire', icon: '💼', kind: 'revenu', color: '#2F6B4F' },
  { id: 'aides', name: 'Aides et allocations', icon: '🤝', kind: 'revenu', color: '#4F8F6B' },
  { id: 'remboursements', name: 'Remboursements', icon: '↩️', kind: 'revenu', color: '#6FA382' },
  { id: 'placements-revenus', name: 'Dividendes et intérêts', icon: '🌱', kind: 'revenu', color: '#3E7D5E' },
  { id: 'autres-revenus', name: 'Autres revenus', icon: '➕', kind: 'revenu', color: '#7FA68E' },
  { id: 'virement-interne', name: 'Virement entre mes comptes', icon: '⇄', kind: 'transfert', color: '#9AA4AB' },
  { id: 'epargne', name: 'Épargne et placements', icon: '📈', kind: 'transfert', color: '#B3862E' },
];

// Mots-clés fréquents sur les relevés français. sign : 'out' (débit) | 'in' (crédit) | undefined
const K = (category, words, sign) => ({ category, words, sign });
export const BUILTIN_RULES = [
  K('virement-interne', ['VIR INTERNE', 'VIREMENT INTERNE', 'VIR CPTE A CPTE', 'VIREMENT DE COMPTE A COMPTE']),
  K('epargne', ['TRADE REPUBLIC', 'LIVRET A', 'LDDS', 'LIVRET DEV', 'LEP ', 'PEL ', 'ASSURANCE VIE', 'BOURSORAMA', 'DEGIRO', 'BOURSE DIRECT', 'YOMONI', 'NALO', 'LINXEA', 'PEA '], 'out'),
  K('salaire', ['SALAIRE', ' PAIE ', 'PAYE ', 'REMUNERATION'], 'in'),
  K('aides', ['CAF ', 'C.A.F', 'ALLOCATION', 'FRANCE TRAVAIL', 'POLE EMPLOI', 'PRIME D ACTIVITE', 'APL '], 'in'),
  K('remboursements', ['CPAM', 'REMBOURSEMENT', 'REMB ', 'AVOIR', 'MUTUELLE', 'HARMONIE', 'MGEN', 'ALAN '], 'in'),
  K('banque', ['COTISATION', 'FRAIS ', 'COMMISSION', 'AGIOS', 'INTERETS DEBITEURS', 'COM INTERVENTION', 'TENUE DE COMPTE', 'OFFRE GROUPEE', 'FORFAIT BANC', 'MINIMUM FACTURABLE'], 'out'),
  K('impots', ['DGFIP', 'IMPOT', 'TRESOR PUBLIC', 'FINANCES PUBLIQUES', 'ANTAI', 'AMENDE', 'TAXE FONCIERE', 'TAXE HABITATION', 'URSSAF'], 'out'),
  K('especes', ['RETRAIT DAB', 'RETRAIT CB', 'RETRAIT ', 'DAB '], 'out'),
  K('restaurants', ['UBER EATS', 'UBER *EATS', 'UBER  *EATS', 'UBEREATS', 'DELIVEROO', 'JUST EAT', 'MCDONALD', 'MC DONALD', 'BURGER KING', 'KFC', 'RESTAURANT', 'BRASSERIE', 'STARBUCKS', 'SUBWAY', 'DOMINO', 'PIZZ', 'SUSHI', 'O TACOS', 'BISTRO', 'CREPERIE', 'BOULANGERIE PAUL', 'COLUMBUS CAFE', 'FIVE GUYS', 'LA CROISSANTERIE']),
  K('alimentation', ['CARREFOUR', 'LECLERC', 'AUCHAN', 'INTERMARCHE', 'LIDL', 'ALDI', 'MONOPRIX', 'MONOP', 'FRANPRIX', 'CASINO', 'SUPER U', 'HYPER U', 'MARCHE U', 'U EXPRESS', 'PICARD', 'BIOCOOP', 'NATURALIA', 'GRAND FRAIS', 'NETTO', 'CORA', 'G20', 'SPAR', 'LEADER PRICE', 'BOULANGERIE', 'BOUCHERIE', 'PRIMEUR', 'LA VIE CLAIRE', 'CHRONODRIVE', 'EPICERIE']),
  K('transports', ['SNCF', 'OUIGO', 'TRAINLINE', 'RATP', 'NAVIGO', 'UBER', 'BOLT', 'HEETCH', 'G7', 'BLABLACAR', 'TOTALENERGIES STATION', 'TOTAL ', 'ESSO', 'SHELL', ' BP ', 'AVIA', 'STATION', 'CARBURANT', 'PEAGE', 'VINCI AUTOROUTE', 'SANEF', 'APRR', 'AREA ', 'PARKING', 'INDIGO', 'TRANSDEV', 'KEOLIS', 'LIME', 'VELIB', 'DOTT', 'TIER ', 'GETAROUND']),
  K('abonnements', ['NETFLIX', 'SPOTIFY', 'DEEZER', 'DISNEY', 'CANAL', 'AMAZON PRIME', 'PRIME VIDEO', 'APPLE.COM/BILL', 'APPLE.COM', 'ITUNES', 'ICLOUD', 'GOOGLE STORAGE', 'GOOGLE ONE', 'YOUTUBE', 'FREE MOBILE', 'FREE TELECOM', 'FREEBOX', 'ORANGE', 'SOSH', 'SFR', 'RED BY SFR', 'BOUYGUES', 'B&YOU', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'CLAUDE.AI', 'ADOBE', 'MICROSOFT', 'DAZN', 'BASIC FIT', 'BASIC-FIT', 'FITNESS PARK', 'NEONESS', 'ON AIR', 'AUDIBLE', 'KINDLE', 'MOLOTOV', 'PARAMOUNT', 'MAX ', 'CRUNCHYROLL', 'NORD VPN', 'NORDVPN', 'DROPBOX']),
  K('logement', ['LOYER', 'FONCIA', 'NEXITY', 'CITYA', 'SYNDIC', 'EDF', 'ENGIE', 'ENEDIS', 'GRDF', 'VEOLIA', 'SUEZ', 'EAU DE', 'EKWATEUR', 'MINT ENERGIE', 'OHM ENERGIE', 'LEROY MERLIN', 'CASTORAMA', 'BRICO', 'MR BRICOLAGE', 'ECHEANCE PRET', 'PRET IMMO', 'CREDIT IMMO']),
  K('sante', ['PHARMACIE', 'PHARMA', 'DOCTOLIB', 'MEDECIN', 'DR ', 'DOCTEUR', 'DENTISTE', 'DENTAIRE', 'LABORATOIRE', 'LABO ', 'CLINIQUE', 'HOPITAL', 'OPTIQUE', 'OPTICIEN', 'KINE', 'OSTEO', 'PSY'], 'out'),
  K('assurances', ['ASSURANCE', 'MAAF', 'MACIF', 'MATMUT', 'AXA', 'ALLIANZ', 'GMF', 'MAIF', 'GROUPAMA', 'MUTUELLE', 'ALAN', 'HARMONIE', 'MGEN', 'LUKO', 'HISCOX', 'APRIL', 'GENERALI', 'SWISSLIFE', 'MMA '], 'out'),
  K('voyages', ['AIRBNB', 'BOOKING', 'HOTEL', 'AIR FRANCE', 'EASYJET', 'RYANAIR', 'TRANSAVIA', 'VUELING', 'VOLOTEA', 'EXPEDIA', 'LASTMINUTE', 'ABRITEL', 'IBIS', 'NOVOTEL', 'ACCOR']),
  K('loisirs', ['CINEMA', 'PATHE', 'UGC', 'GAUMONT', 'MK2', 'TICKETMASTER', 'FNAC SPECTACLE', 'STEAM', 'PLAYSTATION', 'NINTENDO', 'XBOX', 'BOWLING', 'MUSEE', 'THEATRE', 'CONCERT', 'PARC ', 'DISNEYLAND', 'LIBRAIRIE', 'CULTURA']),
  K('shopping', ['AMAZON', 'AMZN', 'FNAC', 'DARTY', 'BOULANGER', 'ZARA', 'H&M', 'H & M', 'UNIQLO', 'KIABI', 'DECATHLON', 'IKEA', 'ACTION', 'SEPHORA', 'NOCIBE', 'MARIONNAUD', 'CDISCOUNT', 'VINTED', 'ALIEXPRESS', 'SHEIN', 'TEMU', 'ZALANDO', 'LEBONCOIN', 'APPLE STORE', 'GIFI', 'MAISONS DU MONDE', 'CELIO', 'JULES', 'PRIMARK', 'NIKE', 'ADIDAS', 'GO SPORT', 'INTERSPORT', 'NORAUTO', 'FEU VERT']),
  K('cadeaux', ['DON ', 'CROIX ROUGE', 'UNICEF', 'MSF', 'RESTOS DU COEUR', 'LEETCHI', 'LYDIA CAGNOTTE']),
];

/** Catégorie automatique d'une opération (règles de l'utilisateur d'abord, puis règles intégrées). */
export function categorize(tx, userRules = []) {
  const label = ' ' + norm(tx.label) + ' ';
  const key = payeeKey(tx.label);
  const sign = tx.amount < 0 ? 'out' : 'in';

  for (const r of userRules) {
    if (r.sign && r.sign !== sign) continue;
    if (r.payee ? key === r.payee : label.includes(' ' + norm(r.value))) return r.categoryId;
    if (r.payee && label.includes(' ' + r.payee + ' ')) return r.categoryId;
  }

  // Opérations Trade Republic : le type de l'export suffit
  const t = tx.meta?.trType;
  if (t) {
    if (/^(BUY|SELL|SAVINGS_PLAN|SAVINGS_PLAN_EXECUTION|SAVEBACK|ROUND_UP)/.test(t)) return 'epargne';
    if (/DIVIDEND|DISTRIBUTION|INTEREST/.test(t)) return 'placements-revenus';
    if (/^(CUSTOMER_INBOUND|CUSTOMER_INPAYMENT|TRANSFER_INBOUND|CUSTOMER_OUTBOUND|TRANSFER_OUTBOUND|PAYOUT)/.test(t)) return 'virement-interne';
    if (/^FEE/.test(t)) return 'banque';
    if (/^TAX/.test(t)) return 'impots';
    if (/BONUS/.test(t)) return 'autres-revenus';
  }

  for (const r of COMPILED) {
    if (r.sign && r.sign !== sign) continue;
    if (r.re.test(label)) return r.category;
  }
  return sign === 'in' ? 'autres-revenus' : 'divers';
}

// Un mot-clé doit commencer un mot (« ACTION » ne doit pas trouver « TRANSACTION ») ;
// un espace final exige aussi la fin du mot (« DON » ≠ « LONDON », « DONALD »).
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = BUILTIN_RULES.map(r => ({
  ...r,
  re: new RegExp(
    r.words
      .map(w => '(?:^|[^A-Z0-9])' + esc(w.trim()) + (w.endsWith(' ') ? '(?=$|[^A-Z0-9])' : ''))
      .join('|')
  ),
}));
