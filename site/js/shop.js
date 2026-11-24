// Ticket shop on the event / invite page: choose tickets, apply a code, give your details, go to the payment page.
// Prices and stock always come from the server; this page only shows them and sends the basket.
(function () {
  'use strict';
  var C = window.ML || {}, box = document.getElementById('g-shop'); if (!box) return;
  var qs = new URLSearchParams(location.search), st = { qty: {}, code: (qs.get('code') || '').slice(0, 40), data: null, busy: false }, utm = {};
  try { utm = JSON.parse(sessionStorage.getItem('ml-utm-' + C.e) || '{}'); } catch (e) {}
  ['source', 'medium', 'campaign', 'content'].forEach(function (k) { var v = qs.get('utm_' + k); if (v) utm[k] = v.slice(0, 80); });
  // English or Turkish: the visitor's browser language to start with, their own choice after that
  var lang = 'en'; try { lang = localStorage.getItem('ml-lang') || ((navigator.language || '').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en'); } catch (e) {}
  if (qs.get('lang') === 'tr' || qs.get('lang') === 'en') lang = qs.get('lang');
  var TR = { 'Tickets': 'Biletler', 'Test mode · no money moves': 'Deneme modu · para hareketi yok', 'Last few': 'Son biletler', 'Admits': 'Kişi sayısı:', 'On sale': 'Satış başlangıcı:', 'Not on sale yet': 'Henüz satışta değil', 'Sold out': 'Tükendi', 'Sales ended': 'Satış bitti', 'Free': 'Ücretsiz', 'fee': 'hizmet bedeli',
    'One fewer': 'Bir azalt', 'One more': 'Bir artır', 'Promo or access code': 'İndirim ya da erişim kodu', 'Apply': 'Uygula', 'applied.': 'uygulandı.', 'Code': 'Kod', 'This code has been used up.': 'Bu kodun kullanım hakkı doldu.', 'This code is not valid.': 'Bu kod geçerli değil.', 'ticket': 'bilet', 'tickets': 'bilet', 'Service fee': 'Hizmet bedeli', 'Total': 'Toplam',
    'Full name': 'Ad soyad', 'Email': 'E-posta', 'Phone': 'Telefon', '(optional)': '(isteğe bağlı)', 'Terms of sale and refund policy': 'Satış koşulları ve iade politikası', 'Seller': 'Satıcı', 'Refunds': 'İade', 'Terms of sale': 'Satış koşulları',
    'I accept the terms of sale and refund policy, and More Life may use these details to manage my order.': 'Satış koşullarını ve iade politikasını kabul ediyorum; More Life bu bilgileri siparişimi yönetmek için kullanabilir.', 'Continue to payment': 'Ödemeye geç', 'Get tickets': 'Biletleri al',
    'Your tickets are held for': 'Biletleriniz ödeme sırasında', 'minutes while you pay. Card details are entered on the payment provider’s page, never here.': 'dakika sizin için tutulur. Kart bilgileri bu sayfada değil, ödeme sağlayıcısının sayfasında girilir.', 'Ticket sales are not open yet.': 'Bilet satışı henüz açılmadı.',
    'Please enter your full name and a valid email.': 'Lütfen adınızı soyadınızı ve geçerli bir e-posta girin.', 'Please accept the terms of sale to continue.': 'Devam etmek için satış koşullarını kabul edin.', 'Holding your tickets…': 'Biletleriniz ayrılıyor…', 'Something went wrong.': 'Bir şeyler ters gitti.',
    'Join the waitlist': 'Bekleme listesine katıl', 'Tell me when it opens': 'Açılınca haber ver', 'Your email': 'E-posta adresiniz', 'Notify me': 'Haber ver', 'We will email you once if a ticket becomes available. It is first come, first served.': 'Bilet açılırsa size bir kez e-posta göndeririz. Biletler ilk gelene satılır.', 'You are on the list. We will email you once.': 'Listedesiniz. Size bir kez e-posta göndereceğiz.', 'Please enter a valid email.': 'Lütfen geçerli bir e-posta girin.',
    'Resale ticket from another guest, at the original price': 'Başka bir misafirin geri bıraktığı bilet, ilk fiyatından', 'Instalments are available on the payment page.': 'Ödeme sayfasında taksit seçeneği vardır.', 'Quantity for': 'Adet:' };
  function S(k) { return lang === 'tr' && TR[k] ? TR[k] : k; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { try { return new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { style: 'currency', currency: st.data.currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch (e) { return n + ' ' + st.data.currency; } }
  function when(v) { var p = v.split('T'), d = p[0].split('-'); return new Date(+d[0], +d[1] - 1, +d[2]).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' }) + ' · ' + p[1]; }
  function ga(name, params) { if (typeof window.gtag === 'function') window.gtag('event', name, params); } // gtag exists only after the visitor has agreed to analytics
  function totals() {
    var sub = 0, fee = 0, n = 0;
    st.data.types.forEach(function (t) { var q = st.qty[t.id] || 0; sub += t.now * q; fee += t.fee * q; n += q; });
    return { sub: Math.round(sub * 100) / 100, fee: Math.round(fee * 100) / 100, n: n, total: Math.round((sub + fee) * 100) / 100 };
  }
  function load(keep) {
    return fetch('/api/public/shop?' + (C.t ? 't=' + encodeURIComponent(C.t) : 'slug=' + encodeURIComponent(C.slug)) + (st.code ? '&code=' + encodeURIComponent(st.code) : '')).then(function (r) { return r.json(); }).then(function (d) {
      st.data = d; if (!d.enabled || !d.types.length) { box.hidden = true; return; }
      d.types.forEach(function (t) { if (t.state !== 'on') st.qty[t.id] = 0; else if (st.qty[t.id] > t.max) st.qty[t.id] = t.max; });
      draw(keep); box.hidden = false;
      var cta = document.querySelectorAll('[data-shop]'); cta.forEach(function (b) { b.hidden = false; });
    }).catch(function () { box.hidden = true; });
  }
  var LABEL = { soon: 'Not on sale yet', soldout: 'Sold out', ended: 'Sales ended' }, wait = '', waited = {};
  function draw(keep) {
    var d = st.data, v = keep ? vals() : {}, t = totals();
    box.innerHTML = '<div class="sh-head"><h2>' + S('Tickets') + '</h2><div class="sh-lang" role="group" aria-label="Language"><button type="button" data-lang="en" aria-pressed="' + (lang === 'en') + '">EN</button><button type="button" data-lang="tr" aria-pressed="' + (lang === 'tr') + '">TR</button></div></div>' + (d.test ? '<p class="g-pill hot" style="align-self:flex-start">' + S('Test mode · no money moves') + '</p>' : '') + (d.note ? '<p style="color:var(--mute)">' + esc(d.note) + '</p>' : '') +
      '<div class="sh-list">' + d.types.map(function (x) {
        var q = st.qty[x.id] || 0, on = x.state === 'on';
        return '<div class="sh-row' + (on ? '' : ' off') + '"><div class="sh-main"><b>' + esc(x.name) + '</b>' + (x.description ? '<span>' + esc(x.description) + '</span>' : '') + (x.admits > 1 ? '<span>' + S('Admits') + ' ' + x.admits + '</span>' : '') +
          (on && x.resale ? '<span>' + S('Resale ticket from another guest, at the original price') + '</span>' : on && x.low ? '<span class="sh-low">' + S('Last few') + '</span>' : '') + (!on ? '<span>' + (x.state === 'soon' && x.opens ? S('On sale') + ' ' + esc(when(x.opens)) : S(LABEL[x.state] || '')) + '</span>' : '') + '</div>' +
          '<div class="sh-price">' + (x.now < x.price ? '<s>' + money(x.price) + '</s>' : '') + '<b>' + (x.now ? money(x.now) : S('Free')) + '</b>' + (x.fee ? '<span>+ ' + money(x.fee) + ' ' + S('fee') + '</span>' : '') + '</div>' +
          (on ? '<div class="sh-qty" role="group" aria-label="' + S('Quantity for') + ' ' + esc(x.name) + '"><button type="button" data-dec="' + x.id + '" aria-label="' + S('One fewer') + '"' + (q ? '' : ' disabled') + '>−</button><output aria-live="polite">' + q + '</output><button type="button" data-inc="' + x.id + '" aria-label="' + S('One more') + '"' + (q >= x.max ? ' disabled' : '') + '>+</button></div>'
            : '<div class="sh-qty">' + (x.notify && !waited[x.id] ? '<button class="sh-wait" type="button" data-wait="' + x.id + '">' + S(x.notify === 'onsale' ? 'Tell me when it opens' : 'Join the waitlist') + '</button>' : '') + '</div>') +
          (waited[x.id] ? '<p class="g-msg" style="grid-column:1/-1">' + S('You are on the list. We will email you once.') + '</p>' : wait === x.id ? '<form class="sh-code" data-waitform="' + x.id + '" style="grid-column:1/-1"><label class="sr-only" for="sh-w">' + S('Your email') + '</label><input id="sh-w" type="email" autocomplete="email" required placeholder="' + S('Your email') + '" style="text-transform:none"><button class="btn quiet" type="submit">' + S('Notify me') + '</button><p class="sh-note" style="flex-basis:100%">' + S('We will email you once if a ticket becomes available. It is first come, first served.') + '</p><p class="g-msg bad" role="alert" style="flex-basis:100%"></p></form>' : '') + '</div>';
      }).join('') + '</div>' +
      '<form class="sh-code" id="sh-code"><label class="sr-only" for="sh-c">' + S('Promo or access code') + '</label><input id="sh-c" placeholder="' + S('Promo or access code') + '" autocomplete="off" autocapitalize="characters" value="' + esc(st.code) + '"><button class="btn quiet" type="submit">' + S('Apply') + '</button>' + (d.code ? '<p class="g-msg' + (d.code.ok ? '' : ' bad') + '" style="flex-basis:100%">' + (d.code.ok ? S('Code') + ' ' + esc(d.code.code) + ' ' + S('applied.') : esc(S(d.code.error))) + '</p>' : '') + '</form>' +
      (t.n ? '<form class="g-form" id="sh-form" novalidate><div class="sh-sum" style="grid-column:1/-1"><div><span>' + t.n + ' ' + S(t.n === 1 ? 'ticket' : 'tickets') + '</span><b>' + money(t.sub) + '</b></div>' + (t.fee ? '<div><span>' + S('Service fee') + '</span><b>' + money(t.fee) + '</b></div>' : '') + '<div class="tot"><span>' + S('Total') + '</span><b>' + (t.total ? money(t.total) : S('Free')) + '</b></div></div>' +
        (d.ready ? '<div class="field"><label for="sh-name">' + S('Full name') + '</label><input id="sh-name" name="name" autocomplete="name" required value="' + esc(v.name || '') + '"></div><div class="field"><label for="sh-email">' + S('Email') + '</label><input id="sh-email" name="email" type="email" autocomplete="email" required value="' + esc(v.email || '') + '"></div>' +
          '<div class="field" style="grid-column:1/-1"><label for="sh-phone">' + S('Phone') + ' <span style="opacity:.6">' + S('(optional)') + '</span></label><input id="sh-phone" name="phone" type="tel" autocomplete="tel" value="' + esc(v.phone || '') + '"></div>' +
          '<div style="position:absolute;left:-9999px" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
          (d.terms || d.refundPolicy ? '<details class="sh-terms" style="grid-column:1/-1"><summary>' + S('Terms of sale and refund policy') + '</summary>' + (d.seller ? '<p><b>' + S('Seller') + '</b><br>' + esc(d.seller).replace(/\n/g, '<br>') + '</p>' : '') + (d.refundPolicy ? '<p><b>' + S('Refunds') + '</b><br>' + esc(d.refundPolicy).replace(/\n/g, '<br>') + '</p>' : '') + (d.terms ? '<p><b>' + S('Terms of sale') + '</b><br>' + esc(d.terms).replace(/\n/g, '<br>') + '</p>' : '') + '</details>' : '') +
          '<label class="check" for="sh-terms" style="grid-column:1/-1"><input id="sh-terms" name="terms" type="checkbox" required' + (v.terms ? ' checked' : '') + '><span>' + S('I accept the terms of sale and refund policy, and More Life may use these details to manage my order.') + '</span></label>' +
          '<p class="g-msg" id="sh-msg" role="alert" style="grid-column:1/-1"></p><button class="btn" type="submit" style="grid-column:1/-1">' + (t.total ? S('Continue to payment') + ' · ' + money(t.total) : S('Get tickets')) + '</button><p class="sh-note" style="grid-column:1/-1">' + S('Your tickets are held for') + ' ' + d.holdMinutes + ' ' + S('minutes while you pay. Card details are entered on the payment provider’s page, never here.') + (d.installments && t.total ? ' ' + S('Instalments are available on the payment page.') : '') + '</p>'
          : '<p class="g-msg" style="grid-column:1/-1">' + S('Ticket sales are not open yet.') + '</p>') + '</form>' : '');
  }
  function vals() { var f = document.getElementById('sh-form'), o = {}; if (f) f.querySelectorAll('[name]').forEach(function (el) { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return o; }
  box.addEventListener('click', function (ev) {
    var lg = ev.target.closest('[data-lang]'), wb = ev.target.closest('[data-wait]');
    if (lg) { lang = lg.getAttribute('data-lang'); try { localStorage.setItem('ml-lang', lang); } catch (e) {} draw(true); return; }
    if (wb) { wait = wb.getAttribute('data-wait'); draw(true); var wi = document.getElementById('sh-w'); if (wi) wi.focus(); return; }
    var inc = ev.target.closest('[data-inc]'), dec = ev.target.closest('[data-dec]'), id = (inc || dec) && (inc || dec).getAttribute(inc ? 'data-inc' : 'data-dec'); if (!id) return;
    var t = st.data.types.filter(function (x) { return x.id === id; })[0], q = st.qty[id] || 0;
    st.qty[id] = inc ? (q ? Math.min(t.max, q + 1) : Math.min(t.max, t.min)) : (q <= t.min ? 0 : q - 1); // the first tap jumps to the minimum, going below it clears
    draw(true); var again = box.querySelector('[' + (inc ? 'data-inc' : 'data-dec') + '="' + id + '"]'); if (again && !again.disabled) again.focus();
  });
  box.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (ev.target.id === 'sh-code') { st.code = document.getElementById('sh-c').value.trim(); load(true); return; }
    var wf = ev.target.closest('[data-waitform]');
    if (wf) {
      var em = wf.querySelector('input').value.trim(), wm = wf.querySelector('.g-msg'), tid = wf.getAttribute('data-waitform');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { wm.textContent = S('Please enter a valid email.'); return; }
      fetch('/api/public/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: C.slug || undefined, t: C.t || undefined, typeId: tid, email: em, lang: lang }) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || S('Something went wrong.')); }); })
        .then(function () { waited[tid] = 1; wait = ''; draw(true); }).catch(function (err) { wm.textContent = err.message; });
      return;
    }
    if (ev.target.id !== 'sh-form' || st.busy) return;
    var v = vals(), msg = document.getElementById('sh-msg'), btn = ev.target.querySelector('button[type=submit]'), t = totals();
    if (!v.name || v.name.trim().split(/\s+/).length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email || '')) { msg.className = 'g-msg bad'; msg.textContent = S('Please enter your full name and a valid email.'); return; }
    if (!v.terms) { msg.className = 'g-msg bad'; msg.textContent = S('Please accept the terms of sale to continue.'); return; }
    st.busy = true; btn.disabled = true; msg.className = 'g-msg'; msg.textContent = S('Holding your tickets…');
    ga('begin_checkout', { currency: st.data.currency, value: t.total });
    fetch('/api/public/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: C.slug || undefined, t: C.t || undefined, items: Object.keys(st.qty).filter(function (k) { return st.qty[k]; }).map(function (k) { return { typeId: k, qty: st.qty[k] }; }), name: v.name, email: v.email, phone: v.phone, website: v.website, code: st.data.code && st.data.code.ok ? st.code : '', terms: true, lang: lang, utm: utm, ref: (function () { try { return sessionStorage.getItem('ml-ref-' + C.e) || ''; } catch (e) { return ''; } })() }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || S('Something went wrong.')); return j; }); })
      .then(function (j) { location.href = j.url; })
      .catch(function (err) { st.busy = false; load(true).then(function () { var m = document.getElementById('sh-msg'); if (m) { m.className = 'g-msg bad'; m.textContent = err.message; } }); });
  });
  load();
})();
