// More Life HQ — one Netlify Function serving the gated /hq page, the admin API (/api/hq/*) and the guest API (/api/public/*).
import { store, all, setDeployContext, storeName } from './lib/store.mjs';
import { missingConfig, initSecret, checkLogin, sessionCookie, clearCookie, session, sameOrigin, token, id, hash } from './lib/auth.mjs';
import { APP_HTML, LOGIN_HTML } from './lib/hq-html.mjs';

export const config = { path: ['/hq', '/hq/*', '/api/hq/*', '/api/public/*'] };

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' } });
const fail = (status, error) => json({ error }, status);
const now = () => new Date().toISOString();
const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const normEmail = (e) => str(e, 200).toLowerCase();
const normPhone = (p) => str(p, 40).replace(/[^\d+]/g, '');
const tags = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(',')).map((x) => str(x, 40).toLowerCase()).filter(Boolean))].slice(0, 20);

async function body(req) { try { return await req.json(); } catch { return {}; } }

async function limited(key, max, windowSec) {
  const s = await store(), k = 'rate/' + key, t = Date.now();
  const r = (await s.get(k)) || { n: 0, t };
  if (t - r.t > windowSec * 1000) { r.n = 0; r.t = t; }
  r.n += 1; await s.set(k, r);
  return r.n > max;
}
const ipOf = (req, ctx) => (ctx && ctx.ip) || req.headers.get('x-nf-client-connection-ip') || 'local';

/* ---------- shaping ---------- */
const EVENT_FIELDS = ['title', 'artist', 'date', 'time', 'venue', 'city', 'description', 'ticketUrl', 'imageId'];
function eventInput(b, prev = {}) {
  const e = { ...prev };
  for (const f of EVENT_FIELDS) if (f in b) e[f] = str(b[f], f === 'description' ? 2000 : 300);
  if ('capacity' in b) e.capacity = Math.max(0, Math.min(100000, parseInt(b.capacity, 10) || 0));
  if ('visibility' in b) e.visibility = b.visibility === 'private' ? 'private' : 'public';
  if (e.ticketUrl && !/^https:\/\//.test(e.ticketUrl)) return { error: 'Bilet linki https:// ile başlamalı.' };
  if (e.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return { error: 'Tarih geçersiz.' };
  if (e.time && !/^\d{2}:\d{2}$/.test(e.time)) return { error: 'Saat geçersiz.' };
  if (!e.title) return { error: 'Etkinlik adı gerekli.' };
  return { event: e };
}
const publicEvent = (e) => ({ title: e.title, artist: e.artist, date: e.date, time: e.time, venue: e.venue, city: e.city, description: e.description, ticketUrl: e.ticketUrl, image: e.imageId ? '/api/public/image/' + e.imageId : '', visibility: e.visibility, invite: '/invite?t=' + e.inviteToken });
const today = () => new Date().toISOString().slice(0, 10);
const guestsOf = (rs, status) => rs.filter((r) => r.status === status).reduce((n, r) => n + (r.guests || 1), 0);

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function upsertContactFromRsvp(s, r) {
  const key = 'contactEmail/' + hash(r.email);
  const hit = await s.get(key);
  if (hit) return hit.id;
  const c = { id: id(), name: r.name, email: r.email, phone: r.phone, instagram: r.instagram, company: '', tags: ['rsvp'], notes: '', createdAt: now(), updatedAt: now() };
  await s.set('contacts/' + c.id, c); await s.set(key, { id: c.id });
  if (c.phone) await s.set('contactPhone/' + hash(normPhone(c.phone)), { id: c.id });
  return c.id;
}

/* ---------- guest API ---------- */
async function publicApi(req, ctx, parts, url) {
  const s = await store();
  if (parts[0] === 'events' && req.method === 'GET') {
    const evs = (await all('events/')).filter((e) => e.status === 'published' && e.visibility === 'public' && (!e.date || e.date >= today()));
    return json({ events: evs.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(publicEvent) });
  }
  if (parts[0] === 'image' && req.method === 'GET') {
    const key = str(parts[1], 60).replace(/[^A-Za-z0-9_-]/g, '');
    const img = key && await s.getBin('images/' + key);
    if (!img) return fail(404, 'Not found');
    return new Response(img.buf, { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  if (parts[0] === 'invite' && req.method === 'GET') {
    const ref = await s.get('invites/' + str(url.searchParams.get('t'), 60));
    const e = ref && await s.get('events/' + ref.eventId);
    if (!e || e.status !== 'published') return fail(404, 'This invitation is not available.');
    return json({ event: publicEvent(e) });
  }
  if (parts[0] === 'rsvp' && req.method === 'POST') {
    const b = await body(req);
    if (str(b.website)) return json({ ok: true, status: 'pending' }); // honeypot: pretend success
    if (await limited('rsvp/' + hash(ipOf(req, ctx)), 12, 3600)) return fail(429, 'Too many requests. Please try again later.');
    const ref = await s.get('invites/' + str(b.t, 60));
    const e = ref && await s.get('events/' + ref.eventId);
    if (!e || e.status !== 'published') return fail(404, 'This invitation is not available.');
    const r = { name: str(b.name, 120), email: normEmail(b.email), phone: str(b.phone, 40), instagram: str(b.instagram, 80), note: str(b.note, 600), guests: Math.max(1, Math.min(10, parseInt(b.guests, 10) || 1)) };
    if (!r.name || !emailOk(r.email)) return fail(400, 'Please enter your name and a valid email.');
    if (b.consent !== true) return fail(400, 'Please confirm that we may use your details for this event.');
    const dupKey = 'rsvpEmail/' + e.id + '/' + hash(r.email);
    if (await s.get(dupKey)) return json({ ok: true, status: 'pending', duplicate: true });
    Object.assign(r, { id: id(), eventId: e.id, status: 'pending', createdAt: now(), decidedAt: '', passToken: '', checkedInAt: '', scanCount: 0 });
    r.contactId = await upsertContactFromRsvp(s, r);
    await s.set('rsvps/' + e.id + '/' + r.id, r); await s.set(dupKey, { id: r.id });
    return json({ ok: true, status: 'pending' });
  }
  if (parts[0] === 'pass' && req.method === 'GET') {
    const ref = await s.get('passes/' + str(url.searchParams.get('t'), 60));
    const r = ref && await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId);
    const e = r && await s.get('events/' + r.eventId);
    if (!r || !e || r.status !== 'approved') return fail(404, 'This pass is not valid.');
    return json({ pass: { name: r.name, guests: r.guests, checkedIn: !!r.checkedInAt }, event: publicEvent(e) });
  }
  return fail(404, 'Not found');
}

/* ---------- admin API ---------- */
async function adminApi(req, ctx, parts, url) {
  const s = await store(), m = req.method;

  if (parts[0] === 'login' && m === 'POST') {
    if (!sameOrigin(req)) return fail(403, 'Geçersiz istek.');
    const ipk = 'login/' + hash(ipOf(req, ctx));
    if (await limited(ipk, 8, 900)) return fail(429, 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
    const b = await body(req);
    if (!checkLogin(b.email, b.password)) return fail(401, 'E-posta veya şifre hatalı.');
    await s.del('rate/' + ipk);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req) });
  }
  if (parts[0] === 'logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });

  const me = session(req);
  if (!me) return fail(401, 'Giriş gerekli.');
  if (m !== 'GET' && !sameOrigin(req)) return fail(403, 'Geçersiz istek.');
  if (parts[0] === 'session') return json({ email: me.email, store: storeName() });

  if (parts[0] === 'summary') {
    const [evs, rs, ts] = await Promise.all([all('events/'), all('rsvps/'), all('tasks/')]);
    const up = evs.filter((e) => e.status === 'published' && (!e.date || e.date >= today())).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const live = new Set(evs.filter((e) => e.status !== 'archived').map((e) => e.id));
    const act = rs.filter((r) => live.has(r.eventId));
    return json({
      upcoming: up.map((e) => ({ id: e.id, title: e.title, date: e.date, venue: e.venue, pending: act.filter((r) => r.eventId === e.id && r.status === 'pending').length, approved: guestsOf(act.filter((r) => r.eventId === e.id), 'approved'), capacity: e.capacity })),
      pendingRsvps: act.filter((r) => r.status === 'pending').length,
      approvedGuests: guestsOf(act, 'approved'),
      openTasks: ts.filter((t) => t.status !== 'done').length
    });
  }

  if (parts[0] === 'events') {
    if (m === 'GET' && !parts[1]) {
      const [evs, rs] = await Promise.all([all('events/'), all('rsvps/')]);
      return json({ events: evs.sort((a, b) => (b.date || '9').localeCompare(a.date || '9')).map((e) => {
        const mine = rs.filter((r) => r.eventId === e.id);
        return { ...e, counts: { pending: mine.filter((r) => r.status === 'pending').length, approved: guestsOf(mine, 'approved'), waitlist: mine.filter((r) => r.status === 'waitlist').length, checkedIn: mine.filter((r) => r.checkedInAt).reduce((n, r) => n + (r.guests || 1), 0) } };
      }) });
    }
    if (m === 'POST' && !parts[1]) {
      const r = eventInput(await body(req), { visibility: 'public' });
      if (r.error) return fail(400, r.error);
      const e = { ...r.event, id: id(), status: 'draft', inviteToken: token(), createdAt: now(), updatedAt: now() };
      await s.set('events/' + e.id, e); await s.set('invites/' + e.inviteToken, { eventId: e.id });
      return json({ event: e }, 201);
    }
    const e = await s.get('events/' + str(parts[1], 40));
    if (!e) return fail(404, 'Etkinlik bulunamadı.');
    if (m === 'PUT' && !parts[2]) {
      const r = eventInput(await body(req), e);
      if (r.error) return fail(400, r.error);
      r.event.updatedAt = now(); await s.set('events/' + e.id, r.event);
      return json({ event: r.event });
    }
    if (m === 'POST' && parts[2] === 'status') {
      const st = (await body(req)).status;
      if (!['draft', 'published', 'archived'].includes(st)) return fail(400, 'Geçersiz durum.');
      if (st === 'published' && (!e.date || !e.venue)) return fail(400, 'Yayınlamak için tarih ve mekân gerekli.');
      e.status = st; e.updatedAt = now(); await s.set('events/' + e.id, e);
      return json({ event: e });
    }
  }

  if (parts[0] === 'images' && m === 'POST') {
    const mm = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec((await body(req)).dataUrl || '');
    if (!mm) return fail(400, 'Görsel JPEG, PNG veya WebP olmalı.');
    const buf = Buffer.from(mm[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) return fail(400, 'Görsel 3 MB’dan küçük olmalı.');
    const key = id(); await s.setBin('images/' + key, buf, mm[1]);
    return json({ id: key, url: '/api/public/image/' + key }, 201);
  }

  if (parts[0] === 'rsvps' || parts[0] === 'rsvps.csv') {
    const evId = str(parts[1] || url.searchParams.get('event'), 40);
    const e = evId && await s.get('events/' + evId);
    if (!e) return fail(404, 'Etkinlik bulunamadı.');
    const list = (await all('rsvps/' + e.id + '/')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (parts[0] === 'rsvps.csv') {
      const head = ['Ad', 'E-posta', 'Telefon', 'Instagram', 'Kişi', 'Durum', 'Başvuru', 'Karar', 'Giriş', 'Okutma', 'Not'];
      const rows = list.map((r) => [r.name, r.email, r.phone, r.instagram, r.guests, r.status, r.createdAt, r.decidedAt, r.checkedInAt, r.scanCount, r.note]);
      const csv = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="misafir-listesi-' + e.id + '.csv"' } });
    }
    if (m === 'GET') return json({ event: e, rsvps: list });
    if (m === 'POST' && parts[3] === 'decision') {
      const r = list.find((x) => x.id === parts[2]);
      if (!r) return fail(404, 'Başvuru bulunamadı.');
      const b = await body(req);
      if (!['approved', 'rejected', 'waitlist', 'pending'].includes(b.decision)) return fail(400, 'Geçersiz karar.');
      if (b.decision === 'approved' && r.status !== 'approved' && e.capacity && !b.force) {
        const used = guestsOf(list, 'approved');
        if (used + r.guests > e.capacity) return json({ error: 'Kapasite aşılıyor: ' + used + ' onaylı + ' + r.guests + ' > ' + e.capacity + '.', overCapacity: true }, 409);
      }
      r.status = b.decision; r.decidedAt = now();
      if (r.status === 'approved' && !r.passToken) { r.passToken = token(); await s.set('passes/' + r.passToken, { eventId: e.id, rsvpId: r.id }); }
      await s.set('rsvps/' + e.id + '/' + r.id, r);
      return json({ rsvp: r });
    }
  }

  if (parts[0] === 'checkin' && m === 'POST') {
    const b = await body(req);
    let ref = b.rsvpId ? { eventId: str(b.eventId, 40), rsvpId: str(b.rsvpId, 40) } : await s.get('passes/' + str(b.token, 60));
    if (!ref) return json({ result: 'invalid', message: 'Geçersiz QR.' });
    if (b.eventId && ref.eventId !== b.eventId) return json({ result: 'wrong-event', message: 'Bu kart başka bir etkinliğe ait.' });
    const r = await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId);
    if (!r) return json({ result: 'invalid', message: 'Kayıt bulunamadı.' });
    if (r.status !== 'approved') return json({ result: 'not-approved', message: 'Bu misafir onaylı değil.', rsvp: r });
    if (b.undo) { r.checkedInAt = ''; r.scanCount = 0; await s.set('rsvps/' + r.eventId + '/' + r.id, r); return json({ result: 'undone', rsvp: r }); }
    r.scanCount = (r.scanCount || 0) + 1;
    const first = !r.checkedInAt;
    if (first) r.checkedInAt = now();
    await s.set('rsvps/' + r.eventId + '/' + r.id, r);
    return json({ result: first ? 'ok' : 'duplicate', message: first ? 'Giriş onaylandı.' : 'Bu kart daha önce okutuldu.', rsvp: r });
  }

  if (parts[0] === 'contacts') {
    if (parts[1] === 'import' && m === 'POST') {
      const b = await body(req), rows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [];
      const seen = new Set(), out = [];
      for (const raw of rows) {
        const c = { name: str(raw.name, 120), email: normEmail(raw.email), phone: str(raw.phone, 40), instagram: str(raw.instagram, 80), company: str(raw.company, 120), tags: tags(raw.tags), notes: str(raw.notes, 2000) };
        const ph = normPhone(c.phone), keys = [c.email && 'e:' + c.email, ph && 'p:' + ph].filter(Boolean);
        let status = 'new', match = null;
        if (!c.name && !c.email) status = 'invalid';
        else if (c.email && !emailOk(c.email)) status = 'invalid';
        else if (keys.some((k) => seen.has(k))) status = 'duplicate-in-file';
        else {
          const hit = (c.email && await s.get('contactEmail/' + hash(c.email))) || (ph && await s.get('contactPhone/' + hash(ph)));
          if (hit) { status = 'match'; match = await s.get('contacts/' + hit.id); }
        }
        keys.forEach((k) => seen.add(k));
        if (b.commit && status === 'new') {
          const n = { ...c, id: id(), createdAt: now(), updatedAt: now() };
          await s.set('contacts/' + n.id, n);
          if (n.email) await s.set('contactEmail/' + hash(n.email), { id: n.id });
          if (ph) await s.set('contactPhone/' + hash(ph), { id: n.id });
        }
        if (b.commit && status === 'match' && match && c.tags.length) { match.tags = tags([...(match.tags || []), ...c.tags]); match.updatedAt = now(); await s.set('contacts/' + match.id, match); }
        out.push({ row: c, status, match: match ? { id: match.id, name: match.name, email: match.email } : null });
      }
      const count = (st) => out.filter((o) => o.status === st).length;
      return json({ committed: !!b.commit, rows: out.slice(0, 500), totals: { new: count('new'), match: count('match'), duplicateInFile: count('duplicate-in-file'), invalid: count('invalid') } });
    }
    if (m === 'GET' && !parts[1]) return json({ contacts: (await all('contacts/')).sort((a, b) => a.name.localeCompare(b.name, 'tr')) });
    const input = async (prev = {}) => {
      const b = await body(req);
      const c = { ...prev, name: str(b.name, 120), email: normEmail(b.email), phone: str(b.phone, 40), instagram: str(b.instagram, 80), company: str(b.company, 120), tags: tags(b.tags), notes: str(b.notes, 2000), updatedAt: now() };
      if (!c.name) return { error: 'İsim gerekli.' };
      if (c.email && !emailOk(c.email)) return { error: 'E-posta geçersiz.' };
      const hit = c.email && await s.get('contactEmail/' + hash(c.email));
      if (hit && hit.id !== prev.id) return { error: 'Bu e-posta ile kayıtlı bir kişi zaten var.' };
      return { contact: c };
    };
    const index = async (c, prev) => {
      if (prev && prev.email && prev.email !== c.email) await s.del('contactEmail/' + hash(prev.email));
      if (prev && prev.phone && normPhone(prev.phone) !== normPhone(c.phone)) await s.del('contactPhone/' + hash(normPhone(prev.phone)));
      if (c.email) await s.set('contactEmail/' + hash(c.email), { id: c.id });
      if (normPhone(c.phone)) await s.set('contactPhone/' + hash(normPhone(c.phone)), { id: c.id });
    };
    if (m === 'POST' && !parts[1]) {
      const r = await input(); if (r.error) return fail(400, r.error);
      const c = { ...r.contact, id: id(), createdAt: now() };
      await s.set('contacts/' + c.id, c); await index(c);
      return json({ contact: c }, 201);
    }
    const c = await s.get('contacts/' + str(parts[1], 40));
    if (!c) return fail(404, 'Kişi bulunamadı.');
    if (m === 'GET') {
      const [rs, evs] = await Promise.all([all('rsvps/'), all('events/')]);
      const byId = Object.fromEntries(evs.map((e) => [e.id, e]));
      const history = rs.filter((r) => r.contactId === c.id || (c.email && r.email === c.email)).map((r) => ({ eventId: r.eventId, event: (byId[r.eventId] || {}).title || '', date: (byId[r.eventId] || {}).date || '', status: r.status, guests: r.guests, checkedInAt: r.checkedInAt })).sort((a, b) => b.date.localeCompare(a.date));
      return json({ contact: c, history });
    }
    if (m === 'PUT') {
      const r = await input(c); if (r.error) return fail(400, r.error);
      await s.set('contacts/' + c.id, r.contact); await index(r.contact, c);
      return json({ contact: r.contact });
    }
  }

  if (parts[0] === 'tasks') {
    const input = async (prev = {}) => {
      const b = await body(req);
      const t = { ...prev, updatedAt: now() };
      if ('title' in b) t.title = str(b.title, 200);
      if ('eventId' in b) t.eventId = str(b.eventId, 40);
      if ('assignee' in b) t.assignee = str(b.assignee, 80);
      if ('due' in b) t.due = /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : '';
      if ('status' in b) t.status = ['todo', 'doing', 'done'].includes(b.status) ? b.status : 'todo';
      if (!t.title) return { error: 'Görev başlığı gerekli.' };
      if (t.eventId && !(await s.get('events/' + t.eventId))) return { error: 'Etkinlik bulunamadı.' };
      return { task: t };
    };
    if (m === 'GET' && !parts[1]) return json({ tasks: (await all('tasks/')).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')) });
    if (m === 'POST' && !parts[1]) {
      const r = await input({ status: 'todo', eventId: '', assignee: '', due: '' }); if (r.error) return fail(400, r.error);
      const t = { ...r.task, id: id(), createdAt: now() }; await s.set('tasks/' + t.id, t);
      return json({ task: t }, 201);
    }
    const t = await s.get('tasks/' + str(parts[1], 40));
    if (!t) return fail(404, 'Görev bulunamadı.');
    if (m === 'PUT') { const r = await input(t); if (r.error) return fail(400, r.error); await s.set('tasks/' + t.id, r.task); return json({ task: r.task }); }
    if (m === 'DELETE') { await s.del('tasks/' + t.id); return json({ ok: true }); }
  }

  return fail(404, 'Bulunamadı.');
}

export default async function handler(req, ctx) {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  setDeployContext((ctx && ctx.deploy && ctx.deploy.context) || process.env.CONTEXT);
  try {
    if ((parts[0] === 'hq' || parts[1] === 'hq') && !missingConfig().length) await initSecret(await store());
    if (parts[0] === 'hq') {
      const miss = missingConfig();
      if (miss.length) return html('<!doctype html><meta charset="utf-8"><title>More Life HQ</title><body style="font-family:system-ui;background:#0E0B0A;color:#F3EEE6;padding:40px"><h1>HQ henüz yapılandırılmadı</h1><p>Netlify’da şu ortam değişkenlerini tanımlayın: ' + miss.join(', ') + '</p></body>', 503);
      return html(session(req) ? APP_HTML : LOGIN_HTML, 200);
    }
    if (parts[0] === 'api' && parts[1] === 'public') return await publicApi(req, ctx, parts.slice(2), url);
    if (parts[0] === 'api' && parts[1] === 'hq') {
      const miss = missingConfig();
      if (miss.length) return fail(503, 'HQ yapılandırılmadı: ' + miss.join(', '));
      return await adminApi(req, ctx, parts.slice(2), url);
    }
    return fail(404, 'Not found');
  } catch (err) {
    console.error(err);
    return fail(500, 'Beklenmeyen bir hata oluştu.');
  }
}
