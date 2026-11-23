/* Shared parts used by more than one screen: applications, check-in, tasks, SEO editor. */
(function () {
  var H = HQ, e = H.esc; H.parts = {};

  /* ---------- Başvurular ---------- */
  H.parts.apps = async function (root, eventId, start) {
    var st = { f: (start && start.f) || 'pending', q: '', sel: {} }, data;
    var F = [['pending', 'Beklemede'], ['approved', 'Onaylandı'], ['waitlist', 'Bekleme listesi'], ['rejected', 'Reddedildi'], ['cancelled', 'İptal'], ['checkedin', 'Giriş yaptı'], ['all', 'Tümü']];
    var inF = function (r, f) { return f === 'all' || (f === 'checkedin' ? !!r.checkedInAt : r.status === f); };
    var first = true;
    async function load() { data = await H.api('rsvps/' + eventId); draw(); if (!first) H.refreshBadge(); first = false; }
    function draw() {
      var ev = data.event, rs = data.rsvps, t = st.q.trim().toLocaleLowerCase('tr');
      var rows = rs.filter(function (r) { return inF(r, st.f) && (!t || (r.name + ' ' + r.email + ' ' + r.phone).toLocaleLowerCase('tr').indexOf(t) > -1); });
      var ids = rows.filter(function (r) { return st.sel[r.id]; }).map(function (r) { return r.id; });
      root.innerHTML = '<div class="card" style="margin-bottom:16px"><div class="row between"><div><p class="eye">Onaylanan misafir</p><p style="font-size:26px;font-weight:600" class="num-t">' + ev.counts.approved + (ev.capacity ? '<span class="dim" style="font-size:16px"> / ' + ev.capacity + '</span>' : '') + '</p></div>' +
        '<div class="row"><a class="btn sm" href="/api/hq/rsvps.csv?event=' + ev.id + (st.f !== 'all' ? '&status=' + st.f : '') + (t ? '&q=' + encodeURIComponent(st.q) : '') + '">' + H.ico('down') + 'CSV (' + rows.length + ')</a><button class="btn sm" type="button" data-nav="view=kapi&event=' + ev.id + '">' + H.ico('qr') + 'Check-in</button>' +
        (ev.status === 'published' && ev.invite.enabled !== false ? '<button class="btn sm" type="button" data-copy="' + e(ev.inviteUrl) + '" data-copied="Davet linki kopyalandı">' + H.ico('copy') + 'Davet linki</button>' : '') + '</div></div>' + (ev.capacity ? '<div style="margin-top:12px">' + H.meter(ev.counts.approved, ev.capacity) + '</div>' : '') + '</div>' +
        (ev.status !== 'published' ? H.note('warn', 'Etkinlik yayında değil; davet sayfası ve başvuru formu kapalı.') + '<div style="height:14px"></div>' : '') +
        '<div class="row" style="margin-bottom:14px">' + H.seg(F.map(function (x) { return [x[0], x[1], rs.filter(function (r) { return inF(r, x[0]); }).length]; }), st.f, 'data-af') + '<label class="search"><span class="sr">Ara</span>' + H.ico('search') + '<input type="search" id="ap-q" placeholder="İsim, e-posta veya telefon" value="' + e(st.q) + '"></label></div>' +
        (rows.length && st.f !== 'approved' && st.f !== 'checkedin' ? '<div class="row" style="margin-bottom:10px"><label class="check small"><input type="checkbox" id="ap-all"' + (ids.length && ids.length === rows.length ? ' checked' : '') + '><span>Listedekilerin tümünü seç</span></label>' + (ids.length ? '<button class="btn sm ok" type="button" id="ap-bulk">' + ids.length + ' başvuruyu onayla…</button>' : '') + '</div>' : '') +
        (rows.length ? '<div class="card flat"><div class="list">' + rows.map(function (r) {
          var b = function (dec, label, cls) { return r.status === dec ? '' : '<button class="btn sm ' + cls + '" type="button" data-dec="' + dec + '" data-id="' + r.id + '">' + label + '</button>'; };
          return '<div class="item">' + (st.f !== 'approved' && st.f !== 'checkedin' ? '<input type="checkbox" data-sel="' + r.id + '"' + (st.sel[r.id] ? ' checked' : '') + ' aria-label="' + e(r.name) + ' seç">' : '') + '<span class="av' + (r.checkedInAt ? ' in' : '') + '">' + H.initials(r.name) + '</span><div class="main"><div class="row"><button class="t" type="button" data-open="' + r.id + '" style="background:none;border:0;padding:0;text-align:left">' + e(r.name) + '</button>' + (r.guests > 1 ? '<span class="pill plain">+' + (r.guests - 1) + '</span>' : '') + H.pill(r.checkedInAt ? 'checkedin' : r.status) + '</div>' +
            '<span class="mute small">' + e(r.email) + (r.phone ? ' · ' + e(r.phone) : '') + ' · ' + H.fmtTime(r.createdAt) + (r.utm && r.utm.campaign ? ' · kampanya: ' + e(r.utm.campaign) : '') + '</span>' + (function () { var by = r.referredBy && data.rsvps.find(function (x) { return x.id === r.referredBy; }), n = data.rsvps.filter(function (x) { return x.referredBy === r.id; }).length, o = [];
              if (by) o.push('Getiren: ' + e(by.name)); if (n) o.push(n + ' kişi getirdi'); if (r.cancelledBy === 'guest') o.push('Misafir kendi iptal etti');
              if (r.offer && r.status === 'waitlist') o.push(r.offer.expired ? 'Yer teklifi süresi doldu' : 'Yer teklif edildi: ' + H.fmtTime(r.offer.at));
              return o.length ? '<span class="small" style="color:var(--acc)">' + o.join(' · ') + '</span>' : ''; })() + (r.note ? '<span class="small">“' + e(r.note) + '”</span>' : '') + (r.mail ? '<span class="small" style="color:var(--' + (r.mail.status === 'sent' ? 'ok' : 'bad') + ')">' + (r.mail.status === 'sent' ? 'Kart e-postası gönderildi: ' + H.fmtTime(r.mail.at) : 'Kart e-postası gönderilemedi: ' + e(r.mail.error || '')) + '</span>' : '') + (r.wa ? '<span class="small" style="color:var(--' + (r.wa.status === 'sent' ? 'ok' : 'bad') + ')">' + (r.wa.status === 'sent' ? 'WhatsApp’tan gönderildi: ' + H.fmtTime(r.wa.at) : 'WhatsApp gönderilemedi: ' + e(r.wa.error || '')) + '</span>' : '') + (r.checkedInAt ? '<span class="small" style="color:var(--ok)">Giriş: ' + H.fmtTime(r.checkedInAt) + '</span>' : '') + '</div><div class="acts">' +
            (r.status === 'approved' ? '<a class="btn sm" href="/pass?t=' + e(r.passToken) + '" target="_blank" rel="noopener">' + H.ico('qr') + 'QR kartı</a><button class="btn sm" type="button" data-copy="/pass?t=' + e(r.passToken) + '" data-copied="Giriş kartı bağlantısı kopyalandı">' + H.ico('copy') + 'Kart linki</button>' + (data.whatsapp.connected && r.phone ? '<button class="btn sm" type="button" data-wa="' + r.id + '">' + (r.wa && r.wa.status === 'sent' ? 'WhatsApp: yeniden' : 'WhatsApp’tan gönder') + '</button>' : '') + (data.email.connected ? '<button class="btn sm" type="button" data-mail="' + r.id + '">' + (r.mail && r.mail.status === 'sent' ? 'Yeniden gönder' : 'E-postayla gönder') + '</button>' : '') : '') +
            b('approved', 'Onayla', 'ok') + (r.status === 'pending' ? b('waitlist', 'Bekleme listesi', '') : '') + (r.status === 'approved' ? b('cancelled', 'İptal et', 'ghost') : b('rejected', 'Reddet', 'ghost')) + '</div></div>';
        }).join('') + '</div></div>' : H.empty('mail', rs.length ? 'Bu durumda başvuru yok.' : 'Henüz başvuru yok.', rs.length ? '' : 'Davet linkini paylaştığınızda başvurular burada görünür.')) +
        (st.f === 'approved' && rows.length && !data.email.connected ? '<p class="small dim" style="margin-top:12px">E-posta servisi bağlı değil: giriş kartı otomatik gönderilmez. “Kart linki” ile bağlantıyı kopyalayıp misafire iletin.</p>' : '');
      var qi = root.querySelector('#ap-q'); if (st.focus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); st.focus = 0; }
    }
    async function decide(id, dec, btn) {
      async function send(force) { await H.api('rsvps/' + eventId + '/' + id + '/decision', 'POST', { decision: dec, force: force }); }
      if (btn) H.busy(btn, 1, '…');
      try { await send(false); }
      catch (err) {
        if (err.data && err.data.overCapacity && await H.modal({ title: 'Kapasite aşılıyor', text: err.message + ' Yine de onaylansın mı?', ok: 'Yine de onayla' })) { try { await send(true); } catch (e2) { H.toast(e2.message, 'bad'); } }
        else if (!(err.data && err.data.overCapacity)) H.toast(err.message, 'bad');
      }
      await load();
    }
    root.onclick = async function (ev) {
      var a = ev.target.closest('[data-af]'), d = ev.target.closest('[data-dec]'), o = ev.target.closest('[data-open]');
      if (a) { st.f = a.getAttribute('data-af'); st.sel = {}; draw(); }
      else if (d) decide(d.getAttribute('data-id'), d.getAttribute('data-dec'), d);
      else if (ev.target.closest('[data-wa]')) { var wb = ev.target.closest('[data-wa]'); H.busy(wb, 1, 'Gönderiliyor…'); try { await H.api('rsvps/' + eventId + '/' + wb.getAttribute('data-wa') + '/send-pass-wa', 'POST', {}); H.toast('Giriş kartı WhatsApp’tan gönderildi', 'ok'); } catch (err) { H.toast(err.message, 'bad'); } await load(); }
      else if (ev.target.closest('[data-mail]')) { var mb = ev.target.closest('[data-mail]'); H.busy(mb, 1, 'Gönderiliyor…'); try { await H.api('rsvps/' + eventId + '/' + mb.getAttribute('data-mail') + '/send-pass', 'POST', {}); H.toast('Giriş kartı e-postası gönderildi', 'ok'); } catch (err) { H.toast(err.message, 'bad'); } await load(); }
      else if (o) detail(data.rsvps.filter(function (r) { return r.id === o.getAttribute('data-open'); })[0]);
      else if (ev.target.closest('#ap-bulk')) {
        var ids = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
        try {
          var p = await H.api('rsvps/' + eventId + '/bulk', 'POST', { ids: ids, decision: 'approved', dryRun: true });
          var okd = await H.modal({ title: p.count + ' başvuru onaylanacak', body: '<dl class="kv"><dt>Etkilenen başvuru</dt><dd>' + p.count + '</dd><dt>Misafir sayısı (+1 dahil)</dt><dd>' + p.guests + '</dd><dt>Onaylı misafir</dt><dd>' + p.approvedNow + ' → <b>' + p.approvedAfter + '</b>' + (p.capacity ? ' / ' + p.capacity + ' kapasite' : ' (kapasite tanımlı değil)') + '</dd></dl>' + (p.over ? H.note('warn', 'Bu onay kapasiteyi <b>' + (p.approvedAfter - p.capacity) + '</b> kişi aşar.') : ''), ok: p.over ? 'Kapasiteyi aşarak onayla' : 'Onayla' });
          if (okd) { await H.api('rsvps/' + eventId + '/bulk', 'POST', { ids: ids, decision: 'approved', force: true }); st.sel = {}; H.toast(p.count + ' başvuru onaylandı', 'ok'); await load(); }
        } catch (err) { H.toast(err.message, 'bad'); }
      }
    };
    root.onchange = function (ev) {
      var s = ev.target.closest('[data-sel]');
      if (s) { st.sel[s.getAttribute('data-sel')] = s.checked; draw(); }
      if (ev.target.id === 'ap-all') { root.querySelectorAll('[data-sel]').forEach(function (c) { st.sel[c.getAttribute('data-sel')] = ev.target.checked; }); draw(); }
    };
    var timer; root.oninput = function (ev) { if (ev.target.id === 'ap-q') { st.q = ev.target.value; clearTimeout(timer); timer = setTimeout(function () { st.focus = 1; draw(); }, 200); } };
    function detail(r) {
      H.drawer({ title: r.name, body: '<dl class="kv"><dt>Durum</dt><dd>' + H.pill(r.checkedInAt ? 'checkedin' : r.status) + '</dd><dt>E-posta</dt><dd>' + e(r.email) + '</dd><dt>Telefon</dt><dd>' + e(r.phone || '—') + '</dd><dt>Kişi sayısı</dt><dd>' + r.guests + '</dd><dt>Not</dt><dd>' + e(r.note || '—') + '</dd><dt>Başvuru</dt><dd>' + H.fmtTime(r.createdAt) + '</dd><dt>Karar</dt><dd>' + (H.fmtTime(r.decidedAt) || '—') + '</dd><dt>Giriş</dt><dd>' + (r.checkedInAt ? H.fmtTime(r.checkedInAt) + ' · ' + r.scanCount + ' okutma' : '—') + '</dd><dt>Geldiği yer</dt><dd>' + (r.via === 'invite' ? 'Davet linki' : 'Etkinlik sayfası') + '</dd><dt>Kampanya</dt><dd>' + (r.utm && r.utm.campaign ? e([r.utm.source, r.utm.medium, r.utm.campaign].join(' / ')) : 'Bilinmiyor') + '</dd>' +
        '<dt>Giriş kartı e-postası</dt><dd>' + (r.mail ? (r.mail.status === 'sent' ? 'Gönderildi · ' + H.fmtTime(r.mail.at) : 'Gönderilemedi · ' + e(r.mail.error || '')) : (data.email.connected ? 'Gönderilmedi' : 'Gönderilmedi (e-posta servisi bağlı değil)')) + '</dd></dl>',
        foot: (r.contactId ? '<button class="btn" type="button" data-nav="view=crm&kisi=' + r.contactId + '">Kişi kartını aç</button>' : '') + (r.status === 'approved' ? '<a class="btn pri" href="/pass?t=' + e(r.passToken) + '" target="_blank" rel="noopener">QR kartını aç</a>' : '') });
    }
    await load();
  };

  /* ---------- Check-in ---------- */
  H.parts.door = async function (root, eventId) {
    var d = await H.api('rsvps/' + eventId), list = d.rsvps.filter(function (x) { return x.status === 'approved'; }), stop = null;
    root.innerHTML = '<div id="k-res" class="door" role="status" aria-live="assertive"><span class="st">Hazır</span><span class="ex">QR okutun ya da isim arayın</span></div>' +
      '<div class="row" style="margin:14px 0"><button class="btn pri lg" id="k-scan" type="button" style="flex:1">' + H.ico('qr') + 'QR tara</button><span class="pill plain" id="k-count" style="height:36px;font-size:14px"></span></div><video id="k-video" playsinline muted hidden></video>' +
      '<label class="search" style="max-width:none;display:block;margin:14px 0"><span class="sr">İsim, e-posta veya telefon</span>' + H.ico('search') + '<input id="k-q" type="search" autocomplete="off" placeholder="İsim, e-posta veya telefon" style="min-height:52px;font-size:17px"></label><div class="card flat"><div class="list" id="k-list"></div></div>';
    var res = root.querySelector('#k-res'), qEl = root.querySelector('#k-q');
    function draw() {
      var t = qEl.value.trim().toLocaleLowerCase('tr'), rows = list.filter(function (x) { return !t || (x.name + ' ' + x.email + ' ' + x.phone).toLocaleLowerCase('tr').indexOf(t) > -1; }).slice(0, 80);
      root.querySelector('#k-list').innerHTML = rows.length ? rows.map(function (x) {
        return '<div class="item"><span class="av' + (x.checkedInAt ? ' in' : '') + '">' + H.initials(x.name) + '</span><div class="main"><span class="t">' + e(x.name) + '</span><span class="mute small">' + x.guests + ' kişi · ' + e(x.email) + '</span></div><div class="acts">' +
          (x.checkedInAt ? H.pill('checkedin', 'Giriş ' + H.fmtTime(x.checkedInAt)) + '<button class="btn sm ghost" type="button" data-undo="' + x.id + '">Geri al</button>' : '<button class="btn pri" type="button" data-in="' + x.id + '">Giriş yap</button>') + '</div></div>';
      }).join('') : '<div class="item"><span class="mute">' + (list.length ? 'Eşleşen onaylı misafir yok.' : 'Bu etkinlikte onaylı misafir yok.') + '</span></div>';
      root.querySelector('#k-count').textContent = list.filter(function (x) { return x.checkedInAt; }).reduce(function (n, x) { return n + x.guests; }, 0) + ' / ' + list.reduce(function (n, x) { return n + x.guests; }, 0) + ' içeride';
    }
    var LBL = { ok: ['ok', 'Giriş onaylandı'], duplicate: ['duplicate', 'Daha önce kullanıldı'], invalid: ['bad', 'Geçersiz kart'], 'wrong-event': ['wrong', 'Başka etkinliğin kartı'], 'not-approved': ['bad', 'Onaylı değil'], undone: ['', 'Giriş geri alındı'] };
    function show(r) {
      var L = LBL[r.result] || ['bad', r.message]; res.className = 'door ' + L[0];
      res.innerHTML = '<span class="st">' + e(L[1]) + '</span>' + (r.rsvp ? '<span class="who">' + e(r.rsvp.name) + ' · ' + r.rsvp.guests + ' kişi</span>' : '') + '<span class="ex">' + e(r.result === 'duplicate' ? 'İlk giriş: ' + H.fmtTime(r.rsvp.checkedInAt) + ' · ' + r.rsvp.scanCount + '. okutma. Yeni giriş kaydedilmedi.' : r.result === 'ok' ? H.fmtTime(r.rsvp.checkedInAt) : r.result === 'undone' ? '' : r.message) + '</span>';
      if (navigator.vibrate) navigator.vibrate(r.result === 'ok' ? 60 : [80, 60, 80]);
      if (r.rsvp && r.rsvp.eventId === eventId) { var hit = false; list = list.map(function (x) { if (x.id === r.rsvp.id) { hit = true; return r.rsvp; } return x; }); if (hit) draw(); }
    }
    async function check(data) { data.eventId = eventId; try { show(await H.api('checkin', 'POST', data)); } catch (err) { res.className = 'door bad'; res.innerHTML = '<span class="st">Kaydedilemedi</span><span class="ex">' + e(err.message) + '</span>'; } }
    qEl.oninput = draw; draw();
    root.querySelector('#k-list').onclick = function (ev) { var a = ev.target.closest('[data-in]'), u = ev.target.closest('[data-undo]'); if (a) check({ rsvpId: a.getAttribute('data-in') }); if (u) check({ rsvpId: u.getAttribute('data-undo'), undo: true }); };
    window.__hqCheck = function (text) { var m = /[?&]t=([A-Za-z0-9_-]+)/.exec(text); check({ token: m ? m[1] : String(text).trim() }); };
    var video = root.querySelector('#k-video'), btn = root.querySelector('#k-scan');
    btn.onclick = async function () {
      if (stop) { stop(); return; }
      try {
        var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream; video.hidden = false; await video.play(); btn.innerHTML = 'Taramayı durdur';
        var liveOn = true, last = '', lastAt = 0, det = ('BarcodeDetector' in window) ? new BarcodeDetector({ formats: ['qr_code'] }) : null, canvas = document.createElement('canvas');
        if (!det && !window.jsQR) await new Promise(function (ok, no) { var s = document.createElement('script'); s.src = '/js/vendor/jsQR.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
        stop = function () { liveOn = false; stream.getTracks().forEach(function (t) { t.stop(); }); video.hidden = true; btn.innerHTML = H.ico('qr') + 'QR tara'; stop = null; };
        (async function loop() {
          if (!liveOn) return; var text = '';
          try {
            if (det) { var c = await det.detect(video); if (c[0]) text = c[0].rawValue; }
            else if (video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; var g = canvas.getContext('2d', { willReadFrequently: true }); g.drawImage(video, 0, 0); var im = g.getImageData(0, 0, canvas.width, canvas.height), o = window.jsQR(im.data, im.width, im.height); if (o) text = o.data; }
          } catch (x) {}
          if (text && (text !== last || Date.now() - lastAt > 4000)) { last = text; lastAt = Date.now(); window.__hqCheck(text); }
          setTimeout(loop, 250);
        })();
      } catch (err) { res.className = 'door bad'; res.innerHTML = '<span class="st">Kamera açılamadı</span><span class="ex">Tarayıcıda kamera iznini kontrol edin. İsim arayarak giriş yapabilirsiniz.</span>'; }
    };
    return function () { if (stop) stop(); window.__hqCheck = null; };
  };

  /* ---------- Görevler ---------- */
  H.parts.tasks = async function (root, opt) {
    opt = opt || {}; var st = { f: opt.f || 'open' }, tasks, evs, by = {};
    async function load() { var r = await Promise.all([H.api('tasks'), H.api('events')]); tasks = r[0].tasks; evs = r[1].events; evs.forEach(function (x) { by[x.id] = x; }); draw(); }
    function draw() {
      var td = H.today(), mine = tasks.filter(function (t) { return !opt.eventId || t.eventId === opt.eventId; });
      var is = { open: function (t) { return t.status !== 'done'; }, overdue: function (t) { return t.status !== 'done' && t.due && t.due < td; }, done: function (t) { return t.status === 'done'; }, all: function () { return true; } };
      var rows = mine.filter(is[st.f]), F = H.field;
      root.innerHTML = '<form class="card" id="tf" style="margin-bottom:16px"><div class="form">' + F({ name: 'title', id: 't-title', label: 'Yeni görev', required: 1, full: 1, ph: 'Örn. Ses sistemi teyidi' }) +
        (opt.eventId ? '' : F({ name: 'eventId', id: 't-ev', label: 'Etkinlik', type: 'select', options: [['', 'Etkinlik yok']].concat(evs.filter(function (x) { return x.status !== 'archived'; }).map(function (x) { return [x.id, x.title]; })) })) +
        F({ name: 'assignee', id: 't-as', label: 'Sorumlu', ph: 'Ekipten bir isim', hint: 'Atama HQ erişimi vermez.' }) + F({ name: 'due', id: 't-due', label: 'Son tarih', type: 'date' }) + F({ name: 'priority', id: 't-pr', label: 'Öncelik', type: 'select', value: 'normal', options: [['high', 'Yüksek'], ['normal', 'Normal'], ['low', 'Düşük']] }) +
        '</div><div class="row" style="margin-top:14px"><button class="btn pri" type="submit">' + H.ico('plus') + 'Görev ekle</button><p class="msg bad" id="t-msg" role="alert"></p></div></form>' +
        '<div class="row" style="margin-bottom:14px">' + H.seg([['open', 'Açık', mine.filter(is.open).length], ['overdue', 'Geciken', mine.filter(is.overdue).length], ['done', 'Biten', mine.filter(is.done).length], ['all', 'Tümü', mine.length]], st.f, 'data-tf') + '</div>' +
        (rows.length ? '<div class="card flat"><div class="list">' + rows.map(function (t) {
          var late = t.status !== 'done' && t.due && t.due < td;
          return '<div class="item"><div class="main"><div class="row"><span class="t"' + (t.status === 'done' ? ' style="text-decoration:line-through;color:var(--dim)"' : '') + '>' + e(t.title) + '</span>' + (t.priority && t.priority !== 'normal' ? H.pill(t.priority, H.STATUS[t.priority] + ' öncelik') : '') + (late ? H.pill('bad', 'Gecikti') : '') + '</div><span class="mute small">' +
            [!opt.eventId && t.eventId && by[t.eventId] ? '<a href="/hq?view=etkinlik&id=' + t.eventId + '&tab=gorevler" data-nav="view=etkinlik&id=' + t.eventId + '&tab=gorevler">' + e(by[t.eventId].title) + '</a>' : '', t.assignee ? 'Sorumlu: ' + e(t.assignee) : 'Sorumlu yok', t.due ? 'Son tarih: ' + H.fmtDate(t.due) : ''].filter(Boolean).join(' · ') + '</span></div><div class="acts">' +
            '<label class="sr" for="ts-' + t.id + '">Durum</label><select id="ts-' + t.id + '" data-ts="' + t.id + '" style="width:auto;min-height:36px">' + ['todo', 'doing', 'done'].map(function (s) { return '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + H.STATUS[s] + '</option>'; }).join('') + '</select><button class="btn sm ghost" type="button" data-del="' + t.id + '" aria-label="Görevi sil">Sil</button></div></div>';
        }).join('') + '</div></div>' : H.empty('task', 'Görev yok.', st.f === 'open' ? 'Yukarıdan ilk görevi ekleyin.' : ''));
    }
    root.onsubmit = async function (ev) {
      if (ev.target.id !== 'tf') return; ev.preventDefault(); var v = H.vals(ev.target), btn = ev.target.querySelector('button[type=submit]'); if (opt.eventId) v.eventId = opt.eventId;
      H.busy(btn, 1); try { await H.api('tasks', 'POST', v); await load(); H.toast('Görev eklendi', 'ok'); } catch (err) { H.busy(btn, 0); root.querySelector('#t-msg').textContent = err.message; }
    };
    root.onchange = async function (ev) { var s = ev.target.closest('[data-ts]'); if (s) { try { await H.api('tasks/' + s.getAttribute('data-ts'), 'PUT', { status: s.value }); await load(); } catch (err) { H.toast(err.message, 'bad'); } } };
    root.onclick = async function (ev) {
      var f = ev.target.closest('[data-tf]'), d = ev.target.closest('[data-del]');
      if (f) { st.f = f.getAttribute('data-tf'); draw(); }
      if (d && await H.modal({ title: 'Görev silinsin mi?', text: 'Bu işlem geri alınamaz.', ok: 'Sil', danger: 1 })) { try { await H.api('tasks/' + d.getAttribute('data-del'), 'DELETE', {}); await load(); } catch (err) { H.toast(err.message, 'bad'); } }
    };
    await load();
  };

  /* ---------- SEO editörü ---------- */
  // row: one entry from GET /api/hq/seo. save(seo) persists the draft. Returns HTML wiring inside root.
  H.parts.seoEditor = function (root, row, save, publishHint) {
    var s = row.seoInput || {}, df = row.defaults, F = H.field, host = row.url.replace(/^https:\/\//, '');
    root.innerHTML = '<div class="split"><form class="card" id="sf"><div class="form">' +
      F({ name: 'title', label: 'SEO başlığı', value: s.title, full: 1, ph: df.title, count: 60, hint: 'Boş bırakılırsa varsayılan kullanılır. Sayfadaki görünür başlıktan (H1: “' + row.h1 + '”) bağımsızdır.' }) +
      F({ name: 'description', label: 'Meta açıklaması', type: 'textarea', rows: 3, value: s.description, full: 1, ph: df.description, count: 160 }) +
      F({ name: 'canonical', label: 'Canonical URL', value: s.canonical, full: 1, ph: df.canonical, type: 'url' }) +
      F({ name: 'index', label: 'İndeksleme', type: 'select', value: s.index || 'default', full: 1, options: [['default', 'Varsayılan (' + (row.type === 'Etkinlik' && !row.listed ? 'özel/taslak: noindex' : 'indekslenir') + ')'], ['index', 'İndekslensin'], ['noindex', 'İndekslenmesin (noindex)']] }) +
      F({ name: 'ogTitle', label: 'Paylaşım başlığı', value: s.ogTitle, full: 1, ph: 'SEO başlığıyla aynı' }) + F({ name: 'ogDescription', label: 'Paylaşım açıklaması', type: 'textarea', rows: 2, value: s.ogDescription, full: 1, ph: 'Meta açıklamasıyla aynı' }) +
      '<div class="f full"><label for="sf-og">Paylaşım (Open Graph) görseli</label><input id="sf-og" type="file" accept="image/jpeg,image/png,image/webp"><span class="hint">' + (s.ogImageId ? 'Özel görsel yüklü.' : row.draft.ogImage ? 'Şu an varsayılan görsel kullanılıyor.' : 'Görsel yok. 1200×630 önerilir.') + (s.ogImageId ? ' <button class="btn sm ghost" type="button" id="sf-ogx">Özel görseli kaldır</button>' : '') + '</span></div>' +
      '</div><p class="msg bad" id="sf-msg" role="alert" style="margin-top:12px"></p><div class="savebar"><span class="small mute">' + e(publishHint || 'Kaydedilen değerler taslaktır; yayınlayınca public HTML’e yazılır.') + '</span><button class="btn pri" type="submit">Taslağı kaydet</button></div></form>' +
      '<div class="stack"><div><p class="eye" style="margin-bottom:8px">Google arama sonucu (yaklaşık)</p><div class="serp"><div class="u" id="pv-u"></div><div class="t" id="pv-t"></div><div class="d" id="pv-d"></div></div><p class="small dim" style="margin-top:6px">Google başlığı ve açıklamayı aramaya göre değiştirebilir.</p></div>' +
      '<div><p class="eye" style="margin-bottom:8px">Sosyal paylaşım kartı (yaklaşık)</p><div class="og"><div class="im" id="pv-im"></div><div class="tx"><div class="h">' + e(host.split('/')[0]) + '</div><div class="t" id="pv-ot"></div><div class="d" id="pv-od"></div></div></div></div>' +
      '<div class="card"><p class="eye" style="margin-bottom:10px">Yayındaki sayfa şu an ne sunuyor</p><dl class="kv"><dt>URL</dt><dd class="url">' + e(row.url) + '</dd><dt>Görünür başlık (H1)</dt><dd>' + e(row.h1) + '</dd><dt>title</dt><dd>' + e(row.title) + src(row.from.title) + '</dd><dt>description</dt><dd>' + e(row.description) + src(row.from.description) + '</dd><dt>canonical</dt><dd class="url">' + e(row.canonical) + '</dd><dt>robots</dt><dd>' + (row.noindex ? 'noindex' : 'index, follow') + '</dd></dl>' +
      (row.jsonld ? '<p class="eye" style="margin:14px 0 8px">Yapılandırılmış veri (JSON-LD)</p><pre class="code">' + e(JSON.stringify(row.jsonld, null, 2)) + '</pre>' : '<p class="small dim" style="margin-top:12px">' + (row.type === 'Etkinlik' ? 'Bu etkinlik herkese açık ve yayında olmadığı için yapılandırılmış veri üretilmez.' : '') + '</p>') + '</div></div></div>';
    function src(f) { return '<span class="src' + (f === 'custom' ? ' c' : '') + '">' + (f === 'custom' ? 'özel' : 'varsayılan') + '</span>'; }
    var form = root.querySelector('#sf'), clearOg = false;
    function pv() {
      var v = H.vals(form), t = v.title || df.title, d = v.description || df.description, img = clearOg ? df.ogImage : row.draft.ogImage;
      root.querySelector('#pv-u').textContent = (v.canonical || df.canonical).replace(/^https:\/\//, '').replace(/\/$/, '').split('/').join(' › ');
      root.querySelector('#pv-t').innerHTML = e(t) + (v.title ? '' : src('default')); root.querySelector('#pv-d').innerHTML = e(d) + (v.description ? '' : src('default'));
      root.querySelector('#pv-ot').textContent = v.ogTitle || t; root.querySelector('#pv-od').textContent = v.ogDescription || d;
      root.querySelector('#pv-im').innerHTML = img ? '<img src="' + e(img.replace(/^https:\/\/[^/]+/, '')) + '" alt="">' : 'Paylaşım görseli yok';
    }
    form.oninput = pv; pv(); H.counters(form);
    var x = root.querySelector('#sf-ogx'); if (x) x.onclick = function () { clearOg = true; x.parentNode.firstChild.textContent = 'Özel görsel kaydedince kaldırılacak.'; x.remove(); pv(); };
    form.onsubmit = async function (ev) {
      ev.preventDefault(); var btn = form.querySelector('button[type=submit]'), msg = root.querySelector('#sf-msg'); msg.textContent = ''; H.busy(btn, 1);
      try { var v = H.vals(form), id = await H.upload(root.querySelector('#sf-og')); if (id) v.ogImageId = id; else if (clearOg) v.ogImageId = ''; await save(v); }
      catch (err) { msg.textContent = err.message; H.busy(btn, 0); }
    };
  };
})();
