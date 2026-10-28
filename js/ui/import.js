// Import de relevés : choix des fichiers, aperçu avant validation, correspondance des colonnes, annulation.
import { app, registerView, registerActions, update, render, go, onRoute } from '../app.js';
import { html, icon, toast, haptic, ask } from './dom.js';
import { euro, dateShort, dateLong, plural } from './format.js';
import { parseFile, SOURCE_LABELS } from '../import/index.js';
import { rowsToTransactions } from '../import/csv-bank.js';
import { prepareImport, commitImport, undoImport, adjustBalance, accountById } from '../core/model.js';
import { parseAmount } from '../lib/parse.js';

const I = () => (app.ui.imp ||= { step: 'pick', items: [] });

async function readFiles(files) {
  const imp = I();
  imp.items = [];
  for (const f of files) {
    const buf = f.buffer || (await f.arrayBuffer());
    try {
      const parsed = parseFile(f.name, buf);
      imp.items.push({ fileName: f.name, parsed, choices: {}, fix: {} });
    } catch (e) {
      imp.items.push({ fileName: f.name, parsed: null, error: 'Ce fichier n\'a pas pu être lu. Vérifiez qu\'il s\'agit d\'un export OFX, QIF ou CSV.' });
    }
  }
  imp.step = imp.items.some(i => i.parsed?.needsMapping) ? 'mapping' : 'preview';
  render();
}

function accountOptions(selected, newName) {
  const accs = app.state.accounts.filter(a => a.type !== 'titres');
  return html`${accs.map(a => html`<option value="${a.id}" ${selected === a.id ? 'selected' : ''}>${a.name} · ${a.institution}</option>`)}
    <option value="new" ${!selected || selected === 'new' ? 'selected' : ''}>Nouveau compte : ${newName}</option>`;
}

registerView('import', () => {
  const imp = I();
  if (app.ui.pendingFiles) {
    const files = app.ui.pendingFiles;
    app.ui.pendingFiles = null;
    readFiles(files.map(f => ({ name: f.name, buffer: f.buffer })));
  }
  if (imp.step === 'preview') return previewView();
  if (imp.step === 'mapping') return mappingView();
  if (imp.step === 'done') return doneView();
  const history = [...app.state.imports].reverse().slice(0, 8);
  return {
    title: 'Importer', tabs: true, tab: 'import',
    html: html`<main class="screen">
      <div class="topbar"><h1>Importer un relevé</h1></div>
      <label class="drop" id="drop">
        ${icon('upload')}
        <strong>Choisir un ou plusieurs fichiers</strong>
        <span class="muted small">OFX, QIF ou CSV · Caisse d'Épargne, Trade Republic et la plupart des banques</span>
        <input type="file" multiple accept=".ofx,.qfx,.qif,.csv,.txt,text/csv,text/plain,application/x-ofx,application/vnd.intu.qfx" class="sr" data-change="imp-files">
      </label>
      <p class="hint" style="text-align:center">Les fichiers sont lus sur ce téléphone et ne sont envoyés nulle part.</p>

      <h2 class="section">Comment obtenir mes fichiers</h2>
      <div class="howto">
        <details><summary>Caisse d'Épargne</summary><ol>
          <li>Connectez-vous à votre espace client sur caisse-epargne.fr (dans le navigateur du téléphone ou sur ordinateur).</li>
          <li>Comptes → touchez le compte → <b>Gérer</b> → <b>Télécharger les opérations</b>.</li>
          <li>Format <b>Money (.ofx)</b> de préférence, ou Excel (.csv) avec le séparateur « ; ».</li>
          <li>Choisissez la période (depuis le dernier import), puis revenez ici et choisissez le fichier téléchargé.</li>
        </ol></details>
        <details><summary>Trade Republic</summary><ol>
          <li>Dans l'application Trade Republic, touchez votre <b>profil</b> en haut à droite.</li>
          <li><b>Relevés</b> → <b>Export des transactions</b> → <b>Partager</b>.</li>
          <li>Choisissez <b>Toutes les transactions</b> la première fois, puis <b>Créer</b>.</li>
          <li>Android : partagez directement vers <b>Pécule</b>. iPhone : <b>Enregistrer dans Fichiers</b>, puis choisissez le fichier ici.</li>
        </ol></details>
        <details><summary>Réimporter sans doublons</summary><ol>
          <li>Vous pouvez réimporter une période déjà importée : les opérations déjà présentes sont reconnues et ignorées.</li>
          <li>Un import se défait en un geste dans l'historique ci-dessous.</li>
        </ol></details>
      </div>

      ${history.length ? html`<h2 class="section">Derniers imports</h2>
        <div class="group">${history.map(h => html`<div class="row plain">
          <span class="main"><span class="title">${SOURCE_LABELS[h.source] || h.format}</span>
            <span class="sub">${dateShort(h.at.slice(0, 10))} · ${plural(h.count, 'opération', 'opérations')}${h.trades ? ` · ${plural(h.trades, 'mouvement de titres', 'mouvements de titres')}` : ''}</span></span>
          <button class="link" data-act="imp-undo" data-id="${h.id}">Annuler</button></div>`)}</div>` : ''}
    </main>`,
    after: root => {
      const d = root.querySelector('#drop');
      if (!d) return;
      d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('drag'); });
      d.addEventListener('dragleave', () => d.classList.remove('drag'));
      d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('drag'); readFiles([...e.dataTransfer.files]); });
    },
  };
});

function prepFor(item) {
  if (!item.parsed || item.parsed.error || item.parsed.needsMapping) return null;
  return prepareImport(app.state, item.parsed, item.choices);
}

function previewView() {
  const imp = I();
  const preps = imp.items.map(prepFor);
  const total = preps.reduce((t, p) => t + (p ? p.totalFresh + p.trades.length : 0), 0);
  const cards = imp.items.map((item, idx) => {
    const p = preps[idx];
    const src = item.parsed?.source ? SOURCE_LABELS[item.parsed.source] : 'Fichier';
    if (!p) {
      return html`<div class="group" style="padding:14px 16px;margin-bottom:12px"><div class="title" style="font-weight:600">${item.fileName}</div>
        <p class="error">${item.error || item.parsed?.error || 'Fichier illisible.'}</p></div>`;
    }
    return html`<section style="margin-bottom:18px">
      <h2 class="section" style="margin-top:8px">${src} · ${p.format}</h2>
      ${p.groups.map(g => {
        const sel = item.choices[g.key]?.accountId || (g.target ? g.target.id : 'new');
        const bc = g.balanceCheck;
        return html`<div class="group" style="padding:4px 16px 12px">
          <label class="field"><span>Compte</span><select class="input" data-change="imp-account" data-i="${idx}" data-k="${g.key}">${accountOptions(sel, g.parsed.name)}</select></label>
          <div class="stat-line"><span>Période</span><span>${g.from ? `${dateShort(g.from)} → ${dateShort(g.to)}` : '—'}</span></div>
          <div class="stat-line"><span>Nouvelles opérations</span><b class="num">${g.fresh.length}</b></div>
          ${g.dups.length ? html`<div class="stat-line"><span>Déjà présentes, ignorées</span><span class="num muted">${g.dups.length}</span></div>` : ''}
          ${g.fresh.length ? html`<div class="stat-line"><span>Total des nouvelles</span><span class="amount ${g.sumFresh > 0 ? 'pos' : ''}">${euro(g.sumFresh, { sign: true })}</span></div>` : ''}
          ${g.needsBalance && sel === 'new' ? html`<label class="field"><span>Solde affiché par votre banque aujourd'hui (facultatif)</span>
            <input class="input" inputmode="decimal" placeholder="Ex. : 1 250,00" value="${item.choices[g.key]?.balText || ''}" data-change="imp-balance" data-i="${idx}" data-k="${g.key}"></label>
            <p class="hint">${g.parsed.fromInception ? 'Inutile si vous avez exporté toutes les transactions depuis l\'ouverture du compte.' : 'Sans lui, le solde du compte partira de zéro au début du fichier.'}</p>` : ''}
          ${bc && bc.diff !== 0 ? html`<label class="row plain" style="padding:12px 0 0;min-height:0">
            <span class="main small"><b>Écart de ${euro(bc.diff, { sign: true })}</b> avec le solde du relevé (${euro(bc.expected)} au ${dateShort(g.parsed.balance.date)}). Corriger automatiquement ?</span>
            <span class="switch"><input type="checkbox" data-change="imp-fix" data-i="${idx}" data-k="${g.key}" ${item.fix[g.key] !== false ? 'checked' : ''}><span></span></span></label>` : ''}
        </div>`;
      })}
      ${p.trades.length || p.dupTrades ? html`<div class="group" style="padding:4px 16px;margin-top:8px">
        <div class="stat-line"><span>Mouvements de titres (achats, ventes, dividendes)</span><b class="num">${p.trades.length}</b></div>
        ${p.dupTrades ? html`<div class="stat-line"><span>Déjà présents, ignorés</span><span class="num muted">${p.dupTrades}</span></div>` : ''}</div>` : ''}
      ${p.warnings.map(w => html`<p class="hint">${w}</p>`)}
    </section>`;
  });
  return {
    title: 'Vérifier l\'import', tabs: false,
    html: html`<main class="screen no-tabs">
      <div class="topbar"><button class="iconbtn back" data-act="imp-cancel" aria-label="Annuler">${icon('close')}</button><h1>Vérifier avant d'importer</h1></div>
      ${cards}
      <div style="position:sticky;bottom:calc(var(--safe-b) + 12px);padding-top:8px">
        <button class="btn brass block" data-act="imp-commit" ${total ? '' : 'disabled'}>${total ? `Importer ${plural(total, 'élément', 'éléments')}` : 'Rien de nouveau à importer'}</button>
      </div>
    </main>`,
  };
}

function mappingView() {
  const imp = I();
  const idx = imp.items.findIndex(i => i.parsed?.needsMapping);
  const item = imp.items[idx];
  const rows = item.parsed.needsMapping.rows;
  const m = (item.map ||= { header: 0, date: -1, label: -1, amount: -1, debit: -1, credit: -1 });
  const headers = rows[m.header] || [];
  const opts = (key, label) => html`<label class="field"><span>${label}</span><select class="input" data-change="imp-map" data-key="${key}">
    <option value="-1">—</option>${headers.map((h, i) => html`<option value="${i}" ${m[key] === i ? 'selected' : ''}>${h || `Colonne ${i + 1}`} (ex. ${rows[m.header + 1]?.[i] || ''})</option>`)}</select></label>`;
  const ok = m.date > -1 && (m.amount > -1 || m.debit > -1 || m.credit > -1);
  return {
    title: 'Colonnes', tabs: false,
    html: html`<main class="screen no-tabs">
      <div class="topbar"><button class="iconbtn back" data-act="imp-cancel" aria-label="Annuler">${icon('close')}</button><h1>Indiquez les colonnes</h1></div>
      <p class="muted" style="margin:0 4px 12px">Pécule ne reconnaît pas encore le format de <b>${item.fileName}</b>. Dites-lui où trouver la date et le montant ; ce réglage sera demandé à chaque fichier de ce type.</p>
      <label class="field"><span>Ligne des titres de colonnes</span><select class="input" data-change="imp-map" data-key="header">${rows.slice(0, 15).map((r, i) => html`<option value="${i}" ${m.header === i ? 'selected' : ''}>Ligne ${i + 1} : ${r.slice(0, 4).join(' | ')}</option>`)}</select></label>
      ${opts('date', 'Date')}${opts('label', 'Libellé')}${opts('amount', 'Montant (avec signe)')}
      <p class="hint">Ou, si débits et crédits sont dans deux colonnes :</p>
      ${opts('debit', 'Débit')}${opts('credit', 'Crédit')}
      <button class="btn brass block" style="margin-top:16px" data-act="imp-map-apply" data-i="${idx}" ${ok ? '' : 'disabled'}>Continuer</button>
    </main>`,
  };
}

function doneView() {
  const r = I().result;
  return {
    title: 'Import terminé', tabs: true, tab: 'import',
    html: html`<main class="screen">
      <div style="padding:40px 8px 8px;text-align:center">
        <div class="badge" style="margin:0 auto 16px;width:64px;height:64px;border-radius:32px;background:var(--pos-soft);color:var(--pos)">${icon('check')}</div>
        <h1 style="font:650 28px var(--display);margin:0 0 8px">C'est importé</h1>
        <p class="muted">${plural(r.count, 'opération ajoutée', 'opérations ajoutées')}${r.trades ? `, ${plural(r.trades, 'mouvement de titres', 'mouvements de titres')}` : ''}.
        ${r.transfers ? html`<br>${plural(r.transfers, 'virement entre vos comptes reconnu', 'virements entre vos comptes reconnus')}.` : ''}
        ${r.toCheck ? html`<br>${plural(r.toCheck, 'opération reste', 'opérations restent')} à classer.` : ''}</p>
      </div>
      <a class="btn brass block" href="#/accueil">Voir l'accueil</a>
      ${r.toCheck ? html`<a class="btn ghost block" style="margin-top:10px" href="#/operations" data-act="imp-tocheck">Classer les opérations restantes</a>` : ''}
      <button class="btn ghost block" style="margin-top:10px" data-act="imp-another">Importer un autre fichier</button>
      <button class="link block" style="margin-top:10px;width:100%" data-act="imp-undo" data-id="${r.ids.join(',')}">Annuler cet import</button>
    </main>`,
  };
}

registerActions({
  'imp-files': el => { const files = [...el.files]; el.value = ''; if (files.length) readFiles(files); },
  'imp-cancel': () => { app.ui.imp = null; render(); },
  'imp-another': () => { app.ui.imp = null; render(); },
  'imp-account': el => { const it = I().items[el.dataset.i]; (it.choices[el.dataset.k] ||= {}).accountId = el.value; render(); },
  'imp-balance': el => {
    const it = I().items[el.dataset.i];
    const c = (it.choices[el.dataset.k] ||= {});
    c.balText = el.value;
    c.currentBalance = parseAmount(el.value);
  },
  'imp-fix': el => { I().items[el.dataset.i].fix[el.dataset.k] = el.checked; },
  'imp-map': el => {
    const it = I().items.find(i => i.parsed?.needsMapping);
    it.map[el.dataset.key] = Number(el.value);
    render();
  },
  'imp-map-apply': el => {
    const it = I().items[el.dataset.i];
    const m = it.map;
    const rows = it.parsed.needsMapping.rows.slice(m.header + 1);
    const { txs, skipped } = rowsToTransactions(rows, { date: m.date, label: m.label, detail: -1, amount: m.amount, debit: m.debit, credit: m.credit, ref: -1 });
    it.parsed = { ...it.parsed, needsMapping: null, accounts: [{ key: 'csv', externalId: null, name: 'Compte importé', institution: 'Banque', type: 'courant', currency: 'EUR', balance: null, transactions: txs }], warnings: skipped ? [`${skipped} lignes sans date ou sans montant ignorées.`] : [] };
    if (!txs.length) it.parsed.error = 'Aucune opération lisible avec ces colonnes.';
    I().step = I().items.some(i => i.parsed?.needsMapping) ? 'mapping' : 'preview';
    render();
  },
  'imp-commit': () => {
    const imp = I();
    const before = new Set(app.state.transactions.filter(t => t.transferId).map(t => t.id));
    let count = 0, trades = 0;
    const ids = [];
    update(s => {
      for (const item of imp.items) {
        const p = prepFor(item);
        if (!p || (!p.totalFresh && !p.trades.length)) continue;
        const id = commitImport(s, p);
        ids.push(id);
        count += p.totalFresh;
        trades += p.trades.length;
        for (const g of p.groups) {
          if (g.balanceCheck && g.balanceCheck.diff !== 0 && item.fix[g.key] !== false && g.accountId) {
            adjustBalance(s, g.accountId, g.balanceCheck.expected, g.parsed.balance.date);
          }
        }
      }
    }, { rerender: false });
    const transfers = app.state.transactions.filter(t => t.transferId && !before.has(t.id) && ids.includes(t.importId)).length;
    const toCheck = app.state.transactions.filter(t => ids.includes(t.importId) && (t.categoryId === 'divers' || t.categoryId === 'autres-revenus')).length;
    haptic(15);
    imp.result = { count, trades, ids, transfers, toCheck };
    imp.step = 'done';
    imp.items = [];
    render();
  },
  'imp-tocheck': () => { app.ui.ops = { q: '', kind: 'verifier', limit: 150 }; app.ui.imp = null; go('#/operations'); },
  'imp-undo': async el => {
    const ids = el.dataset.id.split(',');
    if (!(await ask('Annuler cet import ?', 'Les opérations qu\'il a ajoutées seront retirées.', { ok: 'Annuler l\'import', danger: true }))) return;
    update(s => { for (const id of ids) undoImport(s, id); }, { rerender: false });
    app.ui.imp = null;
    render();
    toast('Import annulé');
  },
});

export { accountById, dateLong };

// Quitter l'écran « C'est importé » remet l'import à zéro pour la prochaine fois
onRoute(r => {
  if (r.name !== 'import' && app.ui.imp?.step === 'done') app.ui.imp = null;
});
