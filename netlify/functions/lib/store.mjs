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
    async getBin(k) { try { return { buf: await fs.readFile(p(k)), type: await fs.readFile(p(k + '.meta'), 'utf8') }; } catch { return null; } }
  };
}

async function blobStore() {
  const { getStore } = await import('@netlify/blobs');
  const s = getStore({ name: storeName(), consistency: 'strong' });
  return {
    get: (k) => s.get(k, { type: 'json' }),
    set: (k, v) => s.setJSON(k, v),
    del: (k) => s.delete(k),
    async create(k, v) { const r = await s.setJSON(k, v, { onlyIfNew: true }); return !!(r && r.modified); },
    async list(prefix) { const r = await s.list({ prefix }); return r.blobs.map((b) => b.key); },
    setBin: (k, buf, type) => s.set(k, buf, { metadata: { type } }),
    async getBin(k) {
      const r = await s.getWithMetadata(k, { type: 'arrayBuffer' });
      return r ? { buf: Buffer.from(r.data), type: (r.metadata && r.metadata.type) || 'application/octet-stream' } : null;
    }
  };
}

// Preview and branch deploys get their own store so tests never touch live records.
let deployContext = 'production';
export function setDeployContext(c) { if (c && c !== deployContext) { deployContext = c; cached = null; } }
export function storeName() { return deployContext === 'production' ? 'morelife-hq' : 'morelife-hq-preview'; }

let cached;
export async function store() {
  if (!cached) cached = process.env.HQ_LOCAL_STORE ? fileStore(process.env.HQ_LOCAL_STORE) : await blobStore();
  return cached;
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
