// Classement express : file des opérations à classer (une carte par bénéficiaire) et suggestions de catégorie.
import { payeeKey, norm } from '../lib/text.js';
import { setCategory } from './model.js';

const TO_CLASSIFY = new Set(['divers', 'autres-revenus']);
export const needsReview = t => TO_CLASSIFY.has(t.categoryId) && !t.transferId && t.catSource !== 'manual';

/**
 * File de classement : une opération par bénéficiaire (classer l'une classe les autres),
 * les bénéficiaires les plus fréquents d'abord, puis les plus gros montants.
 */
export function triageQueue(state) {
  const groups = new Map();
  for (const t of state.transactions) {
    if (!needsReview(t)) continue;
    const k = `${Math.sign(t.amount)}|${payeeKey(t.label)}`;
    const g = groups.get(k);
    if (!g) groups.set(k, { id: t.id, count: 1, total: Math.abs(t.amount), date: t.date });
    else { g.count++; g.total += Math.abs(t.amount); if (t.date > g.date) { g.date = t.date; g.id = t.id; } }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.total - a.total).map(g => g.id);
}

/** Nombre d'opérations encore à classer. */
export const reviewCount = state => state.transactions.filter(needsReview).length;

/** Jusqu'à 3 catégories probables : même bénéficiaire déjà classé, même premier mot, puis les plus courantes dans ce sens. */
export function suggestCategories(state, tx, n = 3) {
  const kinds = Object.fromEntries(state.categories.map(c => [c.id, c.kind]));
  const sign = Math.sign(tx.amount);
  const key = payeeKey(tx.label);
  const word = norm(tx.payee || tx.label).split(' ').find(w => w.length > 2) || '';
  const score = new Map();
  const bump = (id, v) => { if (!id || TO_CLASSIFY.has(id)) return; score.set(id, (score.get(id) || 0) + v); };
  for (const t of state.transactions) {
    if (t.id === tx.id || Math.sign(t.amount) !== sign || TO_CLASSIFY.has(t.categoryId) || t.transferId) continue;
    if (payeeKey(t.label) === key) bump(t.categoryId, 100);
    else if (word && norm(t.payee || t.label).split(' ').includes(word)) bump(t.categoryId, 20);
    else bump(t.categoryId, 1);
  }
  // Catégories du bon sens, pour compléter
  const fallback = sign < 0 ? ['alimentation', 'shopping', 'restaurants', 'loisirs', 'transports'] : ['remboursements', 'salaire', 'aides', 'virement-interne'];
  for (const [i, id] of fallback.entries()) if (state.categories.some(c => c.id === id)) bump(id, 0.1 / (i + 1));
  return [...score.entries()]
    .filter(([id]) => (sign < 0 ? kinds[id] !== 'revenu' : kinds[id] !== 'depense'))
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}

/**
 * Classe une opération (et, si demandé, toutes celles du même bénéficiaire, avec une règle pour les prochaines).
 * Renvoie de quoi annuler : catégories d'avant et règles d'avant.
 */
export function classify(state, txId, categoryId, applyToSimilar = true) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return null;
  const key = payeeKey(tx.label), sign = Math.sign(tx.amount);
  const touched = state.transactions.filter(t => t.id === txId || (Math.sign(t.amount) === sign && payeeKey(t.label) === key));
  const undo = { cats: touched.map(t => [t.id, t.categoryId, t.catSource]), rules: state.rules.slice() };
  const n = setCategory(state, txId, categoryId, applyToSimilar);
  return { undo, count: n + 1 };
}

export function undoClassify(state, undo) {
  const byId = new Map(state.transactions.map(t => [t.id, t]));
  for (const [id, cat, src] of undo.cats) {
    const t = byId.get(id);
    if (t) { t.categoryId = cat; t.catSource = src; }
  }
  state.rules = undo.rules;
}
