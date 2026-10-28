// Coffre chiffré : toutes les données sont chiffrées (AES-GCM 256) avant d'être écrites sur le téléphone.
// Une clé de données aléatoire est « emballée » par une clé dérivée du mot de passe (PBKDF2-SHA256)
// et, séparément, par une clé dérivée du code de secours. Rien n'est envoyé sur Internet.

const DB = 'pecule';
const STORE = 'kv';
const VAULT_KEY = 'vault';
const PW_ITER = 600000;
const REC_ITER = 150000;

const te = new TextEncoder();
const td = new TextDecoder();
export const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbSet(key, val) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function idbDel(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- Clés ----------
async function kekFromSecret(secret, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function wrap(dek, kek) {
  const iv = rand(12);
  const data = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv: b64(iv), data: b64(data) };
}
async function unwrap(w, kek) {
  return crypto.subtle.unwrapKey('raw', unb64(w.data), kek, { name: 'AES-GCM', iv: unb64(w.iv) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey']);
}

async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return { bytes, z: false };
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(s).arrayBuffer()), z: true };
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function encryptState(dek, state) {
  const { bytes, z } = await gzip(te.encode(JSON.stringify(state)));
  const iv = rand(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, bytes);
  return { iv: b64(iv), data: b64(data), z };
}
async function decryptState(dek, box) {
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, dek, unb64(box.data)));
  if (box.z) bytes = await gunzip(bytes);
  return JSON.parse(td.decode(bytes));
}

// Code de secours lisible : 25 caractères sans ambiguïté (pas de 0/O, 1/I/L), en 5 groupes.
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRecoveryCode() {
  const r = rand(25);
  const chars = Array.from(r, b => ALPHA[b % ALPHA.length]).join('');
  return chars.match(/.{5}/g).join('-');
}
export const normalizeRecovery = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- API ----------
export async function hasVault() {
  return !!(await idbGet(VAULT_KEY));
}

export async function createVault(password, state) {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = rand(16), salt2 = rand(16);
  const recovery = newRecoveryCode();
  const vault = {
    v: 1,
    app: 'pecule',
    pw: { salt: b64(salt), iter: PW_ITER, ...(await wrap(dek, await kekFromSecret(password, salt, PW_ITER))) },
    rec: { salt: b64(salt2), iter: REC_ITER, ...(await wrap(dek, await kekFromSecret(normalizeRecovery(recovery), salt2, REC_ITER))) },
    box: await encryptState(dek, state),
    savedAt: new Date().toISOString(),
  };
  await idbSet(VAULT_KEY, vault);
  return { dek, recovery };
}

export async function unlockWithPassword(password, vault = null) {
  vault = vault || (await idbGet(VAULT_KEY));
  const kek = await kekFromSecret(password, unb64(vault.pw.salt), vault.pw.iter);
  let dek;
  try { dek = await unwrap(vault.pw, kek); } catch { throw new Error('bad-password'); }
  return { dek, state: await decryptState(dek, vault.box) };
}

export async function unlockWithRecovery(code, vault = null) {
  vault = vault || (await idbGet(VAULT_KEY));
  const kek = await kekFromSecret(normalizeRecovery(code), unb64(vault.rec.salt), vault.rec.iter);
  let dek;
  try { dek = await unwrap(vault.rec, kek); } catch { throw new Error('bad-recovery'); }
  return { dek, state: await decryptState(dek, vault.box) };
}

let saving = Promise.resolve();
export function saveState(dek, state) {
  saving = saving.then(async () => {
    const vault = await idbGet(VAULT_KEY);
    vault.box = await encryptState(dek, state);
    vault.savedAt = new Date().toISOString();
    await idbSet(VAULT_KEY, vault);
  });
  return saving;
}

export async function changePassword(dek, newPassword) {
  const vault = await idbGet(VAULT_KEY);
  const salt = rand(16);
  vault.pw = { salt: b64(salt), iter: PW_ITER, ...(await wrap(dek, await kekFromSecret(newPassword, salt, PW_ITER))) };
  delete vault.bio; // l'empreinte devra être réactivée
  await idbSet(VAULT_KEY, vault);
}

export async function newRecovery(dek) {
  const vault = await idbGet(VAULT_KEY);
  const salt2 = rand(16);
  const recovery = newRecoveryCode();
  vault.rec = { salt: b64(salt2), iter: REC_ITER, ...(await wrap(dek, await kekFromSecret(normalizeRecovery(recovery), salt2, REC_ITER))) };
  await idbSet(VAULT_KEY, vault);
  return recovery;
}

/** Sauvegarde : le coffre tel quel (chiffré). Restaurable sur un autre téléphone avec le même mot de passe. */
export async function exportVault() {
  const vault = await idbGet(VAULT_KEY);
  const copy = { ...vault };
  delete copy.bio; // l'empreinte est liée à ce téléphone
  return JSON.stringify(copy);
}

export function parseBackup(text) {
  const v = JSON.parse(text);
  if (v.app !== 'pecule' || !v.pw || !v.box) throw new Error('not-a-backup');
  return v;
}

export async function replaceVault(vault) {
  await idbSet(VAULT_KEY, vault);
}

export async function wipe() {
  await idbDel(VAULT_KEY);
  await idbDel('inbox');
}

// ---------- Déverrouillage par Face ID / empreinte (WebAuthn + extension PRF) ----------
export function biometricPossible() {
  return typeof PublicKeyCredential !== 'undefined' && window.isSecureContext;
}

export async function biometricEnabled() {
  const v = await idbGet(VAULT_KEY);
  return !!v?.bio;
}

async function kekFromPrf(prfBytes) {
  const base = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('pecule-bio'), info: te.encode('kek') }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

async function prfGet(credId, salt) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const r = a.getClientExtensionResults()?.prf?.results?.first;
  if (!r) throw new Error('prf-unsupported');
  return new Uint8Array(r);
}

export async function enableBiometric(dek) {
  const salt = rand(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Pécule' },
      user: { id: rand(16), name: 'pecule', displayName: 'Pécule' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const ext = cred.getClientExtensionResults()?.prf;
  if (ext && ext.enabled === false) throw new Error('prf-unsupported');
  const credId = new Uint8Array(cred.rawId);
  const prf = ext?.results?.first ? new Uint8Array(ext.results.first) : await prfGet(credId, salt);
  const kek = await kekFromPrf(prf);
  const vault = await idbGet(VAULT_KEY);
  vault.bio = { credId: b64(credId), salt: b64(salt), ...(await wrap(dek, kek)) };
  await idbSet(VAULT_KEY, vault);
}

export async function disableBiometric() {
  const vault = await idbGet(VAULT_KEY);
  delete vault.bio;
  await idbSet(VAULT_KEY, vault);
}

export async function unlockWithBiometric() {
  const vault = await idbGet(VAULT_KEY);
  if (!vault?.bio) throw new Error('no-bio');
  const prf = await prfGet(unb64(vault.bio.credId), unb64(vault.bio.salt));
  const dek = await unwrap(vault.bio, await kekFromPrf(prf));
  return { dek, state: await decryptState(dek, vault.box) };
}
