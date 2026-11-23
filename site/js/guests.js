// Guest list on event, invite and pass pages. Everyone sees initials; a visitor holding an entry pass for
// this event sees full names. The pass key is kept on this device only, after the pass page has been opened.
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hue(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function av(g, n) { return '<span aria-hidden="true" style="--h:' + hue(g.n || g.i) + ';--n:' + n + '">' + esc(g.i) + '</span>'; }
  window.MLGuests = function (box, eventId, o) {
    o = o || {}; var p = o.pass || '';
    try { if (p) localStorage.setItem('ml-pass-' + eventId, p); else p = localStorage.getItem('ml-pass-' + eventId) || ''; } catch (e) {}
    var q = '/api/public/guests?e=' + encodeURIComponent(eventId) + (p ? '&p=' + encodeURIComponent(p) : '') + (o.invite ? '&t=' + encodeURIComponent(o.invite) : '');
    fetch(q).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.enabled || !j.going) return;
      var more = j.going - j.guests.reduce(function (n, g) { return n + (g.g || 1); }, 0);
      var head = '<h2><b>' + j.going + '</b> going</h2>';
      if (j.names) box.innerHTML = head + '<ul class="g-names">' + j.guests.map(function (g) { return '<li>' + av(g, 0) + esc(g.n) + (g.g > 1 ? ' +' + (g.g - 1) : '') + '</li>'; }).join('') + '</ul>' + (more > 0 ? '<small>and ' + more + ' more</small>' : '');
      else box.innerHTML = head + (j.guests.length ? '<div class="g-av">' + j.guests.slice(0, 12).map(av).join('') + (j.going > Math.min(j.guests.length, 12) ? '<span class="more" style="--n:12">+' + (j.going - Math.min(j.guests.length, 12)) + '</span>' : '') + '</div>' : '') + '<small>Names are visible to confirmed guests.</small>';
      box.hidden = false;
    }).catch(function () {});
  };
})();
