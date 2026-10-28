// Bourse › Synthèse : chiffres clés, pistes à regarder, exposition réelle, plans d'investissement, fiscalité.
import { app, registerView, registerActions, render } from '../app.js';
import { html, icon } from './dom.js';
import { euro, pct, dateShort, monthName } from './format.js';
import { synthese, taxSummary, taxYears, pfuRate, psRate } from '../core/invest.js';

const PRIO = { 1: ['D\'abord', 'p1'], 2: ['Ensuite', 'p2'], 3: ['À l\'occasion', 'p3'] };
const BAR_COLORS = ['var(--brass)', 'var(--ink)', 'var(--pos)', '#5B6FA8', '#C8743A', '#8A5BA8', '#3D8C99', '#B5525E', 'var(--ink-3)'];

function bars(list, total) {
  if (!list.length || !total) return '';
  return html`<div class="group hbars">${list.map(([k, v], i) => html`<div class="hbar">
    <span>${k}</span><span class="num">${pct(v / total)}</span>
    <span class="bar"><i style="width:${Math.max(1, (v / list[0][1]) * 100)}%;background:${/^Non |^Autres/.test(k) ? 'var(--ink-3)' : BAR_COLORS[i % BAR_COLORS.length]}"></i></span></div>`)}</div>`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const asOf = ix => (ix.asOf.length === 7 ? `${MONTHS[Number(ix.asOf.slice(5)) - 1]} ${ix.asOf.slice(0, 4)}` : ix.asOf);

export function syntheseView(header) {
  const s = app.state;
  const r = synthese(s, app.today);
  if (!r) {
    return html`${header}<div class="empty"><strong>Pas encore de synthèse</strong>Importez votre export ou relevé Trade Republic : Pécule analysera la répartition de vos titres et vous proposera des pistes.
      <div style="margin-top:16px"><a class="btn brass" href="#/import">Importer</a></div></div>`;
  }
  const ex = r.exposure;
  const view = app.ui.expoView || 'regions';
  const sv = (k, l) => html`<button data-act="expo-view" data-v="${k}" aria-pressed="${view === k}">${l}</button>`;
  const expoList = { regions: ex.regions, countries: ex.countries.slice(0, 9), sectors: ex.sectors, classes: ex.classes }[view];
  const expoTotal = view === 'classes' ? ex.total : ex.equity;
  const pl = r.plans;
  const t = r.tax;
  const year = Number(app.today.slice(0, 4));
  return html`${header}
    <div class="disclaimer" style="margin-bottom:14px"><strong>Des pistes, pas des consignes.</strong> Ces repères sont calculés à partir de vos relevés et de règles générales. Pécule ne connaît ni vos projets, ni votre horizon, ni votre situation complète : ce n'est pas un conseil en investissement personnalisé.</div>

    <div class="kpis">${r.key.map(k => html`<div><div class="k">${k.k}</div><div class="v">${k.v}</div><div class="s">${k.s}</div></div>`)}</div>

    <h2 class="section">En bref</h2>
    <div class="group facts">${r.facts.map(f => html`<p>${f}</p>`)}</div>

    <h2 class="section">Pistes à regarder en priorité</h2>
    ${r.pistes.length ? r.pistes.map((p, i) => html`<details class="piste ${PRIO[p.prio][1]}" ${i < 3 ? 'open' : ''}>
      <summary><span class="t">${p.title}</span><span class="chip-s ${p.prio === 1 ? 'bad' : p.prio === 2 ? 'warn' : ''}">${PRIO[p.prio][0]}</span></summary>
      <div class="lbl">Pourquoi</div><p>${p.why}</p>
      <div class="lbl">À regarder</div><ul>${p.look.map(l => html`<li>${l}</li>`)}</ul>
    </details>`) : html`<div class="note">Rien de particulier à signaler : votre portefeuille ne déclenche aucune des règles suivies par Pécule.</div>`}

    ${r.strengths.length ? html`<h2 class="section">Ce qui va déjà dans le bon sens</h2>
      <div class="group facts">${r.strengths.map(x => html`<p class="ok">${icon('check')}<span>${x}</span></p>`)}</div>` : ''}

    <h2 class="section">Exposition réelle</h2>
    <p class="hint" style="margin-top:-4px">Ce que contiennent vraiment vos ETF, une fois « ouverts », pondéré par la valeur de chaque ligne.</p>
    <div class="seg" role="group" aria-label="Exposition" style="margin:8px 0 10px">${sv('regions', 'Zones')}${sv('countries', 'Pays')}${sv('sectors', 'Secteurs')}${sv('classes', 'Classes')}</div>
    ${expoTotal ? bars(expoList, expoTotal) : html`<div class="note">Aucune action dans le portefeuille.</div>`}
    <p class="hint">${view === 'classes' ? 'Part de chaque classe dans la valeur totale. L\'or, le non coté et les obligations sont mis à part des actions.' : `Sur la partie actions (${euro(ex.equity, { round: true })}).`}
      ${ex.sources.length ? ` Composition des indices : ${ex.sources.map(ix => `${ix.label} (${ix.approx ? 'ordre de grandeur, ' : ''}${asOf(ix)})`).join(', ')}.` : ''}
      ${ex.unknownSector ? ' Secteur inconnu pour certaines actions : ajoutez une clé Finnhub dans les réglages pour le compléter.' : ''}</p>

    <h2 class="section">Plans d'investissement</h2>
    ${pl.list.length ? html`
      <div class="kpis" style="margin-bottom:10px"><div><div class="k">Investi chaque mois</div><div class="v">${euro(pl.monthly)}</div><div class="s">${pl.active.length} plan${pl.active.length > 1 ? 's' : ''} actif${pl.active.length > 1 ? 's' : ''}</div></div>
        <div><div class="k">Part de votre épargne</div><div class="v">${r.monthlySave > 0 ? pct(pl.monthly / r.monthlySave) : '—'}</div><div class="s">${r.monthlySave > 0 ? `sur ${euro(r.monthlySave, { round: true })} mis de côté / mois` : 'il faut des mois complets'}</div></div></div>
      <div class="group">${pl.list.map(p => html`<a class="row" href="#/bourse/${encodeURIComponent(p.isin)}">
        <span class="main"><span class="title">${p.name}</span>
          <span class="sub">${p.active ? `${euro(p.amount)} ${p.frequency}${p.wrapper ? ' · PEA' : ''} · prochain vers le ${dateShort(p.next)}` : `Arrêté · dernier le ${dateShort(p.last)}`}</span></span>
        <span class="end"><span class="amount">${euro(p.invested, { round: true })}</span><div class="sub small">${p.count} exécution${p.count > 1 ? 's' : ''}</div></span></a>`)}</div>
      <p class="hint">${pl.heuristic ? 'Plans reconnus aux achats réguliers d\'un même titre (votre fichier ne les signale pas). ' : ''}Montant investi via chaque plan depuis le début de vos relevés.</p>`
    : html`<div class="note">Aucun plan d'investissement repéré dans vos relevés.</div>`}

    <h2 class="section">Fiscalité ${year} <a href="#/fiscal">Détail</a></h2>
    <a class="group row" href="#/fiscal" style="display:flex">
      <span class="main"><span class="title">Impôt estimé sur ${year}</span>
        <span class="sub" style="white-space:normal">Compte-titres : ${euro(t.cto.dividends + t.cto.interest)} de revenus, ${euro(t.cto.netGains, { sign: true })} de plus-values · PEA : rien à déclarer tant que vous ne retirez rien</span></span>
      <span class="end amount">${euro(t.totalTax)}</span></a>
  `;
}

registerView('fiscal', () => {
  const s = app.state;
  const years = taxYears(s);
  const year = app.ui.taxYear || years[0] || Number(app.today.slice(0, 4));
  const t = taxSummary(s, year, app.today);
  const rate = pfuRate(year), ps = psRate(year);
  const row = (label, v, opts = {}) => html`<div class="row plain"><span class="main">${label}${opts.sub ? html`<span class="sub" style="white-space:normal">${opts.sub}</span>` : ''}</span><span class="end amount ${opts.cls || ''}">${opts.text || euro(v, opts)}</span></div>`;
  const lines = e => e.lines.length ? html`<details class="howto" style="margin-top:8px"><summary>Détail (${e.lines.length})</summary>
    ${e.lines.map(l => html`<div class="row plain" style="padding:8px 0"><span class="main"><span class="title" style="font-size:14px">${l.name}</span><span class="sub">${l.kind} · ${dateShort(l.date)}${l.partial ? ' · prix d\'achat partiellement connu' : ''}</span></span><span class="end amount ${l.amount >= 0 ? '' : 'neg'}">${euro(l.amount, { sign: true })}</span></div>`)}</details>` : '';
  return {
    title: 'Fiscalité', tabs: true, tab: 'bourse',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/bourse?vue=synthese" aria-label="Retour">${icon('back')}</a><h1>Fiscalité</h1></div>
      ${years.length > 1 ? html`<div class="chips" role="group" aria-label="Année">${years.map(y => html`<button class="chip" data-act="tax-year" data-y="${y}" aria-pressed="${y === year}">${y}</button>`)}</div>` : ''}
      <section class="reste" style="padding-top:4px"><p class="label">Impôt estimé sur les revenus ${year}</p>
        <p class="figure">${euro(t.totalTax)}</p>
        <p class="perday muted">À déclarer au printemps ${year + 1}. Taux forfaitaire de ${pct(rate)} (12,8 % d'impôt + ${pct(ps)} de prélèvements sociaux).</p></section>
      ${t.incomplete ? html`<div class="note" style="margin-bottom:12px"><strong>Historique incomplet :</strong> certaines ventes portent sur des titres achetés avant vos relevés. Leur plus-value réelle est sans doute différente : fiez-vous à l'IFU de Trade Republic.</div>` : ''}

      <h2 class="section">Compte-titres (CTO)</h2>
      <div class="group">
        ${row('Dividendes', t.cto.dividends, { sub: 'Case 2DC de la déclaration' })}
        ${row('Intérêts', t.cto.interest, { sub: 'Obligations et intérêts du compte espèces · case 2TR' })}
        ${row('Plus-values', t.cto.gains, { sub: 'Case 3VG' })}
        ${row('Moins-values', -t.cto.losses, { sub: 'Case 3VH · reportables pendant 10 ans' })}
        ${row('Impôt estimé', t.cto.estimatedTax, { sub: `${pct(rate)} de ${euro(t.cto.taxable)}` })}
      </div>
      ${lines(t.cto)}

      <h2 class="section">PEA</h2>
      <div class="group">
        ${row('Dividendes et plus-values', t.pea.dividends + t.pea.netGains, { sign: true, sub: 'Restent dans le PEA : rien à déclarer tant que vous ne retirez rien' })}
        ${t.peaSince ? row('Exonération d\'impôt sur le revenu', 0, { text: `dès ${monthName(String(Number(t.peaSince.slice(0, 4)) + 5) + t.peaSince.slice(4, 7))}`, sub: `5 ans après le premier versement connu (${dateShort(t.peaSince)}). Seuls les ${pct(ps)} de prélèvements sociaux s'appliqueront aux gains retirés.` }) : ''}
      </div>
      ${lines(t.pea)}

      <h2 class="section">Cryptomonnaies</h2>
      <div class="group">
        ${row('Ventes en euros', t.crypto.sales)}
        ${row('Plus ou moins-value', t.crypto.netGains, { sign: true, sub: 'Estimation au prix moyen par crypto. Le calcul officiel (formulaire 2086) porte sur l\'ensemble de votre portefeuille crypto.' })}
        ${row('Impôt estimé', t.crypto.estimatedTax, { sub: t.crypto.exempt ? 'Exonéré : ventes de l\'année inférieures à 305 €' : `Case 3AN · ${pct(rate)}` })}
      </div>
      ${lines(t.crypto)}

      ${t.livrets ? html`<h2 class="section">Livrets</h2><div class="group">${row('Intérêts reçus', t.livrets, { sub: 'Livret A, LDDS, LEP et Livret Jeune sont exonérés. Les autres livrets (CSL, livrets bancaires) sont imposés comme des intérêts.' })}</div>` : ''}

      <h2 class="section">À savoir</h2>
      <div class="note">
        <p style="margin:0 0 8px">Trade Republic envoie au printemps un <strong>IFU</strong> (imprimé fiscal unique) : ses montants sont normalement préremplis dans votre déclaration. Vérifiez-les plutôt que de les ressaisir.</p>
        <p style="margin:0 0 8px">L'impôt déjà prélevé à la source (acompte de 12,8 %, retenues étrangères sur dividendes) figure sur l'IFU et vient en déduction.</p>
        <p style="margin:0 0 8px">Vous pouvez opter pour le barème progressif à la place du taux forfaitaire (case 2OP) si votre taux d'imposition est faible : l'option vaut pour tous vos revenus de placement de l'année.</p>
        <p style="margin:0">Un compte ouvert à l'étranger (titres, espèces ou crypto) se déclare avec le formulaire 3916 : vérifiez dans l'aide de Trade Republic si c'est votre cas.</p>
      </div>
      <p class="hint">Estimation indicative à partir de vos relevés, hors abattements, options et situations particulières. Les cases citées correspondent à la déclaration 2042 ; seul l'IFU fait foi.</p>
    </main>`,
  };
});

registerActions({
  'expo-view': el => { app.ui.expoView = el.dataset.v; render(); },
  'tax-year': el => { app.ui.taxYear = Number(el.dataset.y); render(); },
});
