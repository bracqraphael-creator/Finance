// Fin de mois (prévision du solde et échéancier) et objectifs d'épargne.
import { app, registerView, registerActions, update, render, go } from '../app.js';
import { html, icon, openSheet, closeSheet, toast, ask } from './dom.js';
import { euro, euroParts, dateShort, monthName, pct, plural } from './format.js';
import { forecast, upcoming, goalStatus, goalsEffort } from '../core/planning.js';
import { catById } from '../core/model.js';
import { lineChart } from './charts.js';
import { parseAmount } from '../lib/parse.js';
import { uid } from '../lib/text.js';

const dayName = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

registerView('prevision', () => {
  const s = app.state;
  const today = app.today;
  const f = forecast(s, today);
  const items = upcoming(s, today, 31);
  const back = html`<a class="iconbtn back" href="#/accueil" aria-label="Retour">${icon('back')}</a>`;
  if (!f) {
    return { title: 'Fin de mois', tabs: true, tab: 'accueil', html: html`<main class="screen"><div class="topbar">${back}<h1>Fin de mois</h1></div>
      <div class="empty"><strong>Aucun compte courant</strong>Importez un relevé de votre banque pour prévoir votre fin de mois.</div></main>` };
  }
  const endLabel = `${Number(f.endDate.slice(8))} ${monthName(f.endDate.slice(0, 7), false)}`;
  const parts = f.insufficient ? null : euroParts(f.end);
  // Échéancier groupé par jour
  const byDay = [];
  for (const x of items) {
    if (!byDay.length || byDay.at(-1).date !== x.date) byDay.push({ date: x.date, list: [] });
    byDay.at(-1).list.push(x);
  }
  const inSum = items.filter(x => x.amount > 0).reduce((t, x) => t + x.amount, 0);
  const outSum = items.filter(x => x.amount < 0).reduce((t, x) => t - x.amount, 0);
  return {
    title: 'Fin de mois', tabs: true, tab: 'accueil',
    html: html`<main class="screen">
      <div class="topbar">${back}<h1>Fin de mois</h1></div>
      ${f.insufficient
        ? html`<section class="reste"><p class="label">Sur vos comptes courants</p><p class="figure">${euroParts(f.balance).ints}<span class="cents">${euroParts(f.balance).dec}</span></p>
            <p class="perday muted">Il faut au moins un mois complet de relevés de votre banque pour prévoir le solde du ${endLabel}.</p></section>`
        : html`<section class="reste" aria-labelledby="fdm-l">
          <p class="label" id="fdm-l">Solde prévu le ${endLabel}</p>
          <p class="figure ${parts.neg ? 'neg' : ''}">${parts.ints}<span class="cents">${parts.dec}</span></p>
          <p class="perday">Aujourd'hui <strong class="amount">${euro(f.balance)}</strong> sur ${f.accounts > 1 ? 'vos comptes courants' : 'votre compte courant'}.</p>
        </section>
        ${f.curve.length > 1 ? html`<div style="margin:6px 0 4px">${lineChart(f.curve.map(([d, v]) => [d, v / 100]), { label: `Évolution prévue du solde jusqu'au ${endLabel}` })}</div>` : ''}
        ${f.low[1] < 0 ? html`<div class="alert l3" style="margin-top:8px"><div><div class="t">Risque de découvert vers le ${dateShort(f.low[0])}</div><div class="b">Le solde pourrait descendre à ${euro(f.low[1])}. Un virement depuis un livret avant cette date l'éviterait.</div></div></div>` : ''}
        <div class="group" style="margin-top:14px">
          <div class="row plain"><span class="main">Solde actuel</span><span class="end amount">${euro(f.balance)}</span></div>
          <div class="row plain"><span class="main">Revenus attendus</span><span class="end amount pos">${euro(f.income, { sign: true })}</span></div>
          <div class="row plain"><span class="main">Prélèvements et virements prévus</span><span class="end amount">${euro(-f.bills, { sign: true })}</span></div>
          <div class="row plain"><span class="main">Dépenses courantes estimées<span class="sub" style="white-space:normal">courses, sorties, transports… (moyenne de ${plural(f.history, 'mois', 'mois')})</span></span><span class="end amount">${euro(-f.variableLeft, { sign: true })}</span></div>
          <div class="row plain"><span class="main"><strong>Solde prévu</strong></span><span class="end amount"><strong>${euro(f.end)}</strong></span></div>
        </div>`}
      ${f.stale ? html`<p class="hint">Vos relevés s'arrêtent le ${dateShort(f.lastTx)} : importez les plus récents pour une prévision juste.</p>` : ''}

      <h2 class="section">Échéancier sur 30 jours</h2>
      ${items.length ? html`
        <div class="kpis" style="margin-bottom:10px"><div><div class="k">Entrées prévues</div><div class="v pos">${euro(inSum, { round: true })}</div></div><div><div class="k">Sorties prévues</div><div class="v">${euro(outSum, { round: true })}</div></div></div>
        ${byDay.map(d => html`<div class="dayhead">${d.date === today ? 'Aujourd\'hui' : dayName(d.date)}</div>
          <div class="group">${d.list.map(x => html`<div class="row plain">
            <span class="badge">${catById(s, x.categoryId).icon}</span>
            <span class="main"><span class="title">${x.name}</span><span class="sub">${x.transfer ? 'Virement régulier' : catById(s, x.categoryId).name}</span></span>
            <span class="end amount ${x.amount > 0 ? 'pos' : ''}">${euro(x.amount, { sign: true })}</span></div>`)}</div>`)}
        <p class="hint">Opérations repérées chaque mois dans vos relevés (salaire, loyer, abonnements, virements vers l'épargne). Dates et montants sont estimés d'après les mois précédents.</p>`
      : html`<div class="note">Aucune opération régulière repérée pour l'instant. Pécule les reconnaît après 2 à 3 mois de relevés : salaire, loyer, abonnements, virements vers l'épargne.</div>`}

      <h2 class="section">Objectifs <a href="#/objectifs">Voir</a></h2>
      ${goalsSummary()}
    </main>`,
  };
});

function goalsSummary() {
  const s = app.state;
  const goals = s.goals || [];
  if (!goals.length) return html`<a class="alert" href="#/objectifs" style="margin-top:0"><div><div class="t">Fixer un objectif d'épargne</div><div class="b">Voyage, apport, épargne de précaution : suivez où vous en êtes et combien mettre de côté chaque mois.</div></div></a>`;
  return html`<div class="group">${goals.slice(0, 3).map(g => goalRow(g))}</div>`;
}

function goalRow(g) {
  const st = goalStatus(app.state, g, app.today);
  return html`<button class="row" data-act="goal-open" data-id="${g.id}">
    <span class="badge">${g.icon || '🎯'}</span>
    <span class="main"><span class="title">${g.name}</span>
      <span class="progress" style="margin:6px 0 4px"><i style="width:${st.pct * 100}%;${st.done ? 'background:var(--pos)' : ''}"></i></span>
      <span class="sub" style="white-space:normal">${st.done ? 'Objectif atteint' : st.perMonth != null ? (st.late ? `Échéance passée · il manque ${euro(st.left, { round: true })}` : `${euro(st.perMonth, { round: true })} par mois jusqu'en ${monthName(g.deadline)}`) : `Il reste ${euro(st.left, { round: true })}`}</span></span>
    <span class="end"><span class="amount">${euro(st.current, { round: true })}</span><div class="sub small">sur ${euro(g.target, { round: true })}</div></span>
  </button>`;
}

registerView('objectifs', () => {
  const s = app.state;
  const goals = s.goals || [];
  const effort = goalsEffort(s, app.today);
  const cap = goals.length ? goalStatus(s, goals[0], app.today).capacity : null;
  return {
    title: 'Objectifs', tabs: true, tab: 'accueil',
    html: html`<main class="screen">
      <div class="topbar"><a class="iconbtn back" href="#/prevision" aria-label="Retour">${icon('back')}</a><h1>Objectifs</h1><button class="iconbtn" data-act="goal-new" aria-label="Nouvel objectif">${icon('plus')}</button></div>
      ${goals.length ? html`
        <div class="group">${goals.map(goalRow)}</div>
        ${effort ? html`<div class="note" style="margin-top:14px">Vos objectifs demandent <strong class="amount">${euro(effort, { round: true })}</strong> par mois${cap != null ? html`. Vous mettez de côté <strong class="amount">${euro(cap, { round: true })}</strong> par mois en moyenne${cap > 0 && effort > cap ? ' : il faudra repousser une échéance ou réduire un montant.' : '.'}` : '.'}</div>` : ''}
        <button class="btn ghost block" style="margin-top:14px" data-act="goal-new">${icon('plus')} Nouvel objectif</button>`
      : html`<div class="empty"><strong>Aucun objectif</strong>Un voyage, un apport pour un achat, 3 mois de dépenses de côté… Indiquez un montant et une date : Pécule calcule combien mettre de côté chaque mois.
          <div style="margin-top:18px"><button class="btn brass" data-act="goal-new">Créer un objectif</button></div></div>`}
    </main>`,
  };
});

const ICONS = ['🎯', '✈️', '🏠', '🚗', '🛟', '🎓', '💍', '👶', '🎁', '💻'];

function goalForm(g = {}) {
  const s = app.state;
  const accs = s.accounts;
  const icn = g.icon || '🎯';
  openSheet(html`<h3>${g.id ? 'Modifier l\'objectif' : 'Nouvel objectif'}</h3>
    <form data-submit="goal-save"><input type="hidden" name="id" value="${g.id || ''}"><input type="hidden" name="icon" value="${icn}">
      <div class="chips" role="group" aria-label="Icône">${ICONS.map(i => html`<button type="button" class="chip" data-act="goal-icon" data-i="${i}" aria-pressed="${i === icn}">${i}</button>`)}</div>
      <label class="field"><span>Nom</span><input class="input" name="name" required value="${g.name || ''}" placeholder="Ex. : voyage au Japon" data-autofocus></label>
      <label class="field"><span>Montant à atteindre (€)</span><input class="input big" name="target" inputmode="decimal" required value="${g.target ? String(g.target / 100).replace('.', ',') : ''}"></label>
      <label class="field"><span>Pour quand ? (facultatif)</span><input class="input" type="month" name="deadline" value="${g.deadline || ''}" min="${app.today.slice(0, 7)}"></label>
      <label class="field"><span>Argent mis de côté sur</span><select class="input" name="account">
        <option value="">Je l'indique moi-même</option>
        ${accs.map(a => html`<option value="${a.id}" ${g.accountId === a.id ? 'selected' : ''}>${a.type === 'titres' ? 'Portefeuille de titres' : a.name}</option>`)}</select></label>
      <label class="field"><span>Déjà mis de côté (€), si aucun compte choisi</span><input class="input" name="manual" inputmode="decimal" value="${g.manual ? String(g.manual / 100).replace('.', ',') : ''}" placeholder="0"></label>
      <p class="hint">Avec un compte choisi (un livret dédié par exemple), l'avancement suit son solde à chaque import.</p>
      <button class="btn brass block" style="margin-top:12px">Enregistrer</button>
    </form>`, { label: 'Objectif' });
}

function goalSheet(g) {
  const st = goalStatus(app.state, g, app.today);
  openSheet(html`<h3>${g.icon || '🎯'} ${g.name}</h3>
    <div class="progress" style="height:12px;margin:0 4px 10px"><i style="width:${st.pct * 100}%;${st.done ? 'background:var(--pos)' : ''}"></i></div>
    <div class="group">
      <div class="row plain"><span class="main">Mis de côté${st.linked ? html`<span class="sub">${st.linked.type === 'titres' ? 'Portefeuille de titres' : st.linked.name}</span>` : ''}</span><span class="end amount">${euro(st.current)}</span></div>
      <div class="row plain"><span class="main">Objectif</span><span class="end amount">${euro(g.target)}</span></div>
      <div class="row plain"><span class="main">Reste</span><span class="end amount">${euro(st.left)}</span></div>
      ${g.deadline ? html`<div class="row plain"><span class="main">Échéance</span><span class="end">${monthName(g.deadline)}</span></div>` : ''}
      ${st.perMonth ? html`<div class="row plain"><span class="main">À mettre de côté chaque mois</span><span class="end amount"><strong>${euro(st.perMonth)}</strong></span></div>` : ''}
    </div>
    ${st.share != null && st.perMonth ? html`<p class="hint">Soit ${pct(st.share)} de ce que vous mettez de côté en moyenne chaque mois (${euro(st.capacity, { round: true })}).</p>` : ''}
    ${!g.accountId ? html`<form data-submit="goal-add" style="margin-top:10px"><input type="hidden" name="id" value="${g.id}">
      <label class="field"><span>Ajouter un versement (€)</span><input class="input" name="v" inputmode="decimal" placeholder="Ex. : 50"></label>
      <button class="btn brass block">Ajouter</button></form>` : ''}
    <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-act="goal-edit" data-id="${g.id}">Modifier</button><button class="btn danger" data-act="goal-del" data-id="${g.id}">Supprimer</button></div>`, { label: g.name });
}

registerActions({
  'goal-new': () => goalForm(),
  'goal-open': el => { const g = (app.state.goals || []).find(x => x.id === el.dataset.id); if (g) goalSheet(g); },
  'goal-edit': el => { const g = app.state.goals.find(x => x.id === el.dataset.id); if (g) goalForm(g); },
  'goal-icon': el => {
    const form = el.closest('.sheet').querySelector('form');
    form.icon.value = el.dataset.i;
    el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
  },
  'goal-save': form => {
    const target = parseAmount(form.target.value);
    if (!target || target <= 0) { toast('Indiquez un montant'); return; }
    const fields = {
      name: form.name.value.trim() || 'Objectif', icon: form.icon.value, target: Math.abs(target),
      deadline: form.deadline.value || null, accountId: form.account.value || null,
      manual: Math.abs(parseAmount(form.manual.value) || 0),
    };
    update(s => {
      s.goals ||= [];
      const cur = s.goals.find(g => g.id === form.id.value);
      if (cur) Object.assign(cur, fields);
      else s.goals.push({ id: uid('goal_'), createdAt: new Date().toISOString(), ...fields });
    });
    closeSheet();
    toast('Objectif enregistré');
  },
  'goal-add': form => {
    const v = parseAmount(form.v.value);
    if (!v) return;
    let g;
    update(s => { g = s.goals.find(x => x.id === form.id.value); if (g) g.manual = Math.max(0, (g.manual || 0) + v); });
    if (g) goalSheet(g);
    toast(`${euro(v)} ajoutés`);
  },
  'goal-del': async el => {
    if (!(await ask('Supprimer cet objectif ?', 'Vos comptes et opérations ne sont pas modifiés.', { ok: 'Supprimer', danger: true }))) return;
    update(s => { s.goals = s.goals.filter(g => g.id !== el.dataset.id); });
  },
});

export { goalRow };
