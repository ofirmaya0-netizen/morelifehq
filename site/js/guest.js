// Public event / invite page: RSVP form, campaign attribution, privacy-safe counters.
(function () {
  'use strict';
  var C = window.ML || {}, qs = new URLSearchParams(location.search), utm = {};
  ['source', 'medium', 'campaign', 'content'].forEach(function (k) { var v = qs.get('utm_' + k); if (v) utm[k] = v.slice(0, 80); });
  try { // keep the campaign for this visit only, so a later RSVP on the same tab is still attributed
    var key = 'ml-utm-' + C.e;
    if (Object.keys(utm).length) sessionStorage.setItem(key, JSON.stringify(utm)); else utm = JSON.parse(sessionStorage.getItem(key) || '{}');
  } catch (e) {}
  // Counters carry the event id and campaign tags only: never the invite key, a name or an address.
  function hit(kind) { if (!C.track) return; try { navigator.sendBeacon('/api/public/hit', new Blob([JSON.stringify({ e: C.e, k: kind, utm: utm })], { type: 'application/json' })); } catch (e) {} }
  hit('view');
  var tix = document.getElementById('g-tix'); if (tix) tix.addEventListener('click', function () { hit('ticket'); });
  var form = document.getElementById('g-form'); if (!form) return;
  var msg = document.getElementById('g-msg'), btn = form.querySelector('button[type=submit]');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault(); msg.className = 'g-msg'; msg.textContent = '';
    var el = form.elements, data = { t: C.t, slug: C.slug, name: el.name.value, email: el.email.value, phone: el.phone ? el.phone.value : '', plus: el.plus ? el.plus.value : 0, note: el.note ? el.note.value : '', website: el.website.value, consent: el.consent.checked, utm: utm };
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
        form.outerHTML = '<div role="status"><h2 class="g-title" style="font-size:clamp(28px,6vw,40px)">Request <span class="serif accent">received.</span></h2><p style="color:var(--mute);margin-top:10px">Thank you. This is not a confirmation yet: the More Life team reviews every request, and you will get your entry pass once your place is confirmed.</p></div>';
      })
      .catch(function (e) { msg.className = 'g-msg bad'; msg.textContent = e.message === 'Failed to fetch' ? 'Connection error. Your details are still here: please try again.' : e.message; btn.disabled = false; btn.textContent = 'Send request'; });
  });
})();
