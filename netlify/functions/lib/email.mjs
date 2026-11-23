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

export function sendPass(e, r, origin) {
  const url = origin + '/pass?t=' + r.passToken, when = [dateEn(e.date), e.time].filter(Boolean).join(' · '), where = [e.venue, e.city].filter(Boolean).join(', ');
  const html = shell('<p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#C9C0B5">Your attendance is confirmed</p><h1 style="margin:0 0 14px;font-size:30px;line-height:1.1;font-weight:500">' + esc(e.title) + '</h1>' +
    '<p style="margin:0 0 4px;color:#C9C0B5">' + esc(when) + '</p><p style="margin:0 0 22px;color:#C9C0B5">' + esc(where) + '</p><p style="margin:0 0 22px">Hi ' + esc(r.name.split(' ')[0]) + ', your place is confirmed' + (r.guests > 1 ? ' for ' + r.guests + ' guests' : '') + '. Show your entry pass at the door.</p>' +
    '<a href="' + esc(url) + '" style="display:inline-block;background:#F3EEE6;color:#0E0B0A;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px">Open your entry pass</a><p style="margin:18px 0 0;font-size:13px;color:#8F867D">The pass is valid for this event only and can be scanned once. Please do not forward it.</p>');
  const text = 'Your attendance is confirmed: ' + e.title + '\n' + when + '\n' + where + '\n\nEntry pass: ' + url + '\n\nThe pass is valid for this event only and can be scanned once.';
  return send(r.email, 'Your entry pass — ' + e.title, html, text);
}
export function notifyEnquiry(q, origin) {
  const to = process.env.HQ_NOTIFY_EMAIL || process.env.HQ_ADMIN_EMAIL; if (!to) return Promise.resolve({ status: 'off' });
  const rows = [['Tür', q.kindLabel], ['Ad', q.name], ['E-posta', q.email], ['Şirket', q.company], ['Konu', q.topic || q.service], ['Şehir', q.city], ['Tarih', q.preferredDates], ['Mekân', q.venue], ['Kapasite', q.capacity], ['Bütçe', q.budget], ['Sanatçı', q.artist], ['Mesaj', q.message]].filter((x) => x[1]);
  const html = shell('<h1 style="margin:0 0 16px;font-size:22px;font-weight:500">Yeni site talebi</h1>' + rows.map((x) => '<p style="margin:0 0 8px"><span style="color:#8F867D">' + x[0] + ':</span> ' + esc(x[1]).replace(/\n/g, '<br>') + '</p>').join('') + '<a href="' + origin + '/hq?view=talepler" style="display:inline-block;margin-top:14px;background:#F3EEE6;color:#0E0B0A;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:12px">HQ’da aç</a>');
  return send(to, 'Yeni talep: ' + q.kindLabel + ' — ' + q.name, html, rows.map((x) => x[0] + ': ' + x[1]).join('\n'), q.email);
}
