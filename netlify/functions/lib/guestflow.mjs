// What happens to a guest after the request: approval, self-cancellation, waitlist offers, reminders and the
// thank-you note. Shared by the admin API, the guest API and the scheduled run. Every automatic message is
// claimed with an atomic create first, so two overlapping runs never send the same one twice.
import { all } from './store.mjs';
import { now, isoIst } from './util.mjs';
import { live } from './model.mjs';
import { sendPass, sendReminder, sendOffer, sendThanks } from './email.mjs';
import { sendPassWa } from './whatsapp.mjs';
import { randomBytes } from 'node:crypto';

const token = (n) => randomBytes(n).toString('base64url');
const HOUR = 3600 * 1000;
export const OFFER_HOURS = 2;
const opt = (e, k, d) => { const v = (e.invite || {})[k]; return v == null ? d : !!v; };
export const startMs = (e) => (e.date ? Date.parse(isoIst(e.date, e.doors || e.time || '21:00')) : 0);
export const endMs = (e) => (e.endTime ? Date.parse(isoIst(e.endDate || e.date, e.endTime)) : startMs(e) + 6 * HOUR);

export async function approve(s, e, r, origin) {
  r.status = 'approved'; r.decidedAt = now(); delete r.offer;
  if (!r.passToken) { r.passToken = token(24); await s.set('passes/' + r.passToken, { eventId: e.id, rsvpId: r.id }); }
  if (!r.refCode) { r.refCode = token(6); await s.set('refs/' + r.refCode, { eventId: e.id, rsvpId: r.id }); }
  const le = live(e) || e;
  // the pass is e-mailed once on approval; a failed attempt is stored as failed, never as sent
  if (!(r.mail && r.mail.status === 'sent')) { const m = await sendPass(le, r, origin); if (m.status !== 'off') r.mail = m; }
  if (r.phone && !(r.wa && r.wa.status === 'sent')) { const w = await sendPassWa(s, le, r, origin); if (w.status !== 'off') r.wa = w; }
  await s.set('rsvps/' + e.id + '/' + r.id, r);
  return r;
}

// A freed place goes to the longest-waiting guest, who has OFFER_HOURS to take it. Only when the event has this switched on.
export async function offerNext(s, e, origin) {
  if (!opt(e, 'autoWaitlist', false) || e.status !== 'published' || (startMs(e) && Date.now() > startMs(e))) return null;
  const rs = await all('rsvps/' + e.id + '/');
  if (rs.some((r) => r.status === 'waitlist' && r.offer && !r.offer.expired)) return null; // one open offer at a time
  const next = rs.filter((r) => r.status === 'waitlist' && !r.offer).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!next) return null;
  const t = token(24); next.offer = { token: t, at: now(), expiresAt: new Date(Date.now() + OFFER_HOURS * HOUR).toISOString() };
  await s.set('offers/' + t, { eventId: e.id, rsvpId: next.id });
  const m = await sendOffer(live(e) || e, next, origin); if (m.status !== 'off') next.offer.mail = m;
  await s.set('rsvps/' + e.id + '/' + next.id, next);
  return next;
}

export async function cancelByGuest(s, e, r, origin) {
  r.status = 'cancelled'; r.decidedAt = now(); r.cancelledBy = 'guest';
  await s.set('rsvps/' + e.id + '/' + r.id, r);
  await offerNext(s, e, origin);
  return r;
}

const claim = (s, e, r, kind) => s.create('sent/' + e.id + '/' + r.id + '/' + kind, { at: now() });

// Runs every few minutes in production. Returns counts only; no names or addresses are logged.
export async function runSchedule(s, origin) {
  const out = { reminders: 0, thanks: 0, offersExpired: 0, offersSent: 0 }, t = Date.now();
  for (const e0 of await all('events/')) {
    const e = live(e0); if (!e || !e.date || e.eventStatus === 'cancelled') continue;
    const st = startMs(e), en = endMs(e);
    const remind = opt(e0, 'reminders', true) && t >= st - 24 * HOUR && t < st, thank = opt(e0, 'thanks', true) && t >= en + 10 * HOUR && t < en + 72 * HOUR, waitl = opt(e0, 'autoWaitlist', false) && t < st;
    if (!remind && !thank && !waitl) continue;
    const rs = await all('rsvps/' + e.id + '/');
    if (remind) {
      const kind = t >= st - 4 * HOUR ? 'h4' : 'd1';
      for (const r of rs) {
        if (r.status !== 'approved' || r.checkedInAt || (r.decidedAt && t - Date.parse(r.decidedAt) < 6 * HOUR)) continue; // just approved: the pass mail is fresh
        if (!(await claim(s, e, r, kind))) continue;
        const m = await sendReminder(e, r, origin, kind); r.reminders = { ...(r.reminders || {}), [kind]: m };
        await s.set('rsvps/' + e.id + '/' + r.id, r); if (m.status === 'sent') out.reminders += 1;
      }
    }
    if (thank) {
      for (const r of rs) {
        if (!r.checkedInAt || !(await claim(s, e, r, 'thanks'))) continue;
        const m = await sendThanks({ ...e, galleryUrl: e0.galleryUrl }, r, origin); r.thanks = m;
        await s.set('rsvps/' + e.id + '/' + r.id, r); if (m.status === 'sent') out.thanks += 1;
      }
    }
    if (waitl) {
      for (const r of rs) if (r.status === 'waitlist' && r.offer && !r.offer.expired && Date.parse(r.offer.expiresAt) < t) { r.offer.expired = true; await s.del('offers/' + r.offer.token); await s.set('rsvps/' + e.id + '/' + r.id, r); out.offersExpired += 1; }
      if (rs.some((r) => r.status === 'cancelled' || (r.offer && r.offer.expired)) && await offerNextIfRoom(s, e0, rs, origin)) out.offersSent += 1;
    }
  }
  return out;
}
// After an offer lapses the place is still free: pass it on, but never beyond the capacity the host set.
async function offerNextIfRoom(s, e, rs, origin) {
  const used = rs.filter((r) => r.status === 'approved').reduce((n, r) => n + (r.guests || 1), 0);
  if (e.capacity && used >= e.capacity) return null;
  if (!rs.some((r) => r.offer && r.offer.expired && !r.offer.passedOn)) return null;
  const next = await offerNext(s, e, origin);
  if (next) for (const r of rs) if (r.offer && r.offer.expired && !r.offer.passedOn && r.id !== next.id) { r.offer.passedOn = true; await s.set('rsvps/' + e.id + '/' + r.id, r); }
  return next;
}

