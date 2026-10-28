// Lecture des relevés de compte PDF de Trade Republic (Profil → Relevés → Relevé de compte).
// Chaque opération occupe plusieurs lignes (date, type et description sur 2 à 3 lignes) : on lit donc
// le PDF par colonnes, à partir des positions du texte. Le solde imprimé après chaque opération
// sert à vérifier le montant et son sens. Entrée : pages = [[{ x, y, w, s }, …], …] (voir pdf.js).
import { parseAmount, parseDecimal } from '../lib/parse.js';

const MONTHS = { janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sept: 9, oct: 10, nov: 11, dec: 12 };
const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function frDate(text) {
  const m = plain(text).match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Regroupe les éléments d'une page en rangées (même hauteur), de haut en bas. */
function rows(items) {
  const out = [];
  for (const it of items.filter(i => i.s && i.s.trim())) {
    let r = out.find(r => Math.abs(r.y - it.y) <= 1.5);
    if (!r) out.push((r = { y: it.y, items: [] }));
    r.items.push(it);
  }
  out.sort((a, b) => b.y - a.y);
  for (const r of out) { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map(i => i.s).join(' '); }
  return out;
}

export function looksLikeTRStatement(lines) {
  const t = lines.join('\n');
  return /TRADE REPUBLIC BANK/i.test(t) && /SYNTH[ÈE]SE DU RELEV[ÉE] DE COMPTE/i.test(t);
}

/** Classe une opération à partir de sa description. */
function interpret(desc, type) {
  let m;
  if ((m = desc.match(/^(Savings plan execution|Buy trade|Sell trade)\s+([A-Z]{2}[A-Z0-9]{9}\d)\s+(.+?),\s*quantity:\s*([\d.,]+)/i))) {
    const kind = /^sell/i.test(m[1]) ? 'sell' : 'buy';
    return { kind, trType: /^savings/i.test(m[1]) ? 'SAVINGS_PLAN' : kind === 'sell' ? 'SELL' : 'BUY', isin: m[2], name: m[3].trim(), shares: parseDecimal(m[4]) };
  }
  if (/^Ordre d'achat (.+)$/i.test(desc)) {
    const name = desc.replace(/^Ordre d'achat\s*/i, '').trim();
    return { kind: 'buy', trType: 'BUY', isin: 'XTR' + name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 9), name, shares: null, pseudo: true };
  }
  if ((m = desc.match(/^(Interest Payment|Cash Dividend|Dividend|Distribution)\s+for ISIN\s+([A-Z]{2}[A-Z0-9]{9}\d)/i))) {
    return { kind: 'dividend', trType: /interest/i.test(m[1]) ? 'INTEREST_PAYMENT' : 'DIVIDEND', isin: m[2] };
  }
  if ((m = desc.match(/^Incoming transfer from\s+(.+?)(?:\s*\(([A-Z]{2}\d{2}[A-Z0-9]+)\))?$/i))) return { trType: 'CUSTOMER_INBOUND', who: m[1], iban: m[2] || null };
  if ((m = desc.match(/^Outgoing transfer (?:for|to)\s+(.+?)(?:\s*\(([A-Z]{2}\d{2}[A-Z0-9]+)\))?$/i))) return { trType: 'CUSTOMER_OUTBOUND', who: m[1], iban: m[2] || null };
  if (/^Versement PEA/i.test(desc)) return { trType: 'TRANSFER_INBOUND' };
  if (/interest/i.test(desc) || /^Rendement/i.test(type) && !/ISIN/.test(desc)) return { trType: 'INTEREST_PAYMENT' };
  if (/^Transaction par carte|^Card/i.test(type)) return { trType: 'CARD_TRANSACTION' };
  return {};
}

/** « NVIDIA CORP. DL-,001 » → « NVIDIA CORP. », « SIEMENS AG NA » → « SIEMENS AG », « SAFRAN INH. EO -,20 » → « SAFRAN ». */
export function cleanName(name) {
  return name
    .replace(/\s+(INH\.?|NAM\.?-?AKT\.?|DL|EO|LS|SF|DK|SK|NK|CD|HD|YN)\b[\s\-,.\d]*.*$/, '')
    .replace(/\s+NA$/, '')
    .replace(/\s+[-,.\d]+$/, '')
    .trim() || name;
}

const assetClassOf = (isin, name) =>
  /^XF/.test(isin) ? 'CRYPTO'
    : /\bUCITS\b|\bETF\b|\bETC\b|INDEX|ISHARES|AMUNDI|XTRACKERS|LYXOR|WISDOMTREE|WITR|SPDR|VANGUARD/i.test(name) ? 'FUND'
    : /\b\d{2}\/\d{2}\b|\bBOND\b|\bOAT\b/i.test(name) ? 'BOND'
    : /^XTR/.test(isin) ? 'PRIVATE_FUND' : 'STOCK';

export function parseTRStatement(pages) {
  const warnings = [];
  const accounts = [];
  const trades = [];
  const names = {};
  let holder = null, sec = null, cols = null, inTx = false, pendingEnd = null;

  const finish = () => {
    if (!sec) return;
    const sum = sec.txs.reduce((s, t) => s + t.amount, 0);
    if (sec.end != null && sec.start != null && sec.start + sum !== sec.end) {
      warnings.push(`${sec.product} : les opérations lues ne retombent pas sur le solde du relevé (écart de ${((sec.end - sec.start - sum) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}).`);
    }
    accounts.push(sec);
    sec = null;
  };

  for (const items of pages) {
    const rs = rows(items);
    let block = null;
    const flush = () => { if (block && sec && cols) readBlock(block.rows); block = null; };

    const readBlock = rows => {
      const all = rows.flatMap(r => r.items);
      const col = (a, b) => all.filter(i => i.x >= a && i.x < b).sort((p, q) => q.y - p.y || p.x - q.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
      const date = frDate(col(0, cols.type - 2));
      let type = col(cols.type - 2, cols.desc - 2);
      let desc = col(cols.desc - 2, cols.in - 25).replace(/\s*,\s*quantity/i, ', quantity');
      // Type et description parfois imprimés d'un seul tenant (« Rendement Cash Dividend for ISIN … »)
      const glued = type.match(/^(Exécution d'ordre|Exécution|Virement|Rendement|Transaction par carte|Transaction|Paiement|Frais|Impôts?|Bonus|Prime|Récompense|Intérêts?)\s+(.+)$/i);
      if (glued && !/^d'ordre/i.test(glued[2])) { desc = desc ? `${glued[2]} ${desc}` : glued[2]; type = glued[1]; }
      const money = all.filter(i => i.x >= cols.in - 25 && /€/.test(i.s)).sort((a, b) => a.x - b.x);
      if (!date || money.length < 2) return;
      const soldeItem = money.at(-1);
      const amtItem = money.at(-2);
      const balance = parseAmount(soldeItem.s);
      let amount = Math.abs(parseAmount(amtItem.s));
      const byBalance = balance - sec.running;
      if (Math.abs(byBalance) === amount) amount = byBalance;
      else amount = Math.abs(amtItem.x - cols.in) < Math.abs(amtItem.x - cols.out) ? amount : -amount;
      sec.running = balance;

      const info = interpret(desc, type);
      if (info.isin && info.name) names[info.isin] = info.name;
      const name = info.name || names[info.isin] || info.isin || '';
      let label;
      switch (info.trType) {
        case 'SAVINGS_PLAN': label = `Plan d'investissement ${name}`; break;
        case 'BUY': label = `Achat ${name}`; break;
        case 'SELL': label = `Vente ${name}`; break;
        case 'DIVIDEND': label = `Dividende ${name}`; break;
        case 'INTEREST_PAYMENT': label = info.isin ? `Intérêts ${name}` : 'Intérêts'; break;
        case 'CUSTOMER_INBOUND': label = `Virement reçu de ${info.who}`; break;
        case 'CUSTOMER_OUTBOUND': label = `Virement émis vers ${info.who}`; break;
        default: label = desc || type;
      }
      sec.txs.push({ date, amount, label, fitid: null, meta: { trType: info.trType || null, trCategory: sec.product, isin: info.isin || null, detail: desc !== label ? desc : null } });
      if (info.kind && info.isin) {
        const shares = info.kind === 'dividend' ? 0 : info.shares ?? Math.abs(amount) / 100;
        trades.push({
          date, isin: info.isin, name, assetClass: assetClassOf(info.isin, name), kind: info.kind,
          shares: info.kind === 'sell' ? -Math.abs(shares) : shares,
          price: shares ? Math.round((Math.abs(amount) / 100 / Math.abs(shares)) * 1e4) / 1e4 : null,
          amount, gross: amount, fee: 0, tax: 0, currency: 'EUR', txid: null, wrapper: /PEA/i.test(sec.product) ? 'PEA' : null, source: info.trType,
        });
      }
    };

    for (const r of rs) {
      const t = r.text;
      if (/^Trade Republic Bank GmbH|^Généré le|^TRADE REPUBLIC BANK GMBH/i.test(t) || r.y < 90) { flush(); continue; }
      if (/SYNTH[ÈE]SE DU RELEV[ÉE] DE COMPTE/i.test(t)) { flush(); finish(); inTx = false; continue; }
      if (!holder && r.items[0].x < 90 && r.y > 600 && !/TRADE REPUBLIC|^Rue|^\d{5}/i.test(r.items[0].s)) holder = r.items[0].s.trim();
      let m;
      if (!sec && (m = t.match(/^(Compte .+?)\s+(-?[\d  .]+,\d{2}) €\s+(-?[\d  .]+,\d{2}) €\s+(-?[\d  .]+,\d{2}) €\s+(-?[\d  .]+,\d{2}) €/))) {
        sec = { product: m[1].trim(), start: parseAmount(m[2]), end: parseAmount(m[5]), running: parseAmount(m[2]), txs: [] };
        continue;
      }
      if ((m = t.match(/(\d{1,2} \S+ \d{4}) - (\d{1,2} \S+ \d{4})/))) { if (sec) sec.endDate = frDate(m[2]); else pendingEnd = frDate(m[2]); }
      if (/^DATE\b/.test(t) && /DESCRIPTION/.test(t) && /SOLDE/.test(t)) {
        flush();
        const at = re => r.items.find(i => re.test(i.s))?.x;
        const head = rs.filter(x => Math.abs(x.y - r.y) <= 5).flatMap(x => x.items);
        const hx = re => head.find(i => re.test(i.s))?.x;
        cols = { date: at(/^DATE$/), type: at(/^TYPE$/), desc: at(/^DESCRIPTION$/), in: hx(/^ENTR/) ?? 430, out: hx(/^SORTIE/) ?? 460, bal: at(/^SOLDE$/) };
        inTx = true;
        continue;
      }
      if (/^ENTR|^D'ARGENT/.test(t) && inTx && !block) continue;
      if (/^(APER[ÇC]U DU SOLDE|REMARQUES SUR|CONFIRMATION DE LA)/i.test(t)) { flush(); inTx = false; continue; }
      if (!inTx || !sec || !cols) continue;
      if (block && block.lastY - r.y > 12) flush();
      if (!block) block = { rows: [], lastY: r.y };
      block.rows.push(r);
      block.lastY = r.y;
    }
    flush();
  }
  finish();

  // Un même titre peut changer de libellé d'un mois à l'autre (« WITR MET.SEC.Z09/UN.XAU » / « WisdomTree Physical Swiss Gold ») :
  // on garde le plus lisible (le plus de minuscules, puis le plus long), débarrassé des suffixes boursiers
  const best = {};
  const score = n => [(n.match(/[a-z]/g) || []).length, n.length];
  for (const t of trades) if (t.name && t.name !== t.isin) {
    const b = best[t.isin];
    const [l1, n1] = score(t.name), [l2, n2] = b ? score(b) : [-1, -1];
    if (!b || l1 > l2 || (l1 === l2 && n1 > n2)) best[t.isin] = t.name;
  }
  for (const t of trades) if (best[t.isin]) t.name = cleanName(best[t.isin]);

  // Titres qui versent des intérêts (coupons) : ce sont des obligations
  const bonds = new Set(trades.filter(t => t.kind === 'dividend' && /INTEREST/i.test(t.source || '')).map(t => t.isin));
  for (const t of trades) if (bonds.has(t.isin)) t.assetClass = 'BOND';

  const out = accounts.map(a => {
    const pea = /PEA/i.test(a.product);
    return {
      key: pea ? 'TR-PEA' : 'TR-CASH',
      externalId: pea ? 'TR-PEA' : 'TR-CASH',
      name: pea ? 'Trade Republic · PEA (espèces)' : 'Trade Republic · espèces',
      institution: 'Trade Republic',
      type: 'courant',
      currency: 'EUR',
      balance: a.end != null ? { amount: a.end, date: a.endDate || pendingEnd } : null,
      transactions: a.txs,
    };
  });
  if (!out.length) warnings.push('Aucun compte reconnu dans ce relevé.');
  return { source: 'trade-republic', format: 'Relevé PDF Trade Republic', accounts: out, trades, warnings, holder };
}
