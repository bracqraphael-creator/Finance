// Traduction anglais → français des actualités.
// 1. Traducteur intégré au navigateur quand il existe (Chrome sur ordinateur) : sur l'appareil, sans limite.
// 2. Sinon MyMemory (gratuit, sans clé, environ 5 000 caractères par jour) : seul le texte public de l'actualité est envoyé.
// Les traductions sont gardées dans le coffre : une actualité n'est traduite qu'une fois.

const MM = 'https://api.mymemory.translated.net/get';
const MAX_BYTES = 480;

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Coupe un texte à moins de 480 octets UTF-8, sur une fin de phrase ou de mot. */
export function clip(text) {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= MAX_BYTES) return text;
  let t = text;
  while (enc.encode(t).length > MAX_BYTES - 3) t = t.slice(0, Math.floor(t.length * 0.9));
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf(' '));
  return (cut > 40 ? t.slice(0, cut) : t).trim() + '…';
}

export function cachedTranslation(state, text) {
  if (!text) return null;
  return state.market?.translations?.[hash(text)] || null;
}

let native = null; // traducteur du navigateur, créé une fois
async function nativeTranslator() {
  if (native !== null) return native;
  native = false;
  try {
    if ('Translator' in self) {
      const opts = { sourceLanguage: 'en', targetLanguage: 'fr' };
      // Certains navigateurs ne répondent jamais : on n'attend pas plus d'une seconde et demie
      const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
      const av = await within(self.Translator.availability(opts), 1500);
      if (av === 'available') native = await within(self.Translator.create(opts), 3000);
    }
  } catch { native = false; }
  return native;
}

/** Quota du jour atteint chez MyMemory : on n'essaie plus avant demain. */
function quotaReached(state) {
  return state.market?.translateQuotaDay === new Date().toISOString().slice(0, 10);
}

export async function translate(state, text) {
  if (!text || !text.trim()) return text;
  const key = hash(text);
  state.market ||= {};
  const store = (state.market.translations ||= {});
  if (store[key]) return store[key];
  let out = null;
  const tr = await nativeTranslator();
  if (tr) {
    try { out = await tr.translate(text); } catch { out = null; }
  }
  if (!out) {
    if (quotaReached(state)) throw new Error('quota');
    let r;
    try {
      r = await fetch(`${MM}?q=${encodeURIComponent(clip(text))}&langpair=en%7Cfr`, { referrerPolicy: 'no-referrer', credentials: 'omit' });
    } catch {
      throw new Error('offline');
    }
    const j = await r.json().catch(() => ({}));
    const t = j?.responseData?.translatedText || '';
    if (r.status === 429 || /MYMEMORY WARNING|QUOTA/i.test(t) || Number(j?.responseStatus) === 429) {
      state.market.translateQuotaDay = new Date().toISOString().slice(0, 10);
      throw new Error('quota');
    }
    if (!r.ok || Number(j?.responseStatus) !== 200 || !t) throw new Error('failed');
    out = decodeEntities(t);
  }
  store[key] = out;
  // On garde les 400 traductions les plus récentes
  const keys = Object.keys(store);
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete store[k];
  return out;
}

/** Lien qui ouvre la page de l'article traduite en français par Google Traduction. */
export function translatedPageUrl(url) {
  return `https://translate.google.com/translate?sl=auto&tl=fr&hl=fr&u=${encodeURIComponent(url)}`;
}

export const translationQuotaReached = quotaReached;
