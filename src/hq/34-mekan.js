/* Mekân portalı: mekâna verilen tek link. O mekândaki yayındaki etkinliklerde kim geliyor, kimin masası var. */
(function () {
  var H = HQ, e = H.esc;
  H.parts.venueLink = async function (box, venue) {
    var head = '<h2 class="h2" style="margin-bottom:6px">Mekân portalı</h2>';
    if (!venue) { box.innerHTML = head + '<p class="small mute">Bu etkinliğin mekânı girilmemiş. “Genel Bilgiler”e mekânı yazıp yayınlayın; link mekân adına göre açılır.</p>'; return; }
    async function draw() {
      var d;
      try { d = await H.api('venue-links?venue=' + encodeURIComponent(venue)); } catch (err) { box.innerHTML = head + '<p class="small mute">' + e(err.message) + '</p>'; return; }
      var l = d.link, can = H.can('etkinlikler') && H.me.role !== 'viewer';
      box.innerHTML = head + '<p class="small mute" style="margin-bottom:12px"><b>' + e(venue) + '</b> için tek link. Mekân, kendisindeki yayındaki tüm etkinliklerde (şu an ' + d.events + ') kimlerin geldiğini ve kimin masası olduğunu görür: isim, kişi sayısı, masa ve giriş durumu. E-posta, telefon, not ve ödenen tutarları görmez; hiçbir şeyi değiştiremez. Etkinlik, tarihinden iki gün sonra listeden düşer.</p>' +
        (l ? '<p class="url" style="padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid var(--line)">' + e(location.origin + l.url) + '</p><div class="row" style="margin-top:12px"><button class="btn pri" type="button" data-copy="' + e(l.url) + '" data-copied="Mekân linki kopyalandı">' + H.ico('copy') + 'Kopyala</button><a class="btn" href="' + e(l.url) + '" target="_blank" rel="noopener">' + H.ico('ext') + 'Aç</a>' + (can ? '<button class="btn" type="button" data-vl="renew">Yenile</button><button class="btn" type="button" data-vl="close">Kapat</button>' : '') + '</div>'
          : can ? '<button class="btn pri" type="button" data-vl="new">Mekân linki oluştur</button>' : '<p class="small dim">Henüz link oluşturulmadı.</p>');
    }
    box.onclick = async function (x) {
      var b = x.target.closest('[data-vl]'); if (!b) return; var a = b.getAttribute('data-vl');
      if (a !== 'new' && !(await H.modal({ title: a === 'close' ? 'Mekân linki kapatılsın mı?' : 'Mekân linki yenilensin mi?', text: 'Mevcut link hemen çalışmaz olur; mekâna yeniden göndermeniz gerekir.', ok: a === 'close' ? 'Kapat' : 'Yenile', danger: 1 }))) return;
      try { await H.api('venue-links', 'POST', { venue: venue, close: a === 'close' }); H.toast(a === 'close' ? 'Mekân linki kapatıldı' : 'Mekân linki hazır', 'ok'); await draw(); } catch (err) { H.toast(err.message, 'bad'); }
    };
    await draw();
  };
})();
