/* Masa planı: mekânın kat planı üzerinde, etkinlik için kim hangi masada. Masaya tıkla → oturt, taşı, kaldır. */
(function () {
  var H = HQ, e = H.esc;
  var FILL = { room: 'rgba(243,238,230,.035)', carpet: 'rgba(243,238,230,.05)', sofa: '#5b4741', dark: '#2c2624', bar: '#682F3D', wood: '#6e5a3a', door: 'rgba(243,238,230,.2)', bistro: '#8a7f63' };
  function shape(s, attrs) {
    return s.s === 'e' ? '<ellipse cx="' + (s.x + s.w / 2) + '" cy="' + (s.y + s.h / 2) + '" rx="' + s.w / 2 + '" ry="' + s.h / 2 + '"' + attrs + '/>'
      : '<rect x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="' + (s.s === 'r' ? 10 : 2) + '"' + attrs + '/>';
  }
  function text(s, lines, cls) {
    var cx = s.x + s.w / 2, cy = s.y + s.h / 2, lh = 9, y0 = cy - (lines.length - 1) * lh / 2;
    return '<text class="' + cls + '" text-anchor="middle" dominant-baseline="central"' + (s.rot ? ' transform="rotate(' + s.rot + ' ' + cx + ' ' + cy + ')"' : '') + '>' + lines.map(function (l, i) { return '<tspan x="' + cx + '" y="' + (y0 + i * lh) + '"' + (l[1] ? ' class="' + l[1] + '"' : '') + '>' + e(l[0]) + '</tspan>'; }).join('') + '</text>';
  }
  var people = function (items) { return items.reduce(function (n, x) { return n + x.people; }, 0); };
  var short = function (n, max) { var f = n.trim().split(/\s+/)[0]; return f.length > max ? f.slice(0, max - 1) + '…' : f; };

  // d: { plan, assign }. Tables are buttons; everything else is scenery.
  H.planSvg = function (d, pick) {
    var p = d.plan;
    return '<svg class="fplan" viewBox="0 0 ' + p.w + ' ' + p.h + '" role="group" aria-label="' + e(p.name) + ' masa planı">' + p.shapes.map(function (s) {
      if (s.k === 'fix') return shape(s, ' fill="' + (FILL[s.c] || FILL.dark) + '"' + (s.c === 'room' ? ' stroke="rgba(243,238,230,.22)"' : '')) + (s.label ? text(s, s.label.split(' ').length > 1 && s.w < 70 ? s.label.split(' ').map(function (w) { return [w]; }) : [[s.label]], 'fp-fix') : '');
      if (s.k === 'text') return text(s, [[s.label]], 'fp-note');
      if (s.k === 'seat') return shape(s, ' class="fp-seat"') + text(s, s.label.split(' ').length > 1 && s.w < 60 ? s.label.split(' ').map(function (w) { return [w]; }) : [[s.label]], 'fp-seat-t');
      var it = d.assign[s.id] || [], n = people(it), on = it.length > 0, tip = s.label + (on ? ': ' + it.map(function (x) { return x.name + ' (' + x.people + ')'; }).join(', ') : ': boş');
      return '<g class="fp-table' + (on ? ' on' : '') + (pick === s.id ? ' sel' : '') + '" data-t="' + e(s.id) + '" tabindex="0" role="button" aria-label="' + e(tip) + '"><title>' + e(tip) + '</title>' + shape(s, '') +
        text(s, on ? [[s.label, 'fp-sm'], [it.length > 1 ? short(it[0].name, 7) + ' +' + (it.length - 1) : short(it[0].name, 9), 'fp-b'], [n + ' kişi', 'fp-sm']] : s.label.split(' ').map(function (w) { return [w]; }), 'fp-t') + '</g>';
    }).join('') + '</svg>';
  };

  H.parts.floorPlan = async function (root, eventId, title, changed) {
    var d;
    try { d = await H.api('venue-links/plan?event=' + eventId); } catch (err) { root.innerHTML = ''; return; }
    if (!d.plan) { root.innerHTML = ''; return; } // this venue has no plan: the list below is all there is
    var can = H.me.role !== 'viewer';
    function draw() {
      var ts = d.plan.shapes.filter(function (s) { return s.k === 'table'; }), used = ts.filter(function (s) { return (d.assign[s.id] || []).length; }), seated = used.reduce(function (n, s) { return n + people(d.assign[s.id]); }, 0);
      var placed = {}; ts.forEach(function (s) { (d.assign[s.id] || []).forEach(function (x) { placed[x.type + ':' + x.id] = 1; }); });
      var waiting = d.options.filter(function (o) { return o.type === 'table' && !placed[o.type + ':' + o.id]; });
      root.innerHTML = '<div class="card" style="margin-bottom:16px"><div class="row between" style="margin-bottom:4px"><h2 class="h2">Masa planı · ' + e(d.plan.name) + '</h2><span class="small mute"><b style="color:var(--ink)">' + used.length + '</b> / ' + ts.length + ' masa dolu · <b style="color:var(--ink)">' + seated + '</b> kişi oturtuldu</span></div>' +
        '<p class="small mute" style="margin-bottom:12px">' + (can ? 'Bir masaya tıklayıp onaylı misafiri ya da etkinliğin bir masasını oturtun. Mekân, portalında masanın adını görür.' : 'Kim hangi masada.') + '</p>' +
        '<div class="fplan-wrap">' + H.planSvg(d) + '</div>' +
        '<div class="row" style="gap:14px;margin-top:10px"><span class="small mute"><i class="fp-key"></i>Boş masa</span><span class="small mute"><i class="fp-key on"></i>Dolu masa</span><span class="small mute"><i class="fp-key seat"></i>Oturma alanı (atanmaz)</span></div>' +
        (waiting.length ? '<p class="small" style="margin-top:10px;color:var(--warn)">Plana oturtulmamış ' + waiting.length + ' masa var: ' + e(waiting.slice(0, 6).map(function (o) { return o.name; }).join(', ')) + (waiting.length > 6 ? '…' : '') + '</p>' : '') + '</div>';
      root.querySelectorAll('.fp-table').forEach(function (g) { var go = function () { open(g.getAttribute('data-t')); }; g.onclick = go; g.onkeydown = function (x) { if (x.key === 'Enter' || x.key === ' ') { x.preventDefault(); go(); } }; });
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
