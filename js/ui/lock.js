// Écrans d'accès : création du coffre, code de secours, déverrouillage, restauration.
import { app, registerView, registerActions, render, unlocked, localPref } from '../app.js';
import { html, icon, toast } from './dom.js';
import { hasVault, createVault, unlockWithPassword, unlockWithRecovery, changePassword, parseBackup, replaceVault, unlockWithBiometric, biometricEnabled } from '../core/vault.js';
import { emptyState } from '../core/model.js';

const L = () => (app.ui.lock ||= { step: null, error: '', busy: false });

export async function initLock() {
  const l = L();
  try {
    l.exists = await hasVault();
    l.bio = l.exists ? await biometricEnabled() : false;
    l.step = l.exists ? 'unlock' : 'welcome';
  } catch {
    l.step = 'welcome';
    l.error = 'Ce navigateur refuse le stockage local (navigation privée ?). Ouvrez Pécule dans une fenêtre normale pour garder vos données.';
  }
  render();
}

const mark = html`<p class="mark">Pécule<span>.</span></p>`;

registerView('lock', () => {
  const l = L();
  const busy = l.busy ? 'disabled' : '';
  const err = l.error ? html`<p class="error" role="alert">${l.error}</p>` : '';
  let body;
  switch (l.step) {
    case 'welcome':
      body = html`${mark}
        <p class="lede">Vos comptes et vos placements, sur votre téléphone. Vous importez vos relevés vous-même : aucun identifiant bancaire, aucune donnée envoyée.</p>
        <div class="spacer"></div>
        <button class="btn brass block" data-act="lock-step" data-step="create">Commencer</button>
        <button class="btn ghost block" style="margin-top:10px" data-act="lock-restore">Restaurer une sauvegarde</button>
        <input type="file" id="restore-file" accept=".json,.pecule,application/json" class="hidden" data-change="lock-restore-file">
        ${err}`;
      break;
    case 'create':
      body = html`<button class="iconbtn back" data-act="lock-step" data-step="welcome" aria-label="Retour">${icon('back')}</button>
        <h1 class="mark" style="font-size:32px;margin-top:12px">Choisissez un mot de passe</h1>
        <p class="lede">Il chiffre vos données sur ce téléphone. Personne d'autre ne le connaît, pas même Pécule.</p>
        <form data-submit="lock-create" autocomplete="off">
          <label class="field"><span>Mot de passe (8 caractères minimum)</span>
            <input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password" data-autofocus></label>
          <label class="field"><span>Confirmez-le</span>
            <input class="input" type="password" name="pw2" minlength="8" required autocomplete="new-password"></label>
          ${err}
          <button class="btn brass block" ${busy} style="margin-top:12px">${l.busy ? html`<span class="spinner"></span> Chiffrement…` : 'Créer mon coffre'}</button>
        </form>`;
      break;
    case 'recovery':
      body = html`<h1 class="mark" style="font-size:32px">Notez votre code de secours</h1>
        <p class="lede">Si vous oubliez votre mot de passe, ce code est le seul moyen de retrouver vos données. Recopiez-le sur papier ou dans votre gestionnaire de mots de passe.</p>
        <div class="recovery num">${l.recovery}</div>
        <button class="link" data-act="lock-copy-recovery">Copier le code</button>
        <div class="spacer"></div>
        <label class="row plain" style="padding:12px 4px">
          <span class="main">J'ai noté mon code de secours</span>
          <span class="switch"><input type="checkbox" data-change="lock-noted" ${l.noted ? 'checked' : ''}><span></span></span>
        </label>
        <button class="btn brass block" data-act="lock-done" ${l.noted ? '' : 'disabled'}>Continuer</button>`;
      break;
    case 'recover':
      body = html`<button class="iconbtn back" data-act="lock-step" data-step="unlock" aria-label="Retour">${icon('back')}</button>
        <h1 class="mark" style="font-size:32px;margin-top:12px">Code de secours</h1>
        <p class="lede">Saisissez le code de 25 caractères noté à la création du coffre.</p>
        <form data-submit="lock-recover" autocomplete="off">
          <label class="field"><span>Code de secours</span>
            <input class="input" name="code" required autocapitalize="characters" spellcheck="false" placeholder="ABCDE-FGHJK-…" data-autofocus></label>
          ${err}
          <button class="btn brass block" ${busy} style="margin-top:12px">${l.busy ? html`<span class="spinner"></span> Vérification…` : 'Continuer'}</button>
        </form>`;
      break;
    case 'newpw':
      body = html`<h1 class="mark" style="font-size:32px">Nouveau mot de passe</h1>
        <p class="lede">Votre code de secours est correct. Choisissez un nouveau mot de passe.</p>
        <form data-submit="lock-newpw" autocomplete="off">
          <label class="field"><span>Nouveau mot de passe</span><input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password" data-autofocus></label>
          <label class="field"><span>Confirmez-le</span><input class="input" type="password" name="pw2" minlength="8" required autocomplete="new-password"></label>
          ${err}
          <button class="btn brass block" ${busy} style="margin-top:12px">Enregistrer</button>
        </form>`;
      break;
    case 'unlock':
    default:
      body = html`${mark}
        <p class="lede">Vos données sont chiffrées sur ce téléphone.</p>
        <form data-submit="lock-unlock" autocomplete="off">
          <label class="field"><span>Mot de passe</span>
            <input class="input" type="password" name="pw" required autocomplete="current-password" data-autofocus></label>
          ${err}
          <button class="btn brass block" ${busy} style="margin-top:12px">${l.busy ? html`<span class="spinner"></span> Déverrouillage…` : 'Déverrouiller'}</button>
        </form>
        ${l.bio ? html`<button class="btn ghost block" style="margin-top:10px" data-act="lock-bio">Utiliser Face ID ou l'empreinte</button>` : ''}
        <div class="spacer"></div>
        <button class="link" data-act="lock-step" data-step="recover">Mot de passe oublié ?</button>`;
  }
  return { html: html`<main class="lock">${body}</main>`, title: 'Pécule', after: root => root.querySelector('[data-autofocus]')?.focus() };
});

function setErr(msg) { const l = L(); l.error = msg; l.busy = false; render(); }

registerActions({
  'lock-step': el => { const l = L(); l.step = el.dataset.step; l.error = ''; render(); },
  'lock-create': async form => {
    const l = L();
    const pw = form.pw.value, pw2 = form.pw2.value;
    if (pw.length < 8) return setErr('Le mot de passe doit contenir au moins 8 caractères.');
    if (pw !== pw2) return setErr('Les deux mots de passe sont différents.');
    l.busy = true; l.error = ''; render();
    const state = emptyState();
    const { dek, recovery } = await createVault(pw, state);
    l.pending = { dek, state };
    l.recovery = recovery;
    l.step = 'recovery';
    l.busy = false;
    render();
  },
  'lock-copy-recovery': async () => {
    try { await navigator.clipboard.writeText(L().recovery); toast('Code copié'); } catch { toast('Copie impossible : recopiez-le à la main.'); }
  },
  'lock-noted': el => { L().noted = el.checked; render(); },
  'lock-done': () => {
    const { dek, state } = L().pending;
    app.ui.lock = null;
    unlocked(dek, state);
  },
  'lock-unlock': async form => {
    const l = L();
    l.busy = true; l.error = ''; render();
    try {
      const { dek, state } = await unlockWithPassword(form.pw.value);
      app.ui.lock = null;
      unlocked(dek, state);
    } catch (e) {
      setErr(e.message === 'bad-password' ? 'Mot de passe incorrect.' : 'Impossible de lire vos données sur ce téléphone.');
    }
  },
  'lock-bio': async () => {
    try {
      const { dek, state } = await unlockWithBiometric();
      app.ui.lock = null;
      unlocked(dek, state);
    } catch {
      setErr('Déverrouillage biométrique refusé. Utilisez votre mot de passe.');
    }
  },
  'lock-recover': async form => {
    const l = L();
    l.busy = true; l.error = ''; render();
    try {
      l.pending = await unlockWithRecovery(form.code.value);
      l.step = 'newpw'; l.busy = false; render();
    } catch {
      setErr('Ce code de secours ne correspond pas.');
    }
  },
  'lock-newpw': async form => {
    const l = L();
    if (form.pw.value.length < 8) return setErr('Le mot de passe doit contenir au moins 8 caractères.');
    if (form.pw.value !== form.pw2.value) return setErr('Les deux mots de passe sont différents.');
    await changePassword(l.pending.dek, form.pw.value);
    const { dek, state } = l.pending;
    app.ui.lock = null;
    unlocked(dek, state);
    toast('Mot de passe changé');
  },
  'lock-restore': () => document.getElementById('restore-file').click(),
  'lock-restore-file': async el => {
    const f = el.files[0];
    if (!f) return;
    try {
      const vault = parseBackup(await f.text());
      await replaceVault(vault);
      const l = L();
      l.exists = true; l.bio = false; l.step = 'unlock'; l.error = '';
      render();
      toast('Sauvegarde chargée. Saisissez le mot de passe de cette sauvegarde.');
    } catch {
      setErr("Ce fichier n'est pas une sauvegarde Pécule.");
    }
  },
});

export { localPref };
