/* Mekân portalı: mekâna verilen tek link. O mekândaki yayındaki etkinliklerde kim geliyor, kimin masası var. */
(function () {
  var H = HQ, e = H.esc;
  H.parts.venueLink = async function (box, venue, eventId) {
    var head = '<h2 class="h2" style="margin-bottom:6px">Mekân portalı</h2>';
    if (!venue) { box.innerHTML = head + '<p class="small mute">Bu etkinliğin mekânı girilmemiş. “Genel Bilgiler”e mekânı yazıp yayınlayın; link mekân adına göre açılır.</p>'; return; }
    async function draw() {
      var d;
      try { d = await H.api('venue-links?venue=' + encodeURIComponent(venue)); } catch (err) { box.innerHTML = head + '<p class="small mute">' + e(err.message) + '</p>'; return; }
      var l = d.link, can = H.can('etkinlikler') && H.me.role !== 'viewer';
      box.innerHTML = head + '<p class="small mute" style="margin-bottom:12px"><b>' + e(venue) + '</b> için tek link. Mekân, kendisindeki yayındaki tüm etkinliklerde (şu an ' + d.events + ') kimlerin geldiğini ve kimin masası olduğunu görür: isim, kişi sayısı, masa ve giriş durumu. E-posta, telefon, misafirin yazdığı not ve ödenen tutarları görmez; yalnızca sizin “Masa notları”na yazdığınızı görür. Etkinliğin kapasitesi girilmişse, içerideki sayı %90’a ulaşınca mekân da uyarılır. Etkinlik, tarihinden iki gün sonra listeden düşer.</p>' +
        (l ? '<p class="small mute" style="margin-bottom:12px">QR okuma: ' + (l.scan ? '<b>açık</b>. Mekânın kapı ekibi portaldaki “QR okuyucu” ile yalnızca o etkinliğin giriş kartlarını ve biletlerini okutup giriş yapabilir (etkinliğin kapı linkiyle aynı ekran).' : '<b>kapalı</b>. Mekân listeyi görür ama giriş okutamaz.') + '</p><p class="small mute" style="margin-bottom:12px">Mekânın davet linki: ' + (l.invite ? '<b>açık</b>. Mekân portaldan her etkinlik için kendi davet linkini alır; sizin davet linkinizden ayrıdır. Bu linkten gelen başvurular Başvurular’da “Mekân daveti” etiketiyle görünür ve yine sizin onayınızı bekler.' : '<b>kapalı</b>. Mekânın daha önce paylaştığı davet linkleri de açılmaz.') + '</p>' : '') +
        (l ? '<p class="url" style="padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid var(--line)">' + e(location.origin + l.url) + '</p><div class="row" style="margin-top:12px"><button class="btn pri" type="button" data-copy="' + e(l.url) + '" data-copied="Mekân linki kopyalandı">' + H.ico('copy') + 'Kopyala</button><a class="btn" href="' + e(l.url) + '" target="_blank" rel="noopener">' + H.ico('ext') + 'Aç</a>' + (can ? '<button class="btn" type="button" data-vl="' + (l.scan ? 'scanoff' : 'scanon') + '">' + (l.scan ? 'QR okumayı kapat' : 'QR okumayı aç') + '</button><button class="btn" type="button" data-vl="' + (l.invite ? 'invoff' : 'invon') + '">' + (l.invite ? 'Davet linkini kapat' : 'Davet linkini aç') + '</button><button class="btn" type="button" data-vl="renew">Yenile</button><button class="btn" type="button" data-vl="close">Kapat</button>' : '') + '</div>'
          : can ? '<button class="btn pri" type="button" data-vl="new">Mekân linki oluştur</button>' : '<p class="small dim">Henüz link oluşturulmadı.</p>') +
        '<div class="row" style="margin-top:12px"><button class="btn" type="button" data-vl="notes">Masa notları</button></div>';
    }
    box.onclick = async function (x) {
      var b = x.target.closest('[data-vl]'); if (!b) return; var a = b.getAttribute('data-vl');
      if (a === 'notes') { notes(); return; }
      if (a === 'invon' || a === 'invoff') { try { await H.api('venue-links', 'POST', { venue: venue, invite: a === 'invon' }); H.toast(a === 'invon' ? 'Mekânın davet linki açıldı' : 'Mekânın davet linki kapatıldı', 'ok'); await draw(); } catch (err) { H.toast(err.message, 'bad'); } return; }
      if (a === 'scanon' || a === 'scanoff') { try { await H.api('venue-links', 'POST', { venue: venue, scan: a === 'scanon' }); H.toast(a === 'scanon' ? 'QR okuma açıldı' : 'QR okuma kapatıldı', 'ok'); await draw(); } catch (err) { H.toast(err.message, 'bad'); } return; }
      if (a !== 'new' && !(await H.modal({ title: a === 'close' ? 'Mekân linki kapatılsın mı?' : 'Mekân linki yenilensin mi?', text: 'Mevcut link hemen çalışmaz olur; mekâna yeniden göndermeniz gerekir.', ok: a === 'close' ? 'Kapat' : 'Yenile', danger: 1 }))) return;
      try { await H.api('venue-links', 'POST', { venue: venue, close: a === 'close' }); H.toast(a === 'close' ? 'Mekân linki kapatıldı' : 'Mekân linki hazır', 'ok'); await draw(); } catch (err) { H.toast(err.message, 'bad'); }
    };
    // One short note per table, written for the venue (birthday, bottles ordered ahead, VIP). Saved when the field is left.
    async function notes() {
      var d; try { d = await H.api('venue-links/notes?event=' + eventId); } catch (err) { H.toast(err.message, 'bad'); return; }
      var can = H.me.role !== 'viewer', AREA = { backstage: 'Backstage', standard: 'Normal masa' };
      var dr = H.drawer({ title: 'Masa notları', body: '<p class="small mute" style="margin-bottom:14px">Mekânın portalda masanın altında göreceği kısa not: doğum günü, şişe ön siparişi, VIP. Misafire gitmez. Alandan çıkınca kaydedilir.</p>' +
        (d.tables.length ? '<div class="stack">' + d.tables.map(function (t, i) { return '<div class="f"><label for="vn-' + i + '"><b>' + e(t.name) + '</b> · ' + e([t.label, AREA[t.area] || t.area, t.people + ' kişi'].filter(Boolean).join(' · ')) + '</label><input id="vn-' + i + '" data-key="' + e(t.key) + '" value="' + e(t.note || '') + '" maxlength="200" placeholder="Not yok"' + (can ? '' : ' disabled') + '><span class="hint" aria-live="polite"></span></div>'; }).join('') + '</div>' : H.empty('qr', 'Henüz masa yok', 'Satılan ya da onaylanan masalar burada listelenir.')) });
      dr.querySelectorAll('input[data-key]').forEach(function (inp) {
        var last = inp.value;
        inp.onchange = async function () { var hint = inp.parentNode.querySelector('.hint'), v = inp.value.trim(); if (v === last) return; try { await H.api('venue-links/notes', 'PUT', { event: eventId, key: inp.getAttribute('data-key'), note: v }); last = v; hint.textContent = v ? 'Kaydedildi' : 'Not silindi'; } catch (err) { hint.textContent = err.message; } };
      });
    }
    await draw();
  };
})();
