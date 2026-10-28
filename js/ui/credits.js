// Crédits : taux d'endettement, capacité de remboursement et d'emprunt, simulateur, classement des crédits, note.
import { app, registerView, registerActions, update, render } from '../app.js';
import { html, icon, openSheet, updateSheet, closeSheet, toast, ask } from './dom.js';
import { euro, pct, dateShort, monthName, plural } from './format.js';
import { debtAnalysis, simulateLoan, rankLoans, detectLoans, healthScore, newLoan, LOAN_TYPES, REFERENCES } from '../core/debt.js';
import { prepaymentSaving } from '../core/loans.js';
import { parseAmount, parseDecimal } from '../lib/parse.js';
import { demoBanner } from './home.js';

const fmtVal = c => (c.fmt === 'pct' ? pct(c.value) : c.fmt === 'months' ? `${c.value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois` : plural(c.value, 'jour', 'jours'));
const chip = pts => (pts >= 80 ? html`<span class="chip-s good">Bon</span>` : pts >= 50 ? html`<span class="chip-s warn">À surveiller</span>` : html`<span class="chip-s bad">Faible</span>`);
const endLabel = d => { const [y, m] = d.split('-'); return `${monthName(`${y}-${m}`)}`; };

registerView('credits', () => {
  const s = app.state;
  const a = debtAnalysis(s, app.today);
  const ranked = rankLoans(s, app.today);
  const found = detectLoans(s, app.today);
  const hs = healthScore(s, app.today);
  const ratioPct = a.ratio == null ? null : a.ratio * 100;
  const scaleMax = 50;
  const pos = r => `${Math.min(r, scaleMax) / scaleMax * 100}%`;
  const over = a.ratio != null && a.ratio > REFERENCES.maxDebtRatio;

  return {
    title: 'Crédits', tabs: true, tab: 'comptes',
    html: html`<main class="screen">
      ${demoBanner()}
      <div class="topbar"><a class="iconbtn back" href="#/comptes" aria-label="Retour">${icon('back')}</a><h1>Crédits et capacité</h1></div>

      <section class="debt-hero">
        <p class="label">Taux d'endettement</p>
        <p class="figure ${over ? 'neg' : ''}">${ratioPct == null ? '—' : ratioPct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}<span class="cents">${ratioPct == null ? '' : ' %'}</span></p>
        <p class="perday">${a.income
          ? html`<span class="amount">${euro(a.charges)}</span> de crédits par mois sur <span class="amount">${euro(a.income)}</span> de revenus. <button class="link inline" data-act="debt-income">Modifier</button>`
          : html`Indiquez vos revenus pour calculer votre taux. <button class="link inline" data-act="debt-income">Indiquer mes revenus</button>`}</p>
        ${ratioPct != null ? html`<div class="gauge" role="img" aria-label="${`Taux d'endettement ${ratioPct.toFixed(1)} %, limite des banques 35 %`}">
          <div class="g-bed"><i class="g-zone" style="left:${pos(35)}"></i><i class="g-fill ${over ? 'over' : ''}" style="width:${pos(ratioPct)}"></i></div>
          <i class="g-limit" style="left:${pos(35)}"></i>
          <div class="g-scale"><span>0 %</span><span style="left:${pos(35)}">35 %</span><span>50 %</span></div>
          <p class="g-note">Le repère doré marque 35 %, le maximum retenu par les banques.</p>
        </div>` : ''}
      </section>

      <h2 class="section">Capacité de remboursement</h2>
      ${a.income ? html`<div class="note">
          ${a.capacity > 0
            ? html`Vous pouvez encore consacrer jusqu'à <strong class="amount">${euro(a.capacity, { round: true })}</strong> par mois à un nouveau crédit sans dépasser 35 % de vos revenus.`
            : html`Vos crédits atteignent déjà la limite de 35 % : un nouveau crédit serait en principe refusé, sauf dérogation.`}
        </div>
        ${a.capacity > 0 ? html`<div class="group" style="margin-top:10px">
          ${a.durations.map(d => html`<div class="row plain">
            <span class="main"><span class="title">Sur ${d.years} ans</span><span class="sub">au taux de ${d.rate.toLocaleString('fr-FR')} %, assurance ${a.settings.insurancePct.toLocaleString('fr-FR')} %</span></span>
            <span class="end"><span class="amount" style="font-weight:600">${euro(d.capital, { round: true })}</span><div class="sub small">empruntables</div></span></div>`)}
        </div>
        <p class="hint">Taux moyens d'octobre 2026 (baromètre Pretto du ${dateShort(REFERENCES.asOf)}). Le HCSF limite les crédits immobiliers à 35 % des revenus, assurance comprise, et à 25 ans. <button class="link inline" data-act="debt-rates">Modifier les taux</button></p>` : ''}
        <button class="btn brass block" style="margin-top:12px" data-act="debt-sim">Simuler un crédit</button>`
      : html`<div class="note">Pécule calcule vos revenus à partir des salaires et aides importés sur les 3 derniers mois complets. Vous pouvez aussi les saisir.</div>`}

      <h2 class="section">Vos crédits <button data-act="loan-edit" data-id="">Ajouter</button></h2>
      ${found.map(f => html`<div class="alert" style="margin:0 0 10px"><div style="flex:1">
          <div class="t">Crédit détecté : ${f.name}</div>
          <div class="b"><span class="amount">${euro(f.monthly)}</span> prélevés chaque mois depuis ${plural(f.count, 'mois', 'mois')}.</div>
          <div style="display:flex;gap:16px;margin-top:6px"><button class="link" data-act="loan-from" data-key="${f.key}">Ajouter ce crédit</button><button class="link muted" data-act="loan-dismiss" data-key="${f.key}">Ce n'est pas un crédit</button></div>
        </div></div>`)}
      ${ranked.length ? html`<p class="muted small" style="margin:0 4px 8px">Classés du plus coûteux au moins coûteux : c'est l'ordre dans lequel un remboursement anticipé fait économiser le plus d'intérêts.</p>
        <div class="group">${ranked.map(l => html`<button class="row" data-act="loan-open" data-id="${l.id}">
          <span class="badge ink">${l.rank}</span>
          <span class="main"><span class="title">${l.name}</span>
            <span class="sub">${l.rate.toLocaleString('fr-FR')} % · jusqu'en ${endLabel(l.endDate)} · ${euro(l.status.interestLeft, { round: true })} d'intérêts restants</span></span>
          <span class="end"><span class="amount">${euro(l.monthly)}</span><div class="sub small">reste ${euro(l.status.remaining, { round: true })}</div></span>
        </button>`)}</div>
        <div class="kpis" style="margin-top:10px"><div><div class="k">Capital restant dû</div><div class="v">${euro(a.remaining, { round: true })}</div></div><div><div class="k">Intérêts restants</div><div class="v">${euro(a.interestLeft, { round: true })}</div></div></div>
        ${ranked.some(l => l.belowSavings) ? html`<p class="hint">Un crédit à un taux inférieur à celui du Livret A (${REFERENCES.livretA.toLocaleString('fr-FR')} %) coûte moins que ce que rapporte l'épargne réglementée : le rembourser en avance fait perdre plus d'intérêts qu'il n'en économise.</p>` : ''}`
      : html`<div class="note">Aucun crédit enregistré. Ajoutez vos prêts (immobilier, auto, personnel…) avec leur mensualité, leur taux et leur date de fin : ils apparaissent ici, dans votre taux d'endettement et en moins de votre patrimoine.</div>`}

      ${hs ? html`<h2 class="section">Note de santé financière</h2>
        <div class="group grade-card">
          <div class="grade-head">
            <span class="grade g-${hs.grade}">${hs.grade}</span>
            <div><div class="grade-label">${hs.label}</div><div class="muted small">${hs.score} sur 100 · échelle Pécule, indicative</div></div>
          </div>
          ${hs.criteria.map(c => html`<div class="row plain" style="align-items:flex-start">
            <span class="main"><span class="title">${c.label}</span><span class="sub" style="white-space:normal">${c.hint}</span></span>
            <span class="end"><span class="num" style="font-weight:600">${fmtVal(c)}</span><div style="margin-top:4px">${chip(c.pts)}</div></span>
          </div>`)}
        </div>
        <p class="hint">Les critères sont classés du plus faible au plus solide. Cette note n'est pas celle d'une banque : elle vous aide à repérer ce qui pèse le plus dans votre situation.</p>` : ''}
    </main>`,
  };
});

// ---------- Feuilles ----------

function incomeSheet() {
  const a = debtAnalysis(app.state, app.today);
  const ds = a.settings;
  openSheet(html`<h3>Vos revenus</h3>
    <form data-submit="debt-income-save">
      <label class="field"><span>Revenus nets mensuels avant impôt (€)</span>
        <input class="input big" name="inc" inputmode="decimal" placeholder="${a.incomeDetected ? String(a.incomeDetected / 100).replace('.', ',') : '0'}" value="${ds.incomeOverride != null ? String(ds.incomeOverride / 100).replace('.', ',') : ''}" data-autofocus></label>
      <p class="hint">${a.incomeDetected
        ? `Détectés : ${euro(a.incomeDetected)} par mois (salaires et aides, ${a.incomePartial ? 'reçus ce mois-ci' : `moyenne sur ${plural(a.incomeMonths, 'mois', 'mois')}`}). Les banques retiennent le net avant prélèvement à la source, un peu plus élevé que le montant versé : indiquez-le si vous le connaissez (fiche de paie). Laissez vide pour utiliser le montant détecté.`
        : 'Indiquez le net avant impôt de votre fiche de paie, à deux si vous empruntez à deux.'}</p>
      <label class="field"><span>Loyers perçus par mois (€, facultatif)</span><input class="input" name="rent" inputmode="decimal" value="${ds.rentalIncome ? String(ds.rentalIncome / 100).replace('.', ',') : ''}" placeholder="0"></label>
      <p class="hint">Les banques en retiennent en général 70 %.</p>
      <button class="btn brass block" style="margin-top:12px">Enregistrer</button>
    </form>`, { label: 'Vos revenus' });
}

function ratesSheet() {
  const ds = debtAnalysis(app.state, app.today).settings;
  openSheet(html`<h3>Taux retenus</h3>
    <form data-submit="debt-rates-save">
      ${[15, 20, 25].map(y => html`<label class="field"><span>Taux sur ${y} ans (%)</span><input class="input" name="r${y}" inputmode="decimal" value="${String(ds.rates[y]).replace('.', ',')}"></label>`)}
      <label class="field"><span>Assurance emprunteur (% du capital par an)</span><input class="input" name="ins" inputmode="decimal" value="${String(ds.insurancePct).replace('.', ',')}"></label>
      <p class="hint">Valeurs par défaut : moyennes d'octobre 2026. Remplacez-les par les taux proposés par votre banque ou un courtier.</p>
      <button class="btn brass block" style="margin-top:12px">Enregistrer</button>
      <button type="button" class="btn ghost block" style="margin-top:10px" data-act="debt-rates-reset">Revenir aux taux moyens</button>
    </form>`, { label: 'Taux retenus' });
}

function simBody(v) {
  const a = debtAnalysis(app.state, app.today);
  const rate = v.rate ?? a.settings.rates[v.years] ?? 3.7;
  const r = simulateLoan(app.state, { amount: v.amount, years: v.years, rate }, app.today);
  const seg = y => html`<button type="button" data-act="sim-years" data-y="${y}" aria-pressed="${v.years === y}">${y}</button>`;
  return html`<h3>Simuler un crédit</h3>
    <label class="field"><span>Montant emprunté (€)</span><input class="input big" id="sim-amount" inputmode="decimal" value="${(v.amount / 100).toLocaleString('fr-FR')}" data-change="sim-amount"></label>
    <div class="field" style="margin-top:0"><span>Durée (années)</span><div class="seg" role="group" aria-label="Durée en années">${[5, 7, 10, 15, 20, 25].map(seg)}</div></div>
    <label class="field"><span>Taux (%)</span><input class="input" id="sim-rate" inputmode="decimal" value="${String(rate).replace('.', ',')}" data-change="sim-rate"></label>
    <div class="group" style="padding:4px 16px">
      <div class="stat-line"><span>Mensualité, assurance comprise</span><b class="amount">${euro(r.monthly)}</b></div>
      <div class="stat-line"><span>Coût total (intérêts + assurance)</span><span class="amount">${euro(r.totalCost, { round: true })}</span></div>
      <div class="stat-line"><span>Taux d'endettement après ce crédit</span><b class="${r.newRatio > REFERENCES.maxDebtRatio ? 'neg' : 'pos'}">${r.newRatio == null ? '—' : pct(r.newRatio)}</b></div>
      <div class="stat-line"><span>Reste après tous vos crédits</span><span class="amount">${euro(r.resteAVivre, { round: true })} / mois</span></div>
    </div>
    <p class="note" style="margin-top:12px">${r.newRatio == null ? 'Indiquez vos revenus pour savoir si ce crédit respecte la limite des 35 %.'
      : r.ok ? html`<strong>Dans les règles :</strong> ce crédit garderait votre taux d'endettement sous 35 %.`
      : html`<strong>Au-delà de la limite :</strong> ${v.years > REFERENCES.maxYears ? 'la durée dépasse 25 ans.' : `il faudrait réduire la mensualité à ${euro(Math.max(0, a.capacity), { round: true })} au plus, en empruntant moins ou plus longtemps.`}`}</p>
    <button class="btn ghost block" style="margin-top:12px" data-act="sheet-close">Fermer</button>`;
}

function loanSheet(loan) {
  const isNew = !loan.id || !app.state.loans.some(l => l.id === loan.id);
  const v = n => (n ? String(n / 100).replace('.', ',') : '');
  const today = app.today;
  let extra = '';
  if (!isNew) {
    const ex = prepaymentSaving(loan, 500000, today);
    extra = ex.saved ? html`<p class="hint">Rembourser 5 000 € par anticipation ferait économiser environ <b>${euro(ex.saved, { round: true })}</b> d'intérêts et finir ${plural(ex.monthsSaved, 'mois', 'mois')} plus tôt (hors indemnités de remboursement anticipé, souvent plafonnées à 3 % du capital remboursé pour un prêt immobilier).</p>` : '';
  }
  openSheet(html`<h3>${isNew ? 'Nouveau crédit' : loan.name}</h3>
    <form data-submit="loan-save">
      <input type="hidden" name="id" value="${loan.id || ''}">
      <input type="hidden" name="payeeKey" value="${loan.payeeKey || ''}">
      <label class="field"><span>Nom</span><input class="input" name="name" required value="${loan.name}" placeholder="Ex. : Prêt immobilier Caisse d'Épargne" ${isNew ? 'data-autofocus' : ''}></label>
      <label class="field"><span>Type</span><select class="input" name="type">${Object.entries(LOAN_TYPES).map(([k, l]) => html`<option value="${k}" ${loan.type === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="field"><span>Mensualité, assurance comprise (€)</span><input class="input" name="monthly" inputmode="decimal" required value="${v(loan.monthly)}"></label>
      <label class="field"><span>Dont assurance (€ par mois, facultatif)</span><input class="input" name="insurance" inputmode="decimal" value="${v(loan.insurance)}"></label>
      <label class="field"><span>Taux nominal (%)</span><input class="input" name="rate" inputmode="decimal" required value="${loan.rate ? String(loan.rate).replace('.', ',') : ''}" placeholder="Ex. : 3,2"></label>
      <label class="field"><span>Dernière mensualité</span><input class="input" type="month" name="end" required value="${loan.endDate ? loan.endDate.slice(0, 7) : ''}"></label>
      <label class="field"><span>Capital restant dû aujourd'hui (€, facultatif)</span><input class="input" name="remaining" inputmode="decimal" placeholder="Calculé automatiquement" value="${v(loan.remainingOverride)}"></label>
      <p class="hint">Le taux, la mensualité et la date de fin figurent sur votre offre de prêt ou votre tableau d'amortissement. Le capital restant dû y figure aussi : si vous l'indiquez, il remplace le calcul.</p>
      ${extra}
      <button class="btn brass block" style="margin-top:12px">${isNew ? 'Ajouter le crédit' : 'Enregistrer'}</button>
      ${isNew ? '' : html`<button type="button" class="btn danger block" style="margin-top:10px" data-act="loan-delete" data-id="${loan.id}">${icon('trash')} Supprimer ce crédit</button>`}
    </form>`, { label: 'Crédit' });
}

registerActions({
  'debt-income': () => incomeSheet(),
  'debt-income-save': form => {
    const inc = parseAmount(form.inc.value);
    const rent = parseAmount(form.rent.value);
    update(s => { s.debt = { ...s.debt, incomeOverride: inc == null ? null : Math.abs(inc), rentalIncome: rent ? Math.abs(rent) : 0 }; });
    closeSheet();
    toast('Revenus enregistrés');
  },
  'debt-rates': () => ratesSheet(),
  'debt-rates-save': form => {
    const n = k => parseDecimal(form[k].value);
    update(s => {
      const rates = {};
      for (const y of [15, 20, 25]) { const r = n('r' + y); rates[y] = r != null && r >= 0 && r < 20 ? r : REFERENCES.mortgageRates[y]; }
      const ins = n('ins');
      s.debt = { ...s.debt, rates, insurancePct: ins != null && ins >= 0 && ins < 3 ? ins : REFERENCES.insurancePct };
    });
    closeSheet();
    toast('Taux enregistrés');
  },
  'debt-rates-reset': () => { update(s => { const d = { ...s.debt }; delete d.rates; delete d.insurancePct; s.debt = d; }); closeSheet(); toast('Taux moyens rétablis'); },
  'debt-sim': () => {
    const a = debtAnalysis(app.state, app.today);
    app.ui.sim = { amount: Math.max(1000000, Math.round((a.durations[1]?.capital || 10000000) / 1000000) * 1000000), years: 20, rate: null };
    openSheet(simBody(app.ui.sim), { label: 'Simuler un crédit' });
  },
  'sim-years': el => { app.ui.sim.years = Number(el.dataset.y); app.ui.sim.rate = null; updateSheet(simBody(app.ui.sim)); },
  'sim-amount': el => { const v = parseAmount(el.value); if (v > 0) app.ui.sim.amount = v; updateSheet(simBody(app.ui.sim)); },
  'sim-rate': el => { const v = parseDecimal(el.value); if (v != null && v >= 0 && v < 30) app.ui.sim.rate = v; updateSheet(simBody(app.ui.sim)); },
  'sheet-close': () => closeSheet(),
  'loan-edit': () => loanSheet(newLoan({})),
  'loan-open': el => { const l = app.state.loans.find(x => x.id === el.dataset.id); if (l) loanSheet(l); },
  'loan-from': el => {
    const f = detectLoans(app.state, app.today).find(x => x.key === el.dataset.key);
    if (f) loanSheet(newLoan({ name: f.name, monthly: f.monthly, payeeKey: f.key, type: /PRET IMMO|CREDIT IMMO/.test(f.key) ? 'immo' : 'conso' }));
  },
  'loan-dismiss': el => update(s => { s.debt = { ...s.debt, dismissed: [...(s.debt.dismissed || []), el.dataset.key] }; }),
  'loan-save': form => {
    const monthly = parseAmount(form.monthly.value);
    const rate = parseDecimal(form.rate.value);
    if (!monthly || rate == null || !form.end.value) { toast('Indiquez la mensualité, le taux et la date de fin.'); return; }
    const rem = parseAmount(form.remaining.value);
    const fields = {
      name: form.name.value.trim(), type: form.type.value, monthly: Math.abs(monthly),
      insurance: Math.abs(parseAmount(form.insurance.value) || 0), rate: Math.abs(rate),
      endDate: `${form.end.value}-28`, payeeKey: form.payeeKey.value || null,
      remainingOverride: rem ? Math.abs(rem) : null, remainingAt: rem ? app.today : null,
    };
    const id = form.id.value;
    update(s => {
      const cur = s.loans.find(l => l.id === id);
      if (cur) Object.assign(cur, fields);
      else s.loans.push(newLoan(id ? { ...fields, id } : fields));
    });
    closeSheet();
    toast('Crédit enregistré');
  },
  'loan-delete': async el => {
    const id = el.dataset.id;
    closeSheet(true);
    if (!(await ask('Supprimer ce crédit ?', 'Il ne sera plus compté dans votre taux d\'endettement. Vos opérations ne changent pas.', { ok: 'Supprimer', danger: true }))) return;
    update(s => { s.loans = s.loans.filter(l => l.id !== id); });
    toast('Crédit supprimé');
  },
});

export { render };
