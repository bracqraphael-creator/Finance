// Petits outils d'interface : gabarits HTML échappés, feuille du bas, toasts, icônes.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(s);

/** Gabarit : les valeurs sont échappées, sauf raw(...) et les tableaux de raw. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return raw(out);
}
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v == null) return '';
  return esc(v);
}

// ---------- Feuille du bas ----------
let sheetEl = null, backdropEl = null, onCloseCb = null;
export function openSheet(content, { onClose, label = '' } = {}) {
  closeSheet(true);
  backdropEl = document.createElement('div');
  backdropEl.className = 'sheet-backdrop';
  backdropEl.addEventListener('click', () => closeSheet());
  sheetEl = document.createElement('div');
  sheetEl.className = 'sheet';
  sheetEl.setAttribute('role', 'dialog');
  sheetEl.setAttribute('aria-modal', 'true');
  if (label) sheetEl.setAttribute('aria-label', label);
  sheetEl.innerHTML = '<div class="grip"></div>' + String(content);
  document.body.append(backdropEl, sheetEl);
  onCloseCb = onClose || null;
  requestAnimationFrame(() => { backdropEl.classList.add('open'); sheetEl.classList.add('open'); });
  // Glisser vers le bas pour fermer
  let y0 = null;
  sheetEl.addEventListener('touchstart', e => { if (sheetEl.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sheetEl.addEventListener('touchmove', e => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) sheetEl.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheetEl.addEventListener('touchend', e => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    sheetEl.style.transform = '';
    if (dy > 110) closeSheet();
  });
  const first = sheetEl.querySelector('input:not([type=hidden]),select,textarea');
  if (first && first.dataset.autofocus !== undefined) setTimeout(() => first.focus(), 280);
  return sheetEl;
}
export function updateSheet(content) {
  if (!sheetEl) return;
  sheetEl.innerHTML = '<div class="grip"></div>' + String(content);
}
export function closeSheet(immediate = false) {
  if (!sheetEl) return;
  const s = sheetEl, b = backdropEl, cb = onCloseCb;
  sheetEl = backdropEl = onCloseCb = null;
  if (immediate) { s.remove(); b.remove(); }
  else {
    s.classList.remove('open'); b.classList.remove('open');
    setTimeout(() => { s.remove(); b.remove(); }, 260);
  }
  cb?.();
}
export const sheetOpen = () => !!sheetEl;

// ---------- Toast ----------
let toastTimer;
export function toast(message, action = null) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); t.remove(); });
    t.append(b);
  }
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, action ? 6000 : 3200);
}

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* non pris en charge */ }
}

// ---------- Icônes (traits 1,75 px, 24×24) ----------
const P = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  accounts: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
  budget: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6"/>',
  bourse: '<path d="M4 18 9.5 12l3.5 3.5L20 8"/><path d="M15 8h5v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9M6.6 7.6C4 9.3 2.5 12 2.5 12S6 18 12 18a9 9 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 17.7 17"/><path d="M20 5v6.5h-6.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
}

/** Confirmation dans une feuille du bas (les boîtes du navigateur sont peu lisibles sur téléphone). */
export function ask(title, body, { ok = 'Confirmer', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    const el = openSheet(`<h3>${esc(title)}</h3><p class="muted" style="margin:0 4px 18px;font-size:16px">${esc(body)}</p>
      <button class="btn ${danger ? 'danger' : 'brass'} block" data-ask="yes">${esc(ok)}</button>
      <button class="btn ghost block" style="margin-top:10px" data-ask="no">Annuler</button>`, { label: title, onClose: () => finish(false) });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-ask]');
      if (!b) return;
      const yes = b.dataset.ask === 'yes';
      finish(yes);
      closeSheet();
    });
  });
}
