// Public event / invite page: RSVP form, campaign attribution, privacy-safe counters.
(function () {
  'use strict';
  var C = window.ML || {}, qs = new URLSearchParams(location.search), utm = {};
  var ref = (qs.get('ref') || '').slice(0, 20);
  try { if (ref) sessionStorage.setItem('ml-ref-' + C.e, ref); else ref = sessionStorage.getItem('ml-ref-' + C.e) || ''; } catch (e) {}
  ['source', 'medium', 'campaign', 'content'].forEach(function (k) { var v = qs.get('utm_' + k); if (v) utm[k] = v.slice(0, 80); });
  try { // keep the campaign for this visit only, so a later RSVP on the same tab is still attributed
    var key = 'ml-utm-' + C.e;
    if (Object.keys(utm).length) sessionStorage.setItem(key, JSON.stringify(utm)); else utm = JSON.parse(sessionStorage.getItem(key) || '{}');
  } catch (e) {}
  // Counters carry the event id and campaign tags only: never the invite key, a name or an address.
  function hit(kind) { if (!C.track) return; try { navigator.sendBeacon('/api/public/hit', new Blob([JSON.stringify({ e: C.e, k: kind, utm: utm })], { type: 'application/json' })); } catch (e) {} }
  hit('view');
  var gl = document.getElementById('g-guests'); if (gl && window.MLGuests) window.MLGuests(gl, C.e, { invite: C.t });
  var wh = document.getElementById('g-when');
  if (wh && C.d) { // days left, counted on Istanbul's calendar
    var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }), n = Math.round((Date.parse(C.d) - Date.parse(today)) / 864e5);
    var txt = n === 0 ? 'Tonight' : n === 1 ? 'Tomorrow' : n > 1 && n <= 60 ? 'In ' + n + ' days' : '';
    if (txt) { wh.textContent = txt; wh.hidden = false; if (n <= 1) wh.classList.add('hot'); }
  }
  var cta = document.getElementById('g-cta'), fm = document.getElementById('g-form');
  if (cta && fm && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { cta.classList.toggle('off', en[0].isIntersecting); }, { threshold: 0.15 }).observe(fm);
    cta.addEventListener('click', function (ev) { ev.preventDefault(); fm.scrollIntoView({ behavior: 'smooth', block: 'start' }); var f = fm.querySelector('input'); if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 500); });
  }
  var sh = document.getElementById('g-share');
  if (sh) sh.addEventListener('click', function () { // the public address only: no campaign tags, never an invite key
    var u = location.origin + location.pathname, lab = sh.querySelector('span');
    if (navigator.share) navigator.share({ title: document.title, url: u }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { lab.textContent = 'Link copied'; setTimeout(function () { lab.textContent = 'Share'; }, 2000); });
  });
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, img = document.querySelector('.g-poster .g-img');
  if (img && !still && matchMedia('(hover: hover)').matches) { // the poster leans toward the pointer
    var po = img.parentNode;
    po.addEventListener('pointermove', function (ev) { var r = po.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width - .5, y = (ev.clientY - r.top) / r.height - .5; img.classList.add('live'); img.style.transform = 'rotateY(' + (x * 9).toFixed(2) + 'deg) rotateX(' + (-y * 9).toFixed(2) + 'deg) scale(1.015)'; });
    po.addEventListener('pointerleave', function () { img.classList.remove('live'); img.style.transform = ''; });
  }
  if (!still && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }); }, { threshold: 0.08 });
    document.querySelectorAll('.g-desc,.g-panel').forEach(function (n) { if (n.getBoundingClientRect().top > innerHeight) { n.classList.add('rv'); io.observe(n); } });
  }
  var tix = document.getElementById('g-tix'); if (tix) tix.addEventListener('click', function () { hit('ticket'); });
  var form = document.getElementById('g-form'); if (!form) return;
  var msg = document.getElementById('g-msg'), btn = form.querySelector('button[type=submit]');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault(); msg.className = 'g-msg'; msg.textContent = '';
    var el = form.elements, data = { t: C.t, slug: C.slug, name: el.name.value, email: el.email.value, phone: el.phone ? el.phone.value : '', plus: el.plus ? el.plus.value : 0, note: el.note ? el.note.value : '', website: el.website.value, consent: el.consent.checked, showName: !!(el.showName && el.showName.checked), ref: ref, utm: utm };
    if (!data.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) { msg.className = 'g-msg bad'; msg.textContent = 'Please enter your name and a valid email.'; return; }
    if (el.phone && el.phone.required && !data.phone.trim()) { msg.className = 'g-msg bad'; msg.textContent = 'Please enter your phone number.'; return; }
    if (!data.consent) { msg.className = 'g-msg bad'; msg.textContent = 'Please tick the box so we can manage your attendance.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/public/rsvp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.j.error || 'Something went wrong.');
        // Measured only after the server saved the request, and once per saved request.
        if (r.j.created && typeof window.gtag === 'function') window.gtag('event', 'rsvp_submitted', { event_slug: C.slug || 'private', transaction_id: r.j.ref });
        if (cta) cta.remove();
        form.outerHTML = '<div role="status" class="g-done"><div class="g-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg></div><h2 class="g-title" style="font-size:clamp(28px,6vw,40px)">Request <span class="serif accent" style="display:inline">received.</span></h2><p style="color:var(--mute)">Thank you. This is not a confirmation yet: the More Life team reviews every request, and you will get your entry pass once your place is confirmed.</p></div>';
      })
      .catch(function (e) { msg.className = 'g-msg bad'; msg.textContent = e.message === 'Failed to fetch' ? 'Connection error. Your details are still here: please try again.' : e.message; btn.disabled = false; btn.textContent = 'Send request'; });
  });
})();
