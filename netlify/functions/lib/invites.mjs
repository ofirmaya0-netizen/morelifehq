// Sending an event's invitation to a CRM audience by WhatsApp and e-mail.
// Each person gets each channel at most once per event: `sent/<event>/c-<contact>/invite-<channel>` is an atomic claim,
// released again if the provider refuses the message so it can be retried.
import { all, pool } from './store.mjs';
import { json, fail, now, str, int, body, normPhone, csv } from './util.mjs';
import { live } from './model.mjs';
import { audienceMembers } from './admin2.mjs';
import { emailStatus, sendInvite, inviteMail } from './email.mjs';
import { waStatus, waSettings, waSend, inviteParams } from './whatsapp.mjs';
import { token, id } from './auth.mjs';
import { inviteGen } from './venue.mjs';
import { normEmail } from './util.mjs';

/* ---------- personal invitation links ---------- */
// Every person an invitation is sent to gets their own key for the same invitation page (`/invite?t=<key>`), so a request
// that comes in through it is known to be theirs, or, when somebody else's details are on it, forwarded by them.
// `pinv/<event>/<contact>` holds the key; `invites/<key>` → { eventId, contactId, g } opens the page.
export async function personalToken(s, e, c) {
  const g = inviteGen(e), old = await s.get('pinv/' + e.id + '/' + c.id);
  if (old && old.g === g) return old.token;
  const rec = { contactId: c.id, name: c.name || '', token: token(24), g, createdAt: now() };
  await s.set('invites/' + rec.token, { eventId: e.id, contactId: c.id, g }); await s.set('pinv/' + e.id + '/' + c.id, rec);
  return rec.token;
}
// The CRM person whose link this key is, or null (the event's shared link, a venue's link, an old key).
export async function personalOf(s, e0, t) {
  const ref = t && t !== e0.inviteToken ? await s.get('invites/' + t) : null;
  if (!ref || !(ref.contactId || ref.rsvpId) || ref.eventId !== e0.id || ref.g !== inviteGen(e0)) return null;
  if (ref.rsvpId) { const o = await s.get('rsvps/' + e0.id + '/' + ref.rsvpId); return o ? { rsvp: true, id: o.id, name: o.name, email: o.email, phone: o.phone } : null; } // the link of somebody who asked for a place
  return (await s.get('contacts/' + ref.contactId)) || { id: ref.contactId, name: ((await s.get('pinv/' + e0.id + '/' + ref.contactId)) || {}).name || '', email: '', phone: '' };
}
const foldName = (n) => str(n, 120).toLocaleLowerCase('tr').replace(/\s+/g, ' ');
// Marks a new request made through a personal link: the invited person's own, or forwarded by them to somebody else.
export function markPersonal(r, c) {
  // through the link of a guest (not a CRM person): the next ring of the chain. `referredBy` is that guest's request.
  if (c.rsvp) { r.via = 'forward'; r.referredBy = c.id; r.forwardedByName = c.name || ''; return; }
  r.inviteOf = c.id;
  const self = (c.email && normEmail(c.email) === r.email) || (r.phone && c.phone && normPhone(c.phone) === normPhone(r.phone)) || (c.name && foldName(c.name) === foldName(r.name));
  if (self) r.personal = true; else { r.via = 'forward'; r.forwardedBy = c.id; r.forwardedByName = c.name || ''; }
}
// Everybody who asks for a place gets a link of their own to pass on, so the chain goes on past the first ring:
// a CRM person keeps the link they were sent; anybody else gets a new key (`invites/<key>` → { eventId, rsvpId, g }).
export async function shareToken(s, e0, r, ownKey) {
  const g = inviteGen(e0);
  if (r.shareToken && r.shareG === g) return r.shareToken;
  r.shareG = g; r.shareToken = ownKey || token(24);
  if (!ownKey) await s.set('invites/' + r.shareToken, { eventId: e0.id, rsvpId: r.id, g });
  return r.shareToken;
}
export const shareUrl = (e0, r) => (r.shareToken && r.shareG === inviteGen(e0) && (e0.invite || {}).enabled !== false ? '/invite?t=' + r.shareToken : '');
export const personalOpen = (s, e0, contactId) => s.set('pinvhits/' + e0.id + '/' + contactId + '/' + id(), { at: now() });


export const OPT_OUT = 'mesaj-istemiyor'; // contacts with this tag are never messaged
const key = (e, c, ch) => 'sent/' + e.id + '/c-' + c.id + '/invite-' + ch;
const phoneOk = (c) => /^\+\d{8,15}$/.test(normPhone(c.phone || ''));

async function ready(s, e) {
  const ws = await waSettings(s), wa = waStatus().connected && !!(ws.invite.projectId && ws.invite.version), mail = emailStatus().connected;
  const block = !live(e) ? 'Etkinlik henüz yayınlanmadı. Davet göndermek için önce yayınlayın.' : (e.invite || {}).enabled === false ? 'Bu etkinliğin davet linki kapalı. “Davet Ayarları”ndan açın.' : '';
  return { wa, mail, waWhy: wa ? '' : waStatus().connected ? 'Davet şablonu Ayarlar’da tanımlı değil.' : 'WhatsApp bağlı değil.', mailWhy: mail ? '' : 'E-posta servisi bağlı değil.', block, tpl: ws.invite };
}

export async function inviteRoute(req, s, e, url, sub) {
  const m = req.method, rd = await ready(s, e);
  if (sub === 'invite-sends' && m === 'GET') {
    const keys = await s.list('sent/' + e.id + '/c-'), auds = (await all('audiences/')).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const sample = { name: 'Ada Yılmaz', email: 'ada@example.com' }, pm = inviteMail(live(e) || e, sample, url.origin, e.inviteToken);
    return json({ audiences: auds.map((a) => ({ id: a.id, name: a.name })), sent: { wa: keys.filter((k) => k.endsWith('/invite-wa')).length, mail: keys.filter((k) => k.endsWith('/invite-mail')).length }, ready: { wa: rd.wa, mail: rd.mail, waWhy: rd.waWhy, mailWhy: rd.mailWhy, block: rd.block }, optOutTag: OPT_OUT, mail: { subject: pm.subject, html: pm.html } });
  }
  // Who was sent a personal link, how often it was opened, whether they asked for a place and who they passed it on to.
  if (sub === 'invite-tracking' && m === 'GET') {
    const g = inviteGen(e), links = (await all('pinv/' + e.id + '/')).filter((l) => l.g === g).map((l) => ({ ...l })), rs = await all('rsvps/' + e.id + '/'), hits = await s.list('pinvhits/' + e.id + '/'), sentKeys = new Set(await s.list('sent/' + e.id + '/c-'));
    const opens = {}; for (const k of hits) { const c = k.split('/')[2]; opens[c] = (opens[c] || 0) + 1; }
    // the chain: a request made through a guest's own link points at that guest's request (`referredBy`)
    const kids = {}; for (const r of rs) if (r.via === 'forward' && r.referredBy) (kids[r.referredBy] = kids[r.referredBy] || []).push(r);
    let chained = 0, deepest = 0, passers = 0;
    const node = (r, depth, seen) => { deepest = Math.max(deepest, depth); const ch = seen.has(r.id) ? [] : (kids[r.id] || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); seen.add(r.id); chained += ch.length; if (ch.length) passers += 1; return { id: r.id, name: r.name, status: r.status, guests: r.guests, at: r.createdAt, opens: opens['r-' + r.id] || 0, children: ch.map((x) => node(x, depth + 1, seen)) }; };
    const rows = links.map((l) => {
      const own = rs.find((r) => r.inviteOf === l.contactId && r.via !== 'forward'), fw = rs.filter((r) => r.forwardedBy === l.contactId).concat(own ? kids[own.id] || [] : []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { contactId: l.contactId, name: l.name, url: '/invite?t=' + l.token, sent: { wa: sentKeys.has('sent/' + e.id + '/c-' + l.contactId + '/invite-wa'), mail: sentKeys.has('sent/' + e.id + '/c-' + l.contactId + '/invite-mail') }, opens: opens[l.contactId] || 0, own: own ? { id: own.id, status: own.status, guests: own.guests } : null, forwarded: fw.map((r) => node(r, 1, new Set(own ? [own.id] : []))) };
    })
      // people who came through the shared link (or were added by hand) and passed their own link on
      .concat(rs.filter((r) => kids[r.id] && r.via !== 'forward' && !r.inviteOf).map((r) => ({ guest: true, contactId: '', name: r.name, url: shareUrl(e, r), sent: { wa: false, mail: false }, opens: opens['r-' + r.id] || 0, own: { id: r.id, status: r.status, guests: r.guests }, forwarded: node(r, 0, new Set()).children })))
      .sort((a, b) => b.forwarded.length - a.forwarded.length || b.opens - a.opens || a.name.localeCompare(b.name, 'tr'));
    const mine = rows.filter((x) => !x.guest);
    return json({ rows, totals: { links: mine.length, opened: mine.filter((x) => x.opens).length, applied: mine.filter((x) => x.own).length, forwarders: mine.filter((x) => x.forwarded.length).length + passers, forwarded: mine.reduce((n, x) => n + x.forwarded.length, 0) + chained, rings: deepest } });
  }
  // Makes the personal links of a whole audience without sending anything (for invitations sent by hand): name, phone, link.
  if (sub === 'invite-links.csv' && m === 'GET') {
    const a = await s.get('audiences/' + str(url.searchParams.get('audience'), 40)); if (!a) return fail(404, 'Kitle bulunamadı.');
    if (rd.block) return fail(409, rd.block);
    const rows = []; for (const c of (await audienceMembers(a)).sort((x, y) => (x.name || '').localeCompare(y.name || '', 'tr'))) { if ((c.tags || []).includes(OPT_OUT)) continue; rows.push([c.name, c.phone || '', c.email || '', url.origin + '/invite?t=' + await personalToken(s, e, c)]); }
    return csv('kisisel-davet-linkleri-' + e.slug + '.csv', [['Ad Soyad', 'Telefon', 'E-posta', 'Kişisel davet linki']].concat(rows));
  }
  if (sub !== 'invite-send' || m !== 'POST') return fail(405, 'Desteklenmiyor.');
  const b = await body(req), a = await s.get('audiences/' + str(b.audienceId, 40)); if (!a) return fail(404, 'Kitle bulunamadı.');
  const want = { wa: !!(b.channels && b.channels.wa), mail: !!(b.channels && b.channels.mail) };
  if (!want.wa && !want.mail) return fail(400, 'En az bir kanal seçin.');
  if (rd.block) return fail(409, rd.block);
  if (want.wa && !rd.wa) return fail(409, rd.waWhy); if (want.mail && !rd.mail) return fail(409, rd.mailWhy);
  const mem = (await audienceMembers(a)).sort((x, y) => x.id.localeCompare(y.id)), rs = await all('rsvps/' + e.id + '/');
  const applied = new Set(), done = new Set(await s.list('sent/' + e.id + '/c-'));
  for (const r of rs) { if (r.contactId) applied.add(r.contactId); if (r.email) applied.add(r.email); }
  const dry = !!b.dryRun, from = dry ? 0 : int(b.from, 0, mem.length), to = dry ? mem.length : Math.min(mem.length, from + int(b.size, 1, 25, 10));
  const plan = { wa: 0, mail: 0, people: 0, skip: { optOut: 0, applied: 0, already: 0, noContact: 0, badPhone: 0 } }, todo = [];
  for (const c of mem.slice(from, to)) {
    if ((c.tags || []).includes(OPT_OUT)) { plan.skip.optOut += 1; continue; }
    if (applied.has(c.id) || (c.email && applied.has(c.email))) { plan.skip.applied += 1; continue; }
    const hasWa = want.wa && phoneOk(c), hasMail = want.mail && !!c.email;
    const wa = hasWa && !done.has(key(e, c, 'wa')), mail = hasMail && !done.has(key(e, c, 'mail'));
    if (want.wa && c.phone && !phoneOk(c)) plan.skip.badPhone += 1;
    if (!wa && !mail) { plan.skip[hasWa || hasMail ? 'already' : 'noContact'] += 1; continue; }
    plan.people += 1; if (wa) plan.wa += 1; if (mail) plan.mail += 1; todo.push({ c, wa, mail });
  }
  if (dry) return json({ audience: { id: a.id, name: a.name, count: mem.length }, plan, sample: todo.slice(0, 6).map((t) => t.c.name) });
  const le = live(e), sent = { wa: 0, mail: 0 }, failed = [];
  const one = async (c, ch, go) => {
    if (!(await s.create(key(e, c, ch), { at: now(), audienceId: a.id }))) return; // another run got there first
    const r = await go();
    if (r.status === 'sent') { sent[ch] += 1; await s.set(key(e, c, ch), { at: r.at, id: r.id || '', audienceId: a.id }); }
    else { await s.del(key(e, c, ch)); failed.push({ name: c.name, channel: ch, error: r.error || 'Gönderilemedi.' }); }
  };
  await pool(todo, 2, async (t) => { // two at a time keeps under the mail provider's per-second limit
    const pt = await personalToken(s, e, t.c); // each person's own link, so what comes back can be traced to them
    if (t.wa) await one(t.c, 'wa', () => waSend(s, t.c.phone, rd.tpl, inviteParams(le, t.c, url.origin, pt)));
    if (t.mail) await one(t.c, 'mail', () => sendInvite(le, t.c, url.origin, pt));
  });
  return json({ sent, failed, skip: plan.skip, total: mem.length, next: to < mem.length ? to : null });
}
