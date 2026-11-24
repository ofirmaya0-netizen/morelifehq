// Payment providers for ticket sales. One small interface, so the shop does not care who takes the money:
//   start(order, ctx)  → { url }        where the buyer is sent to pay
//   confirm(order, input) → { paid, ref, items?, error? }   called from the provider's callback
//   refund(order, amount, ctx) → { ok, ref?, error? }
// Card details never reach HQ: the buyer types them on the provider's own page.
import crypto from 'node:crypto';
import { storeName } from './store.mjs';

const IYZI = () => ({ key: process.env.IYZICO_API_KEY || '', secret: process.env.IYZICO_SECRET_KEY || '', base: (process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com').replace(/\/$/, '') });
// The test provider moves no money. It exists so the whole flow can be tried on a preview; it is refused on the live store.
export const testAllowed = () => storeName() !== 'morelife-hq' || !!process.env.HQ_LOCAL_STORE || process.env.HQ_PAYMENTS_TEST === '1'; // preview data, a local file store, or an explicit switch
export function providerStatus() {
  const i = IYZI();
  return { test: { ready: testAllowed(), note: testAllowed() ? 'Deneme sağlayıcısı: para hareketi olmaz. Yalnızca önizleme verisinde çalışır.' : 'Canlı sitede kapalı.' },
    iyzico: { ready: !!(i.key && i.secret), sandbox: /sandbox/.test(i.base), missing: ['IYZICO_API_KEY', 'IYZICO_SECRET_KEY'].filter((k) => !process.env[k]) } };
}

async function iyziCall(path, payload) {
  const i = IYZI(), body = JSON.stringify(payload), rnd = Date.now() + crypto.randomBytes(8).toString('hex');
  const sig = crypto.createHmac('sha256', i.secret).update(rnd + path + body).digest('hex');
  const auth = 'IYZWSv2 ' + Buffer.from('apiKey:' + i.key + '&randomKey:' + rnd + '&signature:' + sig).toString('base64');
  const r = await fetch(i.base + path, { method: 'POST', headers: { authorization: auth, 'x-iyzi-rnd': rnd, 'content-type': 'application/json', accept: 'application/json' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'success') throw new Error(String(j.errorMessage || 'iyzico isteği başarısız (HTTP ' + r.status + ').').slice(0, 200));
  return j;
}
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

const PROVIDERS = {
  test: {
    async start(order, { origin }) { return { url: origin + '/pay/test?o=' + order.token }; },
    async confirm(order, input) { return input.result === 'ok' ? { paid: true, ref: 'TEST-' + order.no } : { paid: false, error: 'Payment was declined.' }; },
    async refund(order, amount) { return { ok: true, ref: 'TEST-REFUND-' + Date.now().toString(36) }; }
  },
  // iyzico Checkout Form: HQ opens a payment session, the buyer pays on iyzico's page, iyzico posts a token back,
  // and HQ asks iyzico what happened to that token. The amount is never taken from the browser.
  iyzico: {
    async start(order, { origin, ip }) {
      const [first, ...rest] = order.buyer.name.trim().split(/\s+/), lines = [];
      // iyzico wants the basket to add up to the price before fees and the paid price to be the total
      for (const it of order.items) for (let n = 0; n < it.qty; n++) if (it.unitNet > 0) lines.push({ id: it.typeId + '-' + n, name: it.name.slice(0, 100), category1: 'Etkinlik bileti', itemType: 'VIRTUAL', price: money(it.unitNet) });
      if (order.fee > 0) lines.push({ id: 'fee', name: 'Hizmet bedeli', category1: 'Hizmet', itemType: 'VIRTUAL', price: money(order.fee) });
      const addr = { contactName: order.buyer.name, city: order.buyer.city || 'Istanbul', country: order.buyer.country || 'Turkey', address: order.buyer.city || 'Istanbul' };
      const j = await iyziCall('/payment/iyzipos/checkoutform/initialize/auth/ecom', { locale: 'en', conversationId: order.id, price: money(order.total), paidPrice: money(order.total), currency: order.currency, basketId: order.no, paymentGroup: 'PRODUCT',
        callbackUrl: origin + '/api/public/pay/iyzico?o=' + order.token, enabledInstallments: [1],
        // iyzico requires an identity number on every buyer and ticket buyers are not asked for one, so a placeholder is sent.
        // Confirm this with iyzico for the merchant account before taking live payments.
        buyer: { id: order.contactId || order.id, name: first, surname: rest.join(' ') || first, email: order.buyer.email, gsmNumber: order.buyer.phone || undefined, identityNumber: '11111111111', registrationAddress: addr.address, city: addr.city, country: addr.country, ip },
        billingAddress: addr, basketItems: lines });
      return { url: j.paymentPageUrl, session: j.token };
    },
    async confirm(order, input) {
      if (!input.token) return { paid: false, error: 'Missing payment token.' };
      let j; try { j = await iyziCall('/payment/iyzipos/checkoutform/auth/ecom/detail', { locale: 'en', conversationId: order.id, token: input.token }); } catch (e) { return { paid: false, error: String(e.message || e) }; }
      if (j.paymentStatus !== 'SUCCESS' || j.basketId !== order.no) return { paid: false, error: 'Payment was not completed.' };
      if (Math.abs(Number(j.paidPrice) - order.total) > 0.01) return { paid: false, error: 'Paid amount does not match the order.' };
      return { paid: true, ref: String(j.paymentId), items: (j.itemTransactions || []).map((t) => ({ id: t.itemId, tx: String(t.paymentTransactionId), paid: Number(t.paidPrice) })) };
    },
    // iyzico refunds per basket line; the amount is taken from the lines of this order, largest remaining first
    async refund(order, amount, { ip }) {
      let left = Math.round(amount * 100); const refs = [];
      for (const t of (order.payment.items || []).slice().sort((a, b) => (b.paid - (b.refunded || 0)) - (a.paid - (a.refunded || 0)))) {
        const can = Math.round((t.paid - (t.refunded || 0)) * 100); if (left <= 0 || can <= 0) continue;
        const take = Math.min(left, can);
        try { const j = await iyziCall('/payment/refund', { locale: 'en', conversationId: order.id, paymentTransactionId: t.tx, price: money(take / 100), currency: order.currency, ip }); refs.push(String(j.paymentId || t.tx)); t.refunded = Math.round(((t.refunded || 0) + take / 100) * 100) / 100; left -= take; }
        catch (e) { return { ok: false, error: String(e.message || e), partial: Math.round(amount * 100 - left) / 100 }; }
      }
      return left <= 0 ? { ok: true, ref: refs.join(',') } : { ok: false, error: 'İade edilebilir tutar yetersiz.', partial: Math.round(amount * 100 - left) / 100 };
    }
  }
};
// The provider chosen in settings, or null with the reason selling cannot start.
export function provider(name) {
  const st = providerStatus();
  if (name === 'test') return st.test.ready ? { name, ...PROVIDERS.test } : { error: 'Deneme sağlayıcısı canlı sitede kullanılamaz.' };
  if (name === 'iyzico') return st.iyzico.ready ? { name, ...PROVIDERS.iyzico } : { error: 'iyzico anahtarları tanımlı değil: ' + st.iyzico.missing.join(', ') };
  return { error: 'Ödeme sağlayıcısı seçilmedi.' };
}
