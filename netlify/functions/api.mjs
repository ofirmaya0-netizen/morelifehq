// More Life HQ — one Netlify Function: public pages (home, event, invite, sitemap, robots), the guest API
// (/api/public/*), the gated HQ page (/hq) and the admin API (/api/hq/*). Every admin route passes the same session check.
import { store, all, setDeployContext, storeName } from './lib/store.mjs';
import { missingConfig, initSecret, checkLogin, sessionCookie, clearCookie, session, sameOrigin, token, id, hash } from './lib/auth.mjs';
import { json, fail, page, gated, now, str, int, emailOk, normEmail, normPhone, body, ipOf, istToday, csv, isBot, slugify } from './lib/util.mjs';
import { eventInput, snapshot, isDirty, live, isListed, formState, guestEvent, guestList, counts, guestsOf, DEFAULT_SEO_SETTINGS, eventSeo, RSVP_STATUS } from './lib/model.mjs';
import { renderHome, renderEvent, notFound, sitemap, robots } from './lib/render.mjs';
import { migrate } from './lib/migrations.mjs';
import { admin2 } from './lib/admin2.mjs';
import { emailStatus, sendPass, passMail, notifyEnquiry } from './lib/email.mjs';
import { waStatus, waSettings, sendPassWa, passParams, invitePreview } from './lib/whatsapp.mjs';
import { APP_HTML, LOGIN_HTML, DOOR_HTML } from './lib/hq-html.mjs';
import { LEGACY_EVENTS } from './lib/legacy-events.mjs';

export const config = { path: ['/', '/events/*', '/invite', '/sitemap.xml', '/robots.txt', '/door', '/hq', '/hq/*', '/api/hq/*', '/api/public/*', '/api/door/*'] };

export async function limited(key, max, windowSec) {
  const s = await store(), k = 'rate/' + key, t = Date.now();
  const r = (await s.get(k)) || { n: 0, t };
  if (t - r.t > windowSec * 1000) { r.n = 0; r.t = t; }
  r.n += 1; await s.set(k, r);
  return r.n > max;
}
export const seoSettings = async (s) => ({ ...DEFAULT_SEO_SETTINGS, ...((await s.get('settings/seo')) || {}) });
const rsvpsOf = (eventId) => all('rsvps/' + eventId + '/');
const inviteUrl = (e) => '/invite?t=' + e.inviteToken;

async function upsertContactFromRsvp(s, r) {
  const hit = (await s.get('contactEmail/' + hash(r.email))) || (r.phone && await s.get('contactPhone/' + hash(normPhone(r.phone))));
  if (hit) return hit.id;
  const c = { id: id(), name: r.name, email: r.email, phone: r.phone, instagram: '', company: '', tags: ['rsvp'], source: 'RSVP', notes: '', createdAt: now(), updatedAt: now() };
  await s.set('contacts/' + c.id, c); await s.set('contactEmail/' + hash(c.email), { id: c.id });
  if (c.phone) await s.set('contactPhone/' + hash(normPhone(c.phone)), { id: c.id });
  return c.id;
}

/* ---------- public pages ---------- */
async function publicPage(req, url, parts) {
  const s = await store(), set = await seoSettings(s), admin = !!session(req), preview = url.searchParams.get('preview') === '1' && admin;
  const cache = preview ? { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } : { 'cache-control': 'public, max-age=0, must-revalidate' };
  if (url.pathname === '/robots.txt') return new Response(robots(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (url.pathname === '/sitemap.xml') {
    const home = await s.get('pages/home'), evs = (await all('events/')).filter(isListed).map(live);
    return new Response(sitemap(!(home && home.live && home.live.seo && home.live.seo.index === 'noindex'), evs, set), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  }
  if (url.pathname === '/') {
    const rec = await s.get('pages/home'), c = (preview ? rec && rec.draft : rec && rec.live) || {};
    let featured = null;
    if (c.featuredEventId) { const fe = await s.get('events/' + c.featuredEventId); if (fe && isListed(fe)) featured = live(fe); }
    return page(renderHome(rec, set, featured, preview), 200, cache);
  }
  if (url.pathname === '/invite') {
    const ref = await s.get('invites/' + str(url.searchParams.get('t'), 60)), e0 = ref && await s.get('events/' + ref.eventId), e = e0 && live(e0);
    if (!e || e.inviteToken !== url.searchParams.get('t') || (e.invite && e.invite.enabled === false)) return page(notFound('Invitation unavailable.', 'This invitation link is not active.'), 404, { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' });
    return page(renderEvent(e, set, { mode: 'invite', token: e.inviteToken }), 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' });
  }
  if (parts[0] === 'events' && parts[1]) {
    const slug = slugify(parts[1]), ref = await s.get('slugs/' + slug), e0 = ref && await s.get('events/' + ref.id);
    if (e0 && preview) return page(renderEvent(e0, set, { mode: 'preview' }), 200, cache);
    const e = e0 && live(e0);
    if (e && e.slug === slug && e.visibility === 'public') return page(renderEvent(e, set, { mode: 'public', ga: process.env.GA4_MEASUREMENT_ID || '' }), 200, cache);
    const red = await s.get('redirects/' + slug);
    if (red) return new Response(null, { status: 301, headers: { location: '/events/' + red.to } });
    return page(notFound('Event not found.', 'This event page does not exist or is no longer published.'), 404, { 'x-robots-tag': 'noindex' });
  }
  return page(notFound('Page not found.', 'This page does not exist.'), 404, { 'x-robots-tag': 'noindex' });
}

/* ---------- guest API ---------- */
async function publicApi(req, ctx, parts, url) {
  const s = await store();
  if (parts[0] === 'events' && req.method === 'GET') {
    const evs = (await all('events/')).filter(isListed).map(live).filter((e) => url.searchParams.get('scope') === 'all' || !e.date || (e.endDate || e.date) >= istToday());
    return json({ events: evs.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(guestEvent) });
  }
  if (parts[0] === 'image' && req.method === 'GET') {
    const key = str(parts[1], 60).replace(/[^A-Za-z0-9_-]/g, ''), img = key && await s.getBin('images/' + key);
    if (!img) return fail(404, 'Not found');
    return new Response(img.buf, { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  if (parts[0] === 'rsvp' && req.method === 'POST') {
    const b = await body(req);
    if (str(b.website)) return json({ ok: true, created: false }); // honeypot: pretend success
    if (await limited('rsvp/' + hash(ipOf(req, ctx)), 12, 3600)) return fail(429, 'Too many requests. Please try again later.');
    let e0 = null;
    if (b.t) { const ref = await s.get('invites/' + str(b.t, 60)); e0 = ref && await s.get('events/' + ref.eventId); if (e0 && e0.inviteToken !== b.t) e0 = null; }
    else if (b.slug) { const ref = await s.get('slugs/' + slugify(b.slug)); e0 = ref && await s.get('events/' + ref.id); if (e0 && !isListed(e0)) e0 = null; }
    const e = e0 && live(e0);
    if (!e) return fail(404, 'This event is not available.');
    const st = formState(e);
    if (st !== 'open') return fail(409, st === 'early' ? 'Requests for this event are not open yet.' : 'Requests for this event are closed.');
    const iv = e.invite || {}, r = { name: str(b.name, 120), email: normEmail(b.email), phone: iv.askPhone === 'off' ? '' : str(b.phone, 40), note: iv.askNote ? str(b.note, 600) : '', guests: 1 + int(b.plus, 0, iv.plusOnes || 0) };
    if (!r.name || !emailOk(r.email)) return fail(400, 'Please enter your name and a valid email.');
    if (iv.askPhone === 'required' && normPhone(r.phone).length < 7) return fail(400, 'Please enter your phone number.');
    if (b.consent !== true) return fail(400, 'Please tick the box so we can manage your attendance.');
    const u = b.utm && typeof b.utm === 'object' ? b.utm : {}, utm = {};
    for (const k of ['source', 'medium', 'campaign', 'content']) if (u[k]) utm[k] = str(u[k], 80).toLowerCase();
    Object.assign(r, { id: id(), eventId: e.id, status: 'pending', createdAt: now(), decidedAt: '', passToken: '', checkedInAt: '', scanCount: 0, showName: b.showName === true, utm, via: b.t ? 'invite' : 'event-page' });
    // One request per e-mail per event: only the first writer of this key creates a guest.
    if (!(await s.create('rsvpEmail/' + e.id + '/' + hash(r.email), { id: r.id }))) return json({ ok: true, created: false });
    r.contactId = await upsertContactFromRsvp(s, r);
    await s.set('rsvps/' + e.id + '/' + r.id, r);
    return json({ ok: true, created: true, ref: hash(r.id).slice(0, 16) });
  }
  if (parts[0] === 'enquiries' && req.method === 'POST') {
    const b = await body(req);
    if (str(b.website)) return json({ ok: true }); // honeypot
    if (await limited('enq/' + hash(ipOf(req, ctx)), 8, 3600)) return fail(429, 'Too many requests. Please try again in a few minutes.');
    const KIND = { contact: 'İletişim', community: 'Community kaydı', partner: 'Partnerlik' }, kind = KIND[b.kind] ? b.kind : 'contact';
    const q = { id: id(), kind, brief: !!b.brief, kindLabel: b.brief ? 'Proje brief’i' : KIND[kind], name: str(b.name, 120), email: normEmail(b.email), consent: b.consent === true, path: str(b.analyticsPath, 80), status: 'new', note: '', createdAt: now(), updatedAt: now() };
    for (const f of ['company', 'topic', 'service', 'city', 'preferredDates', 'venue', 'capacity', 'budget', 'artist']) q[f] = str(b[f], 200);
    q.message = str(b.message, 4000);
    if (!q.name || !emailOk(q.email)) return fail(400, 'Please enter your name and a valid email.');
    if (kind === 'community' && !q.consent) return fail(400, 'Please tick the consent box to join the list.');
    if (kind !== 'community' && !q.message) return fail(400, 'Please write a message.');
    // one CRM person per e-mail; the form never overwrites what HQ already knows about them
    const hit = await s.get('contactEmail/' + hash(q.email));
    if (hit) { q.contactId = hit.id; const c = await s.get('contacts/' + hit.id); const tag = kind === 'community' ? 'community' : 'site-talebi'; if (c && !(c.tags || []).includes(tag)) { c.tags = (c.tags || []).concat(tag); c.updatedAt = now(); await s.set('contacts/' + c.id, c); } }
    else { const c = { id: id(), name: q.name, email: q.email, phone: '', instagram: '', company: q.company, tags: [kind === 'community' ? 'community' : 'site-talebi'], source: 'Site formu: ' + q.kindLabel, notes: '', createdAt: now(), updatedAt: now() }; await s.set('contacts/' + c.id, c); await s.set('contactEmail/' + hash(c.email), { id: c.id }); q.contactId = c.id; }
    await s.set('enquiries/' + q.id, q);
    q.notify = await notifyEnquiry(q, url.origin); if (q.notify.status !== 'off') await s.set('enquiries/' + q.id, q);
    return json({ ok: true });
  }
  if (parts[0] === 'guests' && req.method === 'GET') {
    const e0 = await s.get('events/' + str(url.searchParams.get('e'), 40).replace(/[^A-Za-z0-9_-]/g, '')), e = e0 && live(e0);
    if (!e) return fail(404, 'Not found');
    const pref = url.searchParams.get('p') ? await s.get('passes/' + str(url.searchParams.get('p'), 60)) : null;
    const pr = pref && pref.eventId === e.id ? await s.get('rsvps/' + e.id + '/' + pref.rsvpId) : null, holder = !!pr && pr.status === 'approved';
    // a private event's list opens only with its invite key or an entry pass
    if (e.visibility !== 'public' && !holder && str(url.searchParams.get('t'), 60) !== e0.inviteToken) return fail(404, 'Not found');
    if ((e.invite || {}).showGuests === false) return json({ enabled: false }, 200, { 'cache-control': 'no-store' });
    return json({ enabled: true, ...guestList(await rsvpsOf(e.id), holder) }, 200, { 'cache-control': 'no-store' });
  }
  if (parts[0] === 'pass' && req.method === 'GET') {
    const ref = await s.get('passes/' + str(url.searchParams.get('t'), 60));
    const r = ref && await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId), e = r && await s.get('events/' + r.eventId);
    if (!r || !e || r.status !== 'approved') return fail(404, 'This pass is not valid.');
    return json({ eventId: e.id, pass: { name: r.name, guests: r.guests, checkedIn: !!r.checkedInAt }, event: guestEvent(live(e) || e) });
  }
  if (parts[0] === 'hit' && req.method === 'POST') {
    const b = await body(req), kind = b.k === 'ticket' ? 'ticket' : 'view', eid = str(b.e, 40).replace(/[^A-Za-z0-9_-]/g, '');
    if (isBot(req.headers.get('user-agent')) || !eid || await limited('hit/' + hash(ipOf(req, ctx)), 120, 3600)) return json({ ok: true });
    const e = await s.get('events/' + eid); if (!e || e.status !== 'published') return json({ ok: true });
    const u = b.utm && typeof b.utm === 'object' ? b.utm : {};
    await s.set('hits/' + eid + '/' + istToday() + '/' + kind + '/' + id(), { s: str(u.source, 80).toLowerCase(), m: str(u.medium, 80).toLowerCase(), c: str(u.campaign, 80).toLowerCase() });
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

/* ---------- check-in (used by HQ and by the door link) ---------- */
// The check-in record is created atomically: of two devices scanning the same pass, exactly one gets true.
async function checkIn(s, r, undo) {
  const key = 'checkins/' + r.eventId + '/' + r.id, save = () => s.set('rsvps/' + r.eventId + '/' + r.id, r);
  if (undo) { await s.del(key); r.checkedInAt = ''; r.scanCount = 0; await save(); return { result: 'undone', rsvp: r }; }
  const at = now(), first = await s.create(key, { at });
  if (first) { r.checkedInAt = at; r.scanCount = 1; await save(); return { result: 'ok', message: 'Giriş onaylandı.', rsvp: r }; }
  const prev = await s.get(key); r.checkedInAt = (prev && prev.at) || r.checkedInAt || at; r.scanCount = (r.scanCount || 1) + 1; await save();
  return { result: 'duplicate', message: 'Bu kart daha önce kullanıldı.', rsvp: r };
}
async function findPass(s, b, eventId) {
  let r = null;
  if (b.token) { const ref = await s.get('passes/' + str(b.token, 60)); r = ref && await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId); }
  else if (eventId && b.rsvpId) r = await s.get('rsvps/' + eventId + '/' + str(b.rsvpId, 40));
  if (!r) return { out: { result: 'invalid', message: 'Geçersiz kart.' } };
  if (eventId && r.eventId !== eventId) { const other = await s.get('events/' + r.eventId); return { out: { result: 'wrong-event', message: 'Bu kart başka bir etkinliğe ait' + (other ? ': ' + other.title : '') + '.' } }; }
  if (r.status !== 'approved') return { out: { result: 'not-approved', message: 'Bu başvuru onaylı değil.' }, r };
  return { r };
}

/* ---------- door link: check-in for one event, without an HQ account ---------- */
// A door key opens only the check-in list of its own event: names and party size, no e-mail, phone or notes.
const doorGuest = (r) => ({ id: r.id, name: r.name, guests: r.guests, checkedInAt: r.checkedInAt, scanCount: r.scanCount, eventId: r.eventId });
const doorValid = (e) => e && e.status === 'published' && e.door && e.door.token && (!e.date || istToday() <= new Date(Date.parse(e.endDate || e.date) + 2 * 864e5).toISOString().slice(0, 10));
async function doorApi(req, ctx, parts, url) {
  const s = await store(), key = str(req.headers.get('x-door') || '', 60), ref = key && await s.get('doors/' + key), e = ref && await s.get('events/' + ref.eventId);
  if (await limited('door/' + hash(ipOf(req, ctx)), 600, 3600)) return fail(429, 'Çok fazla istek.');
  if (!doorValid(e) || e.door.token !== key) return fail(401, 'Bu kapı linki geçerli değil.');
  if (parts[0] === 'list' && req.method === 'GET') return json({ event: { id: e.id, title: e.title, date: e.date, venue: e.venue }, guests: (await all('rsvps/' + e.id + '/')).filter((r) => r.status === 'approved').map(doorGuest) });
  if (parts[0] === 'checkin' && req.method === 'POST') {
    const b = await body(req), f = await findPass(s, b, e.id);
    if (f.out) return json(f.r ? { ...f.out, rsvp: doorGuest(f.r) } : f.out);
    const o = await checkIn(s, f.r, !!b.undo); return json({ ...o, rsvp: doorGuest(o.rsvp) });
  }
  return fail(404, 'Bulunamadı.');
}

/* ---------- admin API: events, RSVP, check-in ---------- */
const adminEvent = (e, rs) => ({ ...e, doorUrl: e.door && e.door.token ? '/door?k=' + e.door.token : '', counts: counts(rs), dirty: isDirty(e), formState: formState(e), inviteUrl: inviteUrl(e), publicUrl: '/events/' + (e.live ? e.live.slug : e.slug), listed: isListed(e) });
async function uniqueSlug(s, slug, eventId) {
  let cand = slug, n = 1;
  for (;;) { const hit = await s.get('slugs/' + cand); if (!hit || hit.id === eventId) return cand; n += 1; cand = slug.slice(0, 74) + '-' + n; }
}
async function saveSlug(s, e, prevSlug) {
  e.slug = await uniqueSlug(s, e.slug, e.id);
  await s.set('slugs/' + e.slug, { id: e.id });
  if (prevSlug && prevSlug !== e.slug && !(e.live && e.live.slug === prevSlug)) await s.del('slugs/' + prevSlug);
}
// What publishing would change on the public site (shown before the admin confirms).
function routeChanges(e) {
  const out = [];
  if (!e.live) out.push({ type: 'new', url: e.visibility === 'public' ? '/events/' + e.slug : inviteUrl(e) + ' (özel davet, listelenmez)' });
  else if (e.live.slug !== e.slug) out.push({ type: 'moved', from: '/events/' + e.live.slug, to: '/events/' + e.slug });
  return out;
}
async function publish(s, e, redirect) {
  const old = e.live && e.live.slug;
  if (old && old !== e.slug) {
    await s.del('slugs/' + old);
    if (redirect) {
      await s.set('redirects/' + old, { to: e.slug, at: now() });
      for (const k of await s.list('redirects/')) { const r = await s.get(k); if (r && r.to === old) await s.set(k, { to: e.slug, at: now() }); } // no chains
    }
  }
  await s.del('redirects/' + e.slug); // a live page never redirects away from itself (no loops)
  e.live = snapshot(e); e.status = 'published'; e.publishedAt = now(); e.updatedAt = now();
  await s.set('slugs/' + e.slug, { id: e.id }); await s.set('events/' + e.id, e);
}

async function adminApi(req, ctx, parts, url) {
  const s = await store(), m = req.method;
  if (parts[0] === 'login' && m === 'POST') {
    if (!sameOrigin(req)) return fail(403, 'İstek reddedildi.');
    if (await limited('login/' + hash(ipOf(req, ctx)), 8, 900)) return fail(429, 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
    const b = await body(req);
    if (!checkLogin(b.email, b.password)) return fail(401, 'E-posta veya şifre hatalı.');
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req) });
  }
  if (parts[0] === 'logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  const me = session(req);
  if (!me) return fail(401, 'Giriş gerekli.');
  if (m !== 'GET' && !sameOrigin(req)) return fail(403, 'İstek reddedildi.');
  if (parts[0] === 'session') return json({ email: me.email, store: storeName() });

  if (parts[0] === 'summary') {
    const evs = await all('events/'), tasks = await all('tasks/'), td = istToday(), up = [];
    let pending = 0, approved = 0;
    for (const e of evs) {
      if (e.status === 'archived') continue;
      const rs = await rsvpsOf(e.id), c = counts(rs);
      if (e.status === 'published') { pending += c.pending; if (!e.date || (e.endDate || e.date) >= td) { approved += c.approved; up.push(adminEvent(e, rs)); } }
    }
    const open = tasks.filter((t) => t.status !== 'done'), enq = (await all('enquiries/')).filter((x) => x.status === 'new').length;
    return json({ newEnquiries: enq, upcoming: up.sort((a, b) => (a.date || '9').localeCompare(b.date || '9')), pendingRsvps: pending, approvedGuests: approved, openTasks: open.length, overdueTasks: open.filter((t) => t.due && t.due < td).length, drafts: evs.filter((e) => e.status === 'draft').length });
  }

  if (parts[0] === 'events') {
    if (!parts[1] && m === 'GET') {
      const out = []; for (const e of await all('events/')) out.push(adminEvent(e, await rsvpsOf(e.id)));
      return json({ events: out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt.localeCompare(a.createdAt)) });
    }
    if (!parts[1] && m === 'POST') {
      const r = eventInput(await body(req), { visibility: 'public' }); if (r.error) return fail(400, r.error);
      const e = { ...r.event, id: id(), status: 'draft', inviteToken: token(24), createdAt: now(), updatedAt: now(), live: null };
      await saveSlug(s, e, ''); await s.set('events/' + e.id, e); await s.set('invites/' + e.inviteToken, { eventId: e.id });
      return json({ event: adminEvent(e, []) }, 201);
    }
    const e = await s.get('events/' + parts[1]);
    if (!e) return fail(404, 'Etkinlik bulunamadı.');
    if (parts[2] === 'messages' && m === 'GET') {
      const sample = { name: 'Ada Yılmaz', email: 'ada@example.com', guests: 1, passToken: 'ornek' }, pm = passMail(e, sample, url.origin), ws = await waSettings(s);
      return json({ email: { status: emailStatus(), pass: { subject: pm.subject, html: pm.html } }, whatsapp: { status: waStatus(), inviteReady: !!(ws.invite.projectId && ws.invite.version), passReady: !!(ws.pass.projectId && ws.pass.version), invite: invitePreview(e, sample), pass: passParams(e, sample) } });
    }
    if (!parts[2] && m === 'GET') return json({ event: adminEvent(e, await rsvpsOf(e.id)), changes: routeChanges(e), seo: eventSeo(e, await seoSettings(s)) });
    if (!parts[2] && m === 'PUT') {
      const r = eventInput(await body(req), e); if (r.error) return fail(400, r.error);
      const next = { ...r.event, updatedAt: now() };
      await saveSlug(s, next, e.slug); await s.set('events/' + e.id, next);
      return json({ event: adminEvent(next, await rsvpsOf(e.id)), changes: routeChanges(next) });
    }
    if (parts[2] === 'publish' && m === 'POST') {
      const b = await body(req);
      if (!e.date) return fail(400, 'Yayınlamak için tarih gerekli.');
      await publish(s, e, b.redirect !== false);
      return json({ event: adminEvent(e, await rsvpsOf(e.id)) });
    }
    if (parts[2] === 'status' && m === 'POST') {
      const st = (await body(req)).status;
      if (!['draft', 'archived'].includes(st)) return fail(400, 'Geçersiz durum.');
      e.status = st; e.updatedAt = now(); await s.set('events/' + e.id, e); // e.live is kept so the event can be re-published as it was
      return json({ event: adminEvent(e, await rsvpsOf(e.id)) });
    }
    if (parts[2] === 'door-link' && m === 'POST') { // create / renew / close the door staff link
      const b = await body(req);
      if (e.door && e.door.token) await s.del('doors/' + e.door.token);
      e.door = b.close ? null : { token: token(24), createdAt: now() }; e.updatedAt = now();
      if (e.door) await s.set('doors/' + e.door.token, { eventId: e.id });
      await s.set('events/' + e.id, e);
      return json({ event: adminEvent(e, await rsvpsOf(e.id)) });
    }
    if (parts[2] === 'invite-token' && m === 'POST') { // old link stops working immediately
      await s.del('invites/' + e.inviteToken);
      e.inviteToken = token(24); e.updatedAt = now();
      await s.set('invites/' + e.inviteToken, { eventId: e.id }); await s.set('events/' + e.id, e);
      return json({ event: adminEvent(e, await rsvpsOf(e.id)) });
    }
    return fail(404, 'Bulunamadı.');
  }

  if (parts[0] === 'images' && m === 'POST') {
    const b = await body(req), mt = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!mt) return fail(400, 'Görsel JPEG, PNG veya WebP olmalı.');
    const buf = Buffer.from(mt[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) return fail(413, 'Görsel 3 MB’tan küçük olmalı.');
    const key = id(); await s.setBin('images/' + key, buf, mt[1]);
    return json({ id: key, url: '/api/public/image/' + key }, 201);
  }

  if (parts[0] === 'rsvps.csv') {
    const e = await s.get('events/' + str(url.searchParams.get('event'), 40)); if (!e) return fail(404, 'Etkinlik bulunamadı.');
    const st = url.searchParams.get('status') || '', q = (url.searchParams.get('q') || '').toLocaleLowerCase('tr');
    const rows = (await rsvpsOf(e.id)).filter((r) => (!st || (st === 'checkedin' ? !!r.checkedInAt : r.status === st)) && (!q || (r.name + ' ' + r.email + ' ' + r.phone).toLocaleLowerCase('tr').includes(q))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return csv('misafir-' + e.slug + '.csv', [['Ad Soyad', 'E-posta', 'Telefon', 'Kişi', 'Durum', 'Not', 'Başvuru', 'Karar', 'Giriş', 'Kaynak', 'Kampanya']].concat(rows.map((r) => [r.name, r.email, r.phone, r.guests, r.checkedInAt ? 'giriş yaptı' : r.status, r.note, r.createdAt, r.decidedAt, r.checkedInAt, (r.utm && r.utm.source) || '', (r.utm && r.utm.campaign) || ''])));
  }
  if (parts[0] === 'rsvps' && parts[1]) {
    const e = await s.get('events/' + parts[1]); if (!e) return fail(404, 'Etkinlik bulunamadı.');
    const rs = await rsvpsOf(e.id);
    if (!parts[2] && m === 'GET') return json({ event: adminEvent(e, rs), rsvps: rs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), email: emailStatus(), whatsapp: waStatus() });
    const decide = async (r, dec) => {
      r.status = dec; r.decidedAt = now();
      if (dec === 'approved' && !r.passToken) { r.passToken = token(24); await s.set('passes/' + r.passToken, { eventId: e.id, rsvpId: r.id }); }
      // the pass is e-mailed once on approval; a failed attempt is stored as failed, never as sent
      if (dec === 'approved' && !(r.mail && r.mail.status === 'sent')) { const m = await sendPass(live(e) || e, r, url.origin); if (m.status !== 'off') r.mail = m; }
      if (dec === 'approved' && r.phone && !(r.wa && r.wa.status === 'sent')) { const w = await sendPassWa(s, live(e) || e, r); if (w.status !== 'off') r.wa = w; }
      await s.set('rsvps/' + e.id + '/' + r.id, r);
    };
    if (parts[2] === 'bulk' && m === 'POST') {
      const b = await body(req), dec = b.decision, ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      if (!RSVP_STATUS.includes(dec) || dec === 'pending') return fail(400, 'Geçersiz karar.');
      const pick = rs.filter((r) => ids.includes(r.id) && r.status !== dec), used = guestsOf(rs, 'approved');
      const add = dec === 'approved' ? pick.reduce((n, r) => n + (r.guests || 1), 0) : -pick.filter((r) => r.status === 'approved').reduce((n, r) => n + (r.guests || 1), 0);
      const info = { count: pick.length, guests: pick.reduce((n, r) => n + (r.guests || 1), 0), capacity: e.capacity || 0, approvedNow: used, approvedAfter: used + add, over: !!e.capacity && used + add > e.capacity };
      if (b.dryRun) return json(info);
      if (info.over && dec === 'approved' && !b.force) return fail(409, 'Kapasite aşılıyor (' + info.approvedAfter + ' / ' + e.capacity + ').', { overCapacity: true, ...info });
      for (const r of pick) await decide(r, dec);
      return json({ ok: true, ...info });
    }
    const r = rs.find((x) => x.id === parts[2]); if (!r) return fail(404, 'Başvuru bulunamadı.');
    if (parts[3] === 'send-pass-wa' && m === 'POST') {
      if (r.status !== 'approved' || !r.passToken) return fail(400, 'Giriş kartı yalnızca onaylı başvuruya gönderilir.');
      if (!waStatus().connected) return fail(409, 'WhatsApp bağlı değil.');
      if (!r.phone) return fail(400, 'Bu başvuruda telefon numarası yok.');
      r.wa = await sendPassWa(s, live(e) || e, r); await s.set('rsvps/' + e.id + '/' + r.id, r);
      return r.wa.status === 'sent' ? json({ rsvp: r }) : fail(502, 'WhatsApp gönderilemedi: ' + (r.wa.error || ''), { rsvp: r });
    }
    if (parts[3] === 'send-pass' && m === 'POST') {
      if (r.status !== 'approved' || !r.passToken) return fail(400, 'Giriş kartı yalnızca onaylı başvuruya gönderilir.');
      if (!emailStatus().connected) return fail(409, 'E-posta servisi bağlı değil.');
      r.mail = await sendPass(live(e) || e, r, url.origin); await s.set('rsvps/' + e.id + '/' + r.id, r);
      return r.mail.status === 'sent' ? json({ rsvp: r }) : fail(502, 'E-posta gönderilemedi: ' + (r.mail.error || ''), { rsvp: r });
    }
    if (parts[3] === 'decision' && m === 'POST') {
      const b = await body(req), dec = b.decision;
      if (!RSVP_STATUS.includes(dec)) return fail(400, 'Geçersiz karar.');
      if (dec === 'approved' && r.status !== 'approved' && e.capacity && guestsOf(rs, 'approved') + r.guests > e.capacity && !b.force) return fail(409, 'Kapasite doldu (' + guestsOf(rs, 'approved') + ' / ' + e.capacity + ').', { overCapacity: true });
      await decide(r, dec);
      return json({ rsvp: r });
    }
    return fail(404, 'Bulunamadı.');
  }

  if (parts[0] === 'checkin' && m === 'POST') {
    const b = await body(req), f = await findPass(s, b, str(b.eventId, 40));
    if (f.out) return json(f.r ? { ...f.out, rsvp: f.r } : f.out);
    return json(await checkIn(s, f.r, !!b.undo));
  }

  if (parts[0] === 'import-site-events' && m === 'POST') { // one-off: the archive that is hard-coded in the public site
    let created = 0, skipped = 0;
    for (const x of LEGACY_EVENTS) {
      if (await s.get('slugs/' + x.slug)) { skipped += 1; continue; }
      const r = eventInput({ ...x, useRsvp: false, useTickets: false, visibility: 'public' }, {}); if (r.error) { skipped += 1; continue; }
      const e = { ...r.event, id: id(), status: 'draft', inviteToken: token(24), createdAt: now(), updatedAt: now(), live: null, imported: 'site-archive' };
      await s.set('invites/' + e.inviteToken, { eventId: e.id }); await publish(s, e, false); created += 1;
    }
    return json({ ok: true, created, skipped, total: LEGACY_EVENTS.length });
  }

  return admin2(req, ctx, parts, url, s, { seoSettings, adminEvent, rsvpsOf });
}

/* ---------- router ---------- */
export default async function handler(req, ctx) {
  const url = new URL(req.url), parts = url.pathname.split('/').filter(Boolean);
  setDeployContext((ctx && ctx.deploy && ctx.deploy.context) || process.env.CONTEXT);
  try {
    const s = await store();
    await migrate(s, storeName());
    const miss = missingConfig();
    if (!miss.length) await initSecret(s);
    if (parts[0] === 'hq') {
      if (miss.length) return gated('<!doctype html><meta charset="utf-8"><title>More Life HQ</title><body style="font-family:system-ui;background:#0E0B0A;color:#F3EEE6;padding:40px"><h1>HQ henüz yapılandırılmadı</h1><p>Netlify’da şu ortam değişkenlerini tanımlayın: ' + miss.join(', ') + '</p></body>', 503);
      return gated(session(req) ? APP_HTML : LOGIN_HTML, 200);
    }
    if (parts[0] === 'api' && parts[1] === 'hq') {
      if (miss.length) return fail(503, 'HQ yapılandırılmadı: ' + miss.join(', '));
      return await adminApi(req, ctx, parts.slice(2), url);
    }
    if (parts[0] === 'api' && parts[1] === 'public') return await publicApi(req, ctx, parts.slice(2), url);
    if (parts[0] === 'api' && parts[1] === 'door') return await doorApi(req, ctx, parts.slice(2), url);
    if (parts[0] === 'door') return page(DOOR_HTML, 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method not allowed');
    return await publicPage(req, url, parts);
  } catch (err) {
    console.error(err);
    if (url.pathname === '/') { const { SITE_HTML } = await import('./lib/site-html.mjs'); return page(SITE_HTML, 200); } // never take the home page down with the database
    return parts[0] === 'api' ? fail(500, 'Sunucu hatası.') : page(notFound('Something went wrong.', 'Please try again in a moment.'), 500, { 'x-robots-tag': 'noindex' });
  }
}
