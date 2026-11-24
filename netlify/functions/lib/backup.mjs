// Backups of the HQ store. A backup is one JSON record holding every HQ record, written to a separate store
// (see backupStore), plus a copy of each uploaded image and booking file. One is taken automatically every day by
// the scheduled run; the owner can also take one by hand, download it, or restore the store to it.
import { store, backupStore, pool, touchContacts } from './store.mjs';
import { json, fail, now, str, body, istToday } from './util.mjs';
import { resetMigrate } from './migrations.mjs';

// Not in a backup: counters and caches that rebuild themselves, the session signing key, one-time links, and page-view hits.
const SKIP = ['rate/', 'cache/', 'config/', 'setup/', 'hits/', 'meta/contactsStamp'];
const BIN = ['images/', 'files/'];
const isBin = (k) => BIN.some((p) => k.startsWith(p)), skipped = (k) => SKIP.some((p) => k.startsWith(p));
// A restore leaves these as they are today: the record of actions is never rolled back, and an old backup must not
// hand access back to someone who has since been removed from the team.
const KEEP_ON_RESTORE = ['audit/', 'users/', 'userEmail/'], kept = (k) => KEEP_ON_RESTORE.some((p) => k.startsWith(p));
const KEEP_DAILY = 30, KEEP_MONTHLY = 12, KEEP_OTHER = 10, BIN_PER_RUN = 25;
const KIND = { auto: 'Otomatik', manual: 'Elle', 'pre-restore': 'Geri yükleme öncesi' };
const istDay = (iso) => new Date(Date.parse(iso) + 3 * 3600 * 1000).toISOString().slice(0, 10);

async function listMeta(bs) { const out = await pool(await bs.list('meta/'), 32, (k) => bs.get(k)); return out.filter(Boolean).sort((a, b) => b.at.localeCompare(a.at)); }

// Uploaded files never change once written, so only the ones the backup store does not hold yet are copied.
async function copyBins(s, bs, limit = BIN_PER_RUN) {
  const have = new Set(await bs.list('bin/')), todo = [];
  for (const p of BIN) for (const k of await s.list(p)) if (!have.has('bin/' + k)) todo.push(k);
  await pool(todo.slice(0, limit), 4, async (k) => { const b = await s.getBin(k); if (b) await bs.setBin('bin/' + k, b.buf, b.type); });
  return { copied: Math.min(todo.length, limit), waiting: Math.max(0, todo.length - limit), held: have.size + Math.min(todo.length, limit) };
}

export async function createBackup(kind, by) {
  const s = await store(), bs = await backupStore(), at = now(), t0 = Date.now();
  const keys = (await s.list('')).filter((k) => !isBin(k) && !skipped(k)), vals = await pool(keys, 64, (k) => s.get(k));
  const records = {}, counts = {};
  keys.forEach((k, i) => { if (vals[i] == null) return; records[k] = vals[i]; const g = k.split('/')[0]; counts[g] = (counts[g] || 0) + 1; });
  const text = JSON.stringify({ v: 1, at, kind, by, records });
  const bins = await copyBins(s, bs);
  const meta = { id: at.replace(/[^0-9]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6), at, day: istDay(at), kind, kindLabel: KIND[kind] || kind, by: by || '', total: Object.keys(records).length, counts, bytes: Buffer.byteLength(text), bins, ms: Date.now() - t0 };
  await bs.set('snap/' + meta.id, { v: 1, at, kind, by, records }); await bs.set('meta/' + meta.id, meta);
  await prune(bs);
  return meta;
}
// Daily backups: the last 30, then the first one of each of the last 12 months. Manual and pre-restore: the last 10 of each.
async function prune(bs) {
  const all = await listMeta(bs), keep = new Set(), auto = all.filter((m) => m.kind === 'auto'), firstOf = new Map();
  auto.slice(0, KEEP_DAILY).forEach((m) => keep.add(m.id));
  for (const m of auto) firstOf.set(m.day.slice(0, 7), m.id); // newest first, so the last one written per month is its oldest
  [...firstOf.keys()].sort().reverse().slice(0, KEEP_MONTHLY).forEach((mo) => keep.add(firstOf.get(mo)));
  for (const k of ['manual', 'pre-restore']) all.filter((m) => m.kind === k).slice(0, KEEP_OTHER).forEach((m) => keep.add(m.id));
  for (const m of all) if (!keep.has(m.id)) { await bs.del('snap/' + m.id); await bs.del('meta/' + m.id); }
}

// Called by the scheduled run. The lock is an atomic create, so two overlapping runs take one backup between them.
export async function dailyBackup() {
  const bs = await backupStore(), day = istToday();
  if (!(await bs.create('lock/' + day, { at: now() }))) return { skipped: true };
  try { const m = await createBackup('auto', 'Otomatik'); return { id: m.id, total: m.total, ms: m.ms }; }
  catch (e) { await bs.del('lock/' + day); throw e; } // let the next run try again
}

const noSecrets = (snap) => { const r = { ...snap.records }; for (const k of Object.keys(r)) if (k.startsWith('users/')) r[k] = { ...r[k], pass: null, setup: null }; return { ...snap, records: r }; };

export async function backupsRoute(req, parts, url, s, me) {
  const m = req.method, bs = await backupStore();
  if (!parts[1] && m === 'GET') {
    const list = await listMeta(bs), auto = list.find((x) => x.kind === 'auto');
    return json({ backups: list, lastAuto: auto ? auto.at : '', scheduled: (process.env.CONTEXT || 'local') === 'production', keep: { daily: KEEP_DAILY, monthly: KEEP_MONTHLY, other: KEEP_OTHER }, bins: list[0] ? list[0].bins : null,
      notes: ['Yedekler HQ verisinden ayrı bir depoda durur; HQ’daki hiçbir silme ya da düzenleme onlara dokunmaz.', 'Sayfa görüntüleme sayaçları ve oturum anahtarı yedeğe girmez. İndirilen dosyada ekip şifreleri yer almaz.'] });
  }
  if (!parts[1] && m === 'POST') return json({ backup: await createBackup('manual', me.name) }, 201);
  const bid = str(parts[1], 40).replace(/[^0-9a-z-]/g, ''), meta = bid && await bs.get('meta/' + bid); if (!meta) return fail(404, 'Yedek bulunamadı.');
  if (parts[2] === 'download' && m === 'GET') {
    const snap = await bs.get('snap/' + bid); if (!snap) return fail(404, 'Yedek bulunamadı.');
    return new Response(JSON.stringify(noSecrets(snap)), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="morelife-hq-yedek-' + meta.day + '-' + bid.slice(8, 14) + '.json"', 'cache-control': 'no-store' } });
  }
  if (parts[2] === 'restore' && m === 'POST') {
    // Runs in steps the browser drives, so a large store never outlasts one request:
    // begin (safety backup) → write (every record of the backup, in windows) → prune (records that did not exist then) → finish.
    const b = await body(req), snap = await bs.get('snap/' + bid); if (!snap) return fail(404, 'Yedek bulunamadı.');
    const keys = Object.keys(snap.records).filter((k) => !kept(k)).sort();
    if (b.step === 'begin') {
      if (b.confirm !== 'GERİ YÜKLE') return fail(400, 'Onay metni eşleşmiyor.');
      const safety = await createBackup('pre-restore', me.name);
      return json({ total: keys.length, safety: safety.id });
    }
    if (b.step === 'write') {
      const from = Math.max(0, parseInt(b.from, 10) || 0), part = keys.slice(from, from + 300);
      await pool(part, 24, (k) => s.set(k, snap.records[k]));
      return json({ next: from + part.length < keys.length ? from + part.length : null, done: from + part.length, total: keys.length });
    }
    if (b.step === 'prune') {
      const want = new Set(keys), extra = (await s.list('')).filter((k) => !isBin(k) && !skipped(k) && !kept(k) && !want.has(k)), part = extra.slice(0, 400);
      await pool(part, 24, (k) => s.del(k));
      return json({ removed: part.length, left: extra.length - part.length });
    }
    if (b.step === 'finish') {
      // bring back uploaded files the backup knows and the store has lost
      const have = new Set(); for (const p of BIN) for (const k of await s.list(p)) have.add(k);
      const lost = (await bs.list('bin/')).map((k) => k.slice(4)).filter((k) => !have.has(k)), part = lost.slice(0, BIN_PER_RUN);
      await pool(part, 4, async (k) => { const f = await bs.getBin('bin/' + k); if (f) await s.setBin(k, f.buf, f.type); });
      if (lost.length > part.length) return json({ filesLeft: lost.length - part.length });
      touchContacts(); resetMigrate();
      return json({ ok: true, filesLeft: 0 });
    }
    return fail(400, 'Geçersiz adım.');
  }
  return fail(404, 'Bulunamadı.');
}
