// Ticket sales: ticket types, stock, codes, checkout, orders, tickets, refunds, transfers and sales figures.
// Storage has no transactions, so every unit of stock is one record created atomically: two buyers can never hold the same unit.
import crypto from 'node:crypto';
import { all, pool } from './store.mjs';
import { id, token, hash } from './auth.mjs';
import { json, fail, now, str, int, emailOk, normEmail, normPhone, body, istNow, istToday, csv } from './util.mjs';
import { live, isListed, SITE_URL } from './model.mjs';
import { provider, providerStatus } from './payments.mjs';
import { sendOrder, sendRefund, sendWaitlist, sendCart, sendNotice, sendMyTickets, orderMail, emailStatus } from './email.mjs';

export const CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];
const HOLD_MIN = 12, GRACE_MIN = 8; // a basket is held for 12 minutes; its stock is released 8 minutes after that
const r2 = (n) => Math.round(n * 100) / 100;
const isDT = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
const money = (v) => { const n = r2(parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'))); return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null; };
const orderNo = () => 'ML-' + crypto.randomBytes(4).toString('hex').toUpperCase();

/* ---------- webhooks: tell another system when something is sold or refunded ---------- */
// Each call is signed (x-morelife-signature: sha256=<hmac of the body with the hook's secret>) and given three seconds.
// A hook that fails never holds up a sale; its last result is kept for the settings screen.
const hookOrder = (o) => ({ id: o.id, no: o.no, eventId: o.eventId, status: o.status, channel: o.channel, currency: o.currency, subtotal: o.subtotal, discount: o.discount, fee: o.fee, total: o.total, refunded: r2((o.refunds || []).reduce((n, r) => n + r.amount, 0)), code: o.code || '', promoter: o.promoter || '', utm: o.utm || {},
  buyer: { name: o.buyer.name, email: o.buyer.email, phone: o.buyer.phone || '' }, items: o.items.map((i) => ({ typeId: i.typeId, name: i.name, qty: i.qty, unit: i.unit, unitNet: i.unitNet, admits: i.admits })), answers: o.answers || [], paidAt: o.paidAt || '' });
export const hooksOf = async (s) => ((await s.get('settings/webhooks')) || { hooks: [] }).hooks;
export async function emit(s, type, data) {
  let hooks; try { hooks = (await hooksOf(s)).filter((h) => h.active && h.events.includes(type)); } catch { return; }
  if (!hooks.length) return;
  const body = JSON.stringify({ type, at: now(), data }); let changed = false;
  await Promise.all(hooks.map(async (h) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3000);
    try { const r = await fetch(h.url, { method: 'POST', redirect: 'manual', signal: ctl.signal, headers: { 'content-type': 'application/json', 'user-agent': 'MoreLife-HQ', 'x-morelife-event': type, 'x-morelife-signature': 'sha256=' + crypto.createHmac('sha256', h.secret).update(body).digest('hex') }, body }); h.last = { at: now(), type, status: r.status }; }
    catch (err) { h.last = { at: now(), type, status: 0, error: err.name === 'AbortError' ? 'zaman aşımı' : 'bağlantı kurulamadı' }; }
    clearTimeout(timer); changed = true;
  }));
  if (changed) { const all = await hooksOf(s); for (const h of all) { const x = hooks.find((y) => y.id === h.id); if (x) h.last = x.last; } await s.set('settings/webhooks', { hooks: all }); }
}
export const HOOK_EVENTS = [['order.paid', 'Sipariş ödendi (bilet üretildi)'], ['order.refunded', 'İade yapıldı'], ['ticket.transferred', 'Bilet başkasına devredildi'], ['ticket.checked_in', 'Kapıda giriş yapıldı']];

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
// Table map: a floor plan with tables buyers pick themselves. Each table belongs to a ticket type (its price zone) and is one
// unit of that type's stock, under its own number `n`; a number is never reused, so a removed table can never be confused with a new one.
export const mapOf = async (s, eventId) => ({ imageId: '', w: 1000, h: 640, tables: [], ...((await s.get('tmap/' + eventId)) || {}) });
const tablesOf = (map, typeId) => map.tables.filter((x) => x.typeId === typeId);
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
  if ('addon' in b) t.addon = !!b.addon;
  if ('deposit' in b) { if (b.deposit === '' || b.deposit == null) t.deposit = null; else { t.deposit = money(b.deposit); if (t.deposit == null) return { error: 'Depozito tutarı geçersiz.' }; } }
  if ('earlyFor' in b) t.earlyFor = str(b.earlyFor, 40);
  if ('earlyUntil' in b) { t.earlyUntil = str(b.earlyUntil, 16); if (t.earlyUntil && !isDT(t.earlyUntil)) return { error: 'Erken erişim bitiş zamanı geçersiz.' }; }
  if (!t.name) return { error: 'Bilet türüne bir ad verin.' };
  if (t.min > t.max) return { error: 'En az adet, en fazla adetten büyük olamaz.' };
  if (t.saleStart && t.saleEnd && t.saleEnd <= t.saleStart) return { error: 'Satış bitişi başlangıçtan sonra olmalı.' };
  if (t.after && t.after === t.id) return { error: 'Bir bilet türü kendisinden sonra açılamaz.' };
  if (t.deposit != null && (t.deposit <= 0 || t.deposit >= t.price)) return { error: 'Depozito, fiyattan küçük ve sıfırdan büyük olmalı.' };
  if (!!t.earlyFor !== !!t.earlyUntil) return { error: 'Erken erişim için hem kitle hem bitiş zamanı gerekli.' };
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
  const ts = await typesOf(eventId), map = await mapOf(s, eventId), takenBy = {}, byId = {}, open = {}, busy = {};
  await pool(ts, 8, async (t) => {
    const mine = tablesOf(map, t.id); byId[t.id] = t;
    if (mine.length) { // a mapped type: its stock is its tables
      const held = new Set((await s.list('tstock/' + t.id + '/')).map((k) => k.split('/')[2])); busy[t.id] = held; open[t.id] = 0;
      t.stock = mine.length; t.mapped = true; takenBy[t.id] = mine.filter((x) => held.has(String(x.n))).length; return;
    }
    open[t.id] = (await listingsOf(s, t.id)).length; takenBy[t.id] = (await takenOf(s, t.id)) - open[t.id]; // a listed ticket counts as available again
  });
  return ts.map((t) => ({ ...t, taken: takenBy[t.id], resale: open[t.id], left: t.stock ? Math.max(0, t.stock - takenBy[t.id]) : null, state: typeState(t, takenBy[t.id], byId, takenBy), busy: busy[t.id] || null }));
}
// Takes exactly these tables for an order, or none of them.
async function reserveTables(s, t, tables, orderId) {
  const made = [];
  for (const x of tables) { const k = 'tstock/' + t.id + '/' + x.n; if (await s.create(k, { o: orderId, table: x.label })) made.push(k); else { await pool(made, 8, (m) => s.del(m)); return { taken: x.label }; } }
  return { made };
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
// Early access: until the given time a type is sold only to people of one CRM audience (matched by the buyer's e-mail).
const isEarly = (t) => !!t.earlyFor && !!t.earlyUntil && istNow() < t.earlyUntil;
const covers = (c, typeId) => !!c && (!c.typeIds.length || c.typeIds.includes(typeId));
const usesOf = async (s, c) => (await s.list('tcodeUse/' + c.eventId + '/' + c.code + '/')).length;

/* ---------- pricing ---------- */
function price(lines, code, set) { // lines: [{ t, qty }]
  let subtotal = 0, discount = 0, fee = 0, due = 0; const items = [];
  for (const { t, qty } of lines) { // a picked table is its own line: named after the table, admitting its seats
    let unitNet = t.price;
    if (covers(code, t.id) && code.value > 0) unitNet = Math.max(0, r2(code.kind === 'percent' ? t.price * (1 - code.value / 100) : t.price - code.value));
    // with a deposit only that part is paid online; the rest is collected at the venue and shown at the door
    const unitPay = t.deposit != null && t.deposit < unitNet ? t.deposit : unitNet, unitDue = r2(unitNet - unitPay);
    const unitFee = set.feeMode === 'buyer' && unitPay > 0 ? r2(unitPay * (set.feePct || 0) / 100 + (set.feeFixed || 0)) : 0;
    subtotal += t.price * qty; discount += (t.price - unitNet) * qty; fee += unitFee * qty; due += unitDue * qty;
    items.push({ typeId: t.id, name: t.name, qty, unit: t.price, unitNet, unitPay, unitDue, unitFee, admits: t.admits || 1, ...(t.table ? { table: t.table } : {}), ...(t.addon ? { addon: true } : {}) });
  }
  subtotal = r2(subtotal); discount = r2(discount); fee = r2(fee); due = r2(due);
  return { items, subtotal, discount, fee, due, total: r2(subtotal - discount - due + fee) };
}

/* ---------- orders + tickets ---------- */
const orderKey = (o) => 'orders/' + o.eventId + '/' + o.id;
const ordersOf = (eventId) => all('orders/' + eventId + '/');
const ticketsOf = (eventId) => all('tickets/' + eventId + '/');
export const ticketGuest = (t) => ({ id: 'tk-' + t.id, name: t.name, guests: t.addon ? 0 : 1, checkedInAt: t.checkedInAt || '', scanCount: t.scanCount || 0, eventId: t.eventId, ticket: t.typeName, h: hash(t.token).slice(0, 20), ...(t.due ? { due: t.due, currency: t.currency } : {}), ...(t.addon ? { addon: true } : {}) });
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
  o.tickets = []; let seq = 0, unit = 0; // every ticket remembers the unit of stock it came from, so a refund frees exactly that unit
  for (const it of o.items) for (let q = 0; q < it.qty; q++, unit++) for (let n = 0; n < it.admits; n++) {
    const t = { id: id(), eventId: e.id, orderId: o.id, orderNo: o.no, typeId: it.typeId, typeName: it.name, name: o.buyer.name, email: o.buyer.email, token: token(24), slot: (o.slots || [])[unit] || '', table: it.table || '', status: 'valid', checkedInAt: '', scanCount: 0, seq: ++seq, paid: r2(((it.unitPay != null ? it.unitPay : it.unitNet) + it.unitFee) / it.admits), net: r2((it.unitPay != null ? it.unitPay : it.unitNet) / it.admits), ...(it.unitDue && n === 0 ? { due: it.unitDue, currency: o.currency } : {}), ...(it.addon ? { addon: true } : {}), createdAt: now() };
    await s.set('tickets/' + e.id + '/' + t.id, t); await s.set('passes/' + t.token, { eventId: e.id, ticketId: t.id }); o.tickets.push(t.id);
  }
  o.status = 'paid'; o.paidAt = o.paidAt || now(); await s.del('pending/' + e.id + '/' + o.id);
  if (!o.refCode && o.channel === 'online') { o.refCode = token(6); await s.set('refs/' + o.refCode, { eventId: e.id, orderId: o.id }); } // the buyer's own link for friends
  for (const k of (o.slots || []).filter((x) => x.startsWith('tresaleTaken/'))) await handOver(s, e, o, k, origin); // units that came from another holder
  o.slots = (o.slots || []).filter((x) => !x.startsWith('tresaleTaken/'));
  if (!quiet && o.buyer.email) { const m = await sendOrder(live(e) || e, o, await ticketsFor(s, o), origin); if (m.status !== 'off') o.mail = m; }
  await s.set(orderKey(o), o);
  await emit(s, 'order.paid', { order: hookOrder(o), tickets: (await ticketsFor(s, o)).map((x) => ({ id: x.id, type: x.typeName, name: x.name, email: x.email, table: x.table || '' })) });
}
// A resold ticket: the old one stops working and its holder gets the ticket price back (the service fee is not returned).
async function handOver(s, e, o, claimKey, origin) {
  const [, typeId, tid] = claimKey.split('/'), old = await s.get('tickets/' + e.id + '/' + tid), oo = old && await s.get('orders/' + e.id + '/' + old.orderId);
  await s.del('tresale/' + typeId + '/' + tid); await s.del(claimKey);
  if (!old || old.status !== 'valid' || !oo) return;
  if (old.slot) { // the unit of stock changes hands with the ticket
    oo.slots = (oo.slots || []).filter((k) => k !== old.slot); o.slots = (o.slots || []).concat(old.slot);
    for (const nt of await ticketsFor(s, o)) if (nt.slot === claimKey) { nt.slot = old.slot; await s.set('tickets/' + e.id + '/' + nt.id, nt); }
  }
  old.status = 'void'; old.voidAt = now(); old.resoldTo = o.no; old.listed = false; await s.del('passes/' + old.token); await s.set('tickets/' + e.id + '/' + old.id, old);
  const amount = Math.min(old.net != null ? old.net : old.paid || 0, r2(oo.total - refunded(oo)));
  let rf = { ok: true, ref: '' };
  if (amount > 0 && oo.channel === 'online' && oo.provider !== 'free') { const p = provider(oo.provider); rf = p.error ? { ok: false, error: p.error } : await p.refund(oo, amount, { ip: '' }); }
  oo.refunds = (oo.refunds || []).concat({ at: now(), by: 'Yeniden satış', amount: rf.ok ? amount : 0, owed: rf.ok ? 0 : amount, ticketIds: [old.id], reason: 'Bilet ' + o.no + ' siparişine yeniden satıldı', ok: rf.ok, ref: rf.ref || '', error: rf.error || '' });
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
  const all = await typesView(s, e.id), types = all.filter((t) => t.state !== 'off' && (!t.hidden || covers(c, t.id))).map((t) => {
    const p = price([{ t, qty: 1 }], c, set).items[0];
    return { id: t.id, name: t.name, description: t.description || '', price: t.price, now: p.unitNet, pay: p.unitPay, fee: p.unitFee, addon: !!t.addon, state: t.state, min: t.min, max: t.left == null ? t.max : Math.min(t.max, t.left), admits: t.admits || 1, low: t.left != null && t.left > 0 && t.left <= Math.max(5, Math.round(t.stock * 0.1)), opens: t.state === 'soon' ? t.saleStart || '' : '', resale: t.state === 'on' && t.left != null && t.left <= t.resale && t.resale > 0, left: t.left != null && t.left > 0 && t.left <= 10 ? t.left : null, ends: t.state === 'on' && t.saleEnd ? t.saleEnd : '', early: isEarly(t) ? t.earlyUntil : '',
      next: (() => { const n = all.find((x) => x.after === t.id && x.status !== 'off' && !x.hidden && x.price > t.price); return n ? n.price : null; })(), // what the same ticket costs once this phase is gone
      notify: shop.waitlist !== false && (t.state === 'soldout' ? 'waitlist' : t.state === 'soon' ? 'onsale' : '') };
  });
  const map = await mapOf(s, e.id), shown = new Set(types.map((x) => x.id));
  for (const x of types) { const full = all.find((y) => y.id === x.id); x.mapped = !!full.mapped; }
  const plan = map.tables.some((x) => shown.has(x.typeId)) ? { image: map.imageId ? '/api/public/image/' + map.imageId : '', w: map.w, h: map.h, tables: map.tables.filter((x) => shown.has(x.typeId)).map((x) => { const ty = all.find((y) => y.id === x.typeId); return { id: x.id, label: x.label, x: x.x, y: x.y, seats: x.seats, typeId: x.typeId, free: ty.state === 'on' && !(ty.busy && ty.busy.has(String(x.n))) }; }) } : null;
  return { enabled: true, ready: !why, currency: shop.currency, note: shop.note, types, plan, questions: shop.questions || [], code: rawCode ? (c ? { ok: true, code: c.code } : { ok: false, error: full ? 'This code has been used up.' : 'This code is not valid.' }) : null,
    look: shop.look || {}, seller: set.seller, terms: set.terms, refundPolicy: set.refundPolicy, test: set.provider === 'test', holdMinutes: HOLD_MIN, installments: set.provider === 'iyzico' && !!set.installments };
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
    const view = await typesView(s, e.id), map = await mapOf(s, e.id), code = await findCode(s, e.id, b.code), lines = [];
    if (b.code && !code) return fail(400, say('This code is not valid.', 'Bu kod geçerli değil.'));
    for (const x of Array.isArray(b.items) ? b.items.slice(0, 20) : []) {
      const t = view.find((y) => y.id === x.typeId), picked = t && t.mapped ? tablesOf(map, t.id).filter((tb) => Array.isArray(x.tables) && x.tables.includes(tb.id)) : [], qty = t && t.mapped ? picked.length : int(x.qty, 0, 20); if (!qty) continue;
      if (!t || t.state === 'off' || (t.hidden && !covers(code, t.id))) return fail(400, say('A ticket in your basket is no longer available.', 'Sepetinizdeki bir bilet artık satışta değil.'));
      if (t.mapped) { // tables are chosen one by one on the plan
        if (qty > t.max) return fail(400, t.name + say(': at most ' + t.max + ' per order.', ': siparişte en fazla ' + t.max + '.'));
        if (t.state !== 'on') return fail(409, t.name + (t.state === 'soldout' ? say(' is sold out.', ' tükendi.') : say(' is not on sale right now.', ' şu an satışta değil.')));
        for (const tb of picked) lines.push({ t: { ...t, name: t.name + ' · ' + tb.label, admits: tb.seats, table: tb.label }, qty: 1, base: t, tb });
        continue;
      }
      if (t.state !== 'on') return fail(409, t.name + (t.state === 'soldout' ? say(' is sold out.', ' tükendi.') : say(' is not on sale right now.', ' şu an satışta değil.')));
      if (qty < t.min || qty > t.max) return fail(400, t.name + say(': choose between ' + t.min + ' and ' + t.max + '.', ': ' + t.min + ' ile ' + t.max + ' arasında seçin.'));
      lines.push({ t, qty });
    }
    if (!lines.length) return fail(400, say('Please choose at least one ticket.', 'Lütfen en az bir bilet seçin.'));
    if (lines.every((x) => x.t.addon)) return fail(400, say('Extras are sold together with a ticket. Please add a ticket.', 'Ek ürünler biletle birlikte satılır. Lütfen bir bilet ekleyin.'));
    for (const { t } of lines.filter((x) => isEarly(x.t))) {
      const { audienceMembers } = await import('./admin2.mjs'), au = await s.get('audiences/' + t.earlyFor);
      if (!au || !(await audienceMembers(au)).some((c) => c.email === buyer.email)) return fail(403, t.name + say(' is in early access for invited guests until ' + t.earlyUntil.replace('T', ' ') + '. Use the email address we invited you on.', ' şu an yalnızca davetli misafirlere açık (' + t.earlyUntil.replace('T', ' ') + ' tarihine kadar). Sizi davet ettiğimiz e-posta adresini kullanın.'));
    }
    const pm = b.promo ? await s.get('tpromo/' + e.id + '/' + normCode(b.promo)) : null, rf = b.ref ? await s.get('refs/' + str(b.ref, 20).replace(/[^A-Za-z0-9_-]/g, '')) : null;
    const answers = [];
    for (const q of shop.questions || []) { // the organiser's own questions; answers stay on the order
      const v = str(b.answers && b.answers[q.id], 300);
      if (q.required && !v) return fail(400, say('Please answer: ', 'Lütfen yanıtlayın: ') + q.label);
      if (v && q.options.length && !q.options.includes(v)) return fail(400, say('Please choose one of the options: ', 'Lütfen seçeneklerden birini seçin: ') + q.label);
      if (v) answers.push({ id: q.id, label: q.label, value: v });
    }
    const pr = price(lines, code, set), u = b.utm && typeof b.utm === 'object' ? b.utm : {}, utm = {};
    for (const k of ['source', 'medium', 'campaign', 'content']) if (u[k]) utm[k] = str(u[k], 80).toLowerCase();
    const o = { id: id(), no: orderNo(), token: token(24), eventId: e.id, status: 'pending', channel: 'online', provider: pr.total > 0 ? set.provider : 'free', currency: shop.currency, ...pr, code: code ? code.code : '', buyer, answers, lang: L, utm, promoter: pm && pm.active ? pm.code : '', referredBy: rf && rf.eventId === e.id && rf.orderId ? rf.orderId : '',
      slots: [], tickets: [], refunds: [], terms: { at: now(), hash: hash(set.terms + '|' + set.refundPolicy) }, createdAt: now(), expiresAt: new Date(Date.now() + HOLD_MIN * 60000).toISOString() };
    for (const ln of lines) {
      const got = ln.tb ? (await reserveTables(s, ln.base, [ln.tb], o.id)).made : await reserve(s, ln.t, ln.qty, o.id);
      if (!got) { await pool(o.slots, 8, (k) => s.del(k)); return fail(409, ln.tb ? say('Table ' + ln.tb.label + ' was just taken. Please pick another.', ln.tb.label + ' masası az önce alındı. Lütfen başka bir masa seçin.') : ln.t.name + say(' just sold out.', ' az önce tükendi.')); }
      o.slots.push(...got);
    }
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
  // "My tickets": the buyer types their e-mail and gets the links to their orders by mail. The answer on screen is the same
  // whether or not the address is known, so the form cannot be used to find out who bought tickets.
  if (parts[0] === 'mytickets' && m === 'POST') {
    const b = await body(req), email = normEmail(b.email), L = langOf(b.lang);
    if (str(b.website)) return json({ ok: true });
    if (!emailOk(email)) return fail(400, tx(L, 'Please enter a valid email.', 'Lütfen geçerli bir e-posta girin.'));
    if (await h.limited('mine/' + hash(h.ip), 6, 3600) || await h.limited('mine-to/' + hash(email), 3, 3600)) return fail(429, tx(L, 'Too many attempts. Please try again later.', 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.'));
    const found = [], td = istToday();
    for (const e of (await all('events/')).filter((x) => x.status === 'published' && (!x.date || (x.endDate || x.date) >= td))) {
      for (const o of (await ordersOf(e.id)).filter((x) => x.buyer.email === email && ['paid', 'partial'].includes(x.status))) found.push({ title: (live(e) || e).title, date: e.date, no: o.no, url: url.origin + '/order?t=' + o.token });
    }
    if (found.length) await sendMyTickets(email, found, L);
    return json({ ok: true });
  }
  // A promoter's own page, opened with their private link: their sales link and what was sold through it. No buyer contact details.
  if (parts[0] === 'promoter' && m === 'GET') {
    const r = await s.get('tpromoTok/' + str(url.searchParams.get('t'), 60)), pm = r && await s.get('tpromo/' + r.eventId + '/' + r.code), e = pm && await s.get('events/' + r.eventId);
    if (!pm || !e || pm.token !== url.searchParams.get('t')) return fail(404, 'This link is not valid.');
    const le = live(e) || e, shop = await shopOf(s, e.id), st = promoStats(pm, await ordersOf(e.id));
    return json({ name: pm.name, active: pm.active, link: isListed(e) ? '/events/' + le.slug + '?p=' + pm.code : '', currency: shop.currency, tickets: st.tickets, orders: st.orders, revenue: st.revenue, commission: st.commission, terms: [pm.pct ? '%' + pm.pct : '', pm.fixed ? pm.fixed + ' ' + shop.currency + ' / ticket' : ''].filter(Boolean).join(' + '),
      sales: st.list.slice(0, 50).map((o) => ({ at: o.paidAt, who: o.buyer.name.split(' ')[0] + ' ' + (o.buyer.name.split(' ').pop() || '').slice(0, 1) + '.', tickets: o.items.reduce((n, i) => n + i.qty * i.admits, 0) })), event: { title: le.title, date: le.date, venue: le.venue, city: le.city } });
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
    return json({ order: { no: o.no, status: o.status, items: o.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, unitNet: i.unitPay != null ? i.unitPay : i.unitNet })), subtotal: o.subtotal, discount: o.discount, fee: o.fee, due: o.collected ? 0 : o.due || 0, total: o.total, currency: o.currency, refunded: refunded(o), name: o.buyer.name, email: o.buyer.email, paidAt: o.paidAt || '', expiresAt: o.expiresAt, error: (o.payment && o.payment.lastError) || '',
        payUrl: o.status === 'pending' && o.provider === 'test' ? '/pay/test?o=' + o.token : '' },
      lang: o.lang || 'en', tickets: ts.map((t) => ({ id: t.id, type: t.typeName, name: t.name, status: t.status, checkedIn: !!t.checkedInAt, url: t.status === 'valid' ? '/pass?t=' + t.token : '', resold: !!t.resoldTo, listed: !!t.listed,
        canResell: shop.resale === true && !started && !t.table && t.status === 'valid' && !t.checkedInAt && ((types.find((x) => x.id === t.typeId) || {}).admits || 1) === 1, back: t.net != null ? t.net : t.paid || 0 })), transfers: shop.transfers !== false,
      ga: /^G-[A-Z0-9]{4,}$/.test(process.env.GA4_MEASUREMENT_ID || '') ? process.env.GA4_MEASUREMENT_ID : '',
      friends: o.refCode && isListed(e) && ['paid', 'partial'].includes(o.status) && !started ? { url: '/events/' + le.slug + '?ref=' + o.refCode, bought: (await ordersOf(e.id)).filter((x) => x.referredBy === o.id && ['paid', 'partial'].includes(x.status) && x.buyer.email !== o.buyer.email).reduce((n, x) => n + x.items.reduce((m, i) => m + i.qty * i.admits, 0), 0) } : null,
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
    if (moved) { await sendOrder(live(e) || e, { ...o, buyer: { name, email } }, [t], url.origin, true); await emit(s, 'ticket.transferred', { orderNo: o.no, ticket: { id: t.id, type: t.typeName, name, email } }); }
    return json({ ok: true, moved, url: '/pass?t=' + t.token });
  }
  // The holder puts a ticket back on sale at the price they paid. It stays theirs, and valid, until someone buys it;
  // at that moment the old QR dies and the ticket price goes back to the card it was paid with.
  if (parts[0] === 'resale' && m === 'POST') {
    const b = await body(req), o = await ref(b.o), e = o && await s.get('events/' + o.eventId), t = o && (o.tickets || []).includes(b.ticketId) && await s.get('tickets/' + o.eventId + '/' + str(b.ticketId, 40));
    if (!o || !e || !t) return fail(404, 'Ticket not found.');
    const L = langOf(o.lang), shop = await shopOf(s, e.id), ty = (await typesOf(e.id)).find((x) => x.id === t.typeId), le = live(e) || e, key = 'tresale/' + t.typeId + '/' + t.id;
    if (shop.resale !== true) return fail(403, tx(L, 'Resale is not available for this event.', 'Bu etkinlikte yeniden satış kapalı.'));
    if (t.status !== 'valid' || t.table || t.checkedInAt || (le.date && le.date < istToday()) || !ty || (ty.admits || 1) !== 1) return fail(409, tx(L, 'This ticket cannot be put on sale.', 'Bu bilet satışa konulamaz.'));
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
// A promoter's sales: paid online orders that came through their link. Commission is on the ticket price after discounts,
// without the service fee, and only for tickets that were not refunded.
function promoStats(pm, orders) {
  const list = orders.filter((o) => o.promoter === pm.code && ['paid', 'partial'].includes(o.status)).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || '')); let tickets = 0, revenue = 0;
  for (const o of list) { const share = o.total > 0 ? Math.max(0, (o.total - refunded(o)) / o.total) : 1, n = o.items.reduce((a, i) => a + i.qty * i.admits, 0); tickets += Math.round(n * share); revenue += (o.subtotal - o.discount) * share; }
  revenue = r2(revenue);
  return { list, orders: list.length, tickets, revenue, commission: r2(revenue * (pm.pct || 0) / 100 + tickets * (pm.fixed || 0)) };
}
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
  const valid = tickets.filter((t) => t.status === 'valid' && !t.addon), extras = tickets.filter((t) => t.status === 'valid' && t.addon).length, dueOpen = r2(paid.filter((o) => o.status !== 'refunded' && !o.collected).reduce((n, o) => n + (o.due || 0), 0)), collected = r2(paid.reduce((n, o) => n + ((o.collected && o.collected.amount) || 0), 0)), w = Date.now() - 7 * 864e5, w2 = Date.now() - 14 * 864e5, at = (o) => Date.parse(o.paidAt || o.createdAt), cnt = (list) => list.reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty * i.admits, 0), 0);
  return { extras, dueOpen, collected, orders: paid.length, tickets: valid.length, checkedIn: valid.filter((t) => t.checkedInAt).length, gross: sum((o) => o.total), fees: sum((o) => o.fee), discounts: sum((o) => o.discount), refunds: sum(refunded), net: r2(sum((o) => o.total) - sum(refunded)),
    last7: cnt(paid.filter((o) => at(o) >= w)), prev7: cnt(paid.filter((o) => at(o) < w && at(o) >= w2)), pending: orders.filter((o) => o.status === 'pending').length,
    referrers: paid.map((o) => ({ o, got: paid.filter((x) => x.referredBy === o.id && x.buyer.email !== o.buyer.email) })).filter((x) => x.got.length).map((x) => ({ name: x.o.buyer.name, email: x.o.buyer.email, orders: x.got.length, tickets: cnt(x.got) })).sort((a, b) => b.tickets - a.tickets).slice(0, 30), // buying again through your own link does not count
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
  const keep = b.keepTickets === true; // money back without cancelling anything, e.g. a goodwill gesture
  if (!pick.length) return fail(400, 'İade edilecek geçerli bilet yok.');
  if (keep && (b.amount == null || b.amount === '')) return fail(400, 'Biletler geçerli kalacaksa iade tutarını yazın.');
  const left = r2(o.total - refunded(o)), wholeOrder = pick.length === ts.filter((t) => t.status === 'valid').length;
  // fees go back with the ticket unless the admin keeps them; the last tickets of an order take whatever is left, so cents never go missing
  let amount = b.amount != null && b.amount !== '' ? money(b.amount) : wholeOrder ? left : r2(pick.reduce((n, t) => n + (t.paid || 0), 0));
  if (amount == null || amount > left + 0.001) return fail(400, 'İade tutarı kalan tutarı (' + left.toFixed(2) + ' ' + o.currency + ') aşamaz.');
  let rf = { ok: true, ref: '' };
  if (amount > 0 && o.channel === 'online' && o.provider !== 'free') { const p = provider(o.provider); rf = p.error ? { ok: false, error: p.error } : await p.refund(o, amount, { ip }); }
  if (!rf.ok) { if (rf.partial) { o.refunds.push({ at: now(), by: me.name, amount: rf.partial, ticketIds: [], reason: 'Kısmi: sağlayıcı kalanını reddetti', ok: true, ref: '' }); await s.set(orderKey(o), o); } return fail(502, 'Sağlayıcı iadeyi reddetti: ' + (rf.error || '') + ' Biletler iptal edilmedi.'); }
  if (!keep) for (const t of pick) { t.status = 'void'; t.voidAt = now(); await s.del('passes/' + t.token); await s.set('tickets/' + e.id + '/' + t.id, t); }
  if (b.restock !== false && !keep) { // a unit goes back on sale once every ticket it admitted is void (all four seats of a table, say)
    const after = await ticketsFor(s, o), free = [...new Set(pick.map((x) => x.slot).filter(Boolean))].filter((k) => (o.slots || []).includes(k) && !after.some((x) => x.slot === k && x.status === 'valid'));
    await pool(free, 8, (k) => s.del(k)); o.slots = (o.slots || []).filter((k) => !free.includes(k));
  }
  o.refunds.push({ at: now(), by: me.name, amount, ticketIds: keep ? [] : pick.map((t) => t.id), reason: str(b.reason, 200), ok: true, ref: rf.ref || '' });
  o.status = !keep && wholeOrder ? 'refunded' : 'partial'; await s.set(orderKey(o), o);
  if (!keep) for (const t of pick) if (t.listed) { await s.del('tresale/' + t.typeId + '/' + t.id); await s.del('tresaleTaken/' + t.typeId + '/' + t.id); }
  if (b.notify !== false && o.buyer.email) await sendRefund(live(e) || e, o, amount, keep ? 0 : pick.length, url.origin, o.lang);
  if (b.restock !== false) await notifyWaitlist(s, e, url.origin);
  await emit(s, 'order.refunded', { order: hookOrder(o), amount, tickets: keep ? 0 : pick.length });
  return json({ order: orderView(o), refund: { amount, tickets: keep ? 0 : pick.length, currency: o.currency } });
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
  if (parts[1] === 'webhooks') {
    if (me.role !== 'owner') return fail(403, 'Webhook ayarlarını yalnızca HQ sahibi yönetir.');
    const hooks = await hooksOf(s), view = (h) => ({ id: h.id, url: h.url, events: h.events, active: h.active, last: h.last || null, createdAt: h.createdAt });
    if (!parts[2] && m === 'GET') return json({ hooks: hooks.map(view), events: HOOK_EVENTS.map(([key, label]) => ({ key, label })) });
    if (!parts[2] && m === 'POST') {
      const b = await body(req); let u; try { u = new URL(str(b.url, 500)); } catch { return fail(400, 'Adres geçersiz.'); }
      // only public https addresses: never this site's own network or a bare IP
      if (u.protocol !== 'https:' || /^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') || u.username) return fail(400, 'Adres https:// ile başlayan herkese açık bir alan adı olmalı.');
      const events = (Array.isArray(b.events) ? b.events : []).filter((x) => HOOK_EVENTS.some((y) => y[0] === x)); if (!events.length) return fail(400, 'En az bir olay seçin.');
      if (hooks.length >= 5) return fail(400, 'En fazla 5 webhook tanımlanabilir.');
      const h = { id: id(), url: u.toString(), events, active: true, secret: token(32), createdAt: now() }; await s.set('settings/webhooks', { hooks: hooks.concat(h) });
      return json({ hook: view(h), secret: h.secret }, 201); // the secret is shown once, here
    }
    const h = hooks.find((x) => x.id === parts[2]); if (!h) return fail(404, 'Webhook bulunamadı.');
    if (m === 'PUT') { const b = await body(req); if ('active' in b) h.active = !!b.active; await s.set('settings/webhooks', { hooks }); return json({ hook: view(h) }); }
    if (m === 'DELETE') { await s.set('settings/webhooks', { hooks: hooks.filter((x) => x.id !== h.id) }); return json({ ok: true, hook: view(h) }); }
    if (parts[3] === 'test' && m === 'POST') { await emit(s, h.events[0], { test: true, note: 'More Life HQ deneme çağrısı' }); return json({ hook: view((await hooksOf(s)).find((x) => x.id === h.id)) }); }
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
    const promoters = (await all('tpromo/' + e.id + '/')).sort((a, b) => a.name.localeCompare(b.name, 'tr')).map((pm) => { const x = promoStats(pm, os); return { ...pm, orders: x.orders, tickets: x.tickets, revenue: x.revenue, commission: x.commission, panelUrl: '/promoter?t=' + pm.token }; });
    return json({ promoters, map: await mapOf(s, e.id), siteUrl: SITE_URL(), event: { id: e.id, title: e.title, slug: e.live ? e.live.slug : e.slug, inviteToken: e.inviteToken, status: e.status, visibility: e.visibility, inviteUrl: '/invite?t=' + e.inviteToken, listed: isListed(e), externalTickets: !!(e.useTickets && e.ticketUrl) }, shop, types, codes, sales: salesOf(os, ts, types), blocked: blocked(set), provider: set.provider, fee: { mode: set.feeMode, pct: set.feePct, fixed: set.feeFixed }, currencies: CURRENCIES });
  }
  if (sub === 'shop' && m === 'PUT') {
    const b = await body(req), cur = await shopOf(s, e.id), n = { ...cur };
    if ('enabled' in b) n.enabled = !!b.enabled;
    for (const k of ['transfers', 'waitlist', 'resale', 'remind']) if (k in b) n[k] = !!b[k];
    if ('note' in b) n.note = str(b.note, 300);
    if (Array.isArray(b.questions)) n.questions = b.questions.slice(0, 5).map((q) => ({ id: str(q.id, 12).replace(/[^A-Za-z0-9]/g, '') || id().slice(0, 8), label: str(q.label, 120), required: !!q.required, options: (Array.isArray(q.options) ? q.options : String(q.options || '').split('\n')).map((x) => str(x, 60)).filter(Boolean).slice(0, 12) })).filter((q) => q.label);
    if (b.look && typeof b.look === 'object') { // how the shop looks: theme and accent on the stand-alone / embedded page, heading and button text everywhere
      const k = b.look, acc = str(k.accent, 7);
      if (acc && !/^#[0-9a-f]{6}$/i.test(acc)) return fail(400, 'Vurgu rengi #RRGGBB biçiminde olmalı.');
      n.look = { theme: k.theme === 'light' ? 'light' : 'dark', accent: acc, title: str(k.title, 60), button: str(k.button, 40) };
    }
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
  if (sub === 'map' && m === 'PUT') { // the whole plan is saved at once
    const b = await body(req), cur = await mapOf(s, e.id), ts = await typesOf(e.id), next = {}, out = [], seen = new Set();
    for (const x of cur.tables) next[x.typeId] = Math.max(next[x.typeId] || 0, x.n);
    for (const raw of Array.isArray(b.tables) ? b.tables.slice(0, 300) : []) {
      const old = cur.tables.find((x) => x.id === raw.id), typeId = str(raw.typeId, 40), label = str(raw.label, 12);
      if (!label || !ts.some((x) => x.id === typeId)) return fail(400, 'Her masanın bir adı ve bir bilet türü olmalı.');
      if (seen.has(label.toLocaleLowerCase('tr'))) return fail(400, 'İki masa aynı adı taşıyor: ' + label); seen.add(label.toLocaleLowerCase('tr'));
      const n = old && old.typeId === typeId ? old.n : (next[typeId] = (next[typeId] || 0) + 1); // a table moved to another type is a new unit there
      out.push({ id: old ? old.id : id(), label, typeId, n, seats: int(raw.seats, 1, 20, 4), x: Math.max(0, Math.min(1000, Math.round(Number(raw.x) || 0))), y: Math.max(0, Math.min(1000, Math.round(Number(raw.y) || 0))) });
    }
    for (const x of cur.tables) { // a table someone holds or bought cannot disappear or change zone
      const kept = out.find((y) => y.id === x.id && y.typeId === x.typeId);
      if (!kept && await s.get('tstock/' + x.typeId + '/' + x.n)) return fail(409, x.label + ' masası satılmış ya da bir sepette; kaldırılamaz ve türü değiştirilemez.');
    }
    for (const ty of ts) if (!cur.tables.some((x) => x.typeId === ty.id) && out.some((x) => x.typeId === ty.id) && await takenOf(s, ty.id)) return fail(409, ty.name + ' türünden bilet satılmış; plana bağlanamaz. Masalar için yeni bir tür açın.');
    const map = { imageId: 'imageId' in b ? str(b.imageId, 60) : cur.imageId, w: 1000, h: int(b.h, 300, 1400, cur.h), tables: out, updatedAt: now() };
    await s.set('tmap/' + e.id, map); return json({ map, eventTitle: e.title });
  }
  if (sub === 'promoters') { // a person or venue that sells through their own link, with what they earn per sale
    const shape = (b, prev) => { const pm = { ...prev }; if ('name' in b) pm.name = str(b.name, 80); if ('pct' in b) pm.pct = money(b.pct); if ('fixed' in b) pm.fixed = money(b.fixed); if ('active' in b) pm.active = !!b.active; if ('note' in b) pm.note = str(b.note, 200);
      return !pm.name ? { error: 'Promoter adı gerekli.' } : pm.pct == null || pm.pct > 100 || pm.fixed == null ? { error: 'Komisyon geçersiz.' } : { pm }; };
    if (!parts[3] && m === 'POST') {
      const b = await body(req), r = shape(b, { eventId: e.id, code: normCode(b.code || str(b.name, 20)).slice(0, 20), name: '', pct: 0, fixed: 0, active: true, note: '', token: token(24), createdAt: now() }); if (r.error) return fail(400, r.error);
      if (r.pm.code.length < 3) return fail(400, 'Link kodu en az 3 karakter olmalı (harf, rakam).');
      if (!(await s.create('tpromo/' + e.id + '/' + r.pm.code, r.pm))) return fail(409, 'Bu link kodu zaten kullanılıyor.');
      await s.set('tpromoTok/' + r.pm.token, { eventId: e.id, code: r.pm.code }); return json({ promoter: r.pm, eventTitle: e.title }, 201);
    }
    const pm = await s.get('tpromo/' + e.id + '/' + normCode(parts[3])); if (!pm) return fail(404, 'Promoter bulunamadı.');
    if (m === 'PUT') { const r = shape(await body(req), pm); if (r.error) return fail(400, r.error); await s.set('tpromo/' + e.id + '/' + pm.code, r.pm); return json({ promoter: r.pm, eventTitle: e.title }); }
    if (m === 'DELETE') { await s.del('tpromoTok/' + pm.token); await s.del('tpromo/' + e.id + '/' + pm.code); return json({ ok: true, promoter: pm, eventTitle: e.title }); } // past orders keep the code they were sold under
  }
  if (sub === 'orders.csv') {
    const os = (await ordersOf(e.id)).filter((o) => o.status !== 'pending' && o.status !== 'expired' && o.status !== 'cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return csv('siparisler-' + e.slug + '.csv', [['Sipariş', 'Durum', 'Kanal', 'Ad Soyad', 'E-posta', 'Telefon', 'Biletler', 'Ara toplam', 'İndirim', 'Hizmet bedeli', 'Toplam', 'İade', 'Para birimi', 'Kod', 'Promoter', 'Kaynak', 'Kampanya', 'Ödeme', 'Sağlayıcı ref.', 'Yanıtlar']].concat(os.map((o) => [o.no, o.status, o.channel, o.buyer.name, o.buyer.email, o.buyer.phone, o.items.map((i) => i.qty + '× ' + i.name).join(' + '), o.subtotal, o.discount, o.fee, o.total, refunded(o), o.currency, o.code, o.promoter || '', (o.utm && o.utm.source) || '', (o.utm && o.utm.campaign) || '', o.paidAt, (o.payment && o.payment.ref) || '', (o.answers || []).map((x) => x.label + ': ' + x.value).join(' | ')])));
  }
  if (sub === 'report' && m === 'GET') { // settlement sheet for the venue or the agency: counts and money, no buyer data
    const [types, os, ts, shop] = await Promise.all([typesView(s, e.id), ordersOf(e.id), ticketsOf(e.id), shopOf(s, e.id)]), x = salesOf(os, ts, types), paid = os.filter((o) => ['paid', 'partial', 'refunded'].includes(o.status));
    const rows = types.map((ty) => { const mine = ts.filter((k) => k.typeId === ty.id), on = (ch) => mine.filter((k) => k.status === 'valid' && (paid.find((o) => o.id === k.orderId) || {}).channel === ch).length; return { name: ty.name, price: ty.price, online: on('online'), door: on('boxoffice'), comp: on('comp'), refunded: mine.filter((k) => k.status === 'void').length, in: mine.filter((k) => k.status === 'valid' && k.checkedInAt).length }; });
    const tot = { gross: x.gross, fees: x.fees, discounts: x.discounts, refunds: x.refunds, net: x.net, dueOpen: x.dueOpen, collected: x.collected, door: r2(paid.filter((o) => o.channel === 'boxoffice').reduce((n, o) => n + o.total - refunded(o), 0)), orders: x.orders, tickets: x.tickets, checkedIn: x.checkedIn };
    if (url.searchParams.get('format') === 'json') return json({ rows, totals: tot, currency: shop.currency });
    const h = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), mny = (n) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + shop.currency, sumOf = (k) => rows.reduce((n, r) => n + r[k], 0);
    const line = (a, b2, bold) => '<tr' + (bold ? ' class="b"' : '') + '><td>' + a + '</td><td class="r">' + b2 + '</td></tr>';
    return new Response('<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Mutabakat raporu · ' + h(e.title) + '</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:820px;margin:32px auto;padding:0 20px}h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.06em}p{margin:0;color:#555}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:left}th{font-size:12px;color:#555}.r{text-align:right;font-variant-numeric:tabular-nums}.b td{font-weight:700;border-top:2px solid #111;border-bottom:0}.sign{display:flex;gap:40px;margin-top:56px}.sign div{flex:1;border-top:1px solid #111;padding-top:6px;color:#555}button{font:inherit;padding:8px 14px;margin-bottom:20px}@media print{button{display:none}body{margin:0}}</style></head><body><button type="button" onclick="print()">Yazdır / PDF olarak kaydet</button>' +
      '<h1>Mutabakat raporu</h1><p><b>' + h(e.title) + '</b> · ' + h([e.date, e.venue, e.city].filter(Boolean).join(' · ')) + '</p><p>Hazırlayan: ' + h(me.name) + ' · ' + h(new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })) + '</p>' +
      '<h2>Bilet türüne göre</h2><table><thead><tr><th>Tür</th><th class="r">Fiyat</th><th class="r">İnternet</th><th class="r">Kapı</th><th class="r">Davetiye</th><th class="r">İade / iptal</th><th class="r">Giriş yapan</th></tr></thead><tbody>' + rows.map((r) => '<tr><td>' + h(r.name) + '</td><td class="r">' + mny(r.price) + '</td><td class="r">' + r.online + '</td><td class="r">' + r.door + '</td><td class="r">' + r.comp + '</td><td class="r">' + r.refunded + '</td><td class="r">' + r.in + '</td></tr>').join('') + '<tr class="b"><td>Toplam</td><td></td><td class="r">' + sumOf('online') + '</td><td class="r">' + sumOf('door') + '</td><td class="r">' + sumOf('comp') + '</td><td class="r">' + sumOf('refunded') + '</td><td class="r">' + sumOf('in') + '</td></tr></tbody></table>' +
      '<h2>Para</h2><table><tbody>' + line('Brüt tahsilat (hizmet bedeli dahil)', mny(tot.gross)) + line('İçindeki hizmet bedeli', mny(tot.fees)) + line('Uygulanan indirimler (bilgi)', mny(tot.discounts)) + line('İadeler', (tot.refunds ? '−' : '') + mny(tot.refunds)) + line('Net tahsilat', mny(tot.net), 1) + '</tbody></table>' +
      '<table style="margin-top:14px"><tbody>' + line('Net tahsilatın kapıda satılan kısmı', mny(tot.door)) + line('Depozitolu siparişlerde kapıda tahsil edilen', mny(tot.collected)) + line('Depozitolu siparişlerde henüz tahsil edilmeyen', mny(tot.dueOpen)) + line('Toplam tahsilat (internet + kapıda alınan kalanlar)', mny(r2(tot.net + tot.collected)), 1) + '</tbody></table>' +
      '<p style="margin-top:14px;font-size:12px">Ödeme sağlayıcısının kendi komisyonu bu raporda yoktur; sağlayıcı ekstresinden alınır. Sipariş: ' + tot.orders + ' · Geçerli bilet: ' + tot.tickets + ' · Giriş yapan: ' + tot.checkedIn + '</p><div class="sign"><div>More Life</div><div>Mekân / ajans</div></div></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY' } });
  }
  // A notice to the people who hold tickets (door time moved, rain plan…). Sent in windows the browser drives; one mail per address.
  if (sub === 'message' && m === 'POST') {
    const b = await body(req), subject = str(b.subject, 140), text = str(b.text, 3000), seg = str(b.segment, 60);
    if (!subject || !text) return fail(400, 'Konu ve mesaj gerekli.');
    if (!emailStatus().connected && !b.dryRun) return fail(409, 'E-posta servisi bağlı değil.');
    const ts = (await ticketsOf(e.id)).filter((k) => k.status === 'valid' && k.email && (seg === 'out' ? !k.checkedInAt : seg.startsWith('type:') ? k.typeId === seg.slice(5) : true)), to = [...new Set(ts.map((k) => k.email))].sort();
    if (b.dryRun) return json({ count: to.length });
    const from = int(b.from, 0, to.length), part = to.slice(from, from + 20); let sent = 0, failed = 0;
    for (const addr of part) { const r = await sendNotice(live(e) || e, addr, subject, text, url.origin); if (r.status === 'sent') sent += 1; else failed += 1; }
    return json({ sent, failed, total: to.length, next: from + part.length < to.length ? from + part.length : null, eventTitle: e.title });
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
      const tb = t.mapped ? tablesOf(await mapOf(s, e.id), t.id).find((x) => x.id === b.tableId) : null;
      if (t.mapped && !tb) return fail(400, 'Bu tür plandan satılıyor; bir masa seçin.');
      if (!buyer.name) return fail(400, 'Ad soyad gerekli.');
      if (buyer.email && !emailOk(buyer.email)) return fail(400, 'E-posta geçersiz.');
      const unit = channel === 'comp' ? 0 : (b.unit != null && b.unit !== '' ? money(b.unit) : t.price); if (unit == null) return fail(400, 'Tutar geçersiz.');
      const o = { id: id(), no: orderNo(), token: token(24), eventId: e.id, status: 'pending', channel, provider: channel === 'comp' ? 'free' : 'door', method: channel === 'boxoffice' ? (b.method === 'card' ? 'card' : 'cash') : '', currency: shop.currency, items: [tb ? { typeId: t.id, name: t.name + ' · ' + tb.label, qty: 1, unit, unitNet: unit, unitFee: 0, admits: tb.seats, table: tb.label } : { typeId: t.id, name: t.name, qty, unit, unitNet: unit, unitFee: 0, admits: t.admits || 1 }], subtotal: r2(unit * (tb ? 1 : qty)), discount: 0, fee: 0, total: r2(unit * (tb ? 1 : qty)), code: '', buyer, utm: {}, ref: '', slots: [], tickets: [], refunds: [], note: str(b.note, 200), by: me.name, createdAt: now(), expiresAt: now() };
      const got = tb ? (await reserveTables(s, t, [tb], o.id)).made : await reserve(s, t, qty, o.id); if (!got) return fail(409, tb ? tb.label + ' masası dolu.' : t.name + ' için yeterli stok yok (' + (t.left == null ? '∞' : t.left) + ' kaldı).');
      o.slots = got; if (buyer.email) o.contactId = await upsertBuyer(s, buyer);
      await s.set('orderTok/' + o.token, { eventId: e.id, id: o.id }); await issue(s, e, o, url.origin, b.send === false || !buyer.email);
      return json({ order: orderView(o), tickets: (await ticketsFor(s, o)).map((x) => ({ id: x.id, url: '/pass?t=' + x.token })), eventTitle: e.title }, 201);
    }
    const o = await s.get('orders/' + e.id + '/' + parts[3]); if (!o) return fail(404, 'Sipariş bulunamadı.');
    if (!parts[4] && m === 'GET') return json({ order: orderView(o), tickets: await ticketsFor(s, o), mail: emailStatus() });
    if (parts[4] === 'refund' && m === 'POST') { if (!['paid', 'partial'].includes(o.status)) return fail(409, 'Bu sipariş iade edilemez.'); return refund(s, e, o, await body(req), me, url, ip); }
    if (parts[4] === 'collect' && m === 'POST') { // the rest of a deposit order, taken at the venue
      if (!o.due || o.collected) return fail(409, 'Bu siparişte tahsil edilecek kalan tutar yok.');
      const b = await body(req); o.collected = { at: now(), by: me.name, amount: o.due, method: b.method === 'card' ? 'card' : 'cash' };
      for (const x of await ticketsFor(s, o)) if (x.due) { x.due = 0; await s.set('tickets/' + e.id + '/' + x.id, x); }
      await s.set(orderKey(o), o); return json({ order: orderView(o), eventTitle: e.title });
    }
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
