// Prise en main en 3 écrans.
import { app, registerView, registerActions, render, update, go, flush } from '../app.js';
import { html, icon } from './dom.js';
import { buildDemoState } from '../core/demo.js';

const STEPS = [
  {
    title: 'Tout reste sur votre téléphone',
    text: [
      'Pécule ne se connecte jamais à votre banque. Vous exportez vos relevés, puis vous les ouvrez ici.',
      'Vos données sont chiffrées avec votre mot de passe. Seuls les codes des titres que vous suivez sont envoyés pour obtenir les cours de bourse.',
    ],
    art: 'lock',
  },
  {
    title: 'Deux fichiers suffisent',
    text: [
      "Caisse d'Épargne : dans votre espace client web, Comptes → Gérer → Télécharger les opérations, au format OFX (Money).",
      'Trade Republic : dans l\'application, Profil → Relevés → Export des transactions, puis Partager vers Pécule (Android) ou Enregistrer dans Fichiers (iPhone).',
    ],
    art: 'upload',
  },
  {
    title: 'Prêt à commencer',
    text: ['Importez vos relevés maintenant, ou découvrez l\'application avec des données fictives que vous pourrez effacer d\'un geste.'],
    art: 'check',
  },
];

registerView('bienvenue', () => {
  const i = app.ui.onb || 0;
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return {
    title: 'Bienvenue',
    html: html`<main class="lock onb">
      <div class="steps" aria-hidden="true">${STEPS.map((_, k) => html`<i class="${k <= i ? 'on' : ''}"></i>`)}</div>
      <div class="illus badge" style="width:64px;height:64px;border-radius:20px;background:var(--brass-soft);color:var(--brass)">${icon(s.art)}</div>
      <h2>${s.title}</h2>
      ${s.text.map(t => html`<p>${t}</p>`)}
      <div class="spacer"></div>
      ${last
        ? html`<button class="btn brass block" data-act="onb-import">Importer mes relevés</button>
               <button class="btn ghost block" style="margin-top:10px" data-act="onb-demo">Essayer avec des données fictives</button>`
        : html`<button class="btn brass block" data-act="onb-next">Suivant</button>`}
      ${i > 0 ? html`<button class="link" style="margin-top:8px" data-act="onb-prev">Retour</button>` : ''}
    </main>`,
  };
});

registerActions({
  'onb-next': () => { app.ui.onb = (app.ui.onb || 0) + 1; render(); },
  'onb-prev': () => { app.ui.onb = Math.max(0, (app.ui.onb || 0) - 1); render(); },
  'onb-import': () => {
    update(s => { s.settings.onboarded = true; }, { rerender: false });
    flush();
    go('#/import');
  },
  'onb-demo': () => {
    const demo = buildDemoState();
    update(s => {
      const keep = { ...s.settings };
      Object.assign(s, demo);
      s.settings = { ...demo.settings, theme: keep.theme, autoLockMinutes: keep.autoLockMinutes, onboarded: true };
    }, { rerender: false });
    go('#/accueil');
  },
});
