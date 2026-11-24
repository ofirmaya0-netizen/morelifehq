// Booking pipeline: one record per artist deal, from the first offer to the last payment.
// Reached only from adminApi(), after the session, role and same-origin checks (owner and manager roles).
import { all } from './store.mjs';
import { id } from './auth.mjs';
import { json, fail, now, str, emailOk, normEmail, body, istToday } from './util.mjs';

export const STAGES = [['offer', 'Teklif'], ['confirmed', 'Onay'], ['contract', 'Kontrat'], ['deposit', 'Depozito'], ['balance', 'Bakiye'], ['cancelled', 'Olmadı']];
const STAGE_KEYS = STAGES.map((x) => x[0]), ORDER = (k) => STAGE_KEYS.indexOf(k), stageLabel = (k) => (STAGES.find((x) => x[0] === k) || [])[1] || k;
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'TRY'];
const PAY_KINDS = ['deposit', 'balance', 'other'], FILE_KINDS = ['contract', 'rider', 'offer', 'invoice', 'other'];
const FILE_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
export const MAX_FILE = 4 * 1024 * 1024; // a function request carries about 6 MB; base64 adds a third
const TEXT = { artist: 160, agency: 120, agent: 120, venue: 160, city: 80, feeNote: 300, notes: 4000 };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const money = (v) => { const n = Math.round(parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')) * 100) / 100; return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null; };

function bookingInput(b, prev) {
  const k = { ...prev };
  for (const f of Object.keys(TEXT)) if (f in b) k[f] = str(b[f], TEXT[f]);
  if ('agentEmail' in b) { k.agentEmail = normEmail(b.agentEmail); if (k.agentEmail && !emailOk(k.agentEmail)) return { error: 'Ajans e-postası geçersiz.' }; }
  for (const f of ['date', 'offerExpires']) if (f in b) { k[f] = str(b[f], 10); if (k[f] && !isDate(k[f])) return { error: 'Tarih geçersiz.' }; }
  if ('eventId' in b) k.eventId = str(b.eventId, 40);
  if ('currency' in b) k.currency = CURRENCIES.includes(b.currency) ? b.currency : 'EUR';
  if ('fee' in b) { if (b.fee === '' || b.fee == null) k.fee = null; else { k.fee = money(b.fee); if (k.fee == null) return { error: 'Ücret geçersiz.' }; } }
  if ('stage' in b) { if (!STAGE_KEYS.includes(b.stage)) return { error: 'Geçersiz durum.' }; k.stage = b.stage; }
  if (!k.artist) return { error: 'Sanatçı adı gerekli.' };
  return { booking: k };
}
function paymentInput(b, prev, booking) {
  const p = { ...prev };
  if ('label' in b) p.label = str(b.label, 80);
  if ('kind' in b) p.kind = PAY_KINDS.includes(b.kind) ? b.kind : 'other';
  if ('currency' in b) p.currency = CURRENCIES.includes(b.currency) ? b.currency : booking.currency;
  if ('amount' in b) { p.amount = money(b.amount); if (p.amount == null) return { error: 'Tutar geçersiz.' }; }
  if ('due' in b) { p.due = str(b.due, 10); if (p.due && !isDate(p.due)) return { error: 'Vade tarihi geçersiz.' }; }
  if (p.amount == null) return { error: 'Tutar gerekli.' };
  if (!p.label) p.label = { deposit: 'Depozito', balance: 'Bakiye', other: 'Ödeme' }[p.kind];
  return { payment: p };
}
// Paying moves the deal forward by itself, never backward: a paid deposit means at least "Depozito", everything paid means "Bakiye".
function advance(k, who) {
  if (k.stage === 'cancelled') return '';
  const ps = k.payments || [], want = ps.length && ps.every((p) => p.paidAt) ? 'balance' : ps.some((p) => p.kind === 'deposit' && p.paidAt) ? 'deposit' : '';
  return want && ORDER(want) > ORDER(k.stage) ? setStage(k, want, who) : '';
}
function setStage(k, stage, who) {
  if (k.stage === stage) return '';
  const from = k.stage; k.stage = stage; k.stageAt = now();
  k.history = (k.history || []).concat({ stage, at: k.stageAt, by: who.name }).slice(-40);
  return (from ? stageLabel(from) + ' → ' : '') + stageLabel(stage);
}
// What the lists need: totals per currency and the next payment that is still open.
export function bookingView(k, td = istToday()) {
  const ps = k.payments || [], open = ps.filter((p) => !p.paidAt).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')), sum = (list) => { const o = {}; for (const p of list) o[p.currency] = Math.round(((o[p.currency] || 0) + p.amount) * 100) / 100; return o; };
  const planned = sum(ps), mismatch = k.fee != null && ps.length > 0 && (Object.keys(planned).length !== 1 || planned[k.currency] !== k.fee);
  return { ...k, stageLabel: stageLabel(k.stage), paid: sum(ps.filter((p) => p.paidAt)), unpaid: sum(open), planned, planMismatch: mismatch, nextPayment: open[0] || null, overdue: open.filter((p) => p.due && p.due < td).length,
    offerExpired: k.stage === 'offer' && !!k.offerExpires && k.offerExpires < td };
}
// Open payments and offers that need a decision soon, for the Özet screen.
export async function bookingAlerts(days = 14) {
  const td = istToday(), until = new Date(Date.parse(td) + days * 864e5).toISOString().slice(0, 10), payments = [], offers = [];
  let active = 0;
  for (const k of await all('bookings/')) {
    if (k.stage === 'cancelled') continue;
    if (k.stage !== 'balance') active += 1;
    for (const p of k.payments || []) if (!p.paidAt && p.due && p.due <= until) payments.push({ bookingId: k.id, artist: k.artist, label: p.label, amount: p.amount, currency: p.currency, due: p.due, late: p.due < td });
    if (k.stage === 'offer' && k.offerExpires && k.offerExpires <= new Date(Date.parse(td) + 3 * 864e5).toISOString().slice(0, 10)) offers.push({ bookingId: k.id, artist: k.artist, agency: k.agency, expires: k.offerExpires, late: k.offerExpires < td });
  }
  return { active, payments: payments.sort((a, b) => a.due.localeCompare(b.due)), offers: offers.sort((a, b) => a.expires.localeCompare(b.expires)) };
}

export async function bookingsRoute(req, parts, url, s, me) {
  const m = req.method, save = async (k) => { k.updatedAt = now(); await s.set('bookings/' + k.id, k); };
  const eventRef = async (k) => { const e = k.eventId && await s.get('events/' + k.eventId); return e ? { id: e.id, title: e.title, date: e.date, venue: e.venue, city: e.city, status: e.status } : null; };
  if (!parts[1] && m === 'GET') {
    const evs = (await all('events/')).filter((e) => e.status !== 'archived').sort((a, b) => (b.date || '').localeCompare(a.date || '')), byId = new Map(evs.map((e) => [e.id, e]));
    const list = (await all('bookings/')).map((k) => ({ ...bookingView(k), eventTitle: (byId.get(k.eventId) || {}).title || '', files: (k.files || []).length }));
    return json({ bookings: list.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.artist.localeCompare(b.artist, 'tr')), stages: STAGES.map(([key, label]) => ({ key, label })), currencies: CURRENCIES,
      events: evs.map((e) => ({ id: e.id, title: e.title, date: e.date, artist: e.artist || '', venue: e.venue || '', city: e.city || '' })) });
  }
  if (!parts[1] && m === 'POST') {
    const r = bookingInput(await body(req), { artist: '', agency: '', agent: '', agentEmail: '', venue: '', city: '', date: '', offerExpires: '', eventId: '', currency: 'EUR', fee: null, feeNote: '', notes: '' }); if (r.error) return fail(400, r.error);
    const k = r.booking, stage = k.stage || 'offer'; delete k.stage;
    if (k.eventId && !(await s.get('events/' + k.eventId))) return fail(400, 'Etkinlik bulunamadı.');
    Object.assign(k, { id: id(), payments: [], files: [], history: [], createdAt: now(), createdBy: me.name }); setStage(k, stage, me); await save(k);
    return json({ booking: bookingView(k) }, 201);
  }
  const k = await s.get('bookings/' + parts[1]); if (!k) return fail(404, 'Booking bulunamadı.');
  if (!parts[2]) {
    if (m === 'GET') return json({ booking: bookingView(k), event: await eventRef(k), stages: STAGES.map(([key, label]) => ({ key, label })), currencies: CURRENCIES, maxFile: MAX_FILE });
    if (m === 'PUT') {
      const b = await body(req), stage = b.stage; delete b.stage;
      const r = bookingInput(b, k); if (r.error) return fail(400, r.error);
      if (stage != null && !STAGE_KEYS.includes(stage)) return fail(400, 'Geçersiz durum.');
      const n = r.booking; if (n.eventId && n.eventId !== k.eventId && !(await s.get('events/' + n.eventId))) return fail(400, 'Etkinlik bulunamadı.');
      const changed = stage != null ? setStage(n, stage, me) : ''; await save(n);
      return json({ booking: bookingView(n), event: await eventRef(n), stageChanged: changed });
    }
    if (m === 'DELETE') {
      for (const f of k.files || []) await s.delBin('files/' + f.id);
      await s.del('bookings/' + k.id); return json({ ok: true, deleted: { artist: k.artist } });
    }
  }
  if (parts[2] === 'payments') {
    k.payments = k.payments || [];
    if (!parts[3] && m === 'POST') {
      const r = paymentInput(await body(req), { id: id(), label: '', kind: 'other', currency: k.currency, amount: null, due: '', paidAt: '', paidBy: '' }, k); if (r.error) return fail(400, r.error);
      if (k.payments.length >= 30) return fail(400, 'Bir booking’de en fazla 30 ödeme satırı olabilir.');
      k.payments.push(r.payment); await save(k); return json({ booking: bookingView(k), payment: r.payment }, 201);
    }
    const i = k.payments.findIndex((p) => p.id === parts[3]); if (i < 0) return fail(404, 'Ödeme satırı bulunamadı.');
    if (m === 'PUT') {
      const b = await body(req), r = paymentInput(b, k.payments[i], k); if (r.error) return fail(400, r.error);
      const p = r.payment; if ('paid' in b) { p.paidAt = b.paid ? (isDate(str(b.paidOn, 10)) ? b.paidOn : istToday()) : ''; p.paidBy = b.paid ? me.name : ''; }
      k.payments[i] = p; const changed = 'paid' in b && b.paid ? advance(k, me) : ''; await save(k);
      return json({ booking: bookingView(k), payment: p, stageChanged: changed });
    }
    if (m === 'DELETE') { const [p] = k.payments.splice(i, 1); await save(k); return json({ booking: bookingView(k), payment: p }); }
  }
  if (parts[2] === 'files') {
    k.files = k.files || [];
    if (!parts[3] && m === 'POST') {
      const b = await body(req), mt = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(b.dataUrl || '')), type = mt && mt[1].toLowerCase();
      if (!mt || !FILE_TYPES[type]) return fail(400, 'Dosya PDF, Word, Excel ya da görsel (JPG, PNG, WebP) olmalı.');
      const buf = Buffer.from(mt[2], 'base64');
      if (!buf.length || buf.length > MAX_FILE) return fail(413, 'Dosya 4 MB’tan küçük olmalı.');
      if (k.files.length >= 40) return fail(400, 'Bir booking’de en fazla 40 dosya olabilir.');
      const f = { id: id(), name: str(b.name, 160).replace(/[\\/\r\n"]/g, ' ') || 'dosya.' + FILE_TYPES[type], kind: FILE_KINDS.includes(b.kind) ? b.kind : 'other', type, size: buf.length, at: now(), by: me.name };
      await s.setBin('files/' + f.id, buf, type); k.files.push(f); await save(k);
      return json({ booking: bookingView(k), file: f }, 201);
    }
    const f = k.files.find((x) => x.id === parts[3]); if (!f) return fail(404, 'Dosya bulunamadı.');
    if (m === 'GET') { // always a download, never rendered in the HQ origin
      const bin = await s.getBin('files/' + f.id); if (!bin) return fail(404, 'Dosya bulunamadı.');
      return new Response(bin.buf, { headers: { 'content-type': f.type, 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(f.name), 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
    }
    if (m === 'DELETE') { await s.delBin('files/' + f.id); k.files = k.files.filter((x) => x.id !== f.id); await save(k); return json({ booking: bookingView(k), file: f }); }
  }
  return fail(404, 'Bulunamadı.');
}
