/* Özet: bugün benden ne bekleniyor, sonra yaklaşan etkinliklerin durumu */
(function () {
  var H = HQ, e = H.esc;
  // one waiting item: tone (bad | warn | info), icon, title, detail line, where it goes, button label
  function row(x) {
    return '<div class="item todo ' + x.tone + '"><span class="chip-i">' + H.ico(x.icon) + '</span><div class="main"><span class="t">' + x.title + '</span>' + (x.sub ? '<span class="mute small">' + x.sub + '</span>' : '') + '</div><div class="acts"><button class="btn sm' + (x.tone === 'bad' ? ' pri' : '') + '" type="button" data-nav="' + x.nav + '">' + e(x.go) + '</button></div></div>';
  }
  function ago(iso) { var h = Math.floor((Date.now() - Date.parse(iso)) / 36e5); return h < 1 ? 'az önce' : h < 24 ? h + ' saat önce' : Math.floor(h / 24) + ' gün önce'; }
  function left(n) { return n == null ? '' : n < 0 ? 'Sürüyor' : n === 0 ? 'Bugün' : n === 1 ? 'Yarın' : n + ' gün'; }

  H.views.ozet = async function (main) {
    var s = await H.api('summary'), me = H.me, hr = new Date(Date.now() + 3 * 36e5).getUTCHours(), hi = hr < 6 ? 'İyi geceler' : hr < 12 ? 'Günaydın' : hr < 18 ? 'İyi günler' : 'İyi akşamlar';
    var money = !!s.payments, full = H.can('gorevler'), canRsvp = H.can('rsvp'), now = [], soon = [];

    // --- what is waiting, most urgent first ---
    (s.payments || []).forEach(function (p) {
      (p.late ? now : soon).push({ tone: p.late ? 'bad' : 'info', icon: 'coin', title: e(p.artist) + ' · ' + e(p.label) + ' <b class="num-t">' + H.money(p.amount, p.currency) + '</b>', sub: p.late ? 'Vadesi ' + H.inDays(H.daysTo(p.due)) + ' geçti (' + H.fmtDate(p.due) + ')' : 'Vade ' + H.fmtDate(p.due) + ' · ' + H.inDays(H.daysTo(p.due)), nav: 'view=booking&id=' + p.bookingId, go: 'Booking’i aç' });
    });
    (s.offers || []).forEach(function (o) {
      now.push({ tone: o.late ? 'bad' : 'warn', icon: 'mic', title: e(o.artist) + ' teklifi yanıt bekliyor', sub: (o.agency ? e(o.agency) + ' · ' : '') + (o.late ? 'Geçerlilik ' + H.fmtDate(o.expires) + ' tarihinde doldu' : 'Geçerlilik ' + H.inDays(H.daysTo(o.expires)) + ' doluyor'), nav: 'view=booking&id=' + o.bookingId, go: 'Booking’i aç' });
    });
    if (canRsvp) s.waiting.forEach(function (w) {
      now.push({ tone: 'warn', icon: 'mail', title: e(w.title) + ': <b class="num-t">' + w.pending + '</b> başvuru onay bekliyor', sub: 'En eskisi ' + ago(w.oldest) + ' geldi' + (w.date ? ' · etkinlik ' + H.fmtDate(w.date) : ''), nav: 'view=rsvp&event=' + w.id + '&durum=pending', go: 'Başvurular' });
    });
    s.tasks.forEach(function (t) {
      var n = H.daysTo(t.due);
      (n <= 0 ? now : soon).push({ tone: t.late ? 'bad' : n === 0 ? 'warn' : 'info', icon: 'task', title: e(t.title), sub: [t.late ? 'Son tarih ' + H.inDays(n) + ' geçti' : 'Son tarih ' + H.inDays(n), t.event ? e(t.event) : '', t.assignee ? 'Sorumlu: ' + e(t.assignee) : ''].filter(Boolean).join(' · '), nav: t.eventId ? 'view=etkinlik&id=' + t.eventId + '&tab=gorevler' : 'view=gorevler', go: 'Görevi aç' });
    });
    if (s.newEnquiries) now.push({ tone: 'warn', icon: 'info', title: '<b class="num-t">' + s.newEnquiries + '</b> yeni talep', sub: s.enquiries.map(function (q) { return e(q.name) + ' (' + e(q.kind) + ')'; }).join(' · '), nav: 'view=talepler', go: 'Talepler' });
    s.unpublished.forEach(function (u) { now.push({ tone: 'info', icon: 'globe', title: e(u.title) + ': yayınlanmamış değişiklik var', sub: 'Kaydedildi ama sitede hâlâ eski hali görünüyor.', nav: 'view=etkinlik&id=' + u.id + '&tab=public', go: 'Gözden geçir' }); });
    var order = { bad: 0, warn: 1, info: 2 }; now.sort(function (a, b) { return order[a.tone] - order[b.tone]; });

    var stat = function (nav, n, label, icon, alert) { return '<button class="stat' + (alert && n ? ' alert' : '') + '" type="button" data-nav="' + nav + '"><span class="top"><span class="chip-i">' + H.ico(icon) + '</span>' + H.ico('ext') + '</span><span class="num">' + n + '</span><span class="lbl">' + label + '</span></button>'; };
    var tiles = (canRsvp ? stat('view=rsvp&durum=pending', s.pendingRsvps, 'Bekleyen başvuru', 'mail', 1) : '') +
      (money ? stat('view=booking', s.payments.length, '14 gün içinde ödeme', 'coin', s.payments.some(function (p) { return p.late; })) : '') +
      (full ? stat('view=gorevler&durum=overdue', s.overdueTasks, 'Geciken görev', 'task', 1) : '') +
      (H.can('etkinlikler') ? stat('view=etkinlikler&durum=upcoming', s.upcoming.length, 'Yaklaşan etkinlik', 'cal') : '') +
      (canRsvp && !money ? stat('view=rsvp&durum=approved', s.approvedGuests, 'Onaylanan misafir', 'check') : '');

    var sales = s.upcoming.some(function (x) { return x.useTickets && x.ticketUrl; });
    var events = s.upcoming.length ? s.upcoming.map(function (x) {
      var p = x.pace, up = p.last7 > p.prev7, down = p.last7 < p.prev7, fill = x.capacity ? Math.round(x.counts.approved / x.capacity * 100) : null;
      var acts = (canRsvp ? '<button class="btn sm" type="button" data-nav="view=' + (H.can('etkinlikler') ? 'etkinlik&id=' + x.id + '&tab=basvurular' : 'rsvp&event=' + x.id) + '">Başvurular' + (x.counts.pending ? ' (' + x.counts.pending + ')' : '') + '</button>' : '') +
        (H.can('kapi') ? '<button class="btn sm" type="button" data-nav="view=kapi&event=' + x.id + '">' + H.ico('qr') + 'Check-in</button>' : '') +
        (H.can('etkinlikler') && !me.readOnly ? '<button class="btn sm" type="button" data-copy="' + e(x.inviteUrl) + '" data-copied="Davet linki kopyalandı">' + H.ico('copy') + 'Davet linki</button>' : '');
      return '<article class="ev">' + H.cover(x) + '<div><div class="row">' + (H.can('etkinlikler') ? '<a class="t" href="/hq?view=etkinlik&id=' + x.id + '" data-nav="view=etkinlik&id=' + x.id + '">' + e(x.title) + '</a>' : '<span class="t">' + e(x.title) + '</span>') +
        (x.daysLeft != null ? '<span class="pill plain ' + (x.daysLeft <= 3 ? 'warn' : 'info') + '">' + H.ico('clock') + left(x.daysLeft) + '</span>' : '') + (x.visibility === 'private' ? H.pill('private') : '') + '</div>' +
        '<p class="mute small">' + H.fmtDate(x.date) + (x.time ? ' · ' + e(x.time) : '') + (x.venue ? ' · ' + e(x.venue) : '') + '</p>' +
        '<div class="stats"><span><b>' + x.counts.pending + '</b> bekleyen</span><span><b>' + x.counts.approved + (x.capacity ? ' / ' + x.capacity : '') + '</b> onaylı' + (fill != null ? ' · %' + fill + ' dolu' : '') + '</span><span><b>' + x.counts.checkedIn + '</b> giriş</span></div>' + (x.capacity ? '<div style="margin-top:8px;max-width:320px">' + H.meter(x.counts.approved, x.capacity) + '</div>' : '') +
        (full ? '<p class="pace small"><span class="' + (up ? 'up' : down ? 'down' : '') + '">' + (up ? '▲' : down ? '▼' : '■') + ' Son 7 gün <b>' + p.last7 + '</b> başvuru</span><span class="dim">önceki 7 gün ' + p.prev7 + '</span><span class="dim">' + p.views7 + ' ziyaret</span>' + (x.useTickets && x.ticketUrl ? '<span class="dim">' + p.clicks7 + ' bilet linki tıklaması</span>' : '') + '</p>' : '') +
        '</div><div class="acts">' + acts + '</div></article>';
    }).join('') : H.empty('cal', 'Yayında yaklaşan etkinlik yok.', H.can('etkinlikler') && !me.readOnly ? 'İlk etkinliği oluşturun; yayınladığınızda burada görünür.' : '', H.can('etkinlikler') && !me.readOnly ? '<button class="btn pri" type="button" data-nav="view=etkinlikler&yeni=1">Yeni etkinlik</button>' : '');

    main.innerHTML = H.head({ eye: new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' }), title: hi + (me.role !== 'owner' && s.name ? ', ' + e(s.name.split(' ')[0]) : '') + ' <i>.</i>',
      sub: now.length ? 'Bugün senden <b style="color:var(--ink)">' + now.length + '</b> şey bekleniyor.' : 'Bugün bekleyen bir şey yok.',
      acts: H.can('etkinlikler') && !me.readOnly ? (money ? '<button class="btn" type="button" data-nav="view=booking&yeni=1">' + H.ico('mic') + 'Yeni booking</button>' : '') + '<button class="btn pri" type="button" data-nav="view=etkinlikler&yeni=1">' + H.ico('plus') + 'Yeni etkinlik</button>' : '' }) +
      (tiles ? '<div class="grid g4">' + tiles + '</div>' : '') +
      '<div class="' + (soon.length ? 'split' : '') + ' sec"><div><div class="sec-h"><h2 class="h2">Bugün senden beklenenler</h2></div>' +
      (now.length ? '<div class="card flat"><div class="list">' + now.map(row).join('') + '</div></div>' : '<div class="card done-all">' + H.ico('check') + '<div><b>Hepsi tamam.</b><p class="mute small">' + (money ? 'Onay bekleyen başvuru, vadesi gelen ödeme ya da geciken görev yok.' : 'Onay bekleyen bir şey yok.') + '</p></div></div>') + '</div>' +
      (soon.length ? '<div><div class="sec-h"><h2 class="h2">Sırada</h2><span class="small dim">önümüzdeki günler</span></div><div class="card flat"><div class="list">' + soon.map(row).join('') + '</div></div></div>' : '') + '</div>' +
      '<div class="sec"><div class="sec-h"><h2 class="h2">Yaklaşan etkinlikler</h2>' + (s.drafts ? '<button class="btn ghost sm" type="button" data-nav="view=etkinlikler&durum=draft">' + s.drafts + ' taslak</button>' : '') + '</div>' + events +
      (full && sales ? '<p class="small dim" style="margin-top:10px">Bilet satışı HQ’ya bağlı değil: tıklama satış sayısı değildir, yalnızca bilet linkine gidenleri gösterir.</p>' : '') + '</div>';
  };
})();
