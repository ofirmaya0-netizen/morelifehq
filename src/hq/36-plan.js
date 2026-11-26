/* Masa planı: mekânın kat planı üzerinde, etkinlik için kim hangi masada. Masaya tıkla → oturt, taşı, kaldır. */
(function () {
  var H = HQ, e = H.esc;
    function shape(s, attrs) {
    return s.s === 'e' ? '<ellipse cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2) + '" rx="' + s.w / 2 + '" ry="' + s.h / 2 + '"' + attrs + '/>'
      : '<rect x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="' + (s.s === 'r' ? 10 : 2) + '"' + attrs + '/>';
  }
  function text(s, lines, cls) {
    var cx = s.x + s.w / 2, cy = s.y + s.h / 2, lh = cls === 'fp-t' ? 10 : 9, y0 = cy - (lines.length - 1) * lh / 2;
    return '<text class="' + cls + '" text-anchor="middle" dominant-baseline="central"' + (s.rot ? ' transform="rotate(' + s.rot + ' ' + cx + ' ' + cy + ')"' : '') + '>' + lines.map(function (l, i) { return '<tspan x="' + cx + '" y="' + (y0 + i * lh) + '"' + (l[1] ? ' class="' + l[1] + '"' : '') + '>' + e(l[0]) + '</tspan>'; }).join('') + '</text>';
  }
  var people = function (items) { return items.reduce(function (n, x) { return n + x.people; }, 0); };
  var short = function (n, max) { var f = n.trim().split(/\s+/)[0]; return f.length > max ? f.slice(0, max - 1) + '…' : f; };

  var DEFS = '<defs>' +
    '<radialGradient id="fpRoom" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#241a18"/><stop offset="1" stop-color="#0f0b0a"/></radialGradient>' +
    '<radialGradient id="fpFloor" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#E0705F" stop-opacity=".16"/><stop offset="1" stop-color="#E0705F" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="fpBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a3a4c"/><stop offset="1" stop-color="#4a1f2a"/></linearGradient>' +
    '<linearGradient id="fpSofa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b534b"/><stop offset="1" stop-color="#40312d"/></linearGradient>' +
    '<linearGradient id="fpWood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b7146"/><stop offset="1" stop-color="#5b4a2e"/></linearGradient>' +
    '<radialGradient id="fpFree" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d0c3"/></radialGradient>' +
    '<radialGradient id="fpOn" cx="38%" cy="30%" r="85%"><stop offset="0" stop-color="#f39a8b"/><stop offset="1" stop-color="#b9463a"/></radialGradient>' +
    '<radialGradient id="fpVig" cx="50%" cy="50%" r="72%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>' +
    '<radialGradient id="fpSeat" cx="40%" cy="32%" r="80%"><stop offset="0" stop-color="#4a3d39"/><stop offset="1" stop-color="#2b2321"/></radialGradient>' +
    '<radialGradient id="fpCol" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#5a504c"/><stop offset="1" stop-color="#231d1b"/></radialGradient>' +
    '<linearGradient id="fpBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3EEE6" stop-opacity=".10"/><stop offset="1" stop-color="#F3EEE6" stop-opacity="0"/></linearGradient>' +
    '<pattern id="fpGrid" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="rgba(243,238,230,.09)"/></pattern>' +
    '<pattern id="fpRug" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(243,238,230,.04)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(243,238,230,.05)" stroke-width="1.2"/></pattern>' +
    '<filter id="fpShadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".55"/></filter>' +
    '<filter id="fpGlow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="5" result="b"/><feFlood flood-color="#E0705F" flood-opacity=".75"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '</defs>';
  var FIX = { carpet: 'url(#fpRug)', sofa: 'url(#fpSofa)', dark: '#2a2321', bar: 'url(#fpBar)', wood: 'url(#fpWood)', door: 'rgba(243,238,230,.28)', bistro: '#9a8e6e' };
  function shape2(s, attrs, rx) {
    return s.s === 'e' ? '<ellipse cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2) + '" rx="' + s.w / 2 + '" ry="' + s.h / 2 + '"' + attrs + '/>'
      : '<rect x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="' + (rx != null ? rx : s.s === 'r' ? 12 : 4) + '"' + attrs + '/>';
  }
  // chairs round a table, cushions on a sofa, stools at the bar: what makes a drawing read as a room
  function chairs(s, on) {
    if (s.s !== 'e') return ''; // a sofa table has no chairs round it
    var cx = s.x + s.w / 2, cy = s.y + s.h / 2, n = s.w >= 60 ? 8 : s.w >= 46 ? 6 : 5, out = '';
    for (var i = 0; i < n; i++) { var a = (i / n) * Math.PI * 2 - Math.PI / 2 + (n === 6 ? Math.PI / 6 : 0); out += '<circle class="fp-chair' + (on ? ' on' : '') + '" cx="' + (cx + Math.cos(a) * (s.w / 2 + 6.5)).toFixed(1) + '" cy="' + (cy + Math.sin(a) * (s.h / 2 + 6.5)).toFixed(1) + '" r="3.4"/>'; }
    return out;
  }
  function cushions(s) {
    var out = '', horiz = s.w > s.h, len = horiz ? s.w : s.h, n = Math.max(2, Math.round(len / 26));
    for (var i = 1; i < n; i++) { var t = (len / n) * i; out += horiz ? '<line x1="' + (s.x + t) + '" y1="' + (s.y + 2) + '" x2="' + (s.x + t) + '" y2="' + (s.y + s.h - 2) + '" class="fp-seam"/>' : '<line x1="' + (s.x + 2) + '" y1="' + (s.y + t) + '" x2="' + (s.x + s.w - 2) + '" y2="' + (s.y + t) + '" class="fp-seam"/>'; }
    return out;
  }
  function stools(s) { var out = '', n = Math.floor(s.w / 30); for (var i = 0; i < n; i++) out += '<circle class="fp-stool" cx="' + (s.x + 22 + i * ((s.w - 44) / (n - 1))).toFixed(1) + '" cy="' + (s.y + s.h + 9) + '" r="4.2"/>'; return out; }
  function shelf(s) { var out = '', n = Math.floor(s.w / 16); for (var i = 0; i < n; i++) out += '<circle cx="' + (s.x + 10 + i * ((s.w - 20) / (n - 1))).toFixed(1) + '" cy="' + (s.y + s.h / 2) + '" r="1.5" fill="' + (i % 3 === 0 ? '#E0705F' : i % 3 === 1 ? '#F2C46B' : '#F3EEE6') + '" opacity=".75"/>'; return out; }
  var words = function (s, max) { return s.label.split(' ').length > 1 && s.w < max ? s.label.split(' ').map(function (w) { return [w]; }) : [[s.label]]; };

  // d: { plan, assign }. Tables are buttons and drop targets; everything else is scenery.
  H.planSvg = function (d) {
    var p = d.plan, room = p.shapes.filter(function (s) { return s.c === 'room'; })[0], ts = p.shapes.filter(function (s) { return s.k === 'table'; });
    // the dance floor glow sits under the tables: the middle of where they stand
    var cx = ts.reduce(function (n, s) { return n + s.x + s.w / 2; }, 0) / (ts.length || 1), cy = ts.reduce(function (n, s) { return n + s.y + s.h / 2; }, 0) / (ts.length || 1);
    return '<svg class="fplan" viewBox="0 0 ' + p.w + ' ' + p.h + '" role="group" aria-label="' + e(p.name) + ' masa planı">' + DEFS +
      (room ? '<rect x="' + room.x + '" y="' + room.y + '" width="' + room.w + '" height="' + room.h + '" rx="14" fill="url(#fpRoom)" stroke="rgba(243,238,230,.34)" stroke-width="1.4"/><rect x="' + (room.x + 3.5) + '" y="' + (room.y + 3.5) + '" width="' + (room.w - 7) + '" height="' + (room.h - 7) + '" rx="11" fill="none" stroke="rgba(243,238,230,.1)" stroke-width=".8"/><rect x="' + room.x + '" y="' + room.y + '" width="' + room.w + '" height="' + room.h + '" rx="14" fill="url(#fpGrid)"/>' : '') +
      (ts.length ? '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + p.w * 0.29 + '" ry="' + p.h * 0.36 + '" fill="url(#fpFloor)"/>' + [-0.16, 0, 0.16].map(function (o) { var x = cx + o * p.w; return '<polygon class="fp-beam" points="' + (x - 8) + ',' + (cy - p.h * 0.3) + ' ' + (x + 8) + ',' + (cy - p.h * 0.3) + ' ' + (x + 46 + o * 120) + ',' + (cy + p.h * 0.34) + ' ' + (x - 46 + o * 120) + ',' + (cy + p.h * 0.34) + '" fill="url(#fpBeam)"/>'; }).join('') : '') +
      p.shapes.map(function (s) {
        if (s.c === 'room') return '';
        if (s.k === 'fix') {
          var dj = s.label === 'DJ', out = shape2(s, ' fill="' + (FIX[s.c] || FIX.dark) + '"' + (s.c === 'carpet' ? ' stroke="rgba(243,238,230,.07)"' : s.c === 'bar' ? ' filter="url(#fpShadow)" stroke="rgba(255,255,255,.12)"' : s.c === 'sofa' ? ' stroke="rgba(0,0,0,.35)"' : ''), s.c === 'carpet' ? 10 : s.c === 'sofa' ? 6 : null);
          if (s.c === 'sofa') out += cushions(s);
          if (s.c === 'dark' && s.s === 'e') out = shape2(s, ' fill="url(#fpCol)" stroke="rgba(243,238,230,.25)" stroke-width=".8" filter="url(#fpShadow)"');
          if (s.c === 'dark' && s.s !== 'e' && !s.label && s.w > 200) out += shelf(s);
          if (s.c === 'bar' && s.w > 200) out += stools(s);
          if (s.c === 'bar' && s.w > 200) out += '<rect x="' + (s.x + 10) + '" y="' + (s.y + 5) + '" width="' + (s.w - 20) + '" height="2" rx="1" fill="rgba(255,255,255,.22)"/>';
          if (dj) out += [0, 1, 2].map(function (i) { return '<circle class="fp-pulse" style="animation-delay:' + (i * 0.9) + 's" cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2) + '" r="10" fill="none" stroke="#E0705F" stroke-width="1"/>'; }).join('') + '<circle cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2 - 22) + '" r="9" fill="#17110f" stroke="rgba(243,238,230,.35)"/><circle cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2 + 22) + '" r="9" fill="#17110f" stroke="rgba(243,238,230,.35)"/><circle cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2 - 22) + '" r="2" fill="#E0705F"/><circle cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2 + 22) + '" r="2" fill="#E0705F"/>';
          return out + (s.label ? text(s, words(s, 70), 'fp-fix') : '');
        }
        if (s.k === 'text') return text(s, [[s.label]], 'fp-note');
        if (s.k === 'seat') return shape2(s, ' class="fp-seat" fill="url(#fpSeat)"', 7) + text(s, words(s, 60), 'fp-seat-t');
        var it = d.assign[s.id] || [], n = people(it), on = it.length > 0, tip = s.label + (on ? ': ' + it.map(function (x) { return x.name + ' (' + x.people + ')'; }).join(', ') : ': boş');
        return '<g class="fp-table' + (on ? ' on' : '') + '" data-t="' + e(s.id) + '" tabindex="0" role="button" aria-label="' + e(tip) + '"><title>' + e(tip) + '</title>' +
          '<ellipse class="fp-ring" cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2) + '" rx="' + (s.w / 2 + 12) + '" ry="' + (s.h / 2 + 12) + '"/>' + chairs(s, on) + shape2(s, ' class="fp-top" fill="url(#' + (on ? 'fpOn' : 'fpFree') + ')" filter="url(#' + (on ? 'fpGlow' : 'fpShadow') + ')"') +
          text(s, on ? (s.h < 30 ? [[s.label + ' · ' + short(it[0].name, 8) + (it.length > 1 ? ' +' + (it.length - 1) : '') + ' · ' + n, 'fp-b']] : [[s.label, 'fp-sm'], [it.length > 1 ? short(it[0].name, 7) + ' +' + (it.length - 1) : short(it[0].name, 9), 'fp-b'], [n + ' kişi', 'fp-sm']]) : s.h < 30 ? [[s.label]] : (function () { var w = s.label.split(' '); return w.length > 1 ? [[w[0].toLocaleUpperCase('tr'), 'fp-cap'], [w.slice(1).join(' '), 'fp-num']] : [[s.label]]; })(), 'fp-t') + '</g>';
      }).join('') + (room ? '<rect x="' + room.x + '" y="' + room.y + '" width="' + room.w + '" height="' + room.h + '" rx="14" fill="url(#fpVig)" pointer-events="none"/>' : '') + '</svg>';
  };

  H.parts.floorPlan = async function (root, eventId, title, changed) {
    var d;
    try { d = await H.api('venue-links/plan?event=' + eventId); } catch (err) { root.innerHTML = ''; return; }
    if (!d.plan) { root.innerHTML = ''; return; } // this venue has no plan: the list below is all there is
    var can = H.me.role !== 'viewer', q = '', picked = '', label = {}; d.plan.shapes.forEach(function (s) { if (s.k === 'table') label[s.id] = s.label; });
    var keyOf = function (o) { return o.type + ':' + o.id; }, split = function (k) { var a = k.split(':'); return { type: a[0], id: a.slice(1).join(':') }; };
    function whereMap() { var w = {}; Object.keys(d.assign).forEach(function (t) { (d.assign[t] || []).forEach(function (o) { w[keyOf(o)] = t; }); }); return w; }
    function chip(o, tid) {
      var k = keyOf(o);
      return '<div class="fp-chip' + (picked === k ? ' picked' : '') + (tid ? ' seated' : '') + '" data-k="' + e(k) + '"' + (can ? ' role="button" tabindex="0" aria-pressed="' + (picked === k) + '"' : '') + '>' + (can ? '<span class="fp-grip" aria-hidden="true">⠿</span>' : '') +
        '<span class="fp-chip-main"><b>' + e(o.name) + '</b><span class="small mute">' + o.people + ' kişi · ' + e(o.src) + '</span></span>' + (tid ? '<span class="pill plain">' + e(label[tid]) + '</span>' : '') + '</div>';
    }
    function draw() {
      var ts = d.plan.shapes.filter(function (s) { return s.k === 'table'; }), used = ts.filter(function (s) { return (d.assign[s.id] || []).length; }), seated = used.reduce(function (n, s) { return n + people(d.assign[s.id]); }, 0), where = whereMap();
      var f = q.trim().toLocaleLowerCase('tr'), hit = function (o) { return !f || o.name.toLocaleLowerCase('tr').indexOf(f) > -1; };
      var free = d.options.filter(function (o) { return !where[keyOf(o)]; }), sat = d.options.filter(function (o) { return where[keyOf(o)]; });
      var sideScroll = root.querySelector('.fp-side-list'), top = sideScroll ? sideScroll.scrollTop : 0, hadFocus = document.activeElement && document.activeElement.id === 'fp-sq';
      root.innerHTML = '<div class="card" style="margin-bottom:16px"><div class="row between" style="margin-bottom:4px"><h2 class="h2">Masa planı · ' + e(d.plan.name) + '</h2><span class="small mute"><b style="color:var(--ink)">' + used.length + '</b> / ' + ts.length + ' masa dolu · <b style="color:var(--ink)">' + seated + '</b> kişi oturtuldu</span></div>' +
        '<p class="small mute" style="margin-bottom:12px">' + (can ? 'İsmi sürükleyip masanın üzerine bırakın. Sürüklemek yerine ismi seçip masaya da tıklayabilirsiniz; masaya tıklayınca o masadakiler açılır.' : 'Kim hangi masada.') + '</p>' +
        '<div class="fp-layout"><div><div class="fplan-wrap">' + H.planSvg(d) + '</div><div class="row" style="gap:14px;margin-top:10px"><span class="small mute"><i class="fp-key"></i>Boş masa</span><span class="small mute"><i class="fp-key on"></i>Dolu masa</span><span class="small mute"><i class="fp-key seat"></i>Oturma alanı (atanmaz)</span></div></div>' +
        '<aside class="fp-side" id="fp-side"><label class="search" style="max-width:none"><span class="sr">İsim ara</span>' + H.ico('search') + '<input type="search" id="fp-sq" placeholder="İsim ara" value="' + e(q) + '"></label>' +
        '<div class="fp-side-list"><p class="fp-h">Oturtulmadı <span>' + free.length + '</span></p>' + (free.filter(hit).map(function (o) { return chip(o, ''); }).join('') || '<p class="small dim" style="padding:4px 2px">' + (free.length ? 'Eşleşen yok.' : d.options.length ? 'Herkes oturtuldu.' : 'Onaylı misafir ya da masa yok.') + '</p>') +
        (sat.length ? '<p class="fp-h" style="margin-top:14px">Oturtuldu <span>' + sat.length + '</span></p>' + sat.filter(hit).sort(function (a, b) { return label[where[keyOf(a)]].localeCompare(label[where[keyOf(b)]], 'tr', { numeric: true }); }).map(function (o) { return chip(o, where[keyOf(o)]); }).join('') : '') + '</div>' +
        (can ? '<p class="fp-drop small" id="fp-unseat">Masadan kaldırmak için ismi buraya bırakın</p><form id="fp-add" class="fp-add"><input name="name" placeholder="Listede olmayan biri" maxlength="120" required aria-label="Kimin adına"><input name="people" type="number" min="1" max="200" value="4" inputmode="numeric" aria-label="Kişi sayısı"><button class="btn sm" type="submit">Ekle</button></form>' : '') + '</aside></div></div>';
      var ns = root.querySelector('.fp-side-list'); if (ns) ns.scrollTop = top;
      var sq = root.querySelector('#fp-sq'); sq.oninput = function () { q = this.value; draw(); }; if (hadFocus) { sq.focus(); sq.setSelectionRange(q.length, q.length); }
      root.querySelectorAll('.fp-table').forEach(function (g) { var go = function () { var t = g.getAttribute('data-t'); if (picked && can) { var k = picked; picked = ''; seat(k, t); } else open(t); }; g.onclick = go; g.onkeydown = function (x) { if (x.key === 'Enter' || x.key === ' ') { x.preventDefault(); go(); } }; });
      if (!can) return;
      root.querySelectorAll('.fp-chip').forEach(function (c) {
        var k = c.getAttribute('data-k');
        c.onkeydown = function (x) { if (x.key === 'Enter' || x.key === ' ') { x.preventDefault(); picked = picked === k ? '' : k; draw(); var n = root.querySelector('.fp-chip[data-k="' + k.replace(/"/g, '') + '"]'); if (n) n.focus(); } };
        c.onpointerdown = function (ev) { drag(ev, c, k); };
      });
      var add = root.querySelector('#fp-add');
      add.onsubmit = async function (x) { x.preventDefault(); var btn = add.querySelector('button'); H.busy(btn, 1); try { var o = await H.api('venue-links/notes', 'POST', Object.assign({ event: eventId }, H.vals(add))); d = await H.api('venue-links/plan?event=' + eventId); picked = 'table:' + o.table.key; H.toast(o.table.name + ' eklendi; şimdi bir masaya bırakın ya da masaya tıklayın', 'ok'); draw(); if (changed) changed(); } catch (err) { H.toast(err.message, 'bad'); H.busy(btn, 0); } };
    }
    async function seat(k, tid) { var o = d.options.filter(function (x) { return keyOf(x) === k; })[0]; if (await put({ table: tid, add: split(k) })) { H.toast((o ? o.name : '') + ' → ' + label[tid], 'ok'); if (changed) changed(); } }
    async function unseat(k) { var o = d.options.filter(function (x) { return keyOf(x) === k; })[0]; if (await put({ remove: split(k) })) { H.toast((o ? o.name : '') + ' masadan kaldırıldı', 'ok'); if (changed) changed(); } }
    // Dragging with the pointer (mouse, pen, finger). A touch drag starts on the grip, so the list still scrolls under a finger.
    function drag(ev, c, k) {
      if (ev.button || (ev.pointerType === 'touch' && !ev.target.closest('.fp-grip'))) return;
      var sx = ev.clientX, sy = ev.clientY, ghost = null, over = null, seated = c.classList.contains('seated');
      function mark(el) { if (over === el) return; if (over) over.classList.remove('drop'); over = el; if (over) over.classList.add('drop'); }
      function move(m) {
        if (!ghost) { if (Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return; ghost = c.cloneNode(true); ghost.className = 'fp-chip fp-ghost'; document.body.appendChild(ghost); root.classList.add('fp-dragging'); c.classList.add('lifting'); }
        m.preventDefault(); ghost.style.transform = 'translate(' + (m.clientX + 10) + 'px,' + (m.clientY + 10) + 'px)';
        var el = document.elementFromPoint(m.clientX, m.clientY); mark(el && (el.closest('.fp-table') || (seated && el.closest('#fp-side') ? root.querySelector('#fp-unseat') : null)));
      }
      function end(u) {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end);
        var t = over; if (over) over.classList.remove('drop'); root.classList.remove('fp-dragging'); c.classList.remove('lifting');
        if (!ghost) { if (u.type === 'pointerup') { picked = picked === k ? '' : k; draw(); } return; } // a click: pick it, then click a table
        ghost.remove(); picked = '';
        if (u.type !== 'pointerup' || !t) return;
        if (t.classList.contains('fp-table')) seat(k, t.getAttribute('data-t')); else unseat(k);
      }
      document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
    }
    async function put(body) { try { d = await H.api('venue-links/plan', 'PUT', Object.assign({ event: eventId }, body)); draw(); return true; } catch (err) { H.toast(err.message, 'bad'); return false; } }
    function open(tid) {
      var s = d.plan.shapes.filter(function (x) { return x.id === tid; })[0], it = d.assign[tid] || [], where = {}, q = '';
      d.plan.shapes.forEach(function (x) { (d.assign[x.id] || []).forEach(function (o) { where[o.type + ':' + o.id] = x.label; }); });
      var dr = H.drawer({ title: s.label, body:
        '<h3 class="h2" style="margin-bottom:8px">Bu masada' + (it.length ? ' · ' + people(it) + ' kişi' : '') + '</h3>' +
        (it.length ? '<div class="stack" style="gap:6px;margin-bottom:8px">' + it.map(function (o) { return '<div class="row between" style="padding:10px 12px;border:1px solid var(--line);border-radius:12px"><span><b>' + e(o.name) + '</b> <span class="mute small">· ' + o.people + ' kişi · ' + e(o.src) + '</span></span>' + (can ? '<button class="btn sm ghost" type="button" data-rm="' + e(o.type + ':' + o.id) + '">Kaldır</button>' : '') + '</div>'; }).join('') + '</div>' : '<p class="small mute" style="margin-bottom:8px">Masa boş.</p>') +
        (can ? '<h3 class="h2" style="margin:18px 0 8px">Oturt</h3><label class="search" style="max-width:none"><span class="sr">Ara</span>' + H.ico('search') + '<input type="search" id="fp-q" placeholder="Misafir ya da masa ara"></label><div id="fp-opts" class="stack" style="gap:4px;margin-top:8px;max-height:300px;overflow-y:auto"></div>' +
          '<form id="fp-new" class="card" style="margin-top:18px"><h3 class="h2" style="margin-bottom:4px">Listede olmayan biri</h3><p class="small mute" style="margin-bottom:10px">Elle masa olarak eklenir ve bu masaya oturtulur.</p><div class="form">' + H.field({ name: 'name', label: 'Kimin adına', required: 1, max: 120 }) + H.field({ name: 'people', label: 'Kişi sayısı', type: 'number', value: 4, attrs: ' min="1" max="200" inputmode="numeric"' }) + '</div><div class="row between" style="margin-top:10px"><p class="msg bad" role="alert"></p><button class="btn pri" type="submit">Ekle ve oturt</button></div></form>' : '') });
      var done = function () { dr.querySelector('[data-x]').click(); if (changed) changed(); };
      dr.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = async function () { var k = b.getAttribute('data-rm').split(':'); if (await put({ remove: { type: k[0], id: k.slice(1).join(':') } })) { if (changed) changed(); open(tid); } }; });
      if (!can) return;
      var box = dr.querySelector('#fp-opts');
      function list() {
        var f = q.trim().toLocaleLowerCase('tr'), mine = {}; it.forEach(function (o) { mine[o.type + ':' + o.id] = 1; });
        var rows = d.options.filter(function (o) { return !mine[o.type + ':' + o.id] && (!f || o.name.toLocaleLowerCase('tr').indexOf(f) > -1); }).sort(function (a, b) { return (where[a.type + ':' + a.id] ? 1 : 0) - (where[b.type + ':' + b.id] ? 1 : 0) || a.name.localeCompare(b.name, 'tr'); }).slice(0, 60);
        box.innerHTML = rows.length ? rows.map(function (o) { var w = where[o.type + ':' + o.id]; return '<button type="button" class="fp-opt" data-add="' + e(o.type + ':' + o.id) + '"><span><b>' + e(o.name) + '</b> <span class="mute small">· ' + o.people + ' kişi · ' + e(o.src) + '</span></span><span class="small ' + (w ? 'dim' : 'mute') + '">' + (w ? 'şu an ' + e(w) + ' → taşı' : 'Oturt') + '</span></button>'; }).join('') : '<p class="small mute">' + (f ? 'Eşleşen yok.' : 'Oturtulacak onaylı misafir ya da masa yok.') + '</p>';
        box.querySelectorAll('[data-add]').forEach(function (b) { b.onclick = async function () { var k = b.getAttribute('data-add').split(':'); if (await put({ table: tid, add: { type: k[0], id: k.slice(1).join(':') } })) { if (changed) changed(); open(tid); } }; });
      }
      dr.querySelector('#fp-q').oninput = function () { q = this.value; list(); };
      list();
      var nf = dr.querySelector('#fp-new');
      nf.onsubmit = async function (x) {
        x.preventDefault(); var btn = nf.querySelector('button[type=submit]'), msg = nf.querySelector('.msg'); msg.textContent = ''; H.busy(btn, 1);
        try { var o = await H.api('venue-links/notes', 'POST', Object.assign({ event: eventId }, H.vals(nf))); if (await put({ table: tid, add: { type: 'table', id: o.table.key } })) { H.toast(o.table.name + ' → ' + s.label, 'ok'); done(); } else H.busy(btn, 0); } catch (err) { msg.textContent = err.message; H.busy(btn, 0); }
      };
    }
    draw();
  };
})();
