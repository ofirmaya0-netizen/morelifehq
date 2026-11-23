// Small shared helpers for the HQ function.
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
export const page = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
export const gated = (body, status = 200) => page(body, status, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' });
export const now = () => new Date().toISOString();
export const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
export const int = (v, min, max, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };
export const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const normEmail = (e) => str(e, 200).toLowerCase();
// Phones compare on digits; a Turkish local 05xx… number matches its +90 form.
export const normPhone = (p) => { let d = str(p, 40).replace(/[^\d+]/g, ''); if (/^0[1-9]\d{9}$/.test(d)) d = '+90' + d.slice(1); else if (/^00/.test(d)) d = '+' + d.slice(2); else if (/^90\d{10}$/.test(d)) d = '+' + d; return d; };
export const tagList = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(',')).map((x) => str(x, 40).toLowerCase()).filter(Boolean))].slice(0, 20);
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function body(req) { try { return await req.json(); } catch { return {}; } }
export const ipOf = (req, ctx) => (ctx && ctx.ip) || req.headers.get('x-nf-client-connection-ip') || 'local';
// Dates and times are stored as Europe/Istanbul wall-clock strings. Turkey is UTC+3 all year.
export const TZ = 'Europe/Istanbul';
export const istNow = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM in Istanbul
export const istToday = () => istNow().slice(0, 10);
export const isoIst = (date, time) => (date ? date + 'T' + (time || '00:00') + ':00+03:00' : '');
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dateEn = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return parseInt(dd, 10) + ' ' + MONTHS_EN[m - 1] + ' ' + y; };
export const dateTr = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return parseInt(dd, 10) + ' ' + MONTHS[m - 1] + ' ' + y; };
export function slugify(s) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return String(s || '').replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
export function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const csv = (name, rows) => new Response('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="' + name + '"', 'cache-control': 'no-store' } });
export const isBot = (ua) => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse|curl|wget|python|monitor/i.test(ua);
