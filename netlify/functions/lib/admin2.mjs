// Admin API, part 2: CRM, tasks, website content, SEO, campaign links, marketing reports, settings.
// Reached only from adminApi() in api.mjs, i.e. after the session and same-origin checks.
import crypto from 'node:crypto';
import { all, pool, allContacts } from './store.mjs';
import { id, hash } from './auth.mjs';
import { json, fail, now, str, int, emailOk, normEmail, normPhone, tagList, body, istToday, csv, slugify } from './util.mjs';
import { seoInput, eventSeo, homeSeo, eventJsonLd, orgJsonLd, isListed, live, isDirty, DEFAULT_SEO_SETTINGS, SITE_URL } from './model.mjs';
import { HOME_FIELDS, homeDefaults } from './render.mjs';
import { SCHEMA_VERSION } from './migrations.mjs';
import { SITE_HTML } from './site-html.mjs';
import { emailStatus } from './email.mjs';
import { waStatus, waSettings, waChannels, waSend } from './whatsapp.mjs';
import { eventSales } from './tickets.mjs';

/* ---------- CRM ---------- */
const C_TEXT = { name: 120, email: 200, phone: 40, instagram: 80, company: 120, source: 80, notes: 4000 };
function contactInput(b, prev = {}) {
  const c = { ...prev };
  for (const f of Object.keys(C_TEXT)) if (f in b) c[f] = f === 'email' ? normEmail(b[f]) : str(b[f], C_TEXT[f]);
  if ('tags' in b) c.tags = tagList(b.tags);
  if (!c.name && !c.email) return { error: 'İsim veya e-posta gerekli.' };
  if (c.email && !emailOk(c.email)) return { error: 'E-posta geçersiz.' };
  if (!c.name) c.name = c.email;
  return { contact: c };
}
const emailKey = (e) => 'contactEmail/' + hash(e), phoneKey = (p) => 'contactPhone/' + hash(normPhone(p));
async function owners(s, c) { // who already owns this e-mail / phone
  const byE = c.email ? await s.get(emailKey(c.email)) : null, byP = c.phone && normPhone(c.phone).length >= 7 ? await s.get(phoneKey(c.phone)) : null;
  return { byE: byE && byE.id, byP: byP && byP.id };
}
async function saveContact(s, c, prev) {
  if (prev && prev.email && prev.email !== c.email) await s.del(emailKey(prev.email));
  if (prev && prev.phone && normPhone(prev.phone) !== normPhone(c.phone || '')) await s.del(phoneKey(prev.phone));
  await s.set('contacts/' + c.id, c);
  if (c.email) await s.set(emailKey(c.email), { id: c.id });
  if (c.phone && normPhone(c.phone).length >= 7) await s.set(phoneKey(c.phone), { id: c.id });
}
const matchC = (c, q, tag) => (!q || [c.name, c.email, c.phone, c.instagram, c.company, c.source, (c.tags || []).join(' '), c.notes].join(' ').toLocaleLowerCase('tr').includes(q)) && (!tag || (c.tags || []).includes(tag));

async function contacts(req, parts, url, s) {
  const m = req.method;
  if (parts[0] === 'contacts.csv') {
    const q = (url.searchParams.get('q') || '').toLocaleLowerCase('tr'), tag = url.searchParams.get('tag') || '';
    const rows = (await allContacts()).filter((c) => matchC(c, q, tag)).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return csv('kisiler.csv', [['Ad Soyad', 'E-posta', 'Telefon', 'Instagram', 'Şirket', 'Etiketler', 'Kaynak', 'Not', 'Eklendi']].concat(rows.map((c) => [c.name, c.email, c.phone, c.instagram, c.company, (c.tags || []).join(', '), c.source, c.notes, c.createdAt])));
  }
  if (!parts[1] && m === 'GET') {
    const list = (await allContacts()).slice().sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    if (!url.searchParams.has('limit')) return json({ contacts: list });
    // One page at a time for the CRM screen: search and tag filter run here, the browser only ever holds what it shows.
    const q = (url.searchParams.get('q') || '').trim().toLocaleLowerCase('tr'), tag = url.searchParams.get('tag') || '', limit = int(url.searchParams.get('limit'), 1, 200, 100), offset = int(url.searchParams.get('offset'), 0, 1e6), tags = {};
    for (const c of list) for (const x of c.tags || []) tags[x] = (tags[x] || 0) + 1;
    const hit = list.filter((c) => matchC(c, q, tag));
    return json({ contacts: hit.slice(offset, offset + limit), matched: hit.length, total: list.length, next: offset + limit < hit.length ? offset + limit : null, tags: Object.keys(tags).sort((a, b) => a.localeCompare(b, 'tr')).map((name) => ({ name, count: tags[name] })) });
  }
  if (!parts[1] && m === 'POST') {
    const r = contactInput(await body(req)); if (r.error) return fail(400, r.error);
    const o = await owners(s, r.contact); if (o.byE || o.byP) return fail(409, 'Bu e-posta veya telefonla bir kişi zaten var.', { existingId: o.byE || o.byP });
    const c = { tags: [], notes: '', source: 'Elle eklendi', ...r.contact, id: id(), createdAt: now(), updatedAt: now() };
    await saveContact(s, c, null); return json({ contact: c }, 201);
  }
  if (parts[1] === 'import' && m === 'POST') {
    // A big file is handled in windows: the client sends every row each time (so duplicates inside the file are judged
    // against the whole file) plus `from`/`size`, and only that window touches storage. Storage calls run in parallel;
    // one call per row in sequence made a 2,000-row file outlast the function's time limit.
    const b = await body(req), rows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [], seen = new Set();
    const from = int(b.from, 0, rows.length), to = b.size ? Math.min(rows.length, from + int(b.size, 1, 500, 250)) : rows.length, out = [];
    for (const [n, raw] of rows.slice(0, to).entries()) {
      const r = contactInput(raw && typeof raw === 'object' ? raw : {}), line = n + 2, keep = n >= from; // line in the file, header is line 1
      if (r.error) { if (keep) out.push({ line, status: 'invalid', reason: r.error, row: raw }); continue; }
      const c = r.contact, ek = c.email, pk = c.phone ? normPhone(c.phone) : '';
      if ((ek && seen.has('e' + ek)) || (pk && seen.has('p' + pk))) { if (keep) out.push({ line, status: 'duplicate-in-file', row: c }); continue; }
      if (ek) seen.add('e' + ek); if (pk) seen.add('p' + pk);
      if (keep) out.push({ line, status: 'new', row: c });
    }
    await pool(out.filter((o) => o.status === 'new'), 24, async (o) => {
      const h = await owners(s, o.row);
      if (h.byE && h.byP && h.byE !== h.byP) { o.status = 'conflict'; o.reason = 'E-posta bir kişiyle, telefon başka bir kişiyle eşleşiyor.'; return; }
      const hitId = h.byE || h.byP; if (!hitId) return;
      const ex = await s.get('contacts/' + hitId);
      if (ex) { o.status = 'match'; o.match = { id: ex.id, name: ex.name }; o.ex = ex; }
      else o.reuseId = hitId; // an earlier import stopped between the index and the record: finish that person instead of losing them
    });
    const totals = { new: 0, match: 0, conflict: 0, duplicateInFile: 0, invalid: 0 };
    for (const o of out) totals[o.status === 'duplicate-in-file' ? 'duplicateInFile' : o.status] += 1;
    const page = { total: rows.length, next: to < rows.length ? to : null };
    const view = (o) => ({ line: o.line, status: o.status, reason: o.reason, row: o.row, match: o.match });
    if (!b.commit) return json({ totals, rows: out.slice(0, 500).map(view), ...page });
    let created = 0, updated = 0;
    await pool(out, 16, async (o) => {
      if (o.status === 'new') {
        const c = { tags: [], notes: '', ...o.row, source: o.row.source || 'CSV içe aktarma', id: o.reuseId || id(), createdAt: now(), updatedAt: now() };
        // index first: if the request dies here, the next run finds the index and completes the record, so no one is created twice
        if (c.email) await s.set(emailKey(c.email), { id: c.id });
        if (c.phone && normPhone(c.phone).length >= 7) await s.set(phoneKey(c.phone), { id: c.id });
        await s.set('contacts/' + c.id, c); created += 1;
      } else if (o.status === 'match') { // never overwrite: only add tags the person does not have yet
        const ex = o.ex, add = (o.row.tags || []).filter((t) => !(ex.tags || []).includes(t));
        if (add.length) { ex.tags = (ex.tags || []).concat(add); ex.updatedAt = now(); await s.set('contacts/' + ex.id, ex); updated += 1; }
      }
    });
    return json({ ok: true, created, updated, totals, ...page });
  }
  const c = await s.get('contacts/' + parts[1]); if (!c) return fail(404, 'Kişi bulunamadı.');
  if (m === 'GET') {
    const evs = await all('events/'), history = [];
    for (const e of evs) for (const r of await all('rsvps/' + e.id + '/')) if (r.contactId === c.id || (c.email && r.email === c.email)) history.push({ eventId: e.id, event: e.title, date: e.date, status: r.status, guests: r.guests, createdAt: r.createdAt, decidedAt: r.decidedAt, checkedInAt: r.checkedInAt, past: !!e.date && e.date < new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10), campaign: (r.utm && r.utm.campaign) || '' });
    return json({ contact: c, history: history.sort((a, b) => (b.date || '').localeCompare(a.date || '')) });
  }
  if (m === 'PUT') {
    const r = contactInput(await body(req), c); if (r.error) return fail(400, r.error);
    const o = await owners(s, r.contact);
    if ((o.byE && o.byE !== c.id) || (o.byP && o.byP !== c.id)) return fail(409, 'Bu e-posta veya telefon başka bir kişide kayıtlı. Otomatik birleştirme yapılmaz.');
    const next = { ...r.contact, updatedAt: now() }; await saveContact(s, next, c); return json({ contact: next });
  }
  return fail(405, 'Desteklenmiyor.');
}

/* ---------- audiences: saved CRM segments ---------- */
// An audience stores rules, not a list of people: it is worked out from the CRM each time, so new contacts that fit join by themselves.
const A_REACH = ['any', 'phone', 'email', 'both'], A_STATE = ['applied', 'approved', 'attended', 'noshow', 'none'];
const hasPhone = (c) => !!c.phone && normPhone(c.phone).length >= 7;
function audienceRules(b) {
  const r = b && typeof b === 'object' ? b : {};
  return { tags: tagList(r.tags), tagMode: r.tagMode === 'all' ? 'all' : 'any', exclude: tagList(r.exclude), source: str(r.source, 80), reach: A_REACH.includes(r.reach) ? r.reach : 'any', eventId: str(r.eventId, 40), eventState: A_STATE.includes(r.eventState) ? r.eventState : 'applied' };
}
async function audienceEvents(list) { // the RSVPs of every event a rule points at, read once
  const ev = {};
  await pool([...new Set(list.map((r) => r.eventId).filter(Boolean))], 4, async (eid) => {
    const byId = new Map(), byEmail = new Map();
    for (const r of await all('rsvps/' + eid + '/')) { if (r.contactId) byId.set(r.contactId, r); if (r.email) byEmail.set(r.email, r); }
    ev[eid] = { byId, byEmail };
  });
  return ev;
}
function inAudience(c, r, ev) {
  const t = c.tags || [];
  if (r.tags.length && !(r.tagMode === 'all' ? r.tags.every((x) => t.includes(x)) : r.tags.some((x) => t.includes(x)))) return false;
  if (r.exclude.some((x) => t.includes(x))) return false;
  if (r.source && (c.source || '') !== r.source) return false;
  if ((r.reach === 'phone' || r.reach === 'both') && !hasPhone(c)) return false;
  if ((r.reach === 'email' || r.reach === 'both') && !c.email) return false;
  if (r.eventId) {
    const e = ev[r.eventId], v = e && (e.byId.get(c.id) || (c.email && e.byEmail.get(c.email)));
    if (r.eventState === 'none') return !v;
    if (!v) return false;
    if (r.eventState === 'approved') return v.status === 'approved';
    if (r.eventState === 'attended') return !!v.checkedInAt;
    if (r.eventState === 'noshow') return v.status === 'approved' && !v.checkedInAt;
  }
  return true;
}
export async function audienceMembers(a) { const ev = await audienceEvents([a.rules]); return (await allContacts()).filter((c) => inAudience(c, a.rules, ev)); }
const audienceSize = (m) => ({ count: m.length, phone: m.filter(hasPhone).length, email: m.filter((c) => c.email).length });
async function audiences(req, parts, s) {
  const m = req.method, people = async () => (await allContacts()).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const shape = async (b, prev = {}) => {
    const a = { ...prev, name: 'name' in b ? str(b.name, 80) : prev.name, note: 'note' in b ? str(b.note, 300) : prev.note || '', rules: audienceRules(b.rules || prev.rules) };
    if (!a.name) return { error: 'Kitleye bir ad verin.' };
    if (a.rules.eventId && !(await s.get('events/' + a.rules.eventId))) return { error: 'Seçilen etkinlik bulunamadı.' };
    return { audience: a };
  };
  if (!parts[1] && m === 'GET') {
    const [cs, list, evs] = await Promise.all([people(), all('audiences/'), all('events/')]), ev = await audienceEvents(list.map((a) => a.rules));
    const tags = {}, sources = {};
    for (const c of cs) { for (const t of c.tags || []) tags[t] = (tags[t] || 0) + 1; if (c.source) sources[c.source] = (sources[c.source] || 0) + 1; }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr')).map(([name, count]) => ({ name, count }));
    return json({ audiences: list.sort((a, b) => a.name.localeCompare(b.name, 'tr')).map((a) => ({ ...a, ...audienceSize(cs.filter((c) => inAudience(c, a.rules, ev))) })), total: cs.length,
      options: { tags: top(tags), sources: top(sources), events: evs.filter((e) => e.status !== 'archived' || list.some((a) => a.rules.eventId === e.id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e) => ({ id: e.id, title: e.title, date: e.date })) } });
  }
  if (parts[1] === 'preview' && m === 'POST') { // live count while the rules are being edited; saves nothing
    const rules = audienceRules((await body(req)).rules), mem = (await people()).filter(((ev) => (c) => inAudience(c, rules, ev))(await audienceEvents([rules])));
    return json({ ...audienceSize(mem), sample: mem.slice(0, 6).map((c) => c.name) });
  }
  if (!parts[1] && m === 'POST') {
    const r = await shape(await body(req)); if (r.error) return fail(400, r.error);
    const a = { ...r.audience, id: id(), createdAt: now(), updatedAt: now() }; await s.set('audiences/' + a.id, a); return json({ audience: a }, 201);
  }
  const isCsv = /\.csv$/.test(parts[1] || ''), a = await s.get('audiences/' + (parts[1] || '').replace(/\.csv$/, '')); if (!a) return fail(404, 'Kitle bulunamadı.');
  if (m === 'GET') {
    const ev = await audienceEvents([a.rules]), mem = (await people()).filter((c) => inAudience(c, a.rules, ev));
    if (isCsv) return csv('kitle-' + (slugify(a.name) || a.id) + '.csv', [['Ad Soyad', 'E-posta', 'Telefon', 'Instagram', 'Şirket', 'Etiketler', 'Kaynak']].concat(mem.map((c) => [c.name, c.email, c.phone, c.instagram, c.company, (c.tags || []).join(', '), c.source])));
    return json({ audience: { ...a, ...audienceSize(mem) }, members: mem.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, tags: c.tags || [] })) });
  }
  if (m === 'PUT') { const r = await shape(await body(req), a); if (r.error) return fail(400, r.error); const n = { ...r.audience, updatedAt: now() }; await s.set('audiences/' + n.id, n); return json({ audience: n }); }
  if (m === 'DELETE') { await s.del('audiences/' + a.id); return json({ ok: true }); } // removes the saved rules only, never a contact
  return fail(405, 'Desteklenmiyor.');
}

/* ---------- site enquiries ---------- */
async function enquiries(req, parts, url, s) {
  const m = req.method, list = async () => (await all('enquiries/')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (parts[0] === 'enquiries.csv') { const st = url.searchParams.get('status') || ''; return csv('talepler.csv', [['Tarih', 'Tür', 'Durum', 'Ad', 'E-posta', 'Şirket', 'Konu', 'Şehir', 'Tarihler', 'Mekân', 'Kapasite', 'Bütçe', 'Sanatçı', 'Mesaj', 'İzin', 'Not', 'Telefon', 'Etkinlik', 'Kişi', 'Alan']].concat((await list()).filter((q) => !st || q.status === st).map((q) => [q.createdAt, q.kindLabel, q.status, q.name, q.email, q.company, q.topic || q.service, q.city, q.preferredDates, q.venue, q.capacity, q.budget, q.artist, q.message, q.consent ? 'evet' : '', q.note, q.phone || '', q.eventTitle || '', q.party || '', q.area || '']))); }
  if (!parts[1] && m === 'GET') return json({ enquiries: await list(), email: emailStatus() });
  const q = await s.get('enquiries/' + parts[1]); if (!q) return fail(404, 'Talep bulunamadı.');
  if (m === 'PUT') { const b = await body(req); if ('status' in b) q.status = ['open', 'done'].includes(b.status) ? b.status : 'new'; if ('note' in b) q.note = str(b.note, 2000); q.updatedAt = now(); await s.set('enquiries/' + q.id, q); return json({ enquiry: q }); }
  return fail(405, 'Desteklenmiyor.');
}

/* ---------- tasks ---------- */
async function tasks(req, parts, s) {
  const m = req.method;
  const shape = (b, prev = {}) => {
    const t = { ...prev };
    for (const f of ['title', 'assignee', 'eventId', 'notes']) if (f in b) t[f] = str(b[f], f === 'notes' ? 2000 : 200);
    if ('due' in b) t.due = /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : '';
    if ('status' in b) t.status = ['todo', 'doing', 'done'].includes(b.status) ? b.status : 'todo';
    if ('priority' in b) t.priority = ['low', 'high'].includes(b.priority) ? b.priority : 'normal';
    return t;
  };
  if (!parts[1] && m === 'GET') { const P = { high: 0, normal: 1, low: 2 }; return json({ tasks: (await all('tasks/')).sort((a, b) => (P[a.priority] ?? 1) - (P[b.priority] ?? 1) || (a.due || '9999').localeCompare(b.due || '9999')) }); }
  if (!parts[1] && m === 'POST') {
    const t = shape(await body(req), { status: 'todo', priority: 'normal', assignee: '', eventId: '', due: '', notes: '' }); if (!t.title) return fail(400, 'Görev başlığı gerekli.');
    if (t.eventId && !(await s.get('events/' + t.eventId))) return fail(400, 'Etkinlik bulunamadı.');
    Object.assign(t, { id: id(), createdAt: now(), updatedAt: now() }); await s.set('tasks/' + t.id, t); return json({ task: t }, 201);
  }
  const t = await s.get('tasks/' + parts[1]); if (!t) return fail(404, 'Görev bulunamadı.');
  if (m === 'PUT') { const n = shape(await body(req), t); if (!n.title) return fail(400, 'Görev başlığı gerekli.'); n.updatedAt = now(); await s.set('tasks/' + t.id, n); return json({ task: n }); }
  if (m === 'DELETE') { await s.del('tasks/' + t.id); return json({ ok: true }); }
  return fail(405, 'Desteklenmiyor.');
}

/* ---------- website content ---------- */
const SECTIONS = () => [...SITE_HTML.matchAll(/<section class="view[^"]*" id="v-([a-z]+)"/g)].map((m) => m[1]).filter((k) => !['home', 'event', 'service'].includes(k));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function homeView(rec) {
  const draft = { ...homeDefaults(), seo: {}, ...((rec && rec.draft) || {}) }, liveC = rec && rec.live ? { ...homeDefaults(), seo: {}, ...rec.live } : null;
  return { key: 'home', url: '/', name: 'Ana sayfa', fields: HOME_FIELDS.map((f) => ({ key: f[0], label: f[1], def: f[2], max: f[3] })), draft, live: liveC,
    dirty: liveC ? !sameJson(draft, liveC) : !sameJson(draft, { ...homeDefaults(), seo: {} }), publishedAt: (rec && rec.publishedAt) || '', updatedAt: (rec && rec.updatedAt) || '',
    versions: ((rec && rec.versions) || []).map((v) => ({ at: v.at, tagline: v.data.tagline, title: (v.data.seo && v.data.seo.title) || '' })) };
}
async function site(req, parts, s) {
  const m = req.method, rec = (await s.get('pages/home')) || { draft: null, live: null, versions: [] };
  if (!parts[1] && m === 'GET') {
    const evs = (await all('events/')).filter((e) => e.status !== 'archived').map((e) => ({ id: e.id, title: e.title, date: e.date, status: e.status, visibility: e.visibility, listed: isListed(e), dirty: isDirty(e), url: '/events/' + (e.live ? e.live.slug : e.slug) }));
    return json({ home: homeView(rec), sections: SECTIONS().map((k) => ({ key: k, url: '/#' + k })), events: evs, delivery: 'dynamic' });
  }
  if (parts[1] !== 'home') return fail(404, 'Sayfa bulunamadı.');
  if (!parts[2] && m === 'PUT') {
    const b = await body(req), c = b.content || {}, d = { ...homeDefaults(), seo: {}, ...(rec.draft || {}) };
    for (const f of HOME_FIELDS) if (f[0] in c) d[f[0]] = str(c[f[0]], f[3]);
    if ('featuredEventId' in c) d.featuredEventId = str(c.featuredEventId, 40);
    if (!d.tagline) return fail(400, 'Hero alt başlığı boş olamaz.');
    if (!emailOk(d.contactEmail)) return fail(400, 'İletişim e-postası geçersiz.');
    if (!/^https:\/\//.test(d.instagramUrl)) return fail(400, 'Instagram bağlantısı https:// ile başlamalı.');
    if (!/^(#[a-z-]+|\/[^\s]*|https:\/\/[^\s]+)$/.test(d.ctaHref)) return fail(400, 'CTA bağlantısı #bölüm, /sayfa veya https:// adresi olmalı.');
    if (b.seo) { const r = seoInput(b.seo, d.seo); if (r.error) return fail(400, r.error); d.seo = r.seo; }
    rec.draft = d; rec.updatedAt = now(); await s.set('pages/home', rec); return json({ home: homeView(rec) });
  }
  if (parts[2] === 'publish' && m === 'POST') {
    const d = { ...homeDefaults(), seo: {}, ...(rec.draft || {}) };
    if (rec.live) rec.versions = [{ at: rec.publishedAt || now(), data: rec.live }].concat(rec.versions || []).slice(0, 10);
    rec.live = JSON.parse(JSON.stringify(d)); rec.draft = d; rec.publishedAt = now(); await s.set('pages/home', rec);
    return json({ home: homeView(rec), changed: ['/'] });
  }
  if (parts[2] === 'rollback' && m === 'POST') {
    const at = (await body(req)).at, v = (rec.versions || []).find((x) => x.at === at); if (!v) return fail(404, 'Sürüm bulunamadı.');
    rec.versions = [{ at: rec.publishedAt || now(), data: rec.live }].concat((rec.versions || []).filter((x) => x.at !== at)).slice(0, 10);
    rec.live = v.data; rec.draft = JSON.parse(JSON.stringify(v.data)); rec.publishedAt = now(); await s.set('pages/home', rec);
    return json({ home: homeView(rec), changed: ['/'] });
  }
  return fail(404, 'Bulunamadı.');
}

/* ---------- SEO ---------- */
function lengthIssues(seo, out) {
  if (seo.title.length > 60) out.push({ code: 'title-long', level: 'warn', text: 'SEO başlığı 60 karakterden uzun (' + seo.title.length + '); arama sonucunda kesilebilir.' });
  if (seo.title.length < 15) out.push({ code: 'title-short', level: 'warn', text: 'SEO başlığı çok kısa.' });
  if (seo.description.length > 160) out.push({ code: 'desc-long', level: 'warn', text: 'Meta açıklaması 160 karakterden uzun (' + seo.description.length + ').' });
  if (seo.description.length < 50) out.push({ code: 'desc-short', level: 'warn', text: 'Meta açıklaması çok kısa (' + seo.description.length + ').' });
  if (!seo.ogImage) out.push({ code: 'og-image', level: 'warn', text: 'Paylaşım görseli yok.' });
  try { const c = new URL(seo.canonical), u = new URL(seo.url); if (c.host !== u.host) out.push({ code: 'canonical-host', level: 'error', text: 'Canonical başka bir alan adına işaret ediyor: ' + c.host }); else if (c.pathname !== u.pathname) out.push({ code: 'canonical-other', level: 'warn', text: 'Canonical başka bir sayfaya işaret ediyor; bu sayfa sitemap’e girmez.' }); } catch { out.push({ code: 'canonical-bad', level: 'error', text: 'Canonical adres geçersiz.' }); }
}
async function seo(req, parts, s, h) {
  const m = req.method;
  if (parts[1] === 'settings') {
    const cur = await h.seoSettings(s);
    if (m === 'GET') return json({ settings: cur });
    if (m === 'PUT') {
      const b = await body(req), n = { ...cur };
      for (const k of ['orgName', 'siteName', 'homeTitle', 'homeDescription', 'eventTitle', 'eventDescription', 'defaultOgImageId']) if (k in b) n[k] = str(b[k], 320);
      if ('sameAs' in b) n.sameAs = (Array.isArray(b.sameAs) ? b.sameAs : String(b.sameAs).split(/\s+/)).map((x) => str(x, 300)).filter((x) => /^https:\/\//.test(x)).slice(0, 10);
      if (!n.orgName || !n.homeTitle || !n.eventTitle) return fail(400, 'Organizatör adı ve başlık şablonları boş olamaz.');
      await s.set('settings/seo', n); return json({ settings: n });
    }
  }
  if (m !== 'GET') return fail(405, 'Desteklenmiyor.');
  const set = await h.seoSettings(s), rec = await s.get('pages/home'), rows = [], sections = SECTIONS();
  const hv = homeView(rec), liveHome = hv.live || { ...homeDefaults(), seo: {} };
  const mk = (key, type, name, status, eff, draftEff, extra) => {
    const issues = []; lengthIssues(eff, issues);
    return { key, type, name, defaults: extra.defaultsEff, url: eff.url, status, title: eff.title, description: eff.description, canonical: eff.canonical, noindex: eff.noindex, indexSetting: eff.indexSetting, ogTitle: eff.ogTitle, ogDescription: eff.ogDescription, ogImage: eff.ogImage, from: eff.from, draft: draftEff, issues, ...extra, defaultsEff: undefined };
  };
  const homeRow = mk('home', 'Ana sayfa', 'Ana sayfa', 'Yayında', homeSeo(liveHome, set), homeSeo(hv.draft, set), { defaultsEff: homeSeo({ seo: {} }, set), dirty: hv.dirty, updatedAt: hv.publishedAt, h1: 'more life', jsonld: orgJsonLd(set), seoInput: hv.draft.seo, editor: { view: 'website' } });
  if (homeRow.noindex) homeRow.issues.push({ code: 'noindex-live', level: 'error', text: 'Yayındaki ana sayfa noindex olarak ayarlı.' });
  const cta = liveHome.ctaHref || '';
  if (cta.startsWith('#') && !sections.includes(cta.slice(1)) && cta !== '#home') homeRow.issues.push({ code: 'broken-link', level: 'error', text: 'Hero CTA bağlantısı var olmayan bir bölüme gidiyor: ' + cta });
  const evs = (await all('events/')).filter((e) => e.status !== 'archived'), slugs = new Set(evs.filter(isListed).map((e) => e.live.slug));
  if (cta.startsWith('/events/') && !slugs.has(cta.slice(8).replace(/\/$/, ''))) homeRow.issues.push({ code: 'broken-link', level: 'error', text: 'Hero CTA bağlantısı yayında olmayan bir etkinliğe gidiyor: ' + cta });
  rows.push(homeRow);
  for (const e of evs) {
    const pub = live(e), shown = pub || e, eff = eventSeo(shown, set);
    const row = mk('event:' + e.id, 'Etkinlik', e.title, e.status === 'published' ? (e.visibility === 'private' ? 'Yayında · özel davet' : 'Yayında') : 'Taslak', eff, eventSeo(e, set),
      { defaultsEff: eventSeo({ ...e, seo: {} }, set), dirty: isDirty(e), updatedAt: e.publishedAt || e.updatedAt, h1: shown.title, jsonld: isListed(e) ? eventJsonLd(pub, set) : null, seoInput: e.seo || {}, eventId: e.id, listed: isListed(e), editor: { view: 'etkinlik', id: e.id, tab: 'seo' } });
    if (!isListed(e)) row.issues = row.issues.filter((i) => i.code !== 'og-image'); // not a public page: nothing to share
    if (isListed(e) && eff.indexSetting === 'noindex') row.issues.push({ code: 'noindex-live', level: 'error', text: 'Yayındaki herkese açık sayfa noindex olarak ayarlı; sitemap’e girmez.' });
    rows.push(row);
  }
  const indexable = rows.filter((r) => !r.noindex && (r.key === 'home' || r.listed));
  for (const f of ['title', 'description']) {
    const seen = {}; for (const r of indexable) (seen[r[f]] = seen[r[f]] || []).push(r);
    for (const g of Object.values(seen)) if (g.length > 1) for (const r of g) r.issues.push({ code: 'dup-' + f, level: 'warn', text: (f === 'title' ? 'SEO başlığı' : 'Meta açıklaması') + ' başka bir sayfayla aynı: ' + g.filter((x) => x !== r).map((x) => x.url).join(', ') });
  }
  return json({ rows, settings: set, defaults: DEFAULT_SEO_SETTINGS, sitemap: SITE_URL() + '/sitemap.xml', sitemapUrls: indexable.filter((r) => r.canonical === r.url).map((r) => r.url), note: 'Bu kontroller sitenin kendi çıktısına bakar. Google’ın bir sayfayı indeksleyip indekslemediğini göstermez.' });
}

/* ---------- campaign links + marketing ---------- */
const PRESETS = [['Instagram bio', 'instagram', 'social', 'bio'], ['Instagram Story', 'instagram', 'social', 'story'], ['Instagram reklam', 'instagram', 'paid_social', 'ad'], ['E-posta', 'newsletter', 'email', ''], ['WhatsApp', 'whatsapp', 'messaging', ''], ['Partner paylaşımı', 'partner', 'referral', '']];
const utmKey = (u) => [u.source || '', u.medium || '', u.campaign || ''].join('|');
async function utm(req, parts, s) {
  const m = req.method;
  if (!parts[1] && m === 'GET') return json({ links: (await all('utm/')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), presets: PRESETS.map((p) => ({ label: p[0], source: p[1], medium: p[2], content: p[3] })) });
  if (!parts[1] && m === 'POST') {
    const b = await body(req), clean = (v) => str(v, 80).toLowerCase().replace(/\s+/g, '-');
    const l = { name: str(b.name, 120), eventId: str(b.eventId, 40), target: str(b.target, 500), source: clean(b.source), medium: clean(b.medium), campaign: clean(b.campaign), content: clean(b.content) };
    if (!l.source || !l.medium || !l.campaign) return fail(400, 'Source, medium ve campaign gerekli.');
    let u; try { u = new URL(l.target, SITE_URL()); } catch { return fail(400, 'Hedef adres geçersiz.'); }
    if (u.protocol !== 'https:') return fail(400, 'Hedef adres https:// olmalı.');
    for (const k of ['source', 'medium', 'campaign', 'content']) if (l[k]) u.searchParams.set('utm_' + k, l[k]); else u.searchParams.delete('utm_' + k); // other query parameters are kept
    Object.assign(l, { id: id(), url: u.toString(), name: l.name || l.campaign, createdAt: now() });
    await s.set('utm/' + l.id, l); return json({ link: l }, 201);
  }
  if (parts[1] && m === 'DELETE') { await s.del('utm/' + parts[1]); return json({ ok: true }); }
  return fail(405, 'Desteklenmiyor.');
}
const istDay = (iso) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10) : '');
async function marketing(req, parts, url, s) {
  if (parts[1] === 'google') return google(url);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : istToday();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10);
  const only = url.searchParams.get('event') || '', links = await all('utm/'), camp = {}, events = [];
  const named = (k) => { const l = links.find((x) => utmKey(x) === k); return l ? l.name : ''; };
  const bucket = (k) => (camp[k] = camp[k] || { key: k, source: k.split('|')[0], medium: k.split('|')[1], campaign: k.split('|')[2], name: k === '||' ? 'Bilinmiyor' : named(k), views: 0, ticketClicks: 0, rsvps: 0, approved: 0, checkedIn: 0 });
  let truncated = false;
  for (const e of (await all('events/')).filter((x) => x.status !== 'draft' && (!only || x.id === only))) {
    const row = { id: e.id, title: e.title, date: e.date, views: 0, ticketClicks: 0, rsvps: 0, approved: 0, checkedIn: 0 };
    const keys = (await s.list('hits/' + e.id + '/')).filter((k) => { const d = k.split('/')[2]; return d >= from && d <= to; });
    if (keys.length > 4000) truncated = true;
    for (const k of keys.slice(0, 4000)) { const kind = k.split('/')[3] === 'ticket' ? 'ticketClicks' : 'views', v = (await s.get(k)) || {}; row[kind] += 1; bucket([v.s || '', v.m || '', v.c || ''].join('|'))[kind] += 1; }
    for (const r of await all('rsvps/' + e.id + '/')) {
      const d = istDay(r.createdAt); if (d < from || d > to) continue;
      const b = bucket(utmKey(r.utm || {})); row.rsvps += 1; b.rsvps += 1;
      if (r.status === 'approved') { row.approved += 1; b.approved += 1; }
      if (r.checkedInAt) { row.checkedIn += 1; b.checkedIn += 1; }
    }
    const sold = await eventSales(s, e.id); if (sold) { row.tickets = sold.tickets; row.net = sold.net; row.currency = sold.currency; } // sold on More Life's own shop; null when the event sells elsewhere
    events.push(row);
  }
  // link-in-bio page (/links): views, presses per link, and sign-ups that came through its form
  const linkPage = { views: 0, signups: 0, clicks: {} };
  for (const k of (await s.list('linkhits/')).filter((x) => { const d = x.split('/')[1]; return d >= from && d <= to; })) { const l = k.split('/')[2]; if (l === 'view') linkPage.views += 1; else linkPage.clicks[l] = (linkPage.clicks[l] || 0) + 1; }
  for (const q of await all('enquiries/')) if (q.path === '/links' && istDay(q.createdAt) >= from && istDay(q.createdAt) <= to) linkPage.signups += 1;
  const links2 = { views: linkPage.views, signups: linkPage.signups, clicks: Object.entries(linkPage.clicks).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n) };
  return json({ from, to, links: links2, events: events.sort((a, b) => (b.date || '').localeCompare(a.date || '')), campaigns: Object.values(camp).sort((a, b) => b.rsvps - a.rsvps || b.views - a.views), truncated,
    notes: ['Ziyaret ve bilet linki tıklaması More Life’ın kendi sayacından gelir; etkinlik ve davet sayfalarını kapsar, botlar hariç tutulur.', 'Bilet linki tıklaması satış değildir. Satış sütunu yalnızca More Life’ın kendi sayfasında satılan biletleri sayar; harici bilet linki kullanan etkinliklerde boş kalır.'] });
}

/* ---------- Google (Search Console + GA4 Data API) ---------- */
const G_ENV = { sa: 'GOOGLE_SERVICE_ACCOUNT_JSON', gsc: 'GSC_SITE_URL', ga4: 'GA4_PROPERTY_ID', tag: 'GA4_MEASUREMENT_ID' };
export const googleStatus = () => ({
  gsc: { connected: !!(process.env[G_ENV.sa] && process.env[G_ENV.gsc]), missing: [G_ENV.sa, G_ENV.gsc].filter((k) => !process.env[k]),
    steps: ['Google Cloud’da bir servis hesabı oluşturup JSON anahtarını indirin.', 'Search Console’da morelife.events mülkünde bu servis hesabının e-postasını kullanıcı olarak ekleyin.', 'Netlify’da ' + G_ENV.sa + ' (JSON’un tamamı, gizli) ve ' + G_ENV.gsc + ' (ör. sc-domain:morelife.events) değişkenlerini tanımlayın.'] },
  ga4: { connected: !!(process.env[G_ENV.sa] && process.env[G_ENV.ga4]), tagInstalled: !!process.env[G_ENV.tag], missing: [G_ENV.sa, G_ENV.ga4, G_ENV.tag].filter((k) => !process.env[k]),
    steps: ['Sitede şu an herhangi bir GA4 veya başka ölçüm kodu yok; bir GA4 mülkü oluşturun ya da mevcut mülkü kullanın.', 'GA4 mülkünde servis hesabının e-postasına “Görüntüleyici” yetkisi verin.', 'Netlify’da ' + G_ENV.ga4 + ' (mülk numarası) ve ' + G_ENV.tag + ' (G-XXXX ölçüm kimliği) değişkenlerini tanımlayın.'] }
});
async function googleToken(scope) {
  const sa = JSON.parse(process.env[G_ENV.sa]), t = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3000 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.error || 'Google kimlik doğrulaması başarısız.');
  return j.access_token;
}
async function google(url) {
  const st = googleStatus(), to = url.searchParams.get('to') || istToday(), from = url.searchParams.get('from') || new Date(Date.parse(to) - 27 * 864e5).toISOString().slice(0, 10), out = { from, to, gsc: st.gsc, ga4: st.ga4 };
  if (st.gsc.connected) {
    try {
      const tok = await googleToken('https://www.googleapis.com/auth/webmasters.readonly'), site = encodeURIComponent(process.env[G_ENV.gsc]);
      const q = async (dim) => { const r = await fetch('https://www.googleapis.com/webmasters/v3/sites/' + site + '/searchAnalytics/query', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ startDate: from, endDate: to, dimensions: [dim], rowLimit: 50 }) }); const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'Search Console isteği başarısız.'); return (j.rows || []).map((x) => ({ key: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position })); };
      const days = await q('date'); out.gsc = { ...st.gsc, pages: await q('page'), queries: await q('query'), latest: days.length ? days[days.length - 1].key : '' };
    } catch (e) { out.gsc = { ...st.gsc, error: String(e.message || e) }; }
  }
  if (st.ga4.connected) {
    try {
      const tok = await googleToken('https://www.googleapis.com/auth/analytics.readonly');
      const run = async (dims, mets, filter) => { const r = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/' + encodeURIComponent(process.env[G_ENV.ga4]) + ':runReport', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: from, endDate: to }], dimensions: dims.map((name) => ({ name })), metrics: mets.map((name) => ({ name })), dimensionFilter: filter, limit: 50 }) }); const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'GA4 isteği başarısız.'); return (j.rows || []).map((x) => ({ dims: x.dimensionValues.map((d) => d.value), mets: x.metricValues.map((d) => Number(d.value)) })); };
      const ev = (name) => ({ filter: { fieldName: 'eventName', stringFilter: { value: name } } });
      out.ga4 = { ...st.ga4, sources: await run(['sessionSource', 'sessionMedium'], ['sessions']), campaigns: await run(['sessionCampaignName'], ['sessions']), landing: await run(['landingPage'], ['sessions']), rsvps: await run(['eventName'], ['eventCount'], ev('rsvp_submitted')), ticketClicks: await run(['eventName'], ['eventCount'], ev('ticket_click')) };
    } catch (e) { out.ga4 = { ...st.ga4, error: String(e.message || e) }; }
  }
  return json(out);
}

/* ---------- WhatsApp (Bird) ---------- */
async function whatsapp(req, parts, s) {
  const m = req.method, st = waStatus(), set = await waSettings(s);
  const tpl = (b, prev) => ({ projectId: str(b && b.projectId, 60).replace(/[^a-f0-9-]/gi, '') || '', version: str(b && b.version, 60).replace(/[^a-f0-9-]/gi, '') || '', locale: str(b && b.locale, 10) || prev.locale || 'en' });
  if (!parts[1] && m === 'GET') { let channels = [], error = ''; if (st.connected) { try { channels = await waChannels(); } catch (e) { error = String(e.message || e); } } return json({ status: st, settings: set, channels, error, envChannel: !!process.env.BIRD_CHANNEL_ID }); }
  if (parts[1] === 'settings' && m === 'PUT') { const b = await body(req); const n = { ...set, channelId: 'channelId' in b ? str(b.channelId, 60) : set.channelId, pass: b.pass ? { ...tpl(b.pass, set.pass), qr: 'qr' in b.pass ? b.pass.qr === true : !!set.pass.qr } : set.pass, invite: b.invite ? tpl(b.invite, set.invite) : set.invite, table: b.table ? tpl(b.table, set.table) : set.table }; await s.set('settings/whatsapp', n); return json({ settings: n }); }
  if (parts[1] === 'test' && m === 'POST') {
    if (!st.connected) return fail(409, 'WhatsApp bağlı değil.');
    const b = await body(req), params = {}; for (const [k, v] of Object.entries(b.parameters && typeof b.parameters === 'object' ? b.parameters : {})) params[str(k, 40)] = str(v, 300);
    const r = await waSend(s, b.to, tpl(b, {}), params);
    return r.status === 'sent' ? json({ result: r }) : fail(502, 'Gönderilemedi: ' + (r.error || ''), { result: r });
  }
  return fail(404, 'Bulunamadı.');
}

/* ---------- settings ---------- */
async function settings(s, storeNameNow) {
  const meta = (await s.get('meta/schema')) || { version: 0, applied: [] };
  return json({ store: storeNameNow, context: process.env.CONTEXT || 'local', siteUrl: SITE_URL(), schema: { version: meta.version, expected: SCHEMA_VERSION, applied: meta.applied },
    env: Object.fromEntries(['HQ_ADMIN_EMAIL', 'HQ_ADMIN_PASSWORD', 'HQ_SESSION_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'BIRD_ACCESS_KEY', 'BIRD_WORKSPACE_ID', 'BIRD_CHANNEL_ID', ...Object.values(G_ENV)].map((k) => [k, !!process.env[k]])),
    sessionKey: process.env.HQ_SESSION_SECRET && process.env.HQ_SESSION_SECRET.length >= 32 ? 'env' : 'store',
    legacy: { total: 12 },
    integrations: { whatsapp: { ...waStatus(), note: waStatus().connected ? 'Onaylanan misafire giriş kartı WhatsApp’tan gönderilir (telefon numarası ve onaylı şablon varsa).' : 'WhatsApp bağlı değil.' }, email: { ...emailStatus(), note: emailStatus().connected ? 'Onaylanan misafire giriş kartı e-postası gönderilir; yeni site talepleri yöneticiye bildirilir.' : 'E-posta servisi bağlı değil. Giriş kartı bağlantısı panelden kopyalanıp paylaşılır; hiçbir e-posta gönderildi olarak işaretlenmez.' }, tickets: { connected: false, note: 'Bilet platformu bağlı değil; satış rakamı gösterilmez.' }, google: googleStatus() } });
}

export async function admin2(req, ctx, parts, url, s, h) {
  const { storeName } = await import('./store.mjs');
  if (parts[0] === 'contacts' || parts[0] === 'contacts.csv') return contacts(req, parts, url, s);
  if (parts[0] === 'audiences') return audiences(req, parts, s);
  if (parts[0] === 'whatsapp') return whatsapp(req, parts, s);
  if (parts[0] === 'enquiries' || parts[0] === 'enquiries.csv') return enquiries(req, parts, url, s);
  if (parts[0] === 'tasks') return tasks(req, parts, s);
  if (parts[0] === 'site') return site(req, parts, s);
  if (parts[0] === 'seo') return seo(req, parts, s, h);
  if (parts[0] === 'utm') return utm(req, parts, s);
  if (parts[0] === 'marketing') return marketing(req, parts, url, s);
  if (parts[0] === 'settings' && req.method === 'GET') return settings(s, storeName());
  return fail(404, 'Bulunamadı.');
}
