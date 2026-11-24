// Profit and loss of one event. Ticket income comes from the event's own sales and artist fees from its bookings;
// everything else (bar share, sponsors, production, venue, travel…) is entered as lines. Amounts in other currencies
// count toward the result only once a rate to the event's reporting currency has been entered: HQ never guesses a rate.
import { all } from './store.mjs';
import { id } from './auth.mjs';
import { json, fail, now, str, body } from './util.mjs';
import { eventSales, CURRENCIES } from './tickets.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const CATS = { income: ['Bar / mekân payı', 'Sponsorluk', 'Masa / loca', 'Kapı nakit', 'Diğer gelir'], expense: ['Prodüksiyon (ses, ışık, sahne)', 'Mekân', 'Seyahat ve konaklama', 'Pazarlama', 'Ekip ve güvenlik', 'Vergi ve harç', 'Ödeme komisyonu', 'Diğer gider'] };
const num = (v) => { const n = r2(parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'))); return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null; };

export async function pnlRoute(req, parts, s, me) {
  const m = req.method, e = await s.get('events/' + parts[1]); if (!e) return fail(404, 'Etkinlik bulunamadı.');
  const rec = { currency: '', rates: {}, lines: [], ...((await s.get('pnl/' + e.id)) || {}) }, save = () => s.set('pnl/' + e.id, { ...rec, updatedAt: now() });
  if (!parts[2] && m === 'GET') {
    const sales = await eventSales(s, e.id), cur = rec.currency || (sales && sales.currency) || 'TRY', rows = [];
    if (sales && (sales.tickets || sales.net)) rows.push({ auto: 'tickets', kind: 'income', category: 'Bilet satışı', label: sales.tickets + ' bilet (iadeler düşülmüş, hizmet bedeli dahil)', amount: sales.net, currency: sales.currency, settled: true });
    for (const k of (await all('bookings/')).filter((b) => b.eventId === e.id && b.stage !== 'cancelled' && b.fee != null)) {
      const paid = r2((k.payments || []).filter((p) => p.paidAt && p.currency === k.currency).reduce((n, p) => n + p.amount, 0));
      rows.push({ auto: 'booking', bookingId: k.id, kind: 'expense', category: 'Sanatçı ücreti', label: k.artist + (k.agency ? ' · ' + k.agency : ''), amount: k.fee, currency: k.currency, settled: paid >= k.fee, paid, note: k.feeNote || '' });
    }
    for (const l of rec.lines) rows.push(l);
    const need = [...new Set(rows.map((r) => r.currency).filter((c) => c !== cur))], missing = need.filter((c) => !(rec.rates[c] > 0));
    let income = 0, expense = 0, open = 0;
    for (const r of rows) { const rate = r.currency === cur ? 1 : rec.rates[r.currency]; r.inReport = rate > 0 ? r2(r.amount * rate) : null; if (r.inReport == null) continue; if (r.kind === 'income') income += r.inReport; else { expense += r.inReport; if (!r.settled) open += r.inReport - (r.paid ? r2(r.paid * rate) : 0); } }
    return json({ event: { id: e.id, title: e.title, date: e.date }, currency: cur, currencies: CURRENCIES, rates: rec.rates, need, missing, rows, categories: CATS,
      totals: { income: r2(income), expense: r2(expense), net: r2(income - expense), margin: income > 0 ? Math.round((income - expense) / income * 100) : null, unpaid: r2(open), complete: !missing.length },
      perTicket: sales && sales.tickets ? { tickets: sales.tickets, cost: r2(expense / sales.tickets), breakEven: sales.tickets && sales.net > 0 ? Math.ceil(expense / (sales.net / sales.tickets)) : null } : null });
  }
  if (!parts[2] && m === 'PUT') { // reporting currency and the rates used for this event
    const b = await body(req);
    if ('currency' in b) rec.currency = CURRENCIES.includes(b.currency) ? b.currency : '';
    if (b.rates && typeof b.rates === 'object') for (const c of CURRENCIES) if (c in b.rates) { if (b.rates[c] === '' || b.rates[c] == null) delete rec.rates[c]; else { const v = parseFloat(String(b.rates[c]).replace(',', '.')); if (!(v > 0) || v > 1e6) return fail(400, c + ' kuru geçersiz.'); rec.rates[c] = v; } }
    await save(); return json({ ok: true, eventTitle: e.title });
  }
  if (parts[2] === 'lines') {
    const shape = (b, prev) => {
      const l = { ...prev };
      if ('kind' in b) l.kind = b.kind === 'income' ? 'income' : 'expense';
      if ('category' in b) l.category = str(b.category, 60);
      if ('label' in b) l.label = str(b.label, 160);
      if ('amount' in b) l.amount = num(b.amount);
      if ('currency' in b) l.currency = CURRENCIES.includes(b.currency) ? b.currency : 'TRY';
      if ('settled' in b) l.settled = !!b.settled;
      if ('note' in b) l.note = str(b.note, 300);
      if (!CATS[l.kind].includes(l.category)) l.category = CATS[l.kind][CATS[l.kind].length - 1];
      return l.amount == null ? { error: 'Tutar geçersiz.' } : !l.label ? { error: 'Satıra bir açıklama yazın.' } : { line: l };
    };
    if (!parts[3] && m === 'POST') {
      if (rec.lines.length >= 200) return fail(400, 'Bir etkinlikte en fazla 200 satır olabilir.');
      const r = shape(await body(req), { id: id(), kind: 'expense', category: '', label: '', amount: null, currency: rec.currency || 'TRY', settled: false, note: '', by: me.name, at: now() }); if (r.error) return fail(400, r.error);
      rec.lines.push(r.line); await save(); return json({ line: r.line, eventTitle: e.title }, 201);
    }
    const i = rec.lines.findIndex((l) => l.id === parts[3]); if (i < 0) return fail(404, 'Satır bulunamadı.');
    if (m === 'PUT') { const r = shape(await body(req), rec.lines[i]); if (r.error) return fail(400, r.error); rec.lines[i] = r.line; await save(); return json({ line: r.line, eventTitle: e.title }); }
    if (m === 'DELETE') { const [l] = rec.lines.splice(i, 1); await save(); return json({ ok: true, removed: l, eventTitle: e.title }); }
  }
  return fail(404, 'Bulunamadı.');
}
