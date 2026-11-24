// Storage adapter. Production: Netlify Blobs (persistent, per-site). Local dev/tests: JSON files on disk.
import fs from 'node:fs/promises';
import path from 'node:path';

function fileStore(dir) {
  const p = (k) => path.join(dir, encodeURIComponent(k));
  return {
    async get(k) { try { return JSON.parse(await fs.readFile(p(k), 'utf8')); } catch { return null; } },
    // written beside the target and renamed, so a reader never sees a half-written record (local test store only)
    async set(k, v) { await fs.mkdir(dir, { recursive: true }); const tmp = p(k) + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp'; await fs.writeFile(tmp, JSON.stringify(v)); await fs.rename(tmp, p(k)); },
    async del(k) { try { await fs.unlink(p(k)); } catch {} },
    // Atomic create: resolves true only for the single caller that created the key.
    async create(k, v) { await fs.mkdir(dir, { recursive: true }); try { await fs.writeFile(p(k), JSON.stringify(v), { flag: 'wx' }); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; } },
    async list(prefix) {
      try { return (await fs.readdir(dir)).map(decodeURIComponent).filter((k) => k.startsWith(prefix) && !k.endsWith('.meta') && !k.endsWith('.tmp')); } catch { return []; }
    },
    async setBin(k, buf, type) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(p(k), buf); await fs.writeFile(p(k + '.meta'), type); },
    async getBin(k) { try { return { buf: await fs.readFile(p(k)), type: await fs.readFile(p(k + '.meta'), 'utf8') }; } catch { return null; } },
    async delBin(k) { for (const f of [p(k), p(k + '.meta')]) { try { await fs.unlink(f); } catch {} } }
  };
}

// The Blobs client is made again for every call. A function instance stays warm across many requests, and the access
// token Netlify hands it is short-lived: a client kept from an earlier request starts failing with "Token expired".
async function blobStore(name) {
  const { getStore } = await import('@netlify/blobs');
  const s = () => getStore({ name: name || storeName(), consistency: 'strong' });
  return {
    get: (k) => s().get(k, { type: 'json' }),
    set: (k, v) => s().setJSON(k, v),
    del: (k) => s().delete(k),
    async create(k, v) { const r = await s().setJSON(k, v, { onlyIfNew: true }); return !!(r && r.modified); },
    async list(prefix) { const r = await s().list({ prefix }); return r.blobs.map((b) => b.key); },
    setBin: (k, buf, type) => s().set(k, buf, { metadata: { type } }),
    async getBin(k) {
      const r = await s().getWithMetadata(k, { type: 'arrayBuffer' });
      return r ? { buf: Buffer.from(r.data), type: (r.metadata && r.metadata.type) || 'application/octet-stream' } : null;
    },
    delBin: (k) => s().delete(k)
  };
}

// Preview and branch deploys get their own store so tests never touch live records.
let deployContext = 'production';
export function setDeployContext(c) { if (c && c !== deployContext) { deployContext = c; cached = null; cachedBackup = null; } }
export function storeName() { return deployContext === 'production' ? 'morelife-hq' : 'morelife-hq-preview'; }

// Every write to a CRM contact is noticed here, so the contact snapshot (see allContacts) knows when it is out of date.
let contactsDirty = false;
function tracked(s) {
  const mark = (k) => { if (k.startsWith('contacts/')) contactsDirty = true; };
  return { ...s, set: (k, v) => { mark(k); return s.set(k, v); }, del: (k) => { mark(k); return s.del(k); }, create: (k, v) => { mark(k); return s.create(k, v); } };
}

let cached;
export async function store() {
  if (!cached) cached = tracked(process.env.HQ_LOCAL_STORE ? fileStore(process.env.HQ_LOCAL_STORE) : await blobStore());
  return cached;
}

// Backups live in a store of their own, so nothing that edits or deletes HQ records can reach them.
let cachedBackup;
export async function backupStore() {
  if (!cachedBackup) cachedBackup = process.env.HQ_LOCAL_STORE ? fileStore(process.env.HQ_LOCAL_STORE + '-backups') : await blobStore(storeName() + '-backups');
  return cachedBackup;
}

// Runs fn over items with at most `limit` in flight, so a large collection never opens thousands of storage requests at once.
export async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function all(prefix) {
  const s = await store();
  const keys = await s.list(prefix);
  const out = await pool(keys, 64, (k) => s.get(k));
  return out.filter(Boolean);
}

// CRM contacts as one snapshot. Reading every contact record on each list, search or audience count gets slow as the CRM
// grows, so the list is kept in a single record next to a stamp. The stamp changes after any contact is written (flushDirty,
// called at the end of every request); a snapshot is trusted only while its stamp matches and it is under ten minutes old.
const STAMP = 'meta/contactsStamp', SNAP = 'cache/contacts', SNAP_MAX_AGE = 10 * 60 * 1000;
export async function flushDirty() {
  if (!contactsDirty) return;
  contactsDirty = false;
  await (await store()).set(STAMP, { v: Date.now().toString(36) + Math.random().toString(36).slice(2), at: new Date().toISOString() });
}
export const touchContacts = () => { contactsDirty = true; };
export async function allContacts() {
  const s = await store();
  if (contactsDirty) return all('contacts/'); // this request has changed contacts itself: read them directly
  const [st, snap] = await Promise.all([s.get(STAMP), s.get(SNAP)]), v = (st && st.v) || '0';
  if (snap && snap.v === v && Date.now() - Date.parse(snap.at) < SNAP_MAX_AGE) return snap.rows;
  const rows = await all('contacts/'); // the stamp was read before the contacts, so a write that lands meanwhile makes this snapshot stale, not wrong
  await s.set(SNAP, { v, at: new Date().toISOString(), rows });
  return rows;
}
