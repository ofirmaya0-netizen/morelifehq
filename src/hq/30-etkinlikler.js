/* Etkinlikler: liste + yeni etkinlik */
(function () {
  var H = HQ, e = H.esc;
  H.views.etkinlikler = async function (main) {
    var d = await H.api('events'), f = H.q().get('durum') || 'active', td = H.today();
    var cnt = { active: 0, published: 0, draft: 0, archived: 0 }; d.events.forEach(function (x) { cnt[x.status] += 1; if (x.status !== 'archived') cnt.active += 1; });
    var rows = d.events.filter(function (x) { return f === 'active' ? x.status !== 'archived' : x.status === f; });
    main.innerHTML = H.head({ title: 'Etkinlikler', sub: 'Bir etkinliğin bilgileri, daveti, başvuruları, check-in’i ve SEO’su tek yerde.', acts: '<button class="btn pri" type="button" id="new">' + H.ico('plus') + 'Yeni etkinlik</button>' }) +
      '<div class="row" style="margin-bottom:16px">' + H.seg([['active', 'Aktif', cnt.active], ['published', 'Yayında', cnt.published], ['draft', 'Taslak', cnt.draft], ['archived', 'Arşiv', cnt.archived]], f, 'data-f') + '</div>' +
      (rows.length ? rows.map(function (x) {
        var past = x.date && (x.endDate || x.date) < td;
        return '<article class="ev">' + H.cover(x) + '<div><div class="row"><a class="t" href="/hq?view=etkinlik&id=' + x.id + '" data-nav="view=etkinlik&id=' + x.id + '">' + e(x.title) + '</a>' + H.pill(x.status) + H.pill(x.visibility) + (past ? H.pill('archived', 'Geçmiş') : '') + (x.dirty ? H.pill('warn', 'Yayınlanmamış değişiklik') : '') + '</div>' +
          '<p class="mute small">' + H.fmtDate(x.date) + (x.time ? ' · ' + e(x.time) : '') + ' · ' + e(x.venue || 'Mekân yok') + (x.artist ? ' · ' + e(x.artist) : '') + '</p>' +
          '<div class="stats"><span><b>' + x.counts.pending + '</b> bekleyen</span><span><b>' + x.counts.approved + (x.capacity ? ' / ' + x.capacity : '') + '</b> onaylı</span><span><b>' + x.counts.waitlist + '</b> bekleme listesi</span><span><b>' + x.counts.checkedIn + '</b> giriş</span></div>' + (x.capacity ? '<div style="margin-top:8px;max-width:320px">' + H.meter(x.counts.approved, x.capacity) + '</div>' : '') + '</div>' +
          '<div class="acts"><button class="btn sm pri" type="button" data-nav="view=etkinlik&id=' + x.id + '">Yönet</button><button class="btn sm" type="button" data-nav="view=etkinlik&id=' + x.id + '&tab=basvurular">Başvurular' + (x.counts.pending ? ' (' + x.counts.pending + ')' : '') + '</button>' +
          (x.status === 'published' ? '<button class="btn sm" type="button" data-nav="view=kapi&event=' + x.id + '">' + H.ico('qr') + 'Check-in</button><button class="btn sm" type="button" data-copy="' + e(x.inviteUrl) + '" data-copied="Davet linki kopyalandı">' + H.ico('copy') + 'Davet linki</button>' : '') + '</div></article>';
      }).join('') : H.empty('cal', d.events.length ? 'Bu filtrede etkinlik yok.' : 'Henüz etkinlik yok.', d.events.length ? '' : 'Etkinlik taslak olarak açılır; hazır olduğunda yayınlarsınız.', '<button class="btn pri" type="button" id="new2">Yeni etkinlik</button>'));
    main.onclick = function (ev) { var b = ev.target.closest('[data-f]'); if (b) H.go('view=etkinlikler&durum=' + b.getAttribute('data-f')); if (ev.target.closest('#new,#new2')) create(); };
    if (H.q().get('yeni')) { history.replaceState(null, '', '/hq?view=etkinlikler'); create(); }
  };
  function create() {
    var F = H.field;
    var dr = H.drawer({ title: 'Yeni etkinlik', body: '<form class="form" id="nf">' + F({ name: 'title', label: 'Etkinlik adı', required: 1, full: 1, max: 160 }) + F({ name: 'date', label: 'Tarih', type: 'date' }) + F({ name: 'time', label: 'Başlangıç saati', type: 'time', hint: 'Europe/Istanbul' }) + F({ name: 'venue', label: 'Mekân' }) + F({ name: 'city', label: 'Şehir' }) +
      F({ name: 'visibility', label: 'Görünürlük', type: 'select', full: 1, value: 'public', options: [['public', 'Herkese açık — yayınlanınca sitede listelenir'], ['private', 'Özel davet — yalnızca davet linkiyle açılır']] }) + '<p class="msg bad full" id="nf-msg" role="alert"></p></form>' +
      '<p class="small dim" style="margin-top:14px">Etkinlik taslak olarak kaydedilir. Diğer alanları bir sonraki ekranda doldurursunuz.</p>', foot: '<button class="btn ghost" type="button" data-x>Vazgeç</button><button class="btn pri" type="submit" form="nf">Taslağı oluştur</button>' });
    dr.querySelector('[data-x].btn').onclick = H.closeLayer;
    dr.querySelector('#nf').onsubmit = async function (ev) {
      ev.preventDefault(); var btn = dr.querySelector('button[type=submit]'), msg = dr.querySelector('#nf-msg'); msg.textContent = ''; H.busy(btn, 1);
      try { var r = await H.api('events', 'POST', H.vals(this)); H.closeLayer(); H.toast('Taslak oluşturuldu', 'ok'); H.go('view=etkinlik&id=' + r.event.id); } catch (err) { msg.textContent = err.message; H.busy(btn, 0); }
    };
  }
})();
