// Sending an event's invitation to a CRM audience by WhatsApp and e-mail.
// Each person gets each channel at most once per event: `sent/<event>/c-<contact>/invite-<channel>` is an atomic claim,
// released again if the provider refuses the message so it can be retried.
import { all, pool } from './store.mjs';
import { json, fail, now, str, int, body, normPhone } from './util.mjs';
import { live } from './model.mjs';
import { audienceMembers } from './admin2.mjs';
import { emailStatus, sendInvite, inviteMail } from './email.mjs';
import { waStatus, waSettings, waSend, inviteParams } from './whatsapp.mjs';

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
    if (t.wa) await one(t.c, 'wa', () => waSend(s, t.c.phone, rd.tpl, inviteParams(le, t.c, url.origin, e.inviteToken)));
    if (t.mail) await one(t.c, 'mail', () => sendInvite(le, t.c, url.origin, e.inviteToken));
  });
  return json({ sent, failed, skip: plan.skip, total: mem.length, next: to < mem.length ? to : null });
}
