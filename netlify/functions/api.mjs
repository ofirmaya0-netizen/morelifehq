// More Life HQ — one Netlify Function: public pages (home, event, invite, sitemap, robots), the guest API
// (/api/public/*), the gated HQ page (/hq) and the admin API (/api/hq/*). Every admin route passes the same session check.
import { store, all, setDeployContext, storeName, flushDirty } from './lib/store.mjs';
import { missingConfig, initSecret, checkLogin, verifyPassword, sessionCookie, clearCookie, sameOrigin, token, id, hash } from './lib/auth.mjs';
import { currentUser, ownerUser, findMember, allowed, screens, ROLES, logAudit, describe, auditRoute, teamRoute, setupRoute, meRoute } from './lib/team.mjs';
import { bookingsRoute, bookingAlerts } from './lib/bookings.mjs';
import { backupsRoute } from './lib/backup.mjs';
import { pnlRoute } from './lib/pnl.mjs';
import { ticketsPublic, ticketsAdmin, testPayPage, eventSales, eventTickets, ticketGuest, findTicket, shopOf, emit } from './lib/tickets.mjs';
import { json, fail, page, gated, now, str, int, emailOk, normEmail, normPhone, intlPhone, PHONE_HINT, body, ipOf, istToday, csv, isBot, slugify } from './lib/util.mjs';
import { eventInput, snapshot, isDirty, live, isListed, formState, guestEvent, guestList, counts, guestsOf, DEFAULT_SEO_SETTINGS, eventSeo, RSVP_STATUS } from './lib/model.mjs';
import { renderHome, renderEvent, renderShop, notFound, sitemap, robots } from './lib/render.mjs';
import { approve, offerNext, cancelByGuest, runSchedule } from './lib/guestflow.mjs';
import { reminderMail, offerMail, thanksMail } from './lib/email.mjs';
import { migrate } from './lib/migrations.mjs';
import { admin2 } from './lib/admin2.mjs';
import { inviteRoute, personalOf, markPersonal, personalOpen, shareToken, shareUrl } from './lib/invites.mjs';
import { emailStatus, sendPass, sendTable, passMail, notifyEnquiry } from './lib/email.mjs';
import { waStatus, waSettings, sendPassWa, sendTableWa, passParams, invitePreview, passQrPng } from './lib/whatsapp.mjs';
import { waHook, inboxRoute, unreadThreads } from './lib/inbox.mjs';
import { APP_HTML, LOGIN_HTML, DOOR_HTML } from './lib/hq-html.mjs';
import { LEGACY_EVENTS } from './lib/legacy-events.mjs';
import { venuePublic, venueAdmin, inviteOk, venueOfInvite } from './lib/venue.mjs';

export const config = { path: ['/', '/events/*', '/invite', '/sitemap.xml', '/robots.txt', '/door', '/pay/*', '/tickets', '/tickets/*', '/hq', '/hq/*', '/api/hq/*', '/api/public/*', '/api/door/*'] };

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
  const s = await store(), set = await seoSettings(s);
  // a draft preview is for people who can open the event in HQ
  const viewer = url.searchParams.get('preview') === '1' ? await currentUser(req, s) : null, preview = !!viewer && screens(viewer.role).includes('etkinlikler');
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
    const it = str(url.searchParams.get('t'), 60), ref = await s.get('invites/' + it), e0 = ref && await s.get('events/' + ref.eventId), e = e0 && live(e0);
    if (!e || !(await inviteOk(s, e0, it)) || (e.invite && e.invite.enabled === false)) return page(notFound('Invitation unavailable.', 'This invitation link is not active.'), 404, { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' });
    if ((ref.contactId || ref.rsvpId) && !isBot(req.headers.get('user-agent'))) await personalOpen(s, e0, ref.contactId || 'r-' + ref.rsvpId); // how often a personal link was opened
    return page(renderEvent(e, set, { mode: 'invite', token: it }), 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' });
  }
  if (parts[0] === 'tickets') { // the shop alone: /tickets/slug for public events, /tickets?t=invite-key for private ones; ?embed=1 inside an iframe
    const tk = str(url.searchParams.get('t'), 60), ref = parts[1] ? await s.get('slugs/' + slugify(parts[1])) : tk ? await s.get('invites/' + tk) : null, e0 = ref && await s.get('events/' + (ref.id || ref.eventId)), e = e0 && live(e0);
    if (!e || (parts[1] ? !isListed(e0) : !(await inviteOk(s, e0, tk)))) return page(notFound('Tickets not found.', 'This ticket page does not exist or is no longer published.'), 404, { 'x-robots-tag': 'noindex' });
    const embed = url.searchParams.get('embed') === '1';
    // the embedded page must be allowed inside other sites' frames; everything else it links to opens at the top level
    return page(renderShop(e, { token: parts[1] ? '' : tk, embed, look: (await shopOf(s, e.id)).look || {} }), 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...(parts[1] ? {} : { 'referrer-policy': 'no-referrer' }) });
  }
  if (parts[0] === 'events' && parts[1]) {
    const slug = slugify(parts[1]), ref = await s.get('slugs/' + slug), e0 = ref && await s.get('events/' + ref.id);
    if (e0 && preview) return page(renderEvent(e0, set, { mode: 'preview' }), 200, cache);
    const e = e0 && live(e0);
    if (e && e.slug === slug && e.visibility === 'public') return page(renderEvent(e, set, { mode: 'public', ga: process.env.GA4_MEASUREMENT_ID || '', selling: !!(await shopOf(s, e.id)).enabled }), 200, cache);
    const red = await s.get('redirects/' + slug);
    if (red) return new Response(null, { status: 301, headers: { location: '/events/' + red.to } });
    return page(notFound('Event not found.', 'This event page does not exist or is no longer published.'), 404, { 'x-robots-tag': 'noindex' });
  }
  return page(notFound('Page not found.', 'This page does not exist.'), 404, { 'x-robots-tag': 'noindex' });
}

/* ---------- guest API ---------- */
async function publicApi(req, ctx, parts, url) {
  const s = await store();
  if (parts[0] === 'wa-hook') return waHook(req, s, url); // Bird → HQ: incoming WhatsApp messages, signed
  if (parts[0] === 'events' && req.method === 'GET') {
    const evs = (await all('events/')).filter(isListed).map(live).filter((e) => url.searchParams.get('scope') === 'all' || !e.date || (e.endDate || e.date) >= istToday());
    return json({ events: evs.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(guestEvent) });
  }
  // Events a table can be asked for: every published event that has not passed, private ones included. Title and date only;
  // nothing here opens a private event's page.
  if (parts[0] === 'table-events' && req.method === 'GET') {
    const evs = (await all('events/')).filter((e) => e.status === 'published' && e.live && (!e.live.date || (e.live.endDate || e.live.date) >= istToday()));
    return json({ events: evs.map((e) => ({ id: e.id, title: e.live.title, date: e.live.date || '' })).sort((a, b) => (a.date || '9').localeCompare(b.date || '9')) }, 200, { 'cache-control': 'no-store' });
  }
  if (parts[0] === 'image' && req.method === 'GET') {
    const key = str(parts[1], 60).replace(/[^A-Za-z0-9_-]/g, ''), img = key && await s.getBin('images/' + key);
    if (!img) return fail(404, 'Not found');
    return new Response(img.buf, { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  // The entry QR as a picture, for the WhatsApp pass message. Whoever holds the pass key already holds the pass.
  if (parts[0] === 'pass-qr' && req.method === 'GET') {
    const t = str(parts[1], 70).replace(/\.png$/, '').replace(/[^A-Za-z0-9_-]/g, ''), ref = t && await s.get('passes/' + t);
    const r = ref && (ref.ticketId ? await findTicket(s, ref.eventId, ref.ticketId) : await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId));
    if (!r || (ref.ticketId ? r.status !== 'valid' : r.status !== 'approved') || await limited('passqr/' + hash(ipOf(req, ctx)), 300, 3600)) return fail(404, 'Not found');
    return new Response(await passQrPng(url.origin, t), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
  }
  if (parts[0] === 'rsvp' && req.method === 'POST') {
    const b = await body(req);
    if (str(b.website)) return json({ ok: true, created: false }); // honeypot: pretend success
    if (await limited('rsvp/' + hash(ipOf(req, ctx)), 12, 3600)) return fail(429, 'Too many requests. Please try again later.');
    let e0 = null;
    if (b.t) { const ref = await s.get('invites/' + str(b.t, 60)); e0 = ref && await s.get('events/' + ref.eventId); if (e0 && !(await inviteOk(s, e0, str(b.t, 60)))) e0 = null; }
    else if (b.slug) { const ref = await s.get('slugs/' + slugify(b.slug)); e0 = ref && await s.get('events/' + ref.id); if (e0 && !isListed(e0)) e0 = null; }
    const e = e0 && live(e0);
    if (!e) return fail(404, 'This event is not available.');
    if (!b.t && (await shopOf(s, e.id)).enabled) return fail(409, 'This event is ticketed. Please get your ticket on the event page.');
    const st = formState(e);
    if (st !== 'open') return fail(409, st === 'early' ? 'Requests for this event are not open yet.' : 'Requests for this event are closed.');
    const iv = e.invite || {}, r = { name: str(b.name, 120), email: normEmail(b.email), phone: iv.askPhone === 'off' ? '' : str(b.phone, 40), note: iv.askNote ? str(b.note, 600) : '', guests: 1 + int(b.plus, 0, iv.plusOnes || 0) };
    if (!r.name || !emailOk(r.email)) return fail(400, 'Please enter your name and a valid email.');
    if (iv.askPhone === 'required' && !r.phone) return fail(400, 'Please enter your phone number.');
    // kept in international form, so the entry pass can always go out by WhatsApp
    if (r.phone) { r.phone = intlPhone(r.phone); if (!r.phone) return fail(400, PHONE_HINT); }
    if (b.consent !== true) return fail(400, 'Please tick the box so we can manage your attendance.');
    const u = b.utm && typeof b.utm === 'object' ? b.utm : {}, utm = {};
    for (const k of ['source', 'medium', 'campaign', 'content']) if (u[k]) utm[k] = str(u[k], 80).toLowerCase();
    Object.assign(r, { id: id(), eventId: e.id, status: 'pending', createdAt: now(), decidedAt: '', passToken: '', checkedInAt: '', scanCount: 0, showName: b.showName === true, referredBy: '', utm, via: b.t ? 'invite' : 'event-page' });
    // asked through the venue's own invitation link: marked, so HQ sees whose guest this is
    const byVenue = b.t ? venueOfInvite(e0, str(b.t, 60)) : ''; if (byVenue) { r.via = 'venue'; r.invitedBy = byVenue; }
    // asked through one person's own link: theirs, or passed on by them
    const owner = b.t && !byVenue ? await personalOf(s, e0, str(b.t, 60)) : null; if (owner) markPersonal(r, owner);

    // One request per e-mail per event: only the first writer of this key creates a guest.
    if (!(await s.create('rsvpEmail/' + e.id + '/' + hash(r.email), { id: r.id }))) return json({ ok: true, created: false });
    if (b.ref) { const rf = await s.get('refs/' + str(b.ref, 20).replace(/[^A-Za-z0-9_-]/g, '')); if (rf && rf.eventId === e.id) r.referredBy = rf.rsvpId; }
    r.contactId = await upsertContactFromRsvp(s, r);
    // their own link to pass on (a CRM person keeps the one they were sent), so the next ring is traced to them
    if (b.t && !byVenue) await shareToken(s, e0, r, owner && !owner.rsvp && r.personal ? str(b.t, 60) : '');
    await s.set('rsvps/' + e.id + '/' + r.id, r);
    return json({ ok: true, created: true, ref: hash(r.id).slice(0, 16), share: shareUrl(e0, r) });
  }
  if (parts[0] === 'enquiries' && req.method === 'POST') {
    const b = await body(req);
    if (str(b.website)) return json({ ok: true }); // honeypot
    if (await limited('enq/' + hash(ipOf(req, ctx)), 8, 3600)) return fail(429, 'Too many requests. Please try again in a few minutes.');
    const KIND = { contact: 'İletişim', community: 'Community kaydı', partner: 'Partnerlik', table: 'Masa talebi' }, kind = KIND[b.kind] ? b.kind : 'contact';
    const q = { id: id(), kind, brief: !!b.brief, kindLabel: b.brief ? 'Proje brief’i' : KIND[kind], name: str(b.name, 120), email: normEmail(b.email), consent: b.consent === true, path: str(b.analyticsPath, 80), status: 'new', note: '', createdAt: now(), updatedAt: now() };
    for (const f of ['company', 'topic', 'service', 'city', 'preferredDates', 'venue', 'capacity', 'budget', 'artist']) q[f] = str(b[f], 200);
    q.message = str(b.message, 4000);
    // the link-in-bio page (/links) may also pass a phone and an Instagram handle
    // The table page (/tables): how many people, which area, for which event. A phone number is how the table gets confirmed.
    const table = kind === 'table';
    if (table) {
      q.phone = str(b.phone, 40); q.party = int(b.party, 0, 200, 0); q.area = ['backstage', 'standard', 'either'].includes(b.area) ? b.area : 'either';
      const ref = b.eventSlug ? await s.get('slugs/' + slugify(b.eventSlug)) : null, te = await s.get('events/' + (ref ? ref.id : str(b.eventId, 40).replace(/[^A-Za-z0-9_-]/g, '') || '-'));
      q.eventId = te && te.status === 'published' && te.live ? te.id : ''; q.eventTitle = q.eventId ? te.live.title : '';
    }
    const bio = q.path === '/links';
    if (bio) { q.phone = str(b.phone, 40); q.instagram = str(b.instagram, 60).replace(/^@+/, ''); }
    const tags = [kind === 'community' ? 'community' : table ? 'masa-talebi' : 'site-talebi'].concat(bio ? ['instagram-bio'] : []);
    if (!q.name || !emailOk(q.email)) return fail(400, 'Please enter your name and a valid email.');
    if (kind === 'community' && !q.consent) return fail(400, 'Please tick the consent box to join the list.');
    if (table) { q.phone = intlPhone(q.phone); if (!q.phone) return fail(400, PHONE_HINT); if (q.party < 1) return fail(400, 'Please tell us how many guests.'); }
    if (kind !== 'community' && !table && !q.message) return fail(400, 'Please write a message.');
    // one CRM person per e-mail; the form never overwrites what HQ already knows about them
    const hit = await s.get('contactEmail/' + hash(q.email));
    if (hit) { q.contactId = hit.id; const c = await s.get('contacts/' + hit.id); const add = c ? tags.filter((t) => !(c.tags || []).includes(t)) : []; if (add.length) { c.tags = (c.tags || []).concat(add); c.updatedAt = now(); await s.set('contacts/' + c.id, c); } }
    else {
      const c = { id: id(), name: q.name, email: q.email, phone: bio || table ? q.phone : '', instagram: bio ? q.instagram : '', company: q.company, tags, source: bio ? 'Link sayfası (Instagram bio)' : 'Site formu: ' + q.kindLabel, notes: '', createdAt: now(), updatedAt: now() };
      await s.set('contacts/' + c.id, c); await s.set('contactEmail/' + hash(c.email), { id: c.id }); q.contactId = c.id;
      if (normPhone(c.phone).length >= 7 && !(await s.get('contactPhone/' + hash(normPhone(c.phone))))) await s.set('contactPhone/' + hash(normPhone(c.phone)), { id: c.id });
    }
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
    if (e.visibility !== 'public' && !holder && !(await inviteOk(s, e0, str(url.searchParams.get('t'), 60)))) return fail(404, 'Not found');
    if ((e.invite || {}).showGuests === false) return json({ enabled: false }, 200, { 'cache-control': 'no-store' });
    return json({ enabled: true, ...guestList(await rsvpsOf(e.id), holder) }, 200, { 'cache-control': 'no-store' });
  }
  // The venue's own page: who is coming and who has a table, for the events at that venue only.
  if (parts[0] === 'venue') return venuePublic(req, s, url, () => limited('venue/' + hash(ipOf(req, ctx)), 900, 3600));
  if (['shop', 'checkout', 'pay', 'order', 'ticket', 'waitlist', 'resale', 'promoter', 'mytickets'].includes(parts[0])) return ticketsPublic(req, ctx, parts, url, s, { limited, ip: ipOf(req, ctx) });
  if (parts[0] === 'pass' && req.method === 'GET') {
    const ref = await s.get('passes/' + str(url.searchParams.get('t'), 60));
    if (ref && ref.ticketId) { // a bought ticket opens in the same pass page as an approved guest
      const tk = await findTicket(s, ref.eventId, ref.ticketId), ev = tk && await s.get('events/' + tk.eventId);
      if (!tk || !ev || tk.status !== 'valid') return fail(404, 'This ticket is not valid.');
      return json({ eventId: ev.id, pass: { name: tk.name, guests: 1, checkedIn: !!tk.checkedInAt, canCancel: false, friendUrl: '', type: tk.typeName, order: tk.orderNo }, event: guestEvent(live(ev) || ev) });
    }
    const r = ref && await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId), e = r && await s.get('events/' + r.eventId);
    if (!r || !e || r.status !== 'approved') return fail(404, 'This pass is not valid.');
    const le = live(e) || e, iv = e.invite || {}, open = !r.checkedInAt && (!e.date || Date.now() < Date.parse(e.date + 'T23:59:00+03:00'));
    // the friend link is offered for public events only: a private event's invite key stays with the host
    return json({ eventId: e.id, pass: { name: r.name, guests: r.guests, checkedIn: !!r.checkedInAt, canCancel: open && iv.selfCancel !== false, friendUrl: open && iv.referrals !== false && isListed(e) && r.refCode ? '/events/' + le.slug + '?ref=' + r.refCode : open ? shareUrl(e, r) : '' }, event: guestEvent(le) });
  }
  if (parts[0] === 'pass' && req.method === 'POST') { // the guest gives the place back
    const b = await body(req), ref = await s.get('passes/' + str(b.t, 60));
    if (ref && ref.ticketId) return fail(403, 'Tickets are refunded by More Life, not from this page.');
    const r = ref && await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId), e = r && await s.get('events/' + r.eventId);
    if (!r || !e || r.status !== 'approved' || b.action !== 'cancel') return fail(404, 'This pass is not valid.');
    if (r.checkedInAt) return fail(409, 'This pass has already been used.');
    if ((e.invite || {}).selfCancel === false) return fail(403, 'Please contact More Life to cancel.');
    await cancelByGuest(s, e, r, url.origin);
    return json({ ok: true });
  }
  if (parts[0] === 'offer') { // a waitlisted guest takes a freed place
    const t = str(req.method === 'GET' ? url.searchParams.get('t') : (await body(req)).t, 60), ref = t && await s.get('offers/' + t);
    const r = ref && await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId), e = r && await s.get('events/' + r.eventId);
    if (!r || !e || !r.offer || r.offer.token !== t || r.status !== 'waitlist') return fail(404, 'This offer is no longer available.');
    if (r.offer.expired || Date.parse(r.offer.expiresAt) < Date.now()) return fail(410, 'This offer has expired. The place went to the next person on the waitlist.');
    if (req.method === 'GET') return json({ name: r.name.split(' ')[0], expiresAt: r.offer.expiresAt, event: guestEvent(live(e) || e) });
    if (req.method !== 'POST' || !(await s.create('offerTaken/' + t, { at: now() }))) return fail(409, 'This offer has already been used.');
    await approve(s, e, r, url.origin); await s.del('offers/' + t);
    return json({ ok: true, pass: '/pass?t=' + r.passToken });
  }
  if (parts[0] === 'hit' && req.method === 'POST') {
    const b = await body(req), kind = b.k === 'ticket' ? 'ticket' : 'view', eid = str(b.e, 40).replace(/[^A-Za-z0-9_-]/g, '');
    if (isBot(req.headers.get('user-agent')) || !eid || await limited('hit/' + hash(ipOf(req, ctx)), 120, 3600)) return json({ ok: true });
    const e = await s.get('events/' + eid); if (!e || e.status !== 'published') return json({ ok: true });
    const u = b.utm && typeof b.utm === 'object' ? b.utm : {};
    await s.set('hits/' + eid + '/' + istToday() + '/' + kind + '/' + id(), { s: str(u.source, 80).toLowerCase(), m: str(u.medium, 80).toLowerCase(), c: str(u.campaign, 80).toLowerCase() });
    return json({ ok: true });
  }
  // Link-in-bio page counter: one record per page view or link press. Holds no personal data.
  if (parts[0] === 'linkhit' && req.method === 'POST') {
    const b = await body(req), label = b.k === 'view' ? 'view' : str(b.l, 30).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (isBot(req.headers.get('user-agent')) || !label || (b.k !== 'view' && label === 'view') || await limited('linkhit/' + hash(ipOf(req, ctx)), 120, 3600)) return json({ ok: true });
    await s.set('linkhits/' + istToday() + '/' + label + '/' + id(), { at: now() });
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

/* ---------- check-in (used by HQ and by the door link) ---------- */
// The check-in record is created atomically: of two devices scanning the same pass, exactly one gets true.
// Whoever walks through the door is tagged in the CRM, so the regulars are visible later.
async function markAttended(s, r) { const c = r.contactId && await s.get('contacts/' + r.contactId); if (c && !(c.tags || []).includes('katıldı')) { c.tags = (c.tags || []).concat('katıldı'); c.updatedAt = now(); await s.set('contacts/' + c.id, c); } }
async function checkIn(s, r, undo, by, when) {
  // r is an RSVP or a bought ticket (r.ticket set); both get one atomic check-in record
  const key = 'checkins/' + r.eventId + '/' + (r.ticket ? 'tk-' : '') + r.id, save = () => s.set((r.ticket ? 'tickets/' : 'rsvps/') + r.eventId + '/' + r.id, r), out = (o) => (r.ticket ? { ...o, rsvp: { ...ticketGuest(r), email: r.email } } : o);
  if (undo) { await s.del(key); r.checkedInAt = ''; r.checkedInBy = ''; r.scanCount = 0; await save(); return out({ result: 'undone', rsvp: r }); }
  // a device that was offline reports the time it let the guest in; accepted when it lies in the last 24 hours
  const ms = Date.parse(when || ''), at = ms && ms <= Date.now() && Date.now() - ms < 864e5 ? new Date(ms).toISOString() : now(), first = await s.create(key, { at, by: by || '' });
  if (first) { r.checkedInAt = at; r.checkedInBy = by || ''; r.scanCount = 1; await save(); if (!r.ticket) await markAttended(s, r); else await emit(s, 'ticket.checked_in', { ticket: { id: r.id, type: r.typeName, name: r.name, orderNo: r.orderNo, eventId: r.eventId, at } }); return out({ result: 'ok', message: 'Giriş onaylandı.', rsvp: r }); }
  const prev = await s.get(key); r.checkedInAt = (prev && prev.at) || r.checkedInAt || at; r.scanCount = (r.scanCount || 1) + 1; await save();
  return out({ result: 'duplicate', message: 'Bu kart daha önce kullanıldı.', rsvp: r });
}
async function findPass(s, b, eventId) {
  let r = null;
  if (b.token) { const ref = await s.get('passes/' + str(b.token, 60)); r = ref && (ref.ticketId ? await findTicket(s, ref.eventId, ref.ticketId) : await s.get('rsvps/' + ref.eventId + '/' + ref.rsvpId)); if (r && ref.ticketId) r.ticket = r.typeName; }
  else if (eventId && /^tk-/.test(b.rsvpId || '')) { r = await findTicket(s, eventId, str(b.rsvpId, 44).slice(3)); if (r) r.ticket = r.typeName; }
  else if (eventId && b.rsvpId) r = await s.get('rsvps/' + eventId + '/' + str(b.rsvpId, 40));
  if (!r) return { out: { result: 'invalid', message: 'Geçersiz kart.' } };
  if (eventId && r.eventId !== eventId) { const other = await s.get('events/' + r.eventId); return { out: { result: 'wrong-event', message: 'Bu kart başka bir etkinliğe ait' + (other ? ': ' + other.title : '') + '.' } }; }
  if (r.ticket ? r.status !== 'valid' : r.status !== 'approved') return { out: { result: 'not-approved', message: r.ticket ? 'Bu bilet iptal edilmiş ya da iade edilmiş.' : 'Bu başvuru onaylı değil.' }, r: r.ticket ? { ...ticketGuest(r) } : r };
  return { r };
}

/* ---------- door link: check-in for one event, without an HQ account ---------- */
// A door key opens only the check-in list of its own event: names and party size, no e-mail, phone or notes.
// `h` is a one-way mark of the QR key: a door device that lost its connection can match a scanned code against its list without ever holding the keys
const doorGuest = (r) => (r.ticket ? { id: /^tk-/.test(r.id) ? r.id : 'tk-' + r.id, name: r.name, guests: r.addon ? 0 : 1, checkedInAt: r.checkedInAt, scanCount: r.scanCount, eventId: r.eventId, ticket: r.ticket, h: r.h || (r.token ? hash(r.token).slice(0, 20) : ''), ...(r.due ? { due: r.due, currency: r.currency } : {}), ...(r.addon ? { addon: true } : {}) } : { id: r.id, name: r.name, guests: r.guests, checkedInAt: r.checkedInAt, scanCount: r.scanCount, eventId: r.eventId, h: r.passToken ? hash(r.passToken).slice(0, 20) : '' });
const doorValid = (e) => e && e.status === 'published' && e.door && e.door.token && (!e.date || istToday() <= new Date(Date.parse(e.endDate || e.date) + 2 * 864e5).toISOString().slice(0, 10));
async function doorApi(req, ctx, parts, url) {
  const s = await store(), key = str(req.headers.get('x-door') || '', 60), ref = key && await s.get('doors/' + key), e = ref && await s.get('events/' + ref.eventId);
  if (await limited('door/' + hash(ipOf(req, ctx)), 3000, 3600)) return fail(429, 'Çok fazla istek.');
  if (!doorValid(e) || e.door.token !== key) return fail(401, 'Bu kapı linki geçerli değil.');
  if (parts[0] === 'list' && req.method === 'GET') return json({ event: { id: e.id, title: e.title, date: e.date, venue: e.venue }, guests: (await all('rsvps/' + e.id + '/')).filter((r) => r.status === 'approved').map(doorGuest).concat((await eventTickets(e.id)).map(ticketGuest)) });
  if (parts[0] === 'checkin' && req.method === 'POST') {
    const b = await body(req), f = await findPass(s, b, e.id);
    if (f.out) return json(f.r ? { ...f.out, rsvp: doorGuest(f.r) } : f.out);
    const o = await checkIn(s, f.r, !!b.undo, 'Kapı linki', b.at); return json({ ...o, rsvp: doorGuest(o.rsvp) });
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
    if (checkLogin(b.email, b.password)) { await logAudit(s, ownerUser(), 'Giriş yaptı', ''); return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req, ownerUser()) }); }
    const u = await findMember(s, b.email);
    if (!verifyPassword(b.password, u && u.active ? u.pass : null)) return fail(401, 'E-posta veya şifre hatalı.');
    u.lastLoginAt = now(); await s.set('users/' + u.id, u);
    await logAudit(s, u, 'Giriş yaptı', '');
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req, u) });
  }
  if (parts[0] === 'logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  if (parts[0] === 'setup') { // one-time link of a team member; the key in the link is the credential
    if (m !== 'GET' && !sameOrigin(req)) return fail(403, 'İstek reddedildi.');
    if (await limited('setup/' + hash(ipOf(req, ctx)), 20, 900)) return fail(429, 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
    return setupRoute(req, url, s);
  }
  const me = await currentUser(req, s);
  if (!me) return fail(401, 'Giriş gerekli.');
  if (m !== 'GET' && !sameOrigin(req)) return fail(403, 'İstek reddedildi.');
  if (!allowed(me, m, parts)) return fail(403, 'Bu işlem için yetkiniz yok (' + ROLES[me.role].label + ').');
  // Every change is written to the record of actions with the person who made it.
  const copy = m === 'GET' ? null : req.clone(), res = await adminRoutes(req, ctx, parts, url, s, me);
  if (copy && res.status < 400 && (res.headers.get('content-type') || '').includes('json')) {
    try { const line = await describe(s, parts, m, await body(copy), await res.clone().json()); if (line) await logAudit(s, me, line[0], line[1], line[2]); } catch (err) { console.error('audit', err); }
  }
  return res;
}

async function adminRoutes(req, ctx, parts, url, s, me) {
  const m = req.method;
  if (parts[0] === 'session') return json({ email: me.email, name: me.name, role: me.role, roleLabel: ROLES[me.role].label, screens: screens(me.role), readOnly: me.role === 'viewer', store: storeName() });
  if (parts[0] === 'me') return meRoute(req, parts, s, me);
  if (parts[0] === 'team') return teamRoute(req, parts, s);
  if (parts[0] === 'audit' && m === 'GET') return auditRoute(url, s);
  if (parts[0] === 'bookings') return bookingsRoute(req, parts, url, s, me);
  if (parts[0] === 'backups') return backupsRoute(req, parts, url, s, me);
  if (parts[0] === 'tickets') return ticketsAdmin(req, parts, url, s, me, ipOf(req, ctx));
  if (parts[0] === 'pnl') return pnlRoute(req, parts, s, me);
  if (parts[0] === 'inbox') return inboxRoute(req, parts, url, s, me);

  if (parts[0] === 'summary') {
    // One read for the Özet screen: what is waiting for a decision today, and how each upcoming event is doing.
    const evs = await all('events/'), td = istToday(), up = [], waiting = [], full = ['owner', 'manager', 'viewer'].includes(me.role), money = ['owner', 'manager'].includes(me.role);
    const day = (n) => new Date(Date.parse(td) + n * 864e5).toISOString().slice(0, 10), w1 = Date.now() - 7 * 864e5, w2 = Date.now() - 14 * 864e5;
    let pending = 0, approved = 0;
    for (const e of evs) {
      if (e.status !== 'published') continue;
      const rs = await rsvpsOf(e.id), c = counts(rs);
      pending += c.pending;
      if (c.pending) waiting.push({ id: e.id, title: e.title, date: e.date, pending: c.pending, oldest: rs.filter((r) => r.status === 'pending').map((r) => r.createdAt).sort()[0] || '' });
      if (e.date && (e.endDate || e.date) < td) continue;
      approved += c.approved;
      const v = adminEvent(e, rs), keys = full ? await s.list('hits/' + e.id + '/') : [], recent = (k) => k.split('/')[2] >= day(-6);
      v.daysLeft = e.date ? Math.round((Date.parse(e.date) - Date.parse(td)) / 864e5) : null;
      // requests in the last 7 days against the 7 before, plus page visits and ticket-link clicks of the last 7 days (clicks are not sales)
      v.pace = { last7: rs.filter((r) => Date.parse(r.createdAt) >= w1).length, prev7: rs.filter((r) => Date.parse(r.createdAt) < w1 && Date.parse(r.createdAt) >= w2).length, views7: keys.filter((k) => recent(k) && k.split('/')[3] === 'view').length, clicks7: keys.filter((k) => recent(k) && k.split('/')[3] === 'ticket').length };
      v.sales = full ? await eventSales(s, e.id) : null; // tickets sold here: count, net revenue and the 7-day pace
      up.push(v);
    }
    const out = { role: me.role, name: me.name, upcoming: up.sort((a, b) => (a.date || '9').localeCompare(b.date || '9')), waiting: waiting.sort((a, b) => (a.oldest || '').localeCompare(b.oldest || '')), pendingRsvps: pending, approvedGuests: approved,
      newEnquiries: 0, unreadMessages: 0, openTasks: 0, overdueTasks: 0, drafts: 0, tasks: [], unpublished: [], enquiries: [], payments: null, offers: null, activeBookings: null };
    if (full) {
      const open = (await all('tasks/')).filter((x) => x.status !== 'done'), enq = (await all('enquiries/')).filter((x) => x.status === 'new').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), title = new Map(evs.map((e) => [e.id, e.title]));
      Object.assign(out, { newEnquiries: enq.length, unreadMessages: await unreadThreads(), openTasks: open.length, overdueTasks: open.filter((x) => x.due && x.due < td).length, drafts: evs.filter((e) => e.status === 'draft').length,
        tasks: open.filter((x) => x.due && x.due <= day(7)).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 12).map((x) => ({ id: x.id, title: x.title, due: x.due, late: x.due < td, assignee: x.assignee, priority: x.priority, eventId: x.eventId, event: title.get(x.eventId) || '' })),
        unpublished: evs.filter((e) => e.status === 'published' && isDirty(e)).map((e) => ({ id: e.id, title: e.title })),
        enquiries: enq.slice(0, 5).map((q) => ({ id: q.id, name: q.name, kind: q.kindLabel, at: q.createdAt })) });
    }
    if (money) { const al = await bookingAlerts(14); out.payments = al.payments; out.offers = al.offers; out.activeBookings = al.active; }
    return json(out);
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
      const sample = { name: 'Ada Yılmaz', email: 'ada@example.com', guests: 1, passToken: 'ornek', offer: { token: 'ornek' } }, pm = passMail(e, sample, url.origin), ws = await waSettings(s), iv = e.invite || {};
      const pv = (key, label, on, m) => ({ key, label, on, subject: m.subject, html: m.html });
      return json({ email: { status: emailStatus(), pass: { subject: pm.subject, html: pm.html }, all: [pv('pass', 'Giriş kartı (onayda)', true, pm), pv('d1', 'Hatırlatma: bir gün önce', iv.reminders !== false, reminderMail(e, sample, url.origin, 'd1')), pv('h4', 'Hatırlatma: son 4 saat', iv.reminders !== false, reminderMail(e, sample, url.origin, 'h4')), pv('offer', 'Bekleme listesi: yer açıldı', iv.autoWaitlist === true, offerMail(e, sample, url.origin)), pv('thanks', 'Teşekkür (ertesi gün)', iv.thanks !== false, thanksMail(e, sample, url.origin))] }, whatsapp: { status: waStatus(), inviteReady: !!(ws.invite.projectId && ws.invite.version), passReady: !!(ws.pass.projectId && ws.pass.version), invite: invitePreview(e, sample), pass: passParams(e, sample) } });
    }
    if (['invite-sends', 'invite-send', 'invite-tracking', 'invite-links.csv'].includes(parts[2])) return inviteRoute(req, s, e, url, parts[2]);
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

  // The same run the schedule makes in production; here so it can be tried on a preview.
  if (parts[0] === 'automation' && parts[1] === 'run' && m === 'POST') return json(await runSchedule(s, url.origin));
  if (parts[0] === 'rsvps.csv') {
    const e = await s.get('events/' + str(url.searchParams.get('event'), 40)); if (!e) return fail(404, 'Etkinlik bulunamadı.');
    const st = url.searchParams.get('status') || '', q = (url.searchParams.get('q') || '').toLocaleLowerCase('tr');
    const rows = (await rsvpsOf(e.id)).filter((r) => (!st || (st === 'checkedin' ? !!r.checkedInAt : r.status === st)) && (!q || (r.name + ' ' + r.email + ' ' + r.phone).toLocaleLowerCase('tr').includes(q))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return csv('misafir-' + e.slug + '.csv', [['Ad Soyad', 'E-posta', 'Telefon', 'Kişi', 'Durum', 'Not', 'Başvuru', 'Karar', 'Giriş', 'Kaynak', 'Kampanya', 'Davet eden']].concat(rows.map((r) => [r.name, r.email, r.phone, r.guests, r.checkedInAt ? 'giriş yaptı' : r.status, r.note, r.createdAt, r.decidedAt, r.checkedInAt, (r.utm && r.utm.source) || '', (r.utm && r.utm.campaign) || '', r.via === 'venue' ? 'Mekân: ' + (r.invitedBy || '') : r.via === 'forward' ? 'İletti: ' + (r.forwardedByName || '') : r.personal ? 'Kişisel link' : ''])));
  }
  if (parts[0] === 'rsvps' && parts[1]) {
    const e = await s.get('events/' + parts[1]); if (!e) return fail(404, 'Etkinlik bulunamadı.');
    const rs = await rsvpsOf(e.id);
    if (!parts[2] && m === 'GET') {
      // the door role gets what a door link gets: approved guests, name and party size only
      if (me.role === 'door') return json({ event: { id: e.id, title: e.title, date: e.date, venue: e.venue, status: e.status, counts: counts(rs) }, rsvps: rs.filter((r) => r.status === 'approved').map((r) => ({ ...doorGuest(r), status: r.status, email: '', phone: '' })), tickets: (await eventTickets(e.id)).map(ticketGuest), email: { connected: false }, whatsapp: { connected: false } });
      return json({ event: adminEvent(e, rs), rsvps: rs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), tickets: (await eventTickets(e.id)).map((x) => ({ ...ticketGuest(x), email: x.email })), email: emailStatus(), whatsapp: { ...waStatus(), table: !!(await waSettings(s)).table.projectId } });
    }
    let freed = false;
    const decide = async (r, dec) => {
      r.decidedBy = me.name;
      if (dec === 'approved') return approve(s, e, r, url.origin);
      if (r.status === 'approved') freed = true;
      r.status = dec; r.decidedAt = now(); delete r.offer;
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
      if (freed) await offerNext(s, e, url.origin);
      return json({ ok: true, ...info });
    }
    const r = rs.find((x) => x.id === parts[2]); if (!r) return fail(404, 'Başvuru bulunamadı.');
    if (parts[3] === 'send-pass-wa' && m === 'POST') {
      if (r.status !== 'approved' || !r.passToken) return fail(400, 'Giriş kartı yalnızca onaylı başvuruya gönderilir.');
      if (!waStatus().connected) return fail(409, 'WhatsApp bağlı değil.');
      if (!r.phone) return fail(400, 'Bu başvuruda telefon numarası yok.');
      r.wa = await sendPassWa(s, live(e) || e, r, url.origin); await s.set('rsvps/' + e.id + '/' + r.id, r);
      return r.wa.status === 'sent' ? json({ rsvp: r }) : fail(502, 'WhatsApp gönderilemedi: ' + (r.wa.error || ''), { rsvp: r });
    }
    // The table page of this event, to an approved guest: by WhatsApp (needs its own approved template) or by e-mail.
    if (parts[3] === 'send-table' && m === 'POST') {
      const ch = (await body(req)).channel === 'wa' ? 'wa' : 'mail';
      if (r.status !== 'approved') return fail(400, 'Masa linki yalnızca onaylı misafire gönderilir.');
      if (ch === 'wa') {
        if (!waStatus().connected) return fail(409, 'WhatsApp bağlı değil.');
        if (!r.phone) return fail(400, 'Bu başvuruda telefon numarası yok.');
        r.tableWa = await sendTableWa(s, live(e) || e, r); await s.set('rsvps/' + e.id + '/' + r.id, r);
        return r.tableWa.status === 'sent' ? json({ rsvp: r }) : fail(502, 'WhatsApp gönderilemedi: ' + (r.tableWa.error || ''), { rsvp: r });
      }
      if (!emailStatus().connected) return fail(409, 'E-posta servisi bağlı değil.');
      r.tableMail = await sendTable(live(e) || e, r, url.origin); await s.set('rsvps/' + e.id + '/' + r.id, r);
      return r.tableMail.status === 'sent' ? json({ rsvp: r }) : fail(502, 'E-posta gönderilemedi: ' + (r.tableMail.error || ''), { rsvp: r });
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
      if (freed) await offerNext(s, e, url.origin);
      return json({ rsvp: r });
    }
    return fail(404, 'Bulunamadı.');
  }

  if (parts[0] === 'checkin' && m === 'POST') {
    const b = await body(req), f = await findPass(s, b, str(b.eventId, 40));
    if (f.out) return json(f.r ? { ...f.out, rsvp: me.role === 'door' ? doorGuest(f.r) : f.r } : f.out);
    const o = await checkIn(s, f.r, !!b.undo, me.name);
    return json(me.role === 'door' ? { ...o, rsvp: doorGuest(o.rsvp) } : o);
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

  if (parts[0] === 'venue-links' && !parts[2]) return venueAdmin(req, s, url, me, parts[1] || '');

  return admin2(req, ctx, parts, url, s, { seoSettings, adminEvent, rsvpsOf, me });
}

/* ---------- router ---------- */
export default async function handler(req, ctx) {
  try { return await route(req, ctx); }
  finally { try { await flushDirty(); } catch (err) { console.error('stamp', err); } } // contact snapshot learns about this request's writes
}
async function route(req, ctx) {
  const url = new URL(req.url), parts = url.pathname.split('/').filter(Boolean);
  setDeployContext((ctx && ctx.deploy && ctx.deploy.context) || process.env.CONTEXT);
  try {
    const s = await store();
    await migrate(s, storeName());
    const miss = missingConfig();
    if (!miss.length) await initSecret(s);
    if (parts[0] === 'hq') {
      if (miss.length) return gated('<!doctype html><meta charset="utf-8"><title>More Life HQ</title><body style="font-family:system-ui;background:#0E0B0A;color:#F3EEE6;padding:40px"><h1>HQ henüz yapılandırılmadı</h1><p>Netlify’da şu ortam değişkenlerini tanımlayın: ' + miss.join(', ') + '</p></body>', 503);
      return gated(!url.searchParams.get('kur') && await currentUser(req, s) ? APP_HTML : LOGIN_HTML, 200);
    }
    if (parts[0] === 'api' && parts[1] === 'hq') {
      if (miss.length) return fail(503, 'HQ yapılandırılmadı: ' + miss.join(', '));
      return await adminApi(req, ctx, parts.slice(2), url);
    }
    if (parts[0] === 'api' && parts[1] === 'public') return await publicApi(req, ctx, parts.slice(2), url);
    if (parts[0] === 'api' && parts[1] === 'door') return await doorApi(req, ctx, parts.slice(2), url);
    if (parts[0] === 'pay' && parts[1] === 'test') { const html = await testPayPage(s, url); return html ? page(html, 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }) : new Response(null, { status: 303, headers: { location: url.searchParams.get('o') ? '/order?t=' + encodeURIComponent(url.searchParams.get('o')) : '/' } }); }
    if (parts[0] === 'door') return page(DOOR_HTML, 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method not allowed');
    return await publicPage(req, url, parts);
  } catch (err) {
    console.error(err);
    if (url.pathname === '/') { const { SITE_HTML } = await import('./lib/site-html.mjs'); return page(SITE_HTML, 200); } // never take the home page down with the database
    return parts[0] === 'api' ? fail(500, 'Sunucu hatası.') : page(notFound('Something went wrong.', 'Please try again in a moment.'), 500, { 'x-robots-tag': 'noindex' });
  }
}
