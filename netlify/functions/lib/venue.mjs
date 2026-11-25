// Venue portal: one private link per venue. Whoever holds it sees, for every published event at that venue that has not
// passed, who is coming and who has a table: names, party size, table and whether they are in. No e-mail, phone, notes,
// prices paid or anything from another venue. The link is made, renewed and closed in HQ.
import { all } from './store.mjs';
import { token, hash } from './auth.mjs';
import { json, fail, now, str, body, istToday, slugify } from './util.mjs';
import { live } from './model.mjs';
import { eventTickets } from './tickets.mjs';

// "Lucca Beach", "lucca beach " and "LUCCA BEACH" are one venue.
export const venueKey = (v) => slugify(str(v, 160));
const linkOf = async (s, key) => { const ref = key && await s.get('vvenue/' + hash(key)), l = ref && await s.get('vlinks/' + ref.token); return l && l.key === key ? l : null; };
// Shown until two days after the event, like a door link.
const current = (e) => !e.date || istToday() <= new Date(Date.parse(e.endDate || e.date) + 2 * 864e5).toISOString().slice(0, 10);
const eventsAt = async (key) => (await all('events/')).filter((e) => e.status === 'published' && e.live && venueKey(e.live.venue) === key && current(e.live))
  .sort((a, b) => (a.live.date || '9').localeCompare(b.live.date || '9'));

// Everything the venue sees about one event.
async function detail(e0, enquiries) {
  const rs = (await all('rsvps/' + e0.id + '/')).filter((r) => r.status === 'approved'), ts = await eventTickets(e0.id);
  // A bought table is one unit of stock: its tickets share an order and a slot. A unit that admits several people
  // (a table sold by number, without a plan) is a table too; everything else is one person with one ticket.
  const groups = new Map(), single = [];
  for (const t of ts.filter((x) => !x.addon)) { if (!t.slot && !t.table) { single.push(t); continue; } const k = t.orderId + '|' + (t.slot || t.table); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const tables = [];
  for (const g of groups.values()) {
    if (g.length < 2 && !g[0].table) { single.push(g[0]); continue; }
    g.sort((x, y) => (x.seq || 0) - (y.seq || 0));
    const t = g[0], cut = ' · ' + t.table, due = g.reduce((n, x) => n + (x.due || 0), 0);
    tables.push({ label: t.table || '', area: t.table && t.typeName.endsWith(cut) ? t.typeName.slice(0, -cut.length) : t.typeName, name: t.name, people: g.length, in: g.filter((x) => x.checkedInAt).length, ...(due ? { due: Math.round(due * 100) / 100, currency: t.currency || '' } : {}) });
  }
  tables.sort((x, y) => (x.label || '~').localeCompare(y.label || '~', 'tr', { numeric: true }) || x.name.localeCompare(y.name, 'tr'));
  // a table asked for on the table page and confirmed in HQ has no ticket; it is held under a name
  const held = enquiries.filter((q) => q.kind === 'table' && q.eventId === e0.id && q.table && q.table.status === 'confirmed')
    .map((q) => ({ label: '', area: q.table.area === 'backstage' ? 'backstage' : 'standard', name: q.name, people: q.table.party || q.party || 1, in: null, request: true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  // tickets of one order in the same name and type are one row ("Deniz Arslan · General · 2 people")
  const rows = new Map();
  for (const t of single) { const k = t.orderId + '|' + t.typeId + '|' + t.name, r = rows.get(k) || { name: t.name, people: 0, in: 0, type: t.typeName }; r.people += 1; r.in += t.checkedInAt ? 1 : 0; rows.set(k, r); }
  const guests = rs.map((r) => ({ name: r.name, people: r.guests || 1, in: r.checkedInAt ? r.guests || 1 : 0, list: true })).concat([...rows.values()])
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0), all2 = tables.concat(held);
  const counts = {
    tables: all2.length, tablePeople: sum(all2, (x) => x.people),
    list: sum(guests.filter((g) => g.list), (g) => g.people), tickets: sum(guests.filter((g) => !g.list), (g) => g.people),
    in: sum(tables, (x) => x.in) + sum(guests, (g) => g.in)
  };
  counts.expected = counts.tablePeople + counts.list + counts.tickets;
  return { tables: all2, guests, counts };
}
const head = (e0) => { const e = live(e0); return { id: e0.id, title: e.title, artist: e.artist || '', date: e.date || '', time: e.time || '', doors: e.doors || '', city: e.city || '' }; };

/* ---------- the portal itself: GET /api/public/venue?k=<key>[&e=<event id>] ---------- */
export async function venuePublic(req, s, url, limitedNow) {
  if (req.method !== 'GET') return fail(405, 'Method not allowed');
  const k = str(url.searchParams.get('k'), 60).replace(/[^A-Za-z0-9_-]/g, ''), l = k && await s.get('vlinks/' + k);
  if (await limitedNow()) return fail(429, 'Too many requests. Please try again in a few minutes.');
  if (!l || !l.key) return fail(404, 'This link is not valid.');
  const evs = await eventsAt(l.key), enquiries = evs.length ? await all('enquiries/') : [], out = [];
  for (const e0 of evs) out.push({ ...head(e0), d: await detail(e0, enquiries) });
  const want = str(url.searchParams.get('e'), 40), pick = out.find((x) => x.id === want) || out.find((x) => !x.date || x.date >= istToday()) || out[out.length - 1] || null;
  return json({ venue: l.venue, at: now(), events: out.map(({ d, ...x }) => ({ ...x, counts: d.counts })), event: pick ? { id: pick.id, tables: pick.d.tables, guests: pick.d.guests } : null });
}

/* ---------- HQ: /api/hq/venue-links ---------- */
// GET ?venue=<name> → the link of that venue (or none) · GET → every link · POST { venue, close } → make / renew / close
export async function venueAdmin(req, s, url, me) {
  const m = req.method, view = async (l) => ({ venue: l.venue, url: '/venue?k=' + l.token, createdAt: l.createdAt, by: l.by || '', events: (await eventsAt(l.key)).length });
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
    if (old) await s.del('vlinks/' + old.token); // the old link stops working at once
    if (b.close) { await s.del('vvenue/' + hash(key)); return json({ venue: old ? old.venue : venue, link: null, closed: true }); }
    const l = { token: token(24), venue, key, createdAt: now(), by: (me && me.name) || '' };
    await s.set('vlinks/' + l.token, l); await s.set('vvenue/' + hash(key), { token: l.token });
    return json({ venue, link: await view(l), renewed: !!old }, 201);
  }
  return fail(405, 'Method not allowed');
}
