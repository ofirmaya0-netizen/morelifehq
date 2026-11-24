// Core: helpers, API client, router, shell, shared UI pieces. Views register themselves on HQ.views.
var HQ = (function () {
  'use strict';
  var main = document.getElementById('main'), layer = document.getElementById('layer'), cleanup = null, badge = { pending: 0, enq: 0 }, me = { screens: ['ozet'], role: '', name: '' };
  var IC = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.900 2.100 6.500 5.500M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.800c2 .700 3.200 2.500 3.500 5.200"/>',
    check: '<path d="M4 12.5l5 5L20 6.500"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.800 3 2.800 15 0 18M12 3c-2.800 3-2.800 15 0 18"/>',
    search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900l2.100 2.100M17 17l2.100 2.100M4.900 19.100L7 17M17 7l2.100-2.100"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-7M17.500 17.500h.01"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.01"/>', warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.500l3 3 5-6"/>', link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>', down: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11a6.500 6.500 0 0 0 13 0M12 17.500V21M8.500 21h7"/>', shield: '<path d="M12 3l8 3v6c0 4.500-3.200 7.800-8 9-4.800-1.200-8-4.500-8-9V6z"/><path d="M9 12l2.200 2.200L15 10.400"/>', db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.200c-.600-1-1.700-1.700-3-1.700-1.800 0-3.200 1-3.200 2.300 0 3 6.400 1.400 6.400 4.400 0 1.300-1.400 2.300-3.200 2.300-1.300 0-2.400-.700-3-1.700M12 5.500v2M12 16.500v2"/>', file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', up: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>'
  };
  function ico(n) { return '<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24">' + (IC[n] || '') + '</svg></span>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  function fmtDate(d) { if (!d) return 'Tarih yok'; var p = d.split('-'); return parseInt(p[2], 10) + ' ' + MON[p[1] - 1] + ' ' + p[0]; }
  // Timestamps are always shown in Istanbul time, whatever the device is set to.
  function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }
  function today() { return new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10); }
  function money(n, cur) { if (n == null || n === '') return '—'; try { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch (x) { return n + ' ' + (cur || ''); } }
  function sums(o) { var k = Object.keys(o || {}).filter(function (c) { return o[c]; }); return k.length ? k.map(function (c) { return money(o[c], c); }).join(' + ') : '—'; }
  // whole days from today (Istanbul) to a YYYY-MM-DD date; negative when it has passed
  function daysTo(d) { return d ? Math.round((Date.parse(d) - Date.parse(today())) / 864e5) : null; }
  function inDays(n) { return n == null ? '' : n === 0 ? 'bugün' : n === 1 ? 'yarın' : n === -1 ? 'dün' : n > 0 ? n + ' gün sonra' : -n + ' gün önce'; }
  function can(screen) { return me.screens.indexOf(screen) > -1; }
  function readFile(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('Dosya okunamadı.')); }; r.readAsDataURL(file); }); }
  var STATUS = { draft: 'Taslak', published: 'Yayında', archived: 'Arşiv', pending: 'Beklemede', approved: 'Onaylandı', rejected: 'Reddedildi', waitlist: 'Bekleme listesi', cancelled: 'İptal edildi', checkedin: 'Giriş yaptı', todo: 'Yapılacak', doing: 'Sürüyor', done: 'Bitti', 'public': 'Herkese açık', 'private': 'Özel davet', high: 'Yüksek', normal: 'Normal', low: 'Düşük' };
  function pill(s, label) { return '<span class="pill ' + esc(s) + '">' + esc(label || STATUS[s] || s) + '</span>'; }
  function initials(n) { return esc(String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join('').toLocaleUpperCase('tr')); }
  function q() { return new URLSearchParams(location.search); }
  function go(query, replace) { history[replace ? 'replaceState' : 'pushState'](null, '', '/hq?' + query); render(); }
  function toast(text, kind) { var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = text; document.getElementById('toasts').appendChild(t); setTimeout(function () { t.remove(); }, kind === 'bad' ? 6000 : 2600); }
  async function api(path, method, data) {
    var r;
    try { r = await fetch('/api/hq/' + path, { method: method || 'GET', headers: data ? { 'content-type': 'application/json', 'x-hq': '1' } : { 'x-hq': '1' }, body: data ? JSON.stringify(data) : undefined }); }
    catch (e) { throw new Error('Bağlantı hatası. İnternetinizi kontrol edip tekrar deneyin; yazdıklarınız yerinde duruyor.'); }
    if (r.status === 401) { location.reload(); throw new Error('Oturum sona erdi.'); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || 'İşlem başarısız (' + r.status + ').'); e.data = j; throw e; }
    return j;
  }
  function copy(text, label) {
    var abs = /^\//.test(text) ? location.origin + text : text;
    function fb() { modal({ title: 'Bağlantıyı kopyalayın', body: '<input readonly value="' + esc(abs) + '" onfocus="this.select()">', ok: 'Kapat', cancel: '' }); }
    try { navigator.clipboard.writeText(abs).then(function () { toast(label || 'Bağlantı kopyalandı', 'ok'); }, fb); } catch (e) { fb(); }
  }
  /* overlay pieces */
  function closeLayer() { layer.innerHTML = ''; document.body.style.overflow = ''; }
  function modal(o) {
    return new Promise(function (res) {
      layer.innerHTML = '<div class="scrim" data-x></div><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-t"><header><h2 class="h2" id="m-t">' + esc(o.title) + '</h2></header><div class="body">' + (o.body || '<p class="mute">' + esc(o.text || '') + '</p>') + '</div><footer>' +
        (o.cancel === '' ? '' : '<button class="btn ghost" data-x type="button">' + esc(o.cancel || 'Vazgeç') + '</button>') + '<button class="btn ' + (o.danger ? 'bad' : 'pri') + '" id="m-ok" type="button">' + esc(o.ok || 'Tamam') + '</button></footer></div>';
      var done = function (v) { var chk = layer.querySelector('#m-chk'), inp = layer.querySelector('#m-in'); closeLayer(); res(v ? (chk || inp ? { checked: !!(chk && chk.checked), value: inp ? inp.value : '' } : true) : false); };
      layer.querySelector('#m-ok').onclick = function () { done(true); }; (layer.querySelector('#m-in') || layer.querySelector('#m-ok')).focus();
      layer.querySelectorAll('[data-x]').forEach(function (b) { b.onclick = function () { done(false); }; });
    });
  }
  function drawer(o) { // o: title, body, foot, onClose
    document.body.style.overflow = 'hidden';
    layer.innerHTML = '<div class="scrim" data-x></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-t"><header><h2 class="h2" id="d-t">' + esc(o.title) + '</h2><button class="icon-btn" data-x type="button" aria-label="Kapat">' + ico('x') + '</button></header><div class="body">' + o.body + '</div>' + (o.foot ? '<footer>' + o.foot + '</footer>' : '') + '</aside>';
    layer.querySelectorAll('[data-x]').forEach(function (b) { b.onclick = function () { closeLayer(); if (o.onClose) o.onClose(); }; });
    var f = layer.querySelector('input,select,textarea'); if (f) f.focus();
    return layer.querySelector('.drawer');
  }
  /* small builders */
  function field(o) {
    var id = o.id || 'f-' + o.name, a = ' id="' + id + '" name="' + o.name + '"' + (o.required ? ' required' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.attrs || ''), v = o.value == null ? '' : o.value, c;
    if (o.type === 'select') c = '<select' + a + '>' + o.options.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(v) ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select>';
    else if (o.type === 'textarea') c = '<textarea' + a + (o.rows ? ' rows="' + o.rows + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>' + esc(v) + '</textarea>';
    else if (o.type === 'check') return '<div class="f' + (o.full ? ' full' : '') + '"><label class="check" for="' + id + '"><input type="checkbox"' + a + (v ? ' checked' : '') + '><span>' + esc(o.label) + (o.hint ? '<small>' + esc(o.hint) + '</small>' : '') + '</span></label></div>';
    else c = '<input type="' + (o.type || 'text') + '"' + a + ' value="' + esc(v) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>';
    return '<div class="f' + (o.full ? ' full' : '') + '"><label for="' + id + '">' + esc(o.label) + (o.pub ? '<span class="pubtag" title="Public sayfada görünür">Public</span>' : '') + '</label>' + c + (o.hint ? '<span class="hint">' + esc(o.hint) + '</span>' : '') + (o.count ? '<span class="cnt" data-count="' + id + '" data-max="' + o.count + '"></span>' : '') + '</div>';
  }
  function vals(root) { var o = {}; root.querySelectorAll('[name]').forEach(function (el) { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return o; }
  function counters(root) { root.querySelectorAll('[data-count]').forEach(function (c) { var el = root.querySelector('#' + c.getAttribute('data-count')), max = +c.getAttribute('data-max'), up = function () { var n = el.value.length; c.textContent = n + ' / ' + max + ' karakter'; c.classList.toggle('over', n > max); }; el.addEventListener('input', up); up(); }); }
  function empty(icon, title, text, action) { return '<div class="empty"><span class="big">' + ico(icon) + '</span><b>' + esc(title) + '</b>' + (text ? '<p>' + esc(text) + '</p>' : '') + (action || '') + '</div>'; }
  function note(kind, html) { return '<div class="note ' + (kind || '') + '">' + ico(kind === 'warn' || kind === 'bad' ? 'warn' : kind === 'ok' ? 'check' : 'info') + '<div>' + html + '</div></div>'; }
  function meter(used, cap) { if (!cap) return ''; var p = Math.min(100, Math.round(used / cap * 100)); return '<div class="meter' + (used > cap ? ' over' : p >= 85 ? ' near' : '') + '" role="img" aria-label="Kapasite: ' + used + ' / ' + cap + '"><i style="width:' + p + '%"></i></div>'; }
  function seg(items, cur, attr) { return '<div class="seg" role="group">' + items.map(function (x) { return '<button type="button" ' + attr + '="' + esc(x[0]) + '" aria-pressed="' + (x[0] === cur) + '">' + esc(x[1]) + (x[2] != null ? '<b>' + x[2] + '</b>' : '') + '</button>'; }).join('') + '</div>'; }
  function head(o) { return '<div class="head"><div>' + (o.back ? '<button class="crumb" type="button" data-nav="' + o.back[0] + '">' + ico('back') + esc(o.back[1]) + '</button><br>' : '') + (o.eye ? '<p class="eye" style="margin-bottom:6px">' + o.eye + '</p>' : '') + '<h1 class="h1">' + o.title + '</h1>' + (o.sub ? '<p class="sub">' + o.sub + '</p>' : '') + '</div>' + (o.acts ? '<div class="acts">' + o.acts + '</div>' : '') + '</div>'; }
  function cover(e) { var p = (e.date || '').split('-'); return '<div class="cover">' + (e.imageId ? '<img src="/api/public/image/' + esc(e.imageId) + '" alt="">' : (e.date ? '<div><div class="d">' + parseInt(p[2], 10) + '</div><div class="m">' + MON[p[1] - 1] + ' ' + p[0] + '</div></div>' : '<span class="dim small">Tarih yok</span>')) + '</div>'; }
  function busy(btn, on, label) { if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.textContent = label || 'Kaydediliyor…'; } else { btn.disabled = false; if (btn.dataset.l) btn.innerHTML = btn.dataset.l; } }
  function shrink(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85)); };
      img.onerror = function () { rej(new Error('Görsel okunamadı.')); }; img.src = url;
    });
  }
  async function upload(input) { var f = input && input.files[0]; if (!f) return null; return (await api('images', 'POST', { dataUrl: await shrink(f) })).id; }

  /* shell */
  var NAV = [['ozet', 'Özet', 'home'], ['etkinlikler', 'Etkinlikler', 'cal'], ['satislar', 'Satışlar', 'coin'], ['booking', 'Booking', 'mic'], ['rsvp', 'Davetler & RSVP', 'mail'], ['kapi', 'Check-in', 'qr'], ['crm', 'CRM', 'users'], ['talepler', 'Talepler', 'info'], ['gorevler', 'Görevler', 'task'], null, ['website', 'Website', 'globe'], ['seo', 'SEO', 'search'], ['marketing', 'Marketing', 'chart'], null, ['ekip', 'Ekip & kayıt', 'shield'], ['yedekler', 'Yedekler', 'db'], ['ayarlar', 'Ayarlar', 'gear']];
  var MBAR = [['ozet', 'Özet', 'home'], ['etkinlikler', 'Etkinlik', 'cal'], ['rsvp', 'RSVP', 'mail'], ['kapi', 'Check-in', 'qr'], ['menu', 'Menü', 'menu']];
  var PARENT = { etkinlik: 'etkinlikler', kapi: 'rsvp' };
  // The menu shows only what this person's role can open; the server refuses the rest whatever the menu says.
  function shell(view) {
    var cur = PARENT[view] || view, wide = can('etkinlikler'), items = NAV.filter(function (n, i) { return !n || (can(n[0]) && (n[0] !== 'kapi' || !wide)); });
    items = items.filter(function (n, i) { return n || (i > 0 && items[i - 1] && items.slice(i + 1).some(Boolean)); });
    if (!wide && view === 'kapi') cur = 'kapi';
    document.getElementById('nav').innerHTML = items.map(function (n) { return n ? '<button class="navi" type="button" data-nav="view=' + n[0] + '"' + (n[0] === cur ? ' aria-current="page"' : '') + '>' + ico(n[2]) + '<span>' + n[1] + '</span>' + (n[0] === 'rsvp' && badge.pending ? '<span class="cnt" title="Bekleyen başvuru">' + badge.pending + '</span>' : '') + (n[0] === 'talepler' && badge.enq ? '<span class="cnt" title="Yeni talep">' + badge.enq + '</span>' : '') + '</button>' : '<div class="nav-sep"></div>'; }).join('') + (me.readOnly ? '<p class="ro-tag">' + ico('eye') + 'Sadece görüntüleme: değişiklik kaydedilmez.</p>' : '');
    var bar = MBAR.filter(function (n) { return n[0] === 'menu' || can(n[0]); }), mb = document.getElementById('mbar');
    mb.style.gridTemplateColumns = 'repeat(' + bar.length + ',1fr)';
    mb.innerHTML = bar.map(function (n) { var on = n[0] === view || (n[0] !== 'kapi' && n[0] === cur && view !== 'kapi'); return '<button type="button" ' + (n[0] === 'menu' ? 'id="mmenu"' : 'data-nav="view=' + n[0] + '"') + (on ? ' aria-current="page"' : '') + '>' + ico(n[2]) + n[1] + (n[0] === 'rsvp' && badge.pending ? '<span class="cnt">' + badge.pending + '</span>' : '') + '</button>'; }).join('');
    document.body.classList.remove('menu');
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#mmenu')) { document.body.classList.toggle('menu'); return; }
    if (document.body.classList.contains('menu') && !e.target.closest('#side')) { document.body.classList.remove('menu'); return; }
    var c = e.target.closest('[data-copy]'); if (c) { e.preventDefault(); copy(c.getAttribute('data-copy'), c.getAttribute('data-copied')); return; }
    var n = e.target.closest('[data-nav]'); if (n && !e.target.closest('a[target]')) { e.preventDefault(); closeLayer(); go(n.getAttribute('data-nav')); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var x = layer.querySelector('[data-x]'); if (x) x.click(); } });
  document.getElementById('logout').addEventListener('click', async function () { try { await api('logout', 'POST', {}); } catch (e) {} location.href = '/hq'; });
  window.addEventListener('popstate', function () { closeLayer(); render(); });

  var views = {};
  async function render() {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    main.onclick = main.onchange = main.oninput = main.onsubmit = null;
    var view = q().get('view'); if (!views[view] || !(can(view) || can(PARENT[view]))) view = 'ozet';
    shell(view);
    main.innerHTML = '<div class="skel" style="height:44px;width:min(320px,70%);margin-bottom:26px"></div><div class="grid g4"><div class="skel" style="height:118px"></div><div class="skel" style="height:118px"></div><div class="skel" style="height:118px"></div><div class="skel" style="height:118px"></div></div><div class="skel" style="height:220px;margin-top:20px"></div>';
    try { cleanup = (await views[view](main)) || null; window.scrollTo(0, 0); }
    catch (err) { main.innerHTML = empty('warn', 'Ekran yüklenemedi', err.message, '<button class="btn" type="button" onclick="location.reload()">Tekrar dene</button>'); }
    refreshBadge();
  }
  function refreshBadge() { api('summary').then(function (x) { if (x.pendingRsvps !== badge.pending || x.newEnquiries !== badge.enq) { badge.pending = x.pendingRsvps; badge.enq = x.newEnquiries; var v = q().get('view'); shell(views[v] && (can(v) || can(PARENT[v])) ? v : 'ozet'); } }).catch(function () {}); }
  // A team member changes their own password here; the owner's lives in the Netlify environment.
  function ownPassword() {
    var d = drawer({ title: 'Şifremi değiştir', body: '<form class="form" id="pwf">' + field({ name: 'current', label: 'Mevcut şifre', type: 'password', required: 1, full: 1, attrs: ' autocomplete="current-password"' }) + field({ name: 'next', label: 'Yeni şifre', type: 'password', required: 1, full: 1, hint: 'En az 10 karakter. Diğer cihazlardaki oturumların kapanır.', attrs: ' autocomplete="new-password" minlength="10"' }) + '<p class="msg bad f full" role="alert"></p></form>', foot: '<button class="btn pri" type="submit" form="pwf">Şifreyi değiştir</button>' });
    d.querySelector('#pwf').onsubmit = async function (x) { x.preventDefault(); var b = d.querySelector('button[type=submit]'), msg = d.querySelector('.msg'); msg.textContent = ''; busy(b, 1); try { await api('me/password', 'POST', vals(this)); closeLayer(); toast('Şifre değişti', 'ok'); } catch (err) { msg.textContent = err.message; busy(b, 0); } };
  }
  function boot() {
    document.querySelectorAll('[data-ico]').forEach(function (el) { el.outerHTML = ico(el.getAttribute('data-ico')); });
    api('session').then(function (s) {
      me = s; HQ.me = s;
      document.getElementById('who').textContent = (s.role === 'owner' ? s.email : s.name + ' · ' + s.roleLabel) + (s.store === 'morelife-hq' ? '' : ' · preview verisi');
      var pw = document.getElementById('ownpw'); if (pw && s.role !== 'owner') { pw.hidden = false; pw.onclick = ownPassword; }
      render();
    }).catch(function (err) { main.innerHTML = empty('warn', 'HQ açılamadı', err.message, '<button class="btn" type="button" onclick="location.reload()">Tekrar dene</button>'); });
  }
  return { views: views, me: me, can: can, money: money, sums: sums, daysTo: daysTo, inDays: inDays, readFile: readFile, api: api, go: go, q: q, esc: esc, ico: ico, pill: pill, STATUS: STATUS, fmtDate: fmtDate, fmtTime: fmtTime, today: today, toast: toast, modal: modal, drawer: drawer, closeLayer: closeLayer, field: field, vals: vals, counters: counters, empty: empty, note: note, meter: meter, seg: seg, head: head, cover: cover, busy: busy, upload: upload, initials: initials, copy: copy, render: render, boot: boot, refreshBadge: refreshBadge };
})();
