// Réglages : sécurité, confidentialité, cours de bourse, sauvegardes, règles, effacement.
import { app, registerView, registerActions, update, render, lock, flush, localPref } from '../app.js';
import { html, icon, openSheet, closeSheet, toast, ask } from './dom.js';
import { euro, dateShort } from './format.js';
import { changePassword, newRecovery, exportVault, wipe, enableBiometric, disableBiometric, biometricEnabled, biometricPossible, unlockWithPassword } from '../core/vault.js';
import { PROVIDERS, fetchQuote } from '../core/prices.js';
import { catById, deleteRule, recategorizeAll, accountById } from '../core/model.js';
import { reminderICS } from '../core/planning.js';

const titleCase = t => String(t).toLowerCase().replace(/(^|[\s\-.&/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

export async function saveFile(name, text, mime, { share = true } = {}) {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], name, { type: mime });
  if (share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

registerView('reglages', () => {
  const s = app.state;
  const st = s.settings;
  const prov = PROVIDERS[st.provider] || PROVIDERS.none;
  const theme = st.theme || 'auto';
  const tbtn = (v, l) => html`<button data-act="set-theme" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`;
  const bio = app.ui.bio;
  if (bio === undefined) biometricEnabled().then(v => { app.ui.bio = v; render(); });
  return {
    title: 'Réglages', tabs: true, tab: 'accueil',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/accueil" aria-label="Retour">${icon('back')}</a><h1>Réglages</h1></div>

      <h2 class="section">Sécurité</h2>
      <div class="group">
        <button class="row plain" data-act="lock-now"><span class="main"><span class="title">Verrouiller maintenant</span></span>${icon('lock', 'chev')}</button>
        <label class="row plain"><span class="main"><span class="title">Verrouillage automatique</span><span class="sub">Après une période sans utilisation</span></span>
          <select class="input" style="width:auto;min-height:40px;padding:6px 10px" data-change="set-autolock">
            ${[[1, '1 min'], [5, '5 min'], [15, '15 min'], [60, '1 heure'], [0, 'Jamais']].map(([v, l]) => html`<option value="${v}" ${st.autoLockMinutes === v ? 'selected' : ''}>${l}</option>`)}
          </select></label>
        ${biometricPossible() ? html`<label class="row plain"><span class="main"><span class="title">Face ID ou empreinte</span><span class="sub">Déverrouiller sans saisir le mot de passe</span></span>
          <span class="switch"><input type="checkbox" data-change="set-bio" ${bio ? 'checked' : ''}><span></span></span></label>` : ''}
        <button class="row plain" data-act="set-password"><span class="main"><span class="title">Changer le mot de passe</span></span>${icon('chev', 'chev')}</button>
        <button class="row plain" data-act="set-recovery"><span class="main"><span class="title">Nouveau code de secours</span><span class="sub">L'ancien code ne fonctionnera plus</span></span>${icon('chev', 'chev')}</button>
      </div>

      <h2 class="section">Affichage</h2>
      <div class="group">
        <label class="row plain"><span class="main"><span class="title">Mode discret</span><span class="sub">Floute les montants (aussi depuis l'œil de l'accueil)</span></span>
          <span class="switch"><input type="checkbox" data-change="set-discreet" ${st.discreet ? 'checked' : ''}><span></span></span></label>
        <div class="row plain" style="display:block"><div class="title" style="margin-bottom:8px">Thème</div><div class="seg">${tbtn('auto', 'Automatique')}${tbtn('light', 'Clair')}${tbtn('dark', 'Sombre')}</div></div>
        <label class="row plain"><span class="main"><span class="title">Alerte de solde bas</span><span class="sub">Comptes courants sous ce montant</span></span>
          <input class="input" style="width:110px;min-height:40px;text-align:right" inputmode="decimal" value="${String((st.lowBalance ?? 10000) / 100)}" data-change="set-low"></label>
      </div>

      <h2 class="section">Rappel d'import</h2>
      <div class="group">
        <label class="row plain"><span class="main"><span class="title">Rappel dans Pécule</span><span class="sub" style="white-space:normal">Un bandeau sur l'accueil quand le mois a changé depuis votre dernier import</span></span>
          <span class="switch"><input type="checkbox" data-change="set-reminder" ${st.importReminder !== false ? 'checked' : ''}><span></span></span></label>
        <label class="row plain"><span class="main"><span class="title">Jour du rappel</span><span class="sub">Quand vos relevés du mois précédent sont disponibles</span></span>
          <select class="input" style="width:auto;min-height:40px;padding:6px 10px" data-change="set-reminder-day">
            ${[1, 2, 3, 5, 7, 10, 15].map(d => html`<option value="${d}" ${(st.reminderDay || 3) === d ? 'selected' : ''}>le ${d === 1 ? '1er' : d}</option>`)}
          </select></label>
        <button class="row plain" data-act="reminder-ics"><span class="main"><span class="title">Ajouter à mon calendrier</span><span class="sub" style="white-space:normal">Un rappel chaque mois, même quand Pécule est fermé (fichier .ics pour iPhone, Google Agenda, Outlook)</span></span>${icon('chev', 'chev')}</button>
      </div>

      <h2 class="section">Cours de bourse</h2>
      <div class="group" style="padding:4px 16px 14px">
        <label class="field"><span>Fournisseur</span><select class="input" data-change="set-provider">
          ${Object.entries(PROVIDERS).map(([k, p]) => html`<option value="${k}" ${st.provider === k ? 'selected' : ''}>${p.name}</option>`)}</select></label>
        ${prov.needsKey ? html`<label class="field"><span>Clé d'API ${prov.name}</span><input class="input" value="${st.apiKey}" autocomplete="off" spellcheck="false" data-change="set-key" placeholder="Collez votre clé"></label>
          <p class="hint">Créez une clé sur <a href="${prov.site}" target="_blank" rel="noopener noreferrer">${prov.site.replace('https://', '')}</a>. Seuls les codes des titres sont envoyés, jamais vos montants. ${prov.hint}</p>
          <button class="btn ghost" style="margin-top:10px" data-act="set-test">Tester la connexion</button>` : ''}
        ${st.provider === 'none' ? html`<p class="hint">Sans fournisseur, vous pouvez saisir les cours à la main depuis chaque titre.</p>` : ''}
      </div>

      <h2 class="section">Marchés et actualités</h2>
      <div class="group">
        <label class="row plain"><span class="main"><span class="title">Données de marché publiques</span><span class="sub" style="white-space:normal">Cryptomonnaies (CoinGecko), sentiment (Alternative.me), taux et inflation (BCE). Aucune donnée personnelle envoyée.</span></span>
          <span class="switch"><input type="checkbox" data-change="set-public" ${st.publicMarketData ? 'checked' : ''}><span></span></span></label>
        <div class="row plain" style="display:block">
          <label class="field" style="margin:4px 0"><span>Clé Finnhub (actualités et données d'entreprises, gratuite)</span>
            <input class="input" value="${st.finnhubKey || ''}" autocomplete="off" spellcheck="false" data-change="set-finnhub" placeholder="Collez votre clé"></label>
          <p class="hint">Créez-la sur <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer">finnhub.io/register</a> : votre clé s'affiche ensuite sur le tableau de bord. Seuls les codes de vos titres sont envoyés.</p>
        </div>
        <label class="row plain"><span class="main"><span class="title">Traduire les actualités en français</span><span class="sub" style="white-space:normal">Titres et résumés traduits par MyMemory (gratuit, environ 5 000 caractères par jour). Seul le texte public des actualités est envoyé.</span></span>
          <span class="switch"><input type="checkbox" data-change="set-translate" ${st.translateNews !== false ? 'checked' : ''}><span></span></span></label>
      </div>

      <h2 class="section">Règles de classement</h2>
      ${s.rules.length ? html`<div class="group">${s.rules.map(r => {
        const c = catById(s, r.categoryId);
        return html`<div class="row plain"><span class="badge">${c.icon}</span><span class="main"><span class="title">« ${titleCase(r.payee || r.value)} »</span><span class="sub">${r.sign === 'in' ? 'Entrées' : 'Dépenses'} → ${c.name}</span></span>
          <button class="iconbtn" data-act="rule-del" data-id="${r.id}" aria-label="Supprimer la règle">${icon('trash')}</button></div>`;
      })}</div>` : html`<div class="note">Quand vous changez la catégorie d'une opération, Pécule propose de retenir le choix pour ce bénéficiaire. Les règles apparaissent ici.</div>`}

      <h2 class="section">Données</h2>
      <div class="group">
        <button class="row plain" data-act="backup"><span class="main"><span class="title">Sauvegarde chiffrée</span><span class="sub">Fichier protégé par votre mot de passe, à garder dans iCloud, Drive…</span></span>${icon('chev', 'chev')}</button>
        <button class="row plain" data-act="export-csv"><span class="main"><span class="title">Exporter les opérations (CSV)</span><span class="sub">Lisible dans Excel. Attention : fichier non chiffré.</span></span>${icon('chev', 'chev')}</button>
      </div>
      <p class="hint">${s.transactions.length.toLocaleString('fr-FR')} opérations, ${s.accounts.length} comptes, ${s.imports.length} imports.${app.ui.lastBackup ? ` Sauvegarde faite le ${dateShort(app.ui.lastBackup)}.` : ''}</p>

      <h2 class="section">Zone sensible</h2>
      <button class="btn danger block" data-act="wipe">Effacer toutes les données de ce téléphone</button>

      <p class="hint" style="text-align:center;margin-top:28px">Pécule · version 1.5 · fonctionne hors ligne<br>Aucun compte, aucun serveur, aucune publicité.</p>
    </main>`,
  };
});

function pwSheet(title, submit, intro = '') {
  openSheet(html`<h3>${title}</h3>${intro}<form data-submit="${submit}" autocomplete="off">
    <label class="field"><span>Mot de passe actuel</span><input class="input" type="password" name="old" required autocomplete="current-password" data-autofocus></label>
    ${submit === 'set-password-save' ? html`<label class="field"><span>Nouveau mot de passe (8 caractères minimum)</span><input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
    <label class="field"><span>Confirmez-le</span><input class="input" type="password" name="pw2" minlength="8" required autocomplete="new-password"></label>` : ''}
    <p class="error hidden" id="pw-err"></p>
    <button class="btn brass block" style="margin-top:12px">Continuer</button></form>`);
}
async function checkOld(form) {
  try { await unlockWithPassword(form.old.value); return true; }
  catch { const e = document.getElementById('pw-err'); e.textContent = 'Mot de passe actuel incorrect.'; e.classList.remove('hidden'); return false; }
}

registerActions({
  'lock-now': () => lock(),
  'set-autolock': el => update(s => { s.settings.autoLockMinutes = Number(el.value); }),
  'set-discreet': el => update(s => { s.settings.discreet = el.checked; }),
  'set-theme': el => { localPref('theme', el.dataset.v); update(s => { s.settings.theme = el.dataset.v; }); },
  'set-low': el => { const v = parseFloat(el.value.replace(',', '.')); if (!Number.isNaN(v)) update(s => { s.settings.lowBalance = Math.round(v * 100); }); },
  'set-translate': el => update(s => { s.settings.translateNews = el.checked; }),
  'set-public': el => update(s => { s.settings.publicMarketData = el.checked; }),
  'set-finnhub': el => update(s => {
    s.settings.finnhubKey = el.value.trim();
    // Nouvelle clé : on oublie les actualités et symboles en cache
    for (const k of Object.keys(s.market)) if (/^(news|metric):/.test(k)) delete s.market[k];
    for (const sec of Object.values(s.securities)) delete sec.finnhub;
  }, { rerender: false }),
  'set-provider': el => update(s => { s.settings.provider = el.value; }),
  'set-key': el => update(s => { s.settings.apiKey = el.value.trim(); }, { rerender: false }),
  'set-test': async () => {
    const st = app.state.settings;
    try {
      const q = await fetchQuote(st, st.provider === 'eodhd' ? 'AAPL.US' : 'AAPL');
      toast(`Connexion réussie : Apple à ${q.close} $ le ${dateShort(q.date)}`);
    } catch (e) { toast(e.message); }
  },
  'set-bio': async el => {
    try {
      if (el.checked) { await enableBiometric(app.dek); toast('Face ID / empreinte activé'); }
      else { await disableBiometric(); toast('Déverrouillage biométrique désactivé'); }
      app.ui.bio = el.checked;
    } catch (e) {
      el.checked = false;
      app.ui.bio = false;
      toast(e.message === 'prf-unsupported' ? 'Ce téléphone ou ce navigateur ne permet pas encore ce déverrouillage. Le mot de passe reste nécessaire.' : 'Activation annulée.');
    }
    render();
  },
  'set-password': () => pwSheet('Changer le mot de passe', 'set-password-save'),
  'set-password-save': async form => {
    if (form.pw.value.length < 8 || form.pw.value !== form.pw2.value) {
      const e = document.getElementById('pw-err'); e.textContent = form.pw.value.length < 8 ? '8 caractères minimum.' : 'Les deux mots de passe sont différents.'; e.classList.remove('hidden'); return;
    }
    if (!(await checkOld(form))) return;
    await flush();
    await changePassword(app.dek, form.pw.value);
    app.ui.bio = false;
    closeSheet(); render();
    toast('Mot de passe changé');
  },
  'set-recovery': () => pwSheet('Nouveau code de secours', 'set-recovery-save', html`<p class="muted" style="margin:-6px 4px 8px">Confirmez votre mot de passe pour générer un nouveau code.</p>`),
  'set-recovery-save': async form => {
    if (!(await checkOld(form))) return;
    const code = await newRecovery(app.dek);
    openSheet(html`<h3>Votre nouveau code de secours</h3><div class="recovery num">${code}</div>
      <p class="hint">Notez-le maintenant : il ne sera plus affiché. L'ancien code ne fonctionne plus.</p>
      <button class="btn brass block" style="margin-top:14px" data-act="sheet-close">Je l'ai noté</button>`);
  },
  'set-reminder': el => update(s => { s.settings.importReminder = el.checked; }),
  'set-reminder-day': el => update(s => { s.settings.reminderDay = Number(el.value); }),
  'reminder-ics': async () => {
    await saveFile('pecule-rappel-import.ics', reminderICS(app.state.settings.reminderDay || 3), 'text/calendar', { share: false });
    toast('Ouvrez le fichier pour ajouter le rappel à votre calendrier');
  },
  'rule-del': el => update(s => { deleteRule(s, el.dataset.id); recategorizeAll(s); }),
  backup: async () => {
    await flush();
    const text = await exportVault();
    await saveFile(`pecule-sauvegarde-${app.today}.json`, text, 'application/json');
    app.ui.lastBackup = app.today;
    render();
  },
  'export-csv': async () => {
    const s = app.state;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['Date;Compte;Libellé;Tiers;Catégorie;Montant;Note'];
    for (const t of s.transactions) lines.push([t.date, q(accountById(s, t.accountId)?.name), q(t.label), q(t.payee), q(catById(s, t.categoryId).name), (t.amount / 100).toFixed(2).replace('.', ','), q(t.note)].join(';'));
    await saveFile(`pecule-operations-${app.today}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  },
  wipe: async () => {
    if (!(await ask('Tout effacer ?', 'Toutes les données de Pécule sur ce téléphone seront effacées. Sans sauvegarde chiffrée, elles seront perdues définitivement.', { ok: 'Tout effacer', danger: true }))) return;
    await wipe();
    app.dek = null; app.state = null; app.ui = {};
    try { history.replaceState(null, '', location.pathname); } catch { /* sans importance */ }
    location.reload();
  },
});

export { euro };
