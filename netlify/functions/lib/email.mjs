// Outgoing e-mail through Resend. Active only when RESEND_API_KEY and EMAIL_FROM are set; nothing is ever
// recorded as sent unless the provider accepted it.
import { esc, dateEn } from './util.mjs';
const API = () => process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
export const emailStatus = () => ({ connected: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), missing: ['RESEND_API_KEY', 'EMAIL_FROM'].filter((k) => !process.env[k]) });

// EMAIL_FROM may be a bare address (rsvp@morelife.events); the display name is added here.
const fromHeader = () => { const v = String(process.env.EMAIL_FROM || '').trim(); return /</.test(v) ? v : (process.env.EMAIL_FROM_NAME || 'More Life') + ' <' + v + '>'; };
async function send(to, subject, html, text, replyTo) {
  if (!emailStatus().connected) return { status: 'off' };
  try {
    const r = await fetch(API(), { method: 'POST', headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from: fromHeader(), to: [to], subject, html, text, reply_to: replyTo || undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { status: 'failed', at: new Date().toISOString(), error: String(j.message || j.error || 'HTTP ' + r.status).slice(0, 200) };
    return { status: 'sent', at: new Date().toISOString(), id: String(j.id || '') };
  } catch (e) { return { status: 'failed', at: new Date().toISOString(), error: 'Bağlantı hatası' }; }
}
const shell = (inner) => '<div style="background:#0E0B0A;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#F3EEE6"><div style="max-width:520px;margin:0 auto;background:#17110F;border:1px solid #3a302c;border-radius:20px;padding:28px">' + inner + '<p style="margin:28px 0 0;font-size:12px;color:#8F867D">More Life · morelife.events</p></div></div>';

// Built separately from sending so HQ can show the exact message for an event before anyone receives it.
export function passMail(e, r, origin) {
  const url = origin + '/pass?t=' + r.passToken, when = [dateEn(e.date), e.time].filter(Boolean).join(' · '), where = [e.venue, e.city].filter(Boolean).join(', ');
  const img = e.imageId ? '<img src="' + esc(origin + '/api/public/image/' + e.imageId) + '" alt="' + esc(e.imageAlt || '') + '" width="520" style="display:block;width:100%;height:auto;border-radius:12px;margin:0 0 22px">' : '';
  const html = shell(img + '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#C9C0B5">Your attendance is confirmed</p><h1 style="margin:0 0 14px;font-size:30px;line-height:1.1;font-weight:500">' + esc(e.title) + '</h1>' +
    '<p style="margin:0 0 4px;color:#C9C0B5">' + esc(when) + '</p><p style="margin:0 0 22px;color:#C9C0B5">' + esc(where) + '</p><p style="margin:0 0 22px">Hi ' + esc(r.name.split(' ')[0]) + ', your place is confirmed' + (r.guests > 1 ? ' for ' + r.guests + ' guests' : '') + '. Show your entry pass at the door.</p>' +
    '<a href="' + esc(url) + '" style="display:inline-block;background:#F3EEE6;color:#0E0B0A;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px">Open your entry pass</a><p style="margin:18px 0 0;font-size:13px;color:#8F867D">The pass is valid for this event only and can be scanned once. Please do not forward it.</p>');
  const text = 'Your attendance is confirmed: ' + e.title + '\n' + when + '\n' + where + '\n\nEntry pass: ' + url + '\n\nThe pass is valid for this event only and can be scanned once.';
  return { subject: 'Your entry pass — ' + e.title, html, text };
}
export function sendPass(e, r, origin) { const m = passMail(e, r, origin); return send(r.email, m.subject, m.html, m.text); }
const btn = (href, label) => '<a href="' + esc(href) + '" style="display:inline-block;background:#F3EEE6;color:#0E0B0A;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px">' + label + '</a>';
const head = (kicker, e) => '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#C9C0B5">' + kicker + '</p><h1 style="margin:0 0 14px;font-size:30px;line-height:1.1;font-weight:500">' + esc(e.title) + '</h1>';
const whenWhere = (e) => ({ when: [dateEn(e.date), e.time].filter(Boolean).join(' · '), where: [e.venue, e.city].filter(Boolean).join(', ') });
const first = (r) => esc(r.name.split(' ')[0]);

// kind: 'd1' (the day before) or 'h4' (a few hours before doors)
export function reminderMail(e, r, origin, kind) {
  const url = origin + '/pass?t=' + r.passToken, w = whenWhere(e), soon = kind === 'h4';
  const html = shell(head(soon ? 'Tonight' : 'Tomorrow', e) + '<p style="margin:0 0 4px;color:#C9C0B5">' + esc(w.when) + (e.doors ? ' · doors ' + esc(e.doors) : '') + '</p><p style="margin:0 0 22px;color:#C9C0B5">' + esc(w.where) + '</p>' +
    '<p style="margin:0 0 22px">Hi ' + first(r) + ', ' + (soon ? 'see you in a few hours.' : 'see you tomorrow.') + ' Have your entry pass ready at the door' + (e.dressCode ? '. Dress code: ' + esc(e.dressCode) : '') + '.</p>' + btn(url, 'Open your entry pass') +
    '<p style="margin:18px 0 0;font-size:13px;color:#8F867D">Plans changed? Open your pass and tap “Can’t make it” so your place can go to someone on the waitlist.</p>');
  return { subject: (soon ? 'Tonight: ' : 'Tomorrow: ') + e.title, html, text: (soon ? 'Tonight: ' : 'Tomorrow: ') + e.title + '\n' + w.when + '\n' + w.where + '\n\nEntry pass: ' + url };
}
export function offerMail(e, r, origin) {
  const url = origin + '/offer?t=' + r.offer.token, w = whenWhere(e);
  const html = shell(head('A place has opened', e) + '<p style="margin:0 0 4px;color:#C9C0B5">' + esc(w.when) + '</p><p style="margin:0 0 22px;color:#C9C0B5">' + esc(w.where) + '</p>' +
    '<p style="margin:0 0 22px">Hi ' + first(r) + ', a place has opened up and it is yours if you want it. Please confirm within 2 hours; after that it goes to the next person on the waitlist.</p>' + btn(url, 'Confirm my place'));
  return { subject: 'A place has opened — ' + e.title, html, text: 'A place has opened: ' + e.title + '\n' + w.when + '\n' + w.where + '\n\nConfirm within 2 hours: ' + url };
}
export function thanksMail(e, r, origin) {
  const html = shell(head('Thank you', e) + '<p style="margin:0 0 22px">Hi ' + first(r) + ', thank you for being there. It would not have been the same night without you.</p>' +
    (e.galleryUrl ? btn(e.galleryUrl, 'See the photos') : btn(origin + '/#events', 'See what is next')) + '<p style="margin:18px 0 0;font-size:13px;color:#8F867D">You are receiving this because you attended this event.</p>');
  return { subject: 'Thank you — ' + e.title, html, text: 'Thank you for being there: ' + e.title + (e.galleryUrl ? '\n\nPhotos: ' + e.galleryUrl : '\n\nWhat is next: ' + origin + '/#events') };
}
// Invitation to someone in the CRM who has not applied yet. `c` is a contact, `token` the event's invite key.
export function inviteMail(e, c, origin, token) {
  const url = origin + '/invite?t=' + token + '&utm_source=email&utm_medium=invite', w = whenWhere(e), n = /@/.test(c.name || '') ? '' : esc(String(c.name || '').trim().split(/\s+/)[0]);
  const img = e.imageId ? '<img src="' + esc(origin + '/api/public/image/' + e.imageId) + '" alt="' + esc(e.imageAlt || '') + '" width="520" style="display:block;width:100%;height:auto;border-radius:12px;margin:0 0 22px">' : '';
  const html = shell(img + head('Private invitation', e) + '<p style="margin:0 0 4px;color:#C9C0B5">' + esc(w.when) + '</p><p style="margin:0 0 22px;color:#C9C0B5">' + esc(w.where) + '</p>' +
    (e.waPromo ? '<p style="margin:0 0 14px">' + esc(e.waPromo) + '</p>' : '') + '<p style="margin:0 0 22px">' + (n ? n + ', you' : 'You') + '’re on the list.</p>' + btn(url, 'Request your place') +
    '<p style="margin:18px 0 0;font-size:13px;color:#8F867D">This invitation is personal; please do not forward it. If you would rather not receive invitations from More Life, reply to this e-mail and we will take you off the list.</p>');
  return { subject: 'You’re invited — ' + e.title, html, text: 'You’re invited: ' + e.title + '\n' + w.when + '\n' + w.where + (e.waPromo ? '\n\n' + e.waPromo : '') + '\n\nRequest your place: ' + url + '\n\nReply to this e-mail if you would rather not receive invitations from More Life.' };
}
export async function sendInvite(e, c, origin, token) {
  const m = inviteMail(e, c, origin, token); let r = await send(c.email, m.subject, m.html, m.text);
  for (let i = 0; i < 2 && r.status === 'failed' && /too many|rate/i.test(r.error || ''); i++) { await new Promise((ok) => setTimeout(ok, 700)); r = await send(c.email, m.subject, m.html, m.text); }
  return r;
}
const out = (r, m) => send(r.email, m.subject, m.html, m.text);
export const sendReminder = (e, r, origin, kind) => out(r, reminderMail(e, r, origin, kind));
export const sendOffer = (e, r, origin) => out(r, offerMail(e, r, origin));
export const sendThanks = (e, r, origin) => out(r, thanksMail(e, r, origin));
export function notifyEnquiry(q, origin) {
  const to = process.env.HQ_NOTIFY_EMAIL || process.env.HQ_ADMIN_EMAIL; if (!to) return Promise.resolve({ status: 'off' });
  const rows = [['Tür', q.kindLabel], ['Ad', q.name], ['E-posta', q.email], ['Şirket', q.company], ['Konu', q.topic || q.service], ['Şehir', q.city], ['Tarih', q.preferredDates], ['Mekân', q.venue], ['Kapasite', q.capacity], ['Bütçe', q.budget], ['Sanatçı', q.artist], ['Mesaj', q.message]].filter((x) => x[1]);
  const html = shell('<h1 style="margin:0 0 16px;font-size:22px;font-weight:500">Yeni site talebi</h1>' + rows.map((x) => '<p style="margin:0 0 8px"><span style="color:#8F867D">' + x[0] + ':</span> ' + esc(x[1]).replace(/\n/g, '<br>') + '</p>').join('') + '<a href="' + origin + '/hq?view=talepler" style="display:inline-block;margin-top:14px;background:#F3EEE6;color:#0E0B0A;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:12px">HQ’da aç</a>');
  return send(to, 'Yeni talep: ' + q.kindLabel + ' — ' + q.name, html, rows.map((x) => x[0] + ': ' + x[1]).join('\n'), q.email);
}

/* ---------- ticket orders ---------- */
const amount = (n, cur) => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(n); } catch { return n.toFixed(2) + ' ' + cur; } };
// transfer: the mail goes to someone who was handed a ticket, not to the buyer, so it carries no order total or order link
export function orderMail(e, o, tickets, origin, transfer) {
  const w = whenWhere(e), rows = tickets.filter((t) => t.status === 'valid').map((t) => '<tr><td style="padding:10px 0;border-top:1px solid #3a302c"><b>' + esc(t.typeName) + '</b><br><span style="color:#C9C0B5;font-size:13px">' + esc(t.name) + '</span></td><td style="padding:10px 0;border-top:1px solid #3a302c;text-align:right"><a href="' + esc(origin + '/pass?t=' + t.token) + '" style="color:#F3EEE6;font-weight:600">Open ticket</a></td></tr>').join('');
  const img = e.imageId ? '<img src="' + esc(origin + '/api/public/image/' + e.imageId) + '" alt="' + esc(e.imageAlt || '') + '" width="520" style="display:block;width:100%;height:auto;border-radius:12px;margin:0 0 22px">' : '';
  const html = shell(img + head(transfer ? 'A ticket for you' : 'Your tickets', e) + '<p style="margin:0 0 4px;color:#C9C0B5">' + esc(w.when) + (e.doors ? ' · doors ' + esc(e.doors) : '') + '</p><p style="margin:0 0 22px;color:#C9C0B5">' + esc(w.where) + '</p>' +
    '<p style="margin:0 0 14px">Hi ' + first(o.buyer) + ', ' + (transfer ? 'a ticket has been put in your name.' : 'thank you for your order <b>' + esc(o.no) + '</b>.') + ' Each ticket has its own QR code and is scanned once at the door.</p>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px">' + rows + '</table>' +
    (transfer ? '' : (o.total > 0 ? '<p style="margin:0 0 22px;color:#C9C0B5">Total paid: <b style="color:#F3EEE6">' + esc(amount(o.total, o.currency)) + '</b>' + (o.fee > 0 ? ' (includes ' + esc(amount(o.fee, o.currency)) + ' service fee)' : '') + '</p>' : '') + btn(origin + '/order?t=' + o.token, 'View your order') + '<p style="margin:18px 0 0;font-size:13px;color:#8F867D">From your order page you can put a ticket in a friend’s name.</p>'));
  const text = (transfer ? 'A ticket for you: ' : 'Your tickets: ') + e.title + '\n' + w.when + '\n' + w.where + '\n\n' + tickets.filter((t) => t.status === 'valid').map((t) => t.typeName + ' — ' + t.name + ': ' + origin + '/pass?t=' + t.token).join('\n') + (transfer ? '' : '\n\nOrder ' + o.no + ': ' + origin + '/order?t=' + o.token);
  return { subject: (transfer ? 'Your ticket — ' : 'Your tickets — ') + e.title, html, text };
}
export function sendOrder(e, o, tickets, origin, transfer) { const m = orderMail(e, o, tickets, origin, transfer); return send(o.buyer.email, m.subject, m.html, m.text); }
export function sendRefund(e, o, sum, count, origin) {
  const html = shell(head('Refund', e) + '<p style="margin:0 0 14px">Hi ' + first(o.buyer) + ', we have refunded <b>' + esc(amount(sum, o.currency)) + '</b> for ' + count + ' ticket' + (count === 1 ? '' : 's') + ' on order <b>' + esc(o.no) + '</b>. The refunded tickets are no longer valid.</p><p style="margin:0 0 22px;color:#C9C0B5">Depending on your bank, the amount can take a few working days to appear on your statement.</p>' + btn(origin + '/order?t=' + o.token, 'View your order'));
  return send(o.buyer.email, 'Refund — ' + e.title, html, 'We have refunded ' + amount(sum, o.currency) + ' for ' + count + ' ticket(s) on order ' + o.no + '.\n' + origin + '/order?t=' + o.token);
}
