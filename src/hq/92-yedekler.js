/* Yedekler: günlük otomatik yedek, elle yedek, indirme ve geri yükleme (yalnızca Sahip) */
(function () {
  var H = HQ, e = H.esc;
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  var NAMES = { events: 'etkinlik', rsvps: 'başvuru', contacts: 'kişi', bookings: 'booking', tasks: 'görev', enquiries: 'talep', audiences: 'kitle' };
  H.views.yedekler = async function (main) {
    var d;
    async function load() { d = await H.api('backups'); draw(); }
    function draw() {
      var last = d.backups[0], auto = d.lastAuto, old = auto && Date.now() - Date.parse(auto) > 36 * 36e5;
      main.innerHTML = H.head({ title: 'Yedekler', sub: 'Etkinlikler, başvurular, CRM, booking’ler, görevler ve ayarların tam kopyası. Her gün bir yedek kendiliğinden alınır; istediğiniz an elle de alabilirsiniz.', acts: '<button class="btn pri" type="button" id="bk-now">' + H.ico('db') + 'Şimdi yedekle</button>' }) +
        '<div class="grid g2" style="margin-bottom:18px"><div class="card"><h2 class="h2" style="margin-bottom:12px">Durum</h2><dl class="kv"><dt>Son otomatik yedek</dt><dd>' + (auto ? H.fmtTime(auto) + ' ' + H.pill(old ? 'bad' : 'ok', old ? '36 saatten eski' : 'Güncel') : (d.scheduled ? 'Henüz alınmadı; ilki bu gece yarısından sonra.' : '—')) + '</dd>' +
        '<dt>Otomatik yedek</dt><dd>' + (d.scheduled ? 'Açık · her gün, gece yarısından sonraki ilk 15 dakikada' : 'Bu ortamda çalışmaz. Otomatik yedek yalnızca canlı sitede alınır; önizlemede “Şimdi yedekle” ile deneyebilirsiniz.') + '</dd>' +
        '<dt>Saklama</dt><dd>Son ' + d.keep.daily + ' günün yedeği, sonra ' + d.keep.monthly + ' ay boyunca her ayın ilki. Elle alınanların son ' + d.keep.other + ' tanesi.</dd>' +
        '<dt>Yüklenen dosyalar</dt><dd>' + (d.bins ? d.bins.held + ' görsel ve booking dosyası kopyalandı' + (d.bins.waiting ? ' · ' + d.bins.waiting + ' tanesi sıradaki yedekte' : '') : '—') + '</dd></dl></div>' +
        '<div class="card"><h2 class="h2" style="margin-bottom:12px">Bilmeniz gerekenler</h2><ul class="dots">' + d.notes.map(function (n) { return '<li>' + e(n) + '</li>'; }).join('') + '<li>Geri yükleme, verileri yedeğin alındığı ana döndürür: sonradan eklenen kayıtlar silinir. Ekip üyeleri ve işlem kaydı olduğu gibi kalır. Başlamadan önce o anki durumun yedeği de alınır.</li></ul></div></div>' +
        (d.backups.length ? '<div class="card flat"><div class="scroll"><table><thead><tr><th>Tarih</th><th>Tür</th><th>İçerik</th><th class="r">Boyut</th><th></th></tr></thead><tbody>' + d.backups.map(function (b) {
          var c = Object.keys(NAMES).filter(function (k) { return b.counts[k]; }).map(function (k) { return b.counts[k] + ' ' + NAMES[k]; }).join(' · ');
          return '<tr><td><b>' + H.fmtTime(b.at) + '</b>' + (b.by && b.kind !== 'auto' ? '<br><span class="small mute">' + e(b.by) + '</span>' : '') + '</td><td>' + H.pill(b.kind === 'auto' ? 'info' : b.kind === 'manual' ? 'ok' : 'warn', b.kindLabel) + '</td><td class="small mute"><b style="color:var(--ink)">' + b.total + '</b> kayıt' + (c ? '<br>' + c : '') + '</td><td class="r small mute">' + size(b.bytes) + '</td><td class="r"><div class="row" style="justify-content:flex-end;flex-wrap:nowrap"><a class="btn sm" href="/api/hq/backups/' + b.id + '/download">' + H.ico('down') + 'İndir</a><button class="btn sm ghost" type="button" data-restore="' + b.id + '">Geri yükle</button></div></td></tr>';
        }).join('') + '</tbody></table></div></div>' : H.empty('db', 'Henüz yedek yok.', d.scheduled ? 'İlk otomatik yedek bu gece alınır. Beklemeden “Şimdi yedekle” ile ilkini alabilirsiniz.' : '“Şimdi yedekle” ile ilk yedeği alın.'));
    }
    async function restore(b) {
      var ok = await H.modal({ title: 'Bu yedeğe dönülsün mü?', ok: 'Geri yükle', danger: 1, body: '<p class="mute"><b style="color:var(--ink)">' + H.fmtTime(b.at) + '</b> tarihli yedek geri yüklenecek (' + b.total + ' kayıt). Bu tarihten sonra eklenen ya da değişen her şey o günkü haline döner.</p><p class="mute">Önce şu anki durumun yedeği alınır; vazgeçerseniz ona dönebilirsiniz.</p><label class="lab" for="m-in">Onaylamak için <b style="color:var(--ink)">GERİ YÜKLE</b> yazın</label><input id="m-in" autocomplete="off" autocapitalize="characters">' });
      if (!ok) return;
      if (ok.value.trim() !== 'GERİ YÜKLE') { H.toast('Onay metni eşleşmedi; hiçbir şey değişmedi.', 'bad'); return; }
      var path = 'backups/' + b.id + '/restore', box = document.createElement('div'); box.className = 'toast'; document.getElementById('toasts').appendChild(box);
      var say = function (t) { box.textContent = t; };
      try {
        say('Şu anki durum yedekleniyor…'); var r = await H.api(path, 'POST', { step: 'begin', confirm: 'GERİ YÜKLE' }), next = 0;
        while (next != null) { var w = await H.api(path, 'POST', { step: 'write', from: next }); next = w.next; say('Kayıtlar geri yükleniyor: ' + w.done + ' / ' + w.total); }
        var left = 1; while (left) { left = (await H.api(path, 'POST', { step: 'prune' })).left; say('Sonradan eklenen kayıtlar kaldırılıyor…'); }
        var f = { filesLeft: 1 }; while (f.filesLeft) { f = await H.api(path, 'POST', { step: 'finish' }); say('Dosyalar kontrol ediliyor…'); }
        box.remove(); H.toast('Geri yükleme tamamlandı', 'ok'); await load();
      } catch (err) { box.remove(); H.modal({ title: 'Geri yükleme yarıda kaldı', text: err.message + ' Veriler kısmen eski, kısmen yeni olabilir. Aynı yedeği yeniden geri yükleyin; işlem kaldığı yerden değil baştan, güvenle tekrarlanır.', ok: 'Tamam', cancel: '' }); await load().catch(function () {}); }
    }
    main.onclick = async function (x) {
      var now = x.target.closest('#bk-now'), rs = x.target.closest('[data-restore]');
      if (now) { H.busy(now, 1, 'Yedekleniyor…'); try { var r = await H.api('backups', 'POST', {}); H.toast('Yedek alındı: ' + r.backup.total + ' kayıt', 'ok'); await load(); } catch (err) { H.busy(now, 0); H.toast(err.message, 'bad'); } }
      if (rs) restore(d.backups.filter(function (b) { return b.id === rs.getAttribute('data-restore'); })[0]);
    };
    await load();
  };
})();
