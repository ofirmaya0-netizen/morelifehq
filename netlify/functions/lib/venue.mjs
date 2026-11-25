// Venue portal: one private link per venue. Whoever holds it sees, for every published event at that venue that has not
// passed, who is coming and who has a table: names, party size, table and whether they are in. No e-mail, phone, notes,
// prices paid or anything from another venue. Unless HQ switches it off, the venue's door staff can also open the QR
// reader of those events and check guests in. The link is made, renewed and closed in HQ.
import { all } from './store.mjs';
import { token, hash } from './auth.mjs';
import { json, fail, now, str, body, istToday, slugify } from './util.mjs';
import { live } from './model.mjs';
import { eventTickets } from './tickets.mjs';

// "Lucca Beach", "lucca beach " and "LUCCA BEACH" are one venue.
export const venueKey = (v) => slugify(str(v, 160));
const linkOf = async (s, key) => { const ref = key && await s.get('vvenue/' + hash(key)), l = ref && await s.get('vlinks/' + ref.token); return l && l.key === key ? l : null; };
// The venue's own invitation link of an event (`events/<id>.venueInvite`, key also in `invites/`). It is a different key
// from More Life's invite link, so guests who ask through it are marked as the venue's; it works only while the venue's
// portal link exists and its invitations are not switched off in HQ.
// Personal links (lib/invites.mjs) belong to one generation of the event's invite key: renewing that key in HQ ends them too.
export const inviteGen = (e0) => hash(e0.inviteToken || '').slice(0, 12);
export async function inviteOk(s, e0, t) {
  if (!t || !e0) return false;
  if (e0.inviteToken === t) return true;
  const v = e0.venueInvite;
  if (!v || v.token !== t) { const ref = await s.get('invites/' + t); return !!(ref && ref.contactId && ref.eventId === e0.id && ref.g === inviteGen(e0)); } // one person's own link
  const l = await linkOf(s, venueKey((e0.live || e0).venue)); return !!l && l.invite !== false;
}
export const venueOfInvite = (e0, t) => (e0 && e0.venueInvite && e0.venueInvite.token === t ? e0.venueInvite.venue : '');
// Shown until two days after the event, like a door link.
const current = (e) => !e.date || istToday() <= new Date(Date.parse(e.endDate || e.date) + 2 * 864e5).toISOString().slice(0, 10);
const eventsAt = async (key) => (await all('events/')).filter((e) => e.status === 'published' && e.live && venueKey(e.live.venue) === key && current(e.live))
  .sort((a, b) => (a.live.date || '9').localeCompare(b.live.date || '9'));

// Everything the venue sees about one event.
// Notes are what More Life writes for the venue about one table (birthday, bottles ordered ahead, VIP). They live in
// `vnotes/<event>/<table key>`; what a guest wrote in a form is never passed on.
const CAP_NEAR = 0.9; // the portal and HQ warn from 90 % of the event's capacity
async function detail(e0, enquiries, hq) {
  const rsAll = await all('rsvps/' + e0.id + '/'), rs = rsAll.filter((r) => r.status === 'approved'), ts = await eventTickets(e0.id);
  // A bought table is one unit of stock: its tickets share an order and a slot. A unit that admits several people
  // (a table sold by number, without a plan) is a table too; everything else is one person with one ticket.
  const notes = new Map((await all('vnotes/' + e0.id + '/')).map((n) => [n.key, n.note]));
  const groups = new Map(), single = [];
  for (const t of ts.filter((x) => !x.addon)) { if (!t.slot && !t.table) { single.push(t); continue; } const k = t.orderId + '|' + (t.slot || t.table); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const tables = [];
  for (const g of groups.values()) {
    if (g.length < 2 && !g[0].table) { single.push(g[0]); continue; }
    g.sort((x, y) => (x.seq || 0) - (y.seq || 0));
    const t = g[0], cut = ' · ' + t.table, due = g.reduce((n, x) => n + (x.due || 0), 0);
    tables.push({ key: 't-' + hash(t.orderId + '|' + (t.slot || t.table)).slice(0, 20), label: t.table || '', area: t.table && t.typeName.endsWith(cut) ? t.typeName.slice(0, -cut.length) : t.typeName, name: t.name, people: g.length, in: g.filter((x) => x.checkedInAt).length, ...(due ? { due: Math.round(due * 100) / 100, currency: t.currency || '' } : {}) });
  }
  tables.sort((x, y) => (x.label || '~').localeCompare(y.label || '~', 'tr', { numeric: true }) || x.name.localeCompare(y.name, 'tr'));
  // a table asked for on the table page and confirmed in HQ has no ticket; it is held under a name
  const held = enquiries.filter((q) => q.kind === 'table' && q.eventId === e0.id && q.table && q.table.status === 'confirmed')
    .map((q) => ({ key: 'q-' + q.id, label: '', area: q.table.area === 'backstage' ? 'backstage' : 'standard', name: q.name, people: q.table.party || q.party || 1, in: null, request: true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  // tickets of one order in the same name and type are one row ("Deniz Arslan · General · 2 people")
  const rows = new Map();
  for (const t of single) { const k = t.orderId + '|' + t.typeId + '|' + t.name, r = rows.get(k) || { name: t.name, people: 0, in: 0, type: t.typeName }; r.people += 1; r.in += t.checkedInAt ? 1 : 0; rows.set(k, r); }
  const guests = rs.map((r) => ({ name: r.name, people: r.guests || 1, in: r.checkedInAt ? r.guests || 1 : 0, list: true, ...(r.via === 'venue' ? { yours: true } : {}) })).concat([...rows.values()])
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0), all2 = tables.concat(held).map(({ key, ...x }) => ({ ...(hq ? { key } : {}), ...x, ...(notes.get(key) ? { note: notes.get(key) } : hq ? { note: '' } : {}) }));
  const counts = {
    tables: all2.length, tablePeople: sum(all2, (x) => x.people),
    list: sum(guests.filter((g) => g.list), (g) => g.people), tickets: sum(guests.filter((g) => !g.list), (g) => g.people),
    in: sum(tables, (x) => x.in) + sum(guests, (g) => g.in)
  };
  counts.expected = counts.tablePeople + counts.list + counts.tickets;
  // what came through the venue's own invitation link: people approved, and requests More Life has not decided yet
  counts.yours = sum(rs.filter((r) => r.via === 'venue'), (r) => r.guests || 1); counts.yoursPending = rsAll.filter((r) => r.via === 'venue' && r.status === 'pending').length;
  // capacity is the event's own (HQ → Genel Bilgiler); `level` is what the venue and HQ are warned with
  const cap = e0.capacity > 0 ? e0.capacity : 0;
  if (cap) { counts.capacity = cap; counts.level = counts.in >= cap ? 'full' : counts.in >= cap * CAP_NEAR ? 'near' : ''; }
  return { tables: all2, guests, counts };
}
const head = (e0) => { const e = live(e0); return { id: e0.id, title: e.title, artist: e.artist || '', date: e.date || '', time: e.time || '', doors: e.doors || '', city: e.city || '' }; };

/* ---------- the portal itself: GET /api/public/venue?k=<key>[&e=<event id>] ---------- */
// POST { k, e } opens the QR reader of one of the venue's events: the venue's own door staff scan entry passes and
// tickets of that event only. It hands out the event's door link (made here if HQ has not made one yet), so the reader
// is the same screen More Life's door staff use, and it closes with the event like any door link.
export async function venuePublic(req, s, url, limitedNow) {
  if (req.method !== 'GET' && req.method !== 'POST') return fail(405, 'Method not allowed');
  const b = req.method === 'POST' ? await body(req) : null;
  const k = str(b ? b.k : url.searchParams.get('k'), 60).replace(/[^A-Za-z0-9_-]/g, ''), l = k && await s.get('vlinks/' + k);
  if (await limitedNow()) return fail(429, 'Too many requests. Please try again in a few minutes.');
  if (!l || !l.key) return fail(404, 'This link is not valid.');
  if (b) {
    const e0 = (await eventsAt(l.key)).find((x) => x.id === str(b.e, 40));
    if (!e0) return fail(404, 'This event is not available.');
    if (b.a === 'invite') { // the venue's own invitation link for this event
      if (l.invite === false) return fail(403, 'Invitations are switched off for this venue. Please ask More Life.');
      if ((e0.invite || {}).enabled === false) return fail(409, 'Invitations for this event are closed.');
      if (!(e0.venueInvite && e0.venueInvite.token)) { e0.venueInvite = { token: token(24), venue: l.venue, createdAt: now() }; e0.updatedAt = now(); await s.set('invites/' + e0.venueInvite.token, { eventId: e0.id, venue: true }); await s.set('events/' + e0.id, e0); }
      return json({ url: '/invite?t=' + e0.venueInvite.token });
    }
    if (l.scan === false) return fail(403, 'Scanning is switched off for this venue. Please ask More Life.');
    if (!(e0.door && e0.door.token)) { e0.door = { token: token(24), createdAt: now(), by: 'Mekân portalı' }; e0.updatedAt = now(); await s.set('doors/' + e0.door.token, { eventId: e0.id }); await s.set('events/' + e0.id, e0); }
    return json({ url: '/door?k=' + e0.door.token });
  }
  const evs = await eventsAt(l.key), enquiries = evs.length ? await all('enquiries/') : [], out = [];
  for (const e0 of evs) out.push({ ...head(e0), d: await detail(e0, enquiries) });
  const want = str(url.searchParams.get('e'), 40), pick = out.find((x) => x.id === want) || out.find((x) => !x.date || x.date >= istToday()) || out[out.length - 1] || null;
  return json({ venue: l.venue, scan: l.scan !== false, invite: l.invite !== false, at: now(), events: out.map(({ d, ...x }) => ({ ...x, counts: d.counts })), event: pick ? { id: pick.id, tables: pick.d.tables, guests: pick.d.guests } : null });
}

/* ---------- HQ: /api/hq/venue-links ---------- */
// GET ?venue=<name> → the link of that venue (or none) · GET → every link · POST { venue, close } → make / renew / close
// POST { venue, scan } or { venue, invite } → QR reading / the venue's invitation links on or off
export async function venueAdmin(req, s, url, me, sub) {
  const m = req.method;
  // Table notes for the venue: GET notes?event=<id> → the event's tables with their notes · PUT notes { event, key, note }
  if (sub === 'notes') {
    const b = m === 'PUT' ? await body(req) : null, e0 = await s.get('events/' + str(b ? b.event : url.searchParams.get('event'), 40).replace(/[^A-Za-z0-9_-]/g, ''));
    if (!e0) return fail(404, 'Etkinlik bulunamadı.');
    const d = await detail(e0, await all('enquiries/'), true);
    if (m === 'GET') return json({ tables: d.tables, counts: d.counts });
    if (m !== 'PUT') return fail(405, 'Method not allowed');
    const t = d.tables.find((x) => x.key === str(b.key, 60)), note = str(b.note, 200);
    if (!t) return fail(404, 'Masa bulunamadı.');
    if (note) await s.set('vnotes/' + e0.id + '/' + t.key, { key: t.key, note, at: now(), by: (me && me.name) || '' }); else await s.del('vnotes/' + e0.id + '/' + t.key);
    return json({ table: { ...t, note }, eventTitle: e0.title });
  }
  if (sub) return fail(404, 'Bulunamadı.');
  const view = async (l) => ({ venue: l.venue, scan: l.scan !== false, invite: l.invite !== false, url: '/venue?k=' + l.token, createdAt: l.createdAt, by: l.by || '', events: (await eventsAt(l.key)).length });
  if (m === 'GET') {
    const v = url.searchParams.get('venue');
    if (v != null) { const key = venueKey(v), l = await linkOf(s, key); return json({ venue: str(v, 160), link: l ? await view(l) : null, events: key ? (await eventsAt(key)).length : 0 }); }
    const ls = (await all('vlinks/')).sort((a, b) => a.venue.localeCompare(b.venue, 'tr')), links = []; for (const l of ls) links.push(await view(l));
    return json({ links });
  }
  if (m === 'POST') {
    const b = await body(req), venue = str(b.venue, 160), key = venueKey(venue);
    if (!key) return fail(400, 'Mekân adı gerekli.');
    const old = await linkOf(s, key);
    // QR reading on / off without changing the link
    const sw = ['scan', 'invite'].find((f) => typeof b[f] === 'boolean');
    if (sw && !b.close) { if (!old) return fail(404, 'Bu mekânın linki yok.'); old[sw] = b[sw]; await s.set('vlinks/' + old.token, old); return json({ venue: old.venue, link: await view(old), [sw]: b[sw] }); }
    if (old) await s.del('vlinks/' + old.token); // the old link stops working at once
    if (b.close) { await s.del('vvenue/' + hash(key)); return json({ venue: old ? old.venue : venue, link: null, closed: true }); }
    const l = { token: token(24), venue, key, createdAt: now(), by: (me && me.name) || '', ...(old && old.scan === false ? { scan: false } : {}), ...(old && old.invite === false ? { invite: false } : {}) };
    await s.set('vlinks/' + l.token, l); await s.set('vvenue/' + hash(key), { token: l.token });
    return json({ venue, link: await view(l), renewed: !!old }, 201);
  }
  return fail(405, 'Method not allowed');
}
