// Ticket sales: ticket types, stock, codes, checkout, orders, tickets, refunds, transfers and sales figures.
// Storage has no transactions, so every unit of stock is one record created atomically: two buyers can never hold the same unit.
import crypto from 'node:crypto';
import { all, pool } from './store.mjs';
import { id, token, hash } from './auth.mjs';
import { json, fail, now, str, int, emailOk, normEmail, normPhone, body, istNow, istToday, csv } from './util.mjs';
import { live, isListed, SITE_URL } from './model.mjs';
import { provider, providerStatus } from './payments.mjs';
import { sendOrder, sendRefund, sendWaitlist, sendCart, orderMail, emailStatus } from './email.mjs';

export const CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];
const HOLD_MIN = 12, GRACE_MIN = 8; // a basket is held for 12 minutes; its stock is released 8 minutes after that
const r2 = (n) => Math.round(n * 100) / 100;
const isDT = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
const money = (v) => { const n = r2(parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'))); return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null; };
const orderNo = () => 'ML-' + crypto.randomBytes(4).toString('hex').toUpperCase();

/* ---------- settings ---------- */
const DEFAULTS = { provider: '', feeMode: 'buyer', feePct: 0, feeFixed: 0, installments: false, seller: '', terms: '', refundPolicy: '', supportEmail: '' };
export const tixSettings = async (s) => ({ ...DEFAULTS, ...((await s.get('settings/tickets')) || {}) });
export const shopOf = async (s, eventId) => ({ enabled: false, currency: 'TRY', transfers: true, waitlist: true, resale: false, remind: false, note: '', ...((await s.get('tshop/' + eventId)) || {}) });
// Buyer-facing texts come in the language the buyer used on the shop page.
const tx = (lang, en, tr) => (lang === 'tr' ? tr : en);
const langOf = (v) => (v === 'tr' ? 'tr' : 'en');
// Why the shop cannot take orders yet, or '' when it can. Real payments need the legal texts a buyer must accept.
function blocked(set) {
  const p = provider(set.provider); if (p.error) return p.error;
  if (set.provider !== 'test' && (!set.terms.trim() || !set.refundPolicy.trim() || !set.seller.trim())) return 'Satış başlamadan önce satıcı bilgisi, mesafeli satış sözleşmesi ve iade koşulları girilmeli.';
  return '';
}

/* ---------- ticket types + stock ---------- */
const typesOf = async (eventId) => (await all('ttypes/' + eventId + '/')).sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt.localeCompare(b.createdAt));
const takenOf = async (s, typeId) => (await s.list('tstock/' + typeId + '/')).length;
function typeInput(b, prev) {
  const t = { ...prev };
  if ('name' in b) t.name = str(b.name, 80);
  if ('description' in b) t.description = str(b.description, 400);
  if ('price' in b) { t.price = money(b.price); if (t.price == null) return { error: 'Fiyat geçersiz.' }; }
  if ('stock' in b) t.stock = int(b.stock, 0, 100000);
  if ('min' in b) t.min = int(b.min, 1, 20, 1);
  if ('max' in b) t.max = int(b.max, 1, 20, 10);
  if ('admits' in b) t.admits = int(b.admits, 1, 20, 1);
  if ('order' in b) t.order = int(b.order, 0, 999);
  for (const f of ['saleStart', 'saleEnd']) if (f in b) { t[f] = str(b[f], 16); if (t[f] && !isDT(t[f])) return { error: 'Satış başlangıç/bitiş zamanı geçersiz.' }; }
  if ('hidden' in b) t.hidden = !!b.hidden;
  if ('status' in b) t.status = b.status === 'off' ? 'off' : 'on';
  if ('after' in b) t.after = str(b.after, 40);
  if (!t.name) return { error: 'Bilet türüne bir ad verin.' };
  if (t.min > t.max) return { error: 'En az adet, en fazla adetten büyük olamaz.' };
  if (t.saleStart && t.saleEnd && t.saleEnd <= t.saleStart) return { error: 'Satış bitişi başlangıçtan sonra olmalı.' };
  if (t.after && t.after === t.id) return { error: 'Bir bilet türü kendisinden sonra açılamaz.' };
  return { type: t };
}
// on | soon (not open yet) | soldout | ended | off. "after" opens a type once the one before it is sold out or over: early bird → phase 1 → phase 2.
function typeState(t, taken, byId, takenBy) {
  const n = istNow();
  if (t.status === 'off') return 'off';
  if (t.saleEnd && n > t.saleEnd) return 'ended';
  if (t.stock && taken >= t.stock) return 'soldout';
  if (t.saleStart && n < t.saleStart) return 'soon';
  if (t.after && byId[t.after]) { const p = byId[t.after], ps = typeState({ ...p, after: '' }, takenBy[p.id] || 0, byId, takenBy); if (ps !== 'soldout' && ps !== 'ended' && ps !== 'off') return 'soon'; }
  return 'on';
}
// Tickets their holders put back on sale. A listing is open until a buyer's basket claims it.
async function listingsOf(s, typeId) {
  const [all, taken] = await Promise.all([s.list('tresale/' + typeId + '/'), s.list('tresaleTaken/' + typeId + '/')]), gone = new Set(taken.map((k) => k.split('/')[2]));
  return all.map((k) => k.split('/')[2]).filter((tid) => !gone.has(tid));
}
async function typesView(s, eventId) {
  const ts = await typesOf(eventId), takenBy = {}, byId = {}, open = {};
  await pool(ts, 8, async (t) => { open[t.id] = (await listingsOf(s, t.id)).length; takenBy[t.id] = (await takenOf(s, t.id)) - open[t.id]; byId[t.id] = t; }); // a listed ticket counts as available again
  return ts.map((t) => ({ ...t, taken: takenBy[t.id], resale: open[t.id], left: t.stock ? Math.max(0, t.stock - takenBy[t.id]) : null, state: typeState(t, takenBy[t.id], byId, takenBy) }));
}
// Takes `qty` units of a type for an order, or nothing at all. Returns the keys it created.
async function reserve(s, t, qty, orderId) {
  const made = [], undo = async () => { await pool(made, 8, (k) => s.del(k)); return null; };
  if (!t.stock) { for (let i = 0; i < qty; i++) { const k = 'tstock/' + t.id + '/u' + id(); await s.set(k, { o: orderId }); made.push(k); } return made; }
  for (let round = 0; round < 4 && made.length < qty; round++) {
    const taken = new Set((await s.list('tstock/' + t.id + '/')).map((k) => k.split('/')[2])), free = [];
    for (let n = 1; n <= t.stock && free.length < (qty - made.length) * 3 + 4; n++) if (!taken.has(String(n))) free.push(n);
    if (!free.length) break;
    for (const n of free) { if (made.length >= qty) break; const k = 'tstock/' + t.id + '/' + n; if (await s.create(k, { o: orderId })) made.push(k); } // lost a race for this unit: try the next
  }
  // nothing new left: take tickets that holders put back on sale. The claim is atomic too, so a listed ticket is sold once.
  if (made.length < qty && (t.admits || 1) === 1) for (const tid of await listingsOf(s, t.id)) { if (made.length >= qty) break; const k = 'tresaleTaken/' + t.id + '/' + tid; if (await s.create(k, { o: orderId })) made.push(k); }
  return made.length === qty ? made : undo();
}

/* ---------- codes ---------- */
const normCode = (c) => str(c, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
function codeInput(b, prev) {
  const c = { ...prev };
  if ('code' in b && !prev.code) c.code = normCode(b.code);
  if ('kind' in b) c.kind = b.kind === 'amount' ? 'amount' : 'percent';
  if ('value' in b) { c.value = money(b.value); if (c.value == null) return { error: 'İndirim değeri geçersiz.' }; }
  if ('typeIds' in b) c.typeIds = (Array.isArray(b.typeIds) ? b.typeIds : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 50);
  if ('maxUses' in b) c.maxUses = int(b.maxUses, 0, 100000);
  for (const f of ['start', 'end']) if (f in b) { c[f] = str(b[f], 16); if (c[f] && !isDT(c[f])) return { error: 'Kodun geçerlilik zamanı geçersiz.' }; }
  if ('active' in b) c.active = !!b.active;
  if ('note' in b) c.note = str(b.note, 120);
  if (!c.code || c.code.length < 3) return { error: 'Kod en az 3 karakter olmalı (harf, rakam, tire).' };
  if (c.kind === 'percent' && c.value > 100) return { error: 'Yüzde indirim 100’ü geçemez.' };
  return { code: c };
}
// A code can lower the price of the types it covers and also opens their hidden ones.
async function findCode(s, eventId, raw) {
  const c = raw ? await s.get('tcodes/' + eventId + '/' + normCode(raw)) : null, n = istNow();
  if (!c || !c.active || (c.start && n < c.start) || (c.end && n > c.end)) return null;
  return c;
}
const covers = (c, typeId) => !!c && (!c.typeIds.length || c.typeIds.includes(typeId));
const usesOf = async (s, c) => (await s.list('tcodeUse/' + c.eventId + '/' + c.code + '/')).length;

/* ---------- pricing ---------- */
function price(lines, code, set) { // lines: [{ t, qty }]
  let subtotal = 0, discount = 0, fee = 0; const items = [];
  for (const { t, qty } of lines) {
    let unitNet = t.price;
    if (covers(code, t.id) && code.value > 0) unitNet = Math.max(0, r2(code.kind === 'percent' ? t.price * (1 - code.value / 100) : t.price - code.value));
    const unitFee = set.feeMode === 'buyer' && unitNet > 0 ? r2(unitNet * (set.feePct || 0) / 100 + (set.feeFixed || 0)) : 0;
    subtotal += t.price * qty; discount += (t.price - unitNet) * qty; fee += unitFee * qty;
    items.push({ typeId: t.id, name: t.name, qty, unit: t.price, unitNet, unitFee, admits: t.admits || 1 });
  }
  subtotal = r2(subtotal); discount = r2(discount); fee = r2(fee);
  return { items, subtotal, discount, fee, total: r2(subtotal - discount + fee) };
}

/* ---------- orders + tickets ---------- */
const orderKey = (o) => 'orders/' + o.eventId + '/' + o.id;
const ordersOf = (eventId) => all('orders/' + eventId + '/');
const ticketsOf = (eventId) => all('tickets/' + eventId + '/');
export const ticketGuest = (t) => ({ id: 'tk-' + t.id, name: t.name, guests: 1, checkedInAt: t.checkedInAt || '', scanCount: t.scanCount || 0, eventId: t.eventId, ticket: t.typeName });
async function releaseStock(s, o) { await pool(o.slots || [], 8, (k) => s.del(k)); o.slots = []; if (o.code) await s.del('tcodeUse/' + o.eventId + '/' + o.code + '/' + o.id); await s.del('pending/' + o.eventId + '/' + o.id); }
// Baskets that were never paid give their stock back. Called before stock is shown or taken, and by the scheduled run.
// opt.reconcile (scheduled run only): first ask the provider about baskets that may have been paid without the buyer coming
// back to the site, so a closed browser tab never costs anyone a ticket they paid for.
export async function sweep(s, eventId, opt = {}) {
  const keys = await s.list('pending/' + (eventId ? eventId + '/' : '')), t = Date.now(), origin = opt.origin || SITE_URL(), touched = new Set(); let freed = 0, recovered = 0;
  for (const k of keys) {
    const p = await s.get(k), [, eid, oid] = k.split('/'); if (!p) continue;
    const due = Date.parse(p.exp) + GRACE_MIN * 60000 <= t;
    if (!due && !opt.reconcile) continue;
    const o = await s.get('orders/' + eid + '/' + oid), e = o && await s.get('events/' + eid);
    if (!o || !e || o.status !== 'pending') { await s.del(k); continue; }
    if (opt.reconcile && o.payment && o.payment.session && t - Date.parse(o.createdAt) > 90000) {
      const pr = provider(o.provider), res = pr.error || !pr.check ? null : await pr.check(o).catch(() => null);
      if (res && res.paid) { await settle(s, e, o, res, origin); recovered += 1; continue; }
    }
    if (!due) continue;
    o.status = 'expired'; await releaseStock(s, o); freed += 1; touched.add(eid);
    const shop = await shopOf(s, eid);
    if (shop.remind && shop.enabled && o.channel === 'online' && o.buyer.email && !(await ordersOf(eid)).some((x) => x.id !== o.id && x.buyer.email === o.buyer.email && ['paid', 'partial'].includes(x.status))) { // one note, and not to someone who bought after all
      const le = live(e) || e, m = await sendCart(le, o, origin + (isListed(e) ? '/events/' + le.slug : '/invite?t=' + e.inviteToken), o.lang); if (m.status !== 'off') o.reminded = m;
    }
    await s.set(orderKey(o), o);
  }
  for (const eid of touched) { const e = await s.get('events/' + eid); if (e) await notifyWaitlist(s, e, origin); }
  return opt.reconcile ? { freed, recovered } : freed;
}
// People who asked to be told: when a type they wait for can be bought (stock came back, a ticket was listed, or its sale
// opened), the longest-waiting ones get one e-mail. First come, first served: the mail holds nothing for them.
export async function notifyWaitlist(s, e, origin) {
  const waiting = (await all('twait/' + e.id + '/')).filter((w) => w.status === 'waiting'); if (!waiting.length) return 0;
  const shop = await shopOf(s, e.id), le = live(e); if (!shop.enabled || !le) return 0;
  const url = origin + (isListed(e) ? '/events/' + le.slug : '/invite?t=' + e.inviteToken); let sent = 0;
  for (const t of (await typesView(s, e.id)).filter((x) => x.state === 'on')) {
    let room = t.left == null ? 50 : t.left;
    for (const w of waiting.filter((x) => x.typeId === t.id).sort((a, b) => a.at.localeCompare(b.at))) {
      if (room <= 0) break;
      const m = await sendWaitlist(le, w, t.name, url, w.kind === 'onsale', w.lang); if (m.status === 'off') return sent;
      w.status = 'notified'; w.notifiedAt = now(); w.mail = m; await s.set('twait/' + e.id + '/' + w.id, w); room -= w.qty; sent += 1;
    }
  }
  return sent;
}
async function upsertBuyer(s, b) {
  const hit = (await s.get('contactEmail/' + hash(b.email))) || (b.phone && normPhone(b.phone).length >= 7 && await s.get('contactPhone/' + hash(normPhone(b.phone))));
  if (hit) { const c = await s.get('contacts/' + hit.id); if (c && !(c.tags || []).includes('bilet')) { c.tags = (c.tags || []).concat('bilet'); c.updatedAt = now(); await s.set('contacts/' + c.id, c); } return hit.id; }
  const c = { id: id(), name: b.name, email: b.email, phone: b.phone || '', instagram: '', company: '', tags: ['bilet'], source: 'Bilet satışı', notes: '', createdAt: now(), updatedAt: now() };
  await s.set('contacts/' + c.id, c); await s.set('contactEmail/' + hash(c.email), { id: c.id });
  if (c.phone && normPhone(c.phone).length >= 7) await s.set('contactPhone/' + hash(normPhone(c.phone)), { id: c.id });
  return c.id;
}
// Turns a paid (or free, or door-sold) order into tickets: one per person admitted, each with its own QR key.
async function issue(s, e, o, origin, quiet) {
  if (o.tickets && o.tickets.length) return;
  o.tickets = []; let seq = 0;
  for (const it of o.items) for (let n = 0; n < it.qty * it.admits; n++) {
    const t = { id: id(), eventId: e.id, orderId: o.id, orderNo: o.no, typeId: it.typeId, typeName: it.name, name: o.buyer.name, email: o.buyer.email, token: token(24), status: 'valid', checkedInAt: '', scanCount: 0, seq: ++seq, paid: r2((it.unitNet + it.unitFee) / it.admits), net: r2(it.unitNet / it.admits), createdAt: now() };
    await s.set('tickets/' + e.id + '/' + t.id, t); await s.set('passes/' + t.token, { eventId: e.id, ticketId: t.id }); o.tickets.push(t.id);
  }
  o.status = 'paid'; o.paidAt = o.paidAt || now(); await s.del('pending/' + e.id + '/' + o.id);
  for (const k of (o.slots || []).filter((x) => x.startsWith('tresaleTaken/'))) await handOver(s, e, o, k, origin); // units that came from another holder
  o.slots = (o.slots || []).filter((x) => !x.startsWith('tresaleTaken/'));
  if (!quiet && o.buyer.email) { const m = await sendOrder(live(e) || e, o, await ticketsFor(s, o), origin); if (m.status !== 'off') o.mail = m; }
  await s.set(orderKey(o), o);
}
// A resold ticket: the old one stops working and its holder gets the ticket price back (the service fee is not returned).
async function handOver(s, e, o, claimKey, origin) {
  const [, typeId, tid] = claimKey.split('/'), old = await s.get('tickets/' + e.id + '/' + tid), oo = old && await s.get('orders/' + e.id + '/' + old.orderId);
  await s.del('tresale/' + typeId + '/' + tid); await s.del(claimKey);
  if (!old || old.status !== 'valid' || !oo) return;
  old.status = 'void'; old.voidAt = now(); old.resoldTo = o.no; old.listed = false; await s.del('passes/' + old.token); await s.set('tickets/' + e.id + '/' + old.id, old);
  const amount = Math.min(old.net != null ? old.net : old.paid || 0, r2(oo.total - refunded(oo)));
  let rf = { ok: true, ref: '' };
  if (amount > 0 && oo.channel === 'online' && oo.provider !== 'free') { const p = provider(oo.provider); rf = p.error ? { ok: false, error: p.error } : await p.refund(oo, amount, { ip: '' }); }
  oo.refunds = (oo.refunds || []).concat({ at: now(), by: 'Yeniden satış', amount: rf.ok ? amount : 0, owed: rf.ok ? 0 : amount, ticketIds: [old.id], reason: 'Bilet ' + o.no + ' siparişine yeniden satıldı', ok: rf.ok, ref: rf.ref || '', error: rf.error || '' });
  // the unit stays on the first order's books: it was sold twice and refunded once
  const left = (await ticketsFor(s, oo)).filter((x) => x.status === 'valid').length; oo.status = left ? 'partial' : 'refunded'; await s.set(orderKey(oo), oo);
  if (rf.ok && oo.buyer.email) await sendRefund(live(e) || e, oo, amount, 1, origin, oo.lang, true);
}
const ticketsFor = async (s, o) => (await pool(o.tickets || [], 8, (tid) => s.get('tickets/' + o.eventId + '/' + tid))).filter(Boolean);
const refunded = (o) => r2((o.refunds || []).reduce((n, r) => n + r.amount, 0));
const orderView = (o) => ({ ...o, slots: undefined, payment: o.payment ? { ref: o.payment.ref, provider: o.payment.provider } : null, refunded: refunded(o), orderUrl: '/order?t=' + o.token });

/* ---------- public: shop, checkout, payment, order page ---------- */
async function eventFor(s, b) { // by invite key (private events) or slug (public ones)
  let e0 = null;
  if (b.t) { const ref = await s.get('invites/' + str(b.t, 60)); e0 = ref && await s.get('events/' + ref.eventId); if (e0 && e0.inviteToken !== b.t) e0 = null; }
  else if (b.slug) { const ref = await s.get('slugs/' + str(b.slug, 80)); e0 = ref && await s.get('events/' + ref.id); if (e0 && !isListed(e0)) e0 = null; }
  return e0 && live(e0) ? e0 : null;
}
async function shopView(s, e, rawCode) {
  const shop = await shopOf(s, e.id), set = await tixSettings(s), why = blocked(set), le = live(e) || e;
  if (!shop.enabled || le.eventStatus === 'cancelled') return { enabled: false };
  await sweep(s, e.id);
  const code = await findCode(s, e.id, rawCode), full = code && code.maxUses && await usesOf(s, code) >= code.maxUses, c = full ? null : code;
  const types = (await typesView(s, e.id)).filter((t) => t.state !== 'off' && (!t.hidden || covers(c, t.id))).map((t) => {
    const p = price([{ t, qty: 1 }], c, set).items[0];
    return { id: t.id, name: t.name, description: t.description || '', price: t.price, now: p.unitNet, fee: p.unitFee, state: t.state, min: t.min, max: t.left == null ? t.max : Math.min(t.max, t.left), admits: t.admits || 1, low: t.left != null && t.left > 0 && t.left <= Math.max(5, Math.round(t.stock * 0.1)), opens: t.state === 'soon' ? t.saleStart || '' : '', resale: t.state === 'on' && t.left != null && t.left <= t.resale && t.resale > 0,
      notify: shop.waitlist !== false && (t.state === 'soldout' ? 'waitlist' : t.state === 'soon' ? 'onsale' : '') };
  });
  return { enabled: true, ready: !why, currency: shop.currency, note: shop.note, types, code: rawCode ? (c ? { ok: true, code: c.code } : { ok: false, error: full ? 'This code has been used up.' : 'This code is not valid.' }) : null,
    seller: set.seller, terms: set.terms, refundPolicy: set.refundPolicy, test: set.provider === 'test', holdMinutes: HOLD_MIN, installments: set.provider === 'iyzico' && !!set.installments };
}
async function settle(s, e, o, res, origin) { // payment result → tickets, or the stock goes back
  if (o.status === 'paid') return o;
  if (!res.paid) { o.payment = { ...(o.payment || {}), lastError: res.error || '' }; await s.set(orderKey(o), o); return o; }
  o.payment = { ...(o.payment || {}), ref: res.ref, items: res.items || [], at: now() };
  if (o.status === 'expired' || o.status === 'cancelled') {
    // paid after the basket was given back: take the stock again, or refund at once if it is gone
    const ts = await typesOf(e.id); o.slots = []; let ok = true;
    for (const it of o.items) { const t = ts.find((x) => x.id === it.typeId), got = t && await reserve(s, t, it.qty, o.id); if (!got) { ok = false; break; } o.slots.push(...got); }
    if (!ok) {
      await pool(o.slots, 8, (k) => s.del(k)); o.slots = [];
      const p = provider(o.provider), rf = p.error ? { ok: false, error: p.error } : await p.refund(o, o.total, { ip: '' });
      o.status = 'refunded'; o.refunds = [{ at: now(), by: 'Otomatik', amount: o.total, reason: 'Ödeme geldiğinde biletler tükenmişti', ok: rf.ok, ref: rf.ref || '', error: rf.error || '' }];
      await s.set(orderKey(o), o); return o;
    }
  }
  await issue(s, e, o, origin); return o;
}
const payPage = (o, e) => '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Test payment — More Life</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600&display=swap"><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/guest.css"></head><body><div class="g-wrap"><a class="g-logo" href="/"><img src="/img/logo.svg" alt="">more life</a><main class="g-card"><span class="g-pill hot">Test payment · no money moves</span><h1 class="g-title">' + o.total.toFixed(2) + ' <span class="serif accent">' + o.currency + '</span></h1><p style="color:var(--mute)">' + String(e.title).replace(/[&<>"]/g, '') + ' · order ' + o.no + '. This page stands in for the card page of the payment provider on preview data.</p><form method="post" action="/api/public/pay/test?o=' + o.token + '" style="display:flex;flex-direction:column;gap:10px"><button class="btn" name="result" value="ok" id="pay-ok" type="submit">Approve payment</button><button class="btn quiet" name="result" value="fail" id="pay-fail" type="submit">Decline</button></form></main></div></body></html>';

export async function ticketsPublic(req, ctx, parts, url, s, h) { // h: { limited, ip }
  const m = req.method;
  if (parts[0] === 'shop' && m === 'GET') {
    const e = await eventFor(s, { slug: url.searchParams.get('slug') || '', t: url.searchParams.get('t') || '' }); if (!e) return fail(404, 'Not found');
    return json(await shopView(s, e, url.searchParams.get('code') || ''));
  }
  if (parts[0] === 'checkout' && m === 'POST') {
    const b = await body(req), L = langOf(b.lang), say = (en, tr) => tx(L, en, tr);
    if (str(b.website)) return json({ ok: true }); // honeypot
    if (await h.limited('checkout/' + hash(h.ip), 120, 3600)) // generous: a venue's wifi or a mobile carrier puts many buyers behind one address
      return fail(429, say('Too many attempts. Please try again later.', 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.'));
    const e = await eventFor(s, b); if (!e) return fail(404, say('This event is not available.', 'Bu etkinlik şu an açık değil.'));
    const shop = await shopOf(s, e.id), set = await tixSettings(s), why = blocked(set), le = live(e);
    if (!shop.enabled || le.eventStatus === 'cancelled') return fail(409, say('Tickets are not on sale for this event.', 'Bu etkinlik için bilet satışı açık değil.'));
    if (why) return fail(409, say('Ticket sales are not open yet.', 'Bilet satışı henüz açılmadı.'));
    const buyer = { name: str(b.name, 120), email: normEmail(b.email), phone: str(b.phone, 40), city: str(b.city, 80), country: str(b.country, 60) };
    if (buyer.name.split(/\s+/).length < 2 || !emailOk(buyer.email)) return fail(400, say('Please enter your full name and a valid email.', 'Lütfen adınızı soyadınızı ve geçerli bir e-posta girin.'));
    if (b.terms !== true) return fail(400, say('Please accept the terms of sale to continue.', 'Devam etmek için satış koşullarını kabul edin.'));
    await sweep(s, e.id);
    const view = await typesView(s, e.id), code = await findCode(s, e.id, b.code), lines = [];
    if (b.code && !code) return fail(400, say('This code is not valid.', 'Bu kod geçerli değil.'));
    for (const x of Array.isArray(b.items) ? b.items.slice(0, 20) : []) {
      const t = view.find((y) => y.id === x.typeId), qty = int(x.qty, 0, 20); if (!qty) continue;
      if (!t || t.state === 'off' || (t.hidden && !covers(code, t.id))) return fail(400, say('A ticket in your basket is no longer available.', 'Sepetinizdeki bir bilet artık satışta değil.'));
      if (t.state !== 'on') return fail(409, t.name + (t.state === 'soldout' ? say(' is sold out.', ' tükendi.') : say(' is not on sale right now.', ' şu an satışta değil.')));
      if (qty < t.min || qty > t.max) return fail(400, t.name + say(': choose between ' + t.min + ' and ' + t.max + '.', ': ' + t.min + ' ile ' + t.max + ' arasında seçin.'));
      lines.push({ t, qty });
    }
    if (!lines.length) return fail(400, say('Please choose at least one ticket.', 'Lütfen en az bir bilet seçin.'));
    const pr = price(lines, code, set), u = b.utm && typeof b.utm === 'object' ? b.utm : {}, utm = {};
    for (const k of ['source', 'medium', 'campaign', 'content']) if (u[k]) utm[k] = str(u[k], 80).toLowerCase();
    const o = { id: id(), no: orderNo(), token: token(24), eventId: e.id, status: 'pending', channel: 'online', provider: pr.total > 0 ? set.provider : 'free', currency: shop.currency, ...pr, code: code ? code.code : '', buyer, lang: L, utm, ref: str(b.ref, 20).replace(/[^A-Za-z0-9_-]/g, ''),
      slots: [], tickets: [], refunds: [], terms: { at: now(), hash: hash(set.terms + '|' + set.refundPolicy) }, createdAt: now(), expiresAt: new Date(Date.now() + HOLD_MIN * 60000).toISOString() };
    for (const { t, qty } of lines) { const got = await reserve(s, t, qty, o.id); if (!got) { await pool(o.slots, 8, (k) => s.del(k)); return fail(409, t.name + say(' just sold out.', ' az önce tükendi.')); } o.slots.push(...got); }
    if (code) { // a use is one record per order; when two buyers race for the last use, the earlier record keeps it
      const dir = 'tcodeUse/' + e.id + '/' + code.code + '/', k = dir + o.id, full = async () => { await pool(o.slots, 8, (x) => s.del(x)); return fail(409, say('This code has been used up.', 'Bu kodun kullanım hakkı doldu.')); };
      if (code.maxUses && (await s.list(dir)).length >= code.maxUses) return full();
      await s.set(k, { at: now() });
      if (code.maxUses) {
        const keys = await s.list(dir);
        if (keys.length > code.maxUses) {
          const uses = (await pool(keys, 8, async (x) => ({ x, at: ((await s.get(x)) || {}).at || '' }))).sort((p, q) => p.at.localeCompare(q.at) || p.x.localeCompare(q.x));
          if (uses.findIndex((u) => u.x === k) >= code.maxUses) { await s.del(k); return full(); }
        }
      }
    }
    o.contactId = await upsertBuyer(s, buyer);
    await s.set(orderKey(o), o); await s.set('orderTok/' + o.token, { eventId: e.id, id: o.id }); await s.set('pending/' + e.id + '/' + o.id, { exp: o.expiresAt });
    if (o.total === 0) { await issue(s, e, o, url.origin); return json({ ok: true, url: '/order?t=' + o.token }); }
    try { const p = provider(set.provider), st = await p.start(o, { origin: url.origin, ip: h.ip, installments: !!set.installments }); o.payment = { provider: set.provider, session: st.session || '' }; await s.set(orderKey(o), o); return json({ ok: true, url: st.url, expiresAt: o.expiresAt }); }
    catch (err) { o.status = 'cancelled'; await releaseStock(s, o); o.payment = { lastError: String(err.message || err) }; await s.set(orderKey(o), o); console.error('pay start', err); return fail(502, say('The payment page could not be opened. Please try again.', 'Ödeme sayfası açılamadı. Lütfen tekrar deneyin.')); }
  }
  // "Tell me when I can buy": for a sold-out type (waitlist) or one whose sale has not opened yet
  if (parts[0] === 'waitlist' && m === 'POST') {
    const b = await body(req), L = langOf(b.lang);
    if (str(b.website)) return json({ ok: true });
    if (await h.limited('wait/' + hash(h.ip), 30, 3600)) return fail(429, tx(L, 'Too many attempts. Please try again later.', 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.'));
    const e = await eventFor(s, b); if (!e) return fail(404, 'Not found');
    const shop = await shopOf(s, e.id), t = (await typesView(s, e.id)).find((x) => x.id === b.typeId), email = normEmail(b.email);
    if (!shop.enabled || shop.waitlist === false || !t || !['soldout', 'soon'].includes(t.state)) return fail(409, tx(L, 'This list is not open.', 'Bu liste açık değil.'));
    if (!emailOk(email)) return fail(400, tx(L, 'Please enter a valid email.', 'Lütfen geçerli bir e-posta girin.'));
    const w = { id: hash(t.id + '|' + email).slice(0, 20), eventId: e.id, typeId: t.id, email, name: str(b.name, 120), qty: int(b.qty, 1, 6, 1), kind: t.state === 'soon' ? 'onsale' : 'waitlist', lang: L, status: 'waiting', at: now() };
    await s.set('twait/' + e.id + '/' + w.id, w); // one place per e-mail and type; asking again renews it
    return json({ ok: true });
  }
  // order by its private link
  const ref = async (t) => { const r = t && await s.get('orderTok/' + str(t, 60)); const o = r && await s.get('orders/' + r.eventId + '/' + r.id); return o && o.token === t ? o : null; };
  if (parts[0] === 'pay') { // the provider (or the test page) reports back; the buyer always lands on their order page
    const o = await ref(url.searchParams.get('o')), e = o && await s.get('events/' + o.eventId); if (!o || !e) return fail(404, 'Order not found');
    const back = new Response(null, { status: 303, headers: { location: '/order?t=' + o.token } });
    if (m !== 'POST' || o.status === 'paid' || o.provider !== parts[1]) return back;
    const form = Object.fromEntries(new URLSearchParams(await req.text())), p = provider(o.provider);
    if (!p.error) await settle(s, e, o, await p.confirm(o, form), url.origin);
    return back;
  }
  if (parts[0] === 'order' && m === 'GET') {
    const o = await ref(url.searchParams.get('t')), e = o && await s.get('events/' + o.eventId); if (!o || !e) return fail(404, 'This order link is not valid.');
    if (o.status === 'pending' && o.payment && o.payment.session && Date.now() - Date.parse(o.createdAt) > 20000) { // back from the payment page before the provider's own call arrived
      const pr = provider(o.provider), res = pr.error || !pr.check ? null : await pr.check(o).catch(() => null); if (res && res.paid) await settle(s, e, o, res, url.origin);
    }
    const le = live(e) || e, shop = await shopOf(s, e.id), ts = await ticketsFor(s, o), set = await tixSettings(s), types = await typesOf(e.id), started = !!le.date && le.date < istToday();
    return json({ order: { no: o.no, status: o.status, items: o.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, unitNet: i.unitNet })), subtotal: o.subtotal, discount: o.discount, fee: o.fee, total: o.total, currency: o.currency, refunded: refunded(o), name: o.buyer.name, email: o.buyer.email, paidAt: o.paidAt || '', expiresAt: o.expiresAt, error: (o.payment && o.payment.lastError) || '',
        payUrl: o.status === 'pending' && o.provider === 'test' ? '/pay/test?o=' + o.token : '' },
      lang: o.lang || 'en', tickets: ts.map((t) => ({ id: t.id, type: t.typeName, name: t.name, status: t.status, checkedIn: !!t.checkedInAt, url: t.status === 'valid' ? '/pass?t=' + t.token : '', resold: !!t.resoldTo, listed: !!t.listed,
        canResell: shop.resale === true && !started && t.status === 'valid' && !t.checkedInAt && ((types.find((x) => x.id === t.typeId) || {}).admits || 1) === 1, back: t.net != null ? t.net : t.paid || 0 })), transfers: shop.transfers !== false,
      event: { title: le.title, date: le.date, time: le.time, venue: le.venue, city: le.city, image: le.imageId ? '/api/public/image/' + le.imageId : '', url: isListed(e) ? '/events/' + le.slug : '' }, support: set.supportEmail });
  }
  // the buyer puts a ticket in someone else's name: the old QR stops working and the new holder gets theirs by e-mail
  if (parts[0] === 'ticket' && m === 'POST') {
    const b = await body(req), o = await ref(b.o), e = o && await s.get('events/' + o.eventId), t = o && (o.tickets || []).includes(b.ticketId) && await s.get('tickets/' + o.eventId + '/' + str(b.ticketId, 40));
    if (!o || !e || !t || o.status !== 'paid' && o.status !== 'partial') return fail(404, 'Ticket not found.');
    if (await h.limited('transfer/' + hash(h.ip), 30, 3600)) return fail(429, 'Too many attempts. Please try again later.');
    if (t.status !== 'valid' || t.checkedInAt) return fail(409, 'This ticket can no longer be changed.');
    if (t.listed) return fail(409, 'This ticket is listed for resale. Take it off sale first.');
    if ((await shopOf(s, e.id)).transfers === false) return fail(403, 'Tickets for this event cannot be transferred.');
    const name = str(b.name, 120), email = b.email ? normEmail(b.email) : t.email;
    if (name.split(/\s+/).length < 2 || !emailOk(email)) return fail(400, 'Please enter the new holder’s full name and a valid email.');
    const moved = email !== t.email;
    if (moved) { await s.del('passes/' + t.token); t.token = token(24); await s.set('passes/' + t.token, { eventId: e.id, ticketId: t.id }); t.transfers = (t.transfers || []).concat({ at: now(), from: t.email, to: email }).slice(-10); }
    t.name = name; t.email = email; await s.set('tickets/' + e.id + '/' + t.id, t);
    if (moved) await sendOrder(live(e) || e, { ...o, buyer: { name, email } }, [t], url.origin, true);
    return json({ ok: true, moved, url: '/pass?t=' + t.token });
  }
  // The holder puts a ticket back on sale at the price they paid. It stays theirs, and valid, until someone buys it;
  // at that moment the old QR dies and the ticket price goes back to the card it was paid with.
  if (parts[0] === 'resale' && m === 'POST') {
    const b = await body(req), o = await ref(b.o), e = o && await s.get('events/' + o.eventId), t = o && (o.tickets || []).includes(b.ticketId) && await s.get('tickets/' + o.eventId + '/' + str(b.ticketId, 40));
    if (!o || !e || !t) return fail(404, 'Ticket not found.');
    const L = langOf(o.lang), shop = await shopOf(s, e.id), ty = (await typesOf(e.id)).find((x) => x.id === t.typeId), le = live(e) || e, key = 'tresale/' + t.typeId + '/' + t.id;
    if (shop.resale !== true) return fail(403, tx(L, 'Resale is not available for this event.', 'Bu etkinlikte yeniden satış kapalı.'));
    if (t.status !== 'valid' || t.checkedInAt || (le.date && le.date < istToday()) || !ty || (ty.admits || 1) !== 1) return fail(409, tx(L, 'This ticket cannot be put on sale.', 'Bu bilet satışa konulamaz.'));
    if (b.list === false) {
      if (await s.get('tresaleTaken/' + t.typeId + '/' + t.id)) return fail(409, tx(L, 'Someone is buying this ticket right now. Check again in a few minutes.', 'Şu an biri bu bileti satın alıyor. Birkaç dakika sonra tekrar bakın.'));
      await s.del(key); t.listed = false; await s.set('tickets/' + e.id + '/' + t.id, t); return json({ ok: true, listed: false });
    }
    await s.set(key, { at: now(), orderId: o.id }); t.listed = true; await s.set('tickets/' + e.id + '/' + t.id, t);
    await notifyWaitlist(s, e, url.origin);
    return json({ ok: true, listed: true });
  }
  return fail(404, 'Not found');
}
export const testPayPage = async (s, url) => { const r = await s.get('orderTok/' + str(url.searchParams.get('o'), 60)), o = r && await s.get('orders/' + r.eventId + '/' + r.id), e = o && await s.get('events/' + o.eventId); return o && e && o.status === 'pending' && o.provider === 'test' && !provider('test').error ? payPage(o, live(e) || e) : null; };

/* ---------- admin ---------- */
// What was sold: money in, fees, refunds, by type, by day and by where buyers came from.
function salesOf(orders, tickets, types) {
  const paid = orders.filter((o) => ['paid', 'partial', 'refunded'].includes(o.status)), sum = (f) => r2(paid.reduce((n, o) => n + f(o), 0)), byDay = {}, byType = {}, bySource = {}, byCode = {};
  for (const t of types) byType[t.id] = { id: t.id, name: t.name, stock: t.stock, sold: 0, checkedIn: 0, revenue: 0 };
  for (const t of tickets) { const x = byType[t.typeId] || (byType[t.typeId] = { id: t.typeId, name: t.typeName, stock: 0, sold: 0, checkedIn: 0, revenue: 0 }); if (t.status === 'valid') { x.sold += 1; x.revenue = r2(x.revenue + (t.paid || 0)); if (t.checkedInAt) x.checkedIn += 1; } }
  for (const o of paid) {
    const d = new Date(Date.parse(o.paidAt || o.createdAt) + 3 * 3600 * 1000).toISOString().slice(0, 10), net = r2(o.total - refunded(o)), n = o.items.reduce((a, i) => a + i.qty * i.admits, 0);
    byDay[d] = byDay[d] || { day: d, orders: 0, tickets: 0, revenue: 0 }; byDay[d].orders += 1; byDay[d].tickets += n; byDay[d].revenue = r2(byDay[d].revenue + net);
    const src = o.channel !== 'online' ? (o.channel === 'comp' ? 'Davetiye' : 'Kapı satışı') : (o.utm && o.utm.source ? [o.utm.source, o.utm.medium, o.utm.campaign].filter(Boolean).join(' / ') : 'Doğrudan');
    bySource[src] = bySource[src] || { name: src, orders: 0, tickets: 0, revenue: 0 }; bySource[src].orders += 1; bySource[src].tickets += n; bySource[src].revenue = r2(bySource[src].revenue + net);
    if (o.code) { byCode[o.code] = byCode[o.code] || { code: o.code, orders: 0, discount: 0 }; byCode[o.code].orders += 1; byCode[o.code].discount = r2(byCode[o.code].discount + o.discount); }
  }
  const valid = tickets.filter((t) => t.status === 'valid'), w = Date.now() - 7 * 864e5, w2 = Date.now() - 14 * 864e5, at = (o) => Date.parse(o.paidAt || o.createdAt), cnt = (list) => list.reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty * i.admits, 0), 0);
  return { orders: paid.length, tickets: valid.length, checkedIn: valid.filter((t) => t.checkedInAt).length, gross: sum((o) => o.total), fees: sum((o) => o.fee), discounts: sum((o) => o.discount), refunds: sum(refunded), net: r2(sum((o) => o.total) - sum(refunded)),
    last7: cnt(paid.filter((o) => at(o) >= w)), prev7: cnt(paid.filter((o) => at(o) < w && at(o) >= w2)), pending: orders.filter((o) => o.status === 'pending').length,
    byType: Object.values(byType), byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)).slice(-60), bySource: Object.values(bySource).sort((a, b) => b.revenue - a.revenue || b.tickets - a.tickets), byCode: Object.values(byCode) };
}
// Sales figures of one event for other screens (Özet, Marketing). Null when the event sells no tickets here.
export async function eventSales(s, eventId) {
  if (!(await s.list('ttypes/' + eventId + '/')).length) return null;
  const [os, ts, types, shop] = await Promise.all([ordersOf(eventId), ticketsOf(eventId), typesOf(eventId), shopOf(s, eventId)]), x = salesOf(os, ts, types);
  return { enabled: shop.enabled, currency: shop.currency, tickets: x.tickets, net: x.net, last7: x.last7, prev7: x.prev7, stock: types.every((t) => t.stock) ? types.reduce((n, t) => n + t.stock * (t.admits || 1), 0) : null };
}
export const eventTickets = async (eventId) => (await ticketsOf(eventId)).filter((t) => t.status === 'valid');
export async function findTicket(s, eventId, ticketId) { return s.get('tickets/' + eventId + '/' + ticketId); }

async function refund(s, e, o, b, me, url, ip) {
  const ts = await ticketsFor(s, o), ids = Array.isArray(b.ticketIds) && b.ticketIds.length ? b.ticketIds.map(String) : ts.filter((t) => t.status === 'valid').map((t) => t.id), pick = ts.filter((t) => ids.includes(t.id) && t.status === 'valid');
  if (!pick.length) return fail(400, 'İade edilecek geçerli bilet yok.');
  const left = r2(o.total - refunded(o)), wholeOrder = pick.length === ts.filter((t) => t.status === 'valid').length;
  // fees go back with the ticket unless the admin keeps them; the last tickets of an order take whatever is left, so cents never go missing
  let amount = b.amount != null && b.amount !== '' ? money(b.amount) : wholeOrder ? left : r2(pick.reduce((n, t) => n + (t.paid || 0), 0));
  if (amount == null || amount > left + 0.001) return fail(400, 'İade tutarı kalan tutarı (' + left.toFixed(2) + ' ' + o.currency + ') aşamaz.');
  let rf = { ok: true, ref: '' };
  if (amount > 0 && o.channel === 'online' && o.provider !== 'free') { const p = provider(o.provider); rf = p.error ? { ok: false, error: p.error } : await p.refund(o, amount, { ip }); }
  if (!rf.ok) { if (rf.partial) { o.refunds.push({ at: now(), by: me.name, amount: rf.partial, ticketIds: [], reason: 'Kısmi: sağlayıcı kalanını reddetti', ok: true, ref: '' }); await s.set(orderKey(o), o); } return fail(502, 'Sağlayıcı iadeyi reddetti: ' + (rf.error || '') + ' Biletler iptal edilmedi.'); }
  for (const t of pick) { t.status = 'void'; t.voidAt = now(); await s.del('passes/' + t.token); await s.set('tickets/' + e.id + '/' + t.id, t); }
  if (b.restock !== false) { // the units go back on sale
    const byType = {}; for (const t of pick) byType[t.typeId] = (byType[t.typeId] || 0) + 1;
    for (const it of o.items) { // a unit is freed only when every ticket it admitted has been refunded
      const mine = (o.slots || []).filter((k) => k.startsWith('tstock/' + it.typeId + '/')), free = mine.slice(0, Math.floor((byType[it.typeId] || 0) / it.admits));
      await pool(free, 8, (k) => s.del(k)); o.slots = (o.slots || []).filter((k) => !free.includes(k));
    }
  }
  o.refunds.push({ at: now(), by: me.name, amount, ticketIds: pick.map((t) => t.id), reason: str(b.reason, 200), ok: true, ref: rf.ref || '' });
  o.status = wholeOrder ? 'refunded' : 'partial'; await s.set(orderKey(o), o);
  for (const t of pick) if (t.listed) { await s.del('tresale/' + t.typeId + '/' + t.id); await s.del('tresaleTaken/' + t.typeId + '/' + t.id); }
  if (b.notify !== false && o.buyer.email) await sendRefund(live(e) || e, o, amount, pick.length, url.origin, o.lang);
  if (b.restock !== false) await notifyWaitlist(s, e, url.origin);
  return json({ order: orderView(o), refund: { amount, tickets: pick.length, currency: o.currency } });
}

export async function ticketsAdmin(req, parts, url, s, me, ip) {
  const m = req.method;
  if (parts[1] === 'settings') {
    const cur = await tixSettings(s);
    if (m === 'GET') return json({ settings: cur, providers: providerStatus(), blocked: blocked(cur), email: emailStatus(), currencies: CURRENCIES });
    if (m === 'PUT') {
      const b = await body(req), n = { ...cur };
      if ('provider' in b) n.provider = ['test', 'iyzico'].includes(b.provider) ? b.provider : '';
      if ('feeMode' in b) n.feeMode = b.feeMode === 'absorb' ? 'absorb' : 'buyer';
      if ('installments' in b) n.installments = !!b.installments;
      if ('feePct' in b) { n.feePct = money(b.feePct); if (n.feePct == null || n.feePct > 30) return fail(400, 'Hizmet bedeli yüzdesi 0–30 arasında olmalı.'); }
      if ('feeFixed' in b) { n.feeFixed = money(b.feeFixed); if (n.feeFixed == null) return fail(400, 'Sabit hizmet bedeli geçersiz.'); }
      for (const [k, max] of [['seller', 600], ['terms', 20000], ['refundPolicy', 6000]]) if (k in b) n[k] = str(b[k], max);
      if ('supportEmail' in b) { n.supportEmail = normEmail(b.supportEmail); if (n.supportEmail && !emailOk(n.supportEmail)) return fail(400, 'Destek e-postası geçersiz.'); }
      await s.set('settings/tickets', n); return json({ settings: n, blocked: blocked(n) });
    }
  }
  if (parts[1] === 'sales' && m === 'GET') { // every event that sells tickets, newest first
    const out = [];
    for (const e of await all('events/')) { const x = await eventSales(s, e.id); if (x) out.push({ id: e.id, title: e.title, date: e.date, status: e.status, ...x }); }
    return json({ events: out.sort((a, b) => (b.date || '').localeCompare(a.date || '')), blocked: blocked(await tixSettings(s)) });
  }
  const e = await s.get('events/' + parts[1]); if (!e) return fail(404, 'Etkinlik bulunamadı.');
  const sub = parts[2];
  if (!sub && m === 'GET') {
    await sweep(s, e.id);
    const [types, os, ts, shop, set] = await Promise.all([typesView(s, e.id), ordersOf(e.id), ticketsOf(e.id), shopOf(s, e.id), tixSettings(s)]), codes = (await all('tcodes/' + e.id + '/')).sort((a, b) => a.code.localeCompare(b.code));
    for (const c of codes) c.uses = await usesOf(s, c);
    const waits = (await all('twait/' + e.id + '/')).filter((w) => w.status === 'waiting'); for (const t of types) t.waiting = waits.filter((w) => w.typeId === t.id).reduce((n, w) => n + w.qty, 0);
    return json({ event: { id: e.id, title: e.title, slug: e.live ? e.live.slug : e.slug, status: e.status, visibility: e.visibility, inviteUrl: '/invite?t=' + e.inviteToken, listed: isListed(e), externalTickets: !!(e.useTickets && e.ticketUrl) }, shop, types, codes, sales: salesOf(os, ts, types), blocked: blocked(set), provider: set.provider, fee: { mode: set.feeMode, pct: set.feePct, fixed: set.feeFixed }, currencies: CURRENCIES });
  }
  if (sub === 'shop' && m === 'PUT') {
    const b = await body(req), cur = await shopOf(s, e.id), n = { ...cur };
    if ('enabled' in b) n.enabled = !!b.enabled;
    for (const k of ['transfers', 'waitlist', 'resale', 'remind']) if (k in b) n[k] = !!b[k];
    if ('note' in b) n.note = str(b.note, 300);
    if ('currency' in b && b.currency !== cur.currency) { if ((await s.list('orders/' + e.id + '/')).length) return fail(409, 'Sipariş alındıktan sonra para birimi değiştirilemez.'); n.currency = CURRENCIES.includes(b.currency) ? b.currency : 'TRY'; }
    if (n.enabled && !(await s.list('ttypes/' + e.id + '/')).length) return fail(400, 'Satışı açmadan önce en az bir bilet türü ekleyin.');
    await s.set('tshop/' + e.id, n); return json({ shop: n, eventTitle: e.title });
  }
  if (sub === 'types') {
    if (!parts[3] && m === 'POST') {
      const r = typeInput(await body(req), { id: id(), eventId: e.id, name: '', description: '', price: 0, stock: 0, min: 1, max: 10, admits: 1, order: (await s.list('ttypes/' + e.id + '/')).length, saleStart: '', saleEnd: '', hidden: false, status: 'on', after: '', createdAt: now() }); if (r.error) return fail(400, r.error);
      await s.set('ttypes/' + e.id + '/' + r.type.id, r.type); return json({ type: r.type, eventTitle: e.title }, 201);
    }
    const t = await s.get('ttypes/' + e.id + '/' + parts[3]); if (!t) return fail(404, 'Bilet türü bulunamadı.');
    if (m === 'PUT') {
      const r = typeInput(await body(req), t); if (r.error) return fail(400, r.error);
      const taken = await takenOf(s, t.id); if (r.type.stock && r.type.stock < taken) return fail(409, 'Stok, satılan ve sepette tutulan adetten (' + taken + ') az olamaz.');
      if (!r.type.stock && t.stock && taken) return fail(409, 'Satış başladıktan sonra stok sınırı kaldırılamaz; daha yüksek bir sayı girin.');
      await s.set('ttypes/' + e.id + '/' + t.id, r.type); await notifyWaitlist(s, e, url.origin); // more stock or an earlier sale may let waiting people in
      return json({ type: r.type, eventTitle: e.title });
    }
    if (m === 'DELETE') { if (await takenOf(s, t.id)) return fail(409, 'Bu türden bilet satıldı; silmek yerine satışı kapatın.'); await s.del('ttypes/' + e.id + '/' + t.id); return json({ ok: true, type: t, eventTitle: e.title }); }
  }
  if (sub === 'codes') {
    if (!parts[3] && m === 'POST') {
      const r = codeInput(await body(req), { eventId: e.id, code: '', kind: 'percent', value: 0, typeIds: [], maxUses: 0, start: '', end: '', active: true, note: '', createdAt: now() }); if (r.error) return fail(400, r.error);
      if (!(await s.create('tcodes/' + e.id + '/' + r.code.code, r.code))) return fail(409, 'Bu kod zaten var.');
      return json({ code: r.code, eventTitle: e.title }, 201);
    }
    const c = await s.get('tcodes/' + e.id + '/' + normCode(parts[3])); if (!c) return fail(404, 'Kod bulunamadı.');
    if (m === 'PUT') { const r = codeInput(await body(req), c); if (r.error) return fail(400, r.error); await s.set('tcodes/' + e.id + '/' + c.code, r.code); return json({ code: r.code, eventTitle: e.title }); }
    if (m === 'DELETE') { await s.del('tcodes/' + e.id + '/' + c.code); return json({ ok: true, code: c, eventTitle: e.title }); }
  }
  if (sub === 'orders.csv') {
    const os = (await ordersOf(e.id)).filter((o) => o.status !== 'pending' && o.status !== 'expired' && o.status !== 'cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return csv('siparisler-' + e.slug + '.csv', [['Sipariş', 'Durum', 'Kanal', 'Ad Soyad', 'E-posta', 'Telefon', 'Biletler', 'Ara toplam', 'İndirim', 'Hizmet bedeli', 'Toplam', 'İade', 'Para birimi', 'Kod', 'Kaynak', 'Kampanya', 'Ödeme', 'Sağlayıcı ref.']].concat(os.map((o) => [o.no, o.status, o.channel, o.buyer.name, o.buyer.email, o.buyer.phone, o.items.map((i) => i.qty + '× ' + i.name).join(' + '), o.subtotal, o.discount, o.fee, o.total, refunded(o), o.currency, o.code, (o.utm && o.utm.source) || '', (o.utm && o.utm.campaign) || '', o.paidAt, (o.payment && o.payment.ref) || ''])));
  }
  if (sub === 'waitlist.csv') { const ts = await typesOf(e.id); return csv('bekleme-listesi-' + e.slug + '.csv', [['Tür', 'Ad', 'E-posta', 'Adet', 'Liste', 'Durum', 'Kayıt', 'Bildirim']].concat((await all('twait/' + e.id + '/')).sort((a, b) => a.at.localeCompare(b.at)).map((w) => [(ts.find((x) => x.id === w.typeId) || {}).name || '', w.name, w.email, w.qty, w.kind === 'onsale' ? 'satış açılışı' : 'bekleme', w.status === 'waiting' ? 'bekliyor' : 'bildirildi', w.at, w.notifiedAt || '']))); }
  if (sub === 'tickets.csv') return csv('biletler-' + e.slug + '.csv', [['Bilet', 'Tür', 'Ad Soyad', 'E-posta', 'Sipariş', 'Durum', 'Giriş', 'Girişi yapan']].concat((await ticketsOf(e.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((t) => [t.id, t.typeName, t.name, t.email, t.orderNo, t.status === 'valid' ? 'geçerli' : 'iptal', t.checkedInAt, t.checkedInBy || ''])));
  if (sub === 'orders') {
    if (!parts[3] && m === 'GET') {
      const q = (url.searchParams.get('q') || '').toLocaleLowerCase('tr'), st = url.searchParams.get('status') || '';
      const os = (await ordersOf(e.id)).filter((o) => (st ? o.status === st : !['expired', 'cancelled'].includes(o.status)) && (!q || (o.no + ' ' + o.buyer.name + ' ' + o.buyer.email + ' ' + o.buyer.phone + ' ' + o.code).toLocaleLowerCase('tr').includes(q))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json({ orders: os.slice(0, 300).map(orderView), total: os.length });
    }
    // Tickets given or sold by the team: comp (free, guest list) or box office (paid at the door in cash or by card terminal).
    if (!parts[3] && m === 'POST') {
      const b = await body(req), channel = b.channel === 'boxoffice' ? 'boxoffice' : 'comp', view = await typesView(s, e.id), t = view.find((x) => x.id === b.typeId), qty = int(b.qty, 1, 50, 1), shop = await shopOf(s, e.id);
      const buyer = { name: str(b.name, 120), email: b.email ? normEmail(b.email) : '', phone: str(b.phone, 40) };
      if (!t) return fail(400, 'Bilet türü seçin.');
      if (!buyer.name) return fail(400, 'Ad soyad gerekli.');
      if (buyer.email && !emailOk(buyer.email)) return fail(400, 'E-posta geçersiz.');
      const unit = channel === 'comp' ? 0 : (b.unit != null && b.unit !== '' ? money(b.unit) : t.price); if (unit == null) return fail(400, 'Tutar geçersiz.');
      const o = { id: id(), no: orderNo(), token: token(24), eventId: e.id, status: 'pending', channel, provider: channel === 'comp' ? 'free' : 'door', method: channel === 'boxoffice' ? (b.method === 'card' ? 'card' : 'cash') : '', currency: shop.currency, items: [{ typeId: t.id, name: t.name, qty, unit, unitNet: unit, unitFee: 0, admits: t.admits || 1 }], subtotal: r2(unit * qty), discount: 0, fee: 0, total: r2(unit * qty), code: '', buyer, utm: {}, ref: '', slots: [], tickets: [], refunds: [], note: str(b.note, 200), by: me.name, createdAt: now(), expiresAt: now() };
      const got = await reserve(s, t, qty, o.id); if (!got) return fail(409, t.name + ' için yeterli stok yok (' + (t.left == null ? '∞' : t.left) + ' kaldı).');
      o.slots = got; if (buyer.email) o.contactId = await upsertBuyer(s, buyer);
      await s.set('orderTok/' + o.token, { eventId: e.id, id: o.id }); await issue(s, e, o, url.origin, b.send === false || !buyer.email);
      return json({ order: orderView(o), tickets: (await ticketsFor(s, o)).map((x) => ({ id: x.id, url: '/pass?t=' + x.token })), eventTitle: e.title }, 201);
    }
    const o = await s.get('orders/' + e.id + '/' + parts[3]); if (!o) return fail(404, 'Sipariş bulunamadı.');
    if (!parts[4] && m === 'GET') return json({ order: orderView(o), tickets: await ticketsFor(s, o), mail: emailStatus() });
    if (parts[4] === 'refund' && m === 'POST') { if (!['paid', 'partial'].includes(o.status)) return fail(409, 'Bu sipariş iade edilemez.'); return refund(s, e, o, await body(req), me, url, ip); }
    if (parts[4] === 'resend' && m === 'POST') {
      if (!['paid', 'partial'].includes(o.status) || !o.buyer.email) return fail(400, 'Gönderilecek geçerli bilet ya da e-posta adresi yok.');
      if (!emailStatus().connected) return fail(409, 'E-posta servisi bağlı değil.');
      o.mail = await sendOrder(live(e) || e, o, (await ticketsFor(s, o)).filter((t) => t.status === 'valid'), url.origin); await s.set(orderKey(o), o);
      return o.mail.status === 'sent' ? json({ order: orderView(o) }) : fail(502, 'E-posta gönderilemedi: ' + (o.mail.error || ''));
    }
    if (parts[4] === 'preview' && m === 'GET') { const mm = orderMail(live(e) || e, o, await ticketsFor(s, o), url.origin); return json({ subject: mm.subject, html: mm.html }); }
  }
  return fail(404, 'Bulunamadı.');
}
