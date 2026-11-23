/* Özet */
(function () {
  var H = HQ, e = H.esc;
  H.views.ozet = async function (main) {
    var s = await H.api('summary'), hr = new Date(Date.now() + 3 * 36e5).getUTCHours(), hi = hr < 6 ? 'İyi geceler' : hr < 12 ? 'Günaydın' : hr < 18 ? 'İyi günler' : 'İyi akşamlar';
    var stat = function (nav, n, label, icon, alert) { return '<button class="stat' + (alert && n ? ' alert' : '') + '" type="button" data-nav="' + nav + '"><span class="top"><span class="chip-i">' + H.ico(icon) + '</span>' + H.ico('ext') + '</span><span class="num">' + n + '</span><span class="lbl">' + label + '</span></button>'; };
    main.innerHTML = H.head({ eye: new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' }), title: hi + ' <i>.</i>', sub: 'Etkinlikler, başvurular ve görevlerde bugün neredeyiz.',
      acts: (s.newEnquiries ? '<button class="btn" type="button" data-nav="view=talepler">' + s.newEnquiries + ' yeni talep</button>' : '') + '<button class="btn pri" type="button" data-nav="view=etkinlikler&yeni=1">' + H.ico('plus') + 'Yeni etkinlik</button>' }) +
      '<div class="grid g4">' + stat('view=etkinlikler&durum=published', s.upcoming.length, 'Yaklaşan etkinlik', 'cal') + stat('view=rsvp&durum=pending', s.pendingRsvps, 'Bekleyen başvuru', 'mail', 1) + stat('view=rsvp&durum=approved', s.approvedGuests, 'Onaylanan misafir', 'check') + stat('view=gorevler&durum=overdue', s.overdueTasks, 'Geciken görev', 'task', 1) + '</div>' +
      '<div class="sec"><div class="sec-h"><h2 class="h2">Yaklaşan etkinlikler</h2>' + (s.drafts ? '<button class="btn ghost sm" type="button" data-nav="view=etkinlikler&durum=draft">' + s.drafts + ' taslak</button>' : '') + '</div>' +
      (s.upcoming.length ? s.upcoming.map(function (x) {
        return '<article class="ev">' + H.cover(x) + '<div><div class="row"><a class="t" href="/hq?view=etkinlik&id=' + x.id + '" data-nav="view=etkinlik&id=' + x.id + '">' + e(x.title) + '</a>' + H.pill(x.visibility) + (x.dirty ? H.pill('warn', 'Yayınlanmamış değişiklik') : '') + '</div>' +
          '<p class="mute small">' + H.fmtDate(x.date) + (x.time ? ' · ' + e(x.time) : '') + (x.venue ? ' · ' + e(x.venue) : '') + '</p>' +
          '<div class="stats"><span><b>' + x.counts.pending + '</b> bekleyen</span><span><b>' + x.counts.approved + (x.capacity ? ' / ' + x.capacity : '') + '</b> onaylı</span><span><b>' + x.counts.checkedIn + '</b> giriş</span></div>' + (x.capacity ? '<div style="margin-top:8px;max-width:320px">' + H.meter(x.counts.approved, x.capacity) + '</div>' : '') + '</div>' +
          '<div class="acts"><button class="btn sm" type="button" data-nav="view=etkinlik&id=' + x.id + '&tab=basvurular">Başvurular' + (x.counts.pending ? ' (' + x.counts.pending + ')' : '') + '</button><button class="btn sm" type="button" data-nav="view=kapi&event=' + x.id + '">' + H.ico('qr') + 'Check-in</button><button class="btn sm" type="button" data-copy="' + e(x.inviteUrl) + '" data-copied="Davet linki kopyalandı">' + H.ico('copy') + 'Davet linki</button></div></article>';
      }).join('') : H.empty('cal', 'Yayında yaklaşan etkinlik yok.', 'İlk etkinliği oluşturun; yayınladığınızda burada görünür.', '<button class="btn pri" type="button" data-nav="view=etkinlikler&yeni=1">Yeni etkinlik</button>')) + '</div>';
  };
})();
