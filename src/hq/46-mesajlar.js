/* Mesajlar: More Life WhatsApp hattına gelen mesajlar ve yanıtlar */
(function () {
  var H = HQ, e = H.esc;
  function who(t) { return t.contactName || t.name || t.phone; }
  H.views.mesajlar = async function (main) {
    var d = await H.api('inbox'), ro = H.me.readOnly, f = H.q().get('durum') || 'all', n = d.threads.filter(function (t) { return t.unread; }).length, rows = d.threads.filter(function (t) { return f === 'all' || t.unread; });
    var setup = !d.whatsapp.connected ? H.note('', 'WhatsApp bağlı değil. Ayarlar’daki Bird bağlantısı kurulunca gelen mesajlar buraya bağlanabilir.')
      : !d.hook.connected ? H.note('warn', 'Gelen mesajlar henüz HQ’ya bağlı değil: hatta yazılanlar şu an yalnızca Bird’de görünüyor.' + (ro ? '' : ' <button class="btn sm pri" type="button" id="wa-con" style="margin-left:8px">Gelen mesajları bağla</button>')) : '';
    main.innerHTML = H.head({ title: 'Mesajlar', sub: 'More Life WhatsApp hattına yazanlar. Bir kişi yazdıktan sonra 24 saat boyunca serbest metinle yanıtlanabilir; sonrasında WhatsApp yalnızca onaylı şablona izin verir.', acts: '<button class="btn" type="button" id="wa-ref">Yenile</button>' }) +
      (setup ? '<div style="margin-bottom:14px">' + setup + '</div>' : '') +
      '<div class="row" style="margin-bottom:14px">' + H.seg([['all', 'Tümü', d.threads.length], ['unread', 'Okunmamış', n]], f, 'data-mf') + '</div>' +
      (rows.length ? '<div class="card flat"><div class="list">' + rows.map(function (t) {
        return '<div class="item click" data-open="' + t.key + '"><span class="av' + (t.unread ? '' : ' in') + '">' + H.initials(who(t)) + '</span><div class="main"><div class="row"><span class="t">' + e(who(t)) + '</span>' + (t.unread ? H.pill('warn', 'Yeni') : '') + (t.optOut ? H.pill('archived', 'Mesaj istemiyor') : '') + (t.contactId ? '' : '<span class="pill plain">CRM’de yok</span>') + '</div><span class="mute small">' + e(t.phone) + ' · ' + H.fmtTime(t.lastAt) + '</span><span class="small trunc" style="max-width:640px">' + (t.lastDir === 'out' ? 'Siz: ' : '') + e(t.lastText || '') + '</span></div><div class="acts"><button class="btn sm" type="button" data-open="' + t.key + '">Aç</button></div></div>';
      }).join('') + '</div></div>' : H.empty('chat', d.threads.length ? 'Okunmamış mesaj yok.' : 'Henüz gelen mesaj yok.', d.threads.length ? '' : d.hook.connected ? 'Hatta biri yazdığında burada görünür.' : '')) +
      (d.hook.connected && !ro ? '<p class="small dim" style="margin-top:12px">Bağlantı: <span class="url">' + e(d.hook.url || d.hookUrl) + '</span>' + (d.hook.at ? ' · ' + H.fmtTime(d.hook.at) : '') + (d.hook.manual ? '' : ' · <button class="link" type="button" id="wa-dis">Bağlantıyı kaldır</button>') + '</p>' : '');
    main.onclick = async function (ev) {
      var b = ev.target.closest('[data-mf]'), o = ev.target.closest('[data-open]'), c = ev.target.closest('#wa-con'), x = ev.target.closest('#wa-dis');
      if (ev.target.closest('#wa-ref')) return H.render();
      if (b) return H.go('view=mesajlar&durum=' + b.getAttribute('data-mf'));
      if (o) return open(o.getAttribute('data-open'));
      if (c) {
        if (!(await H.modal({ title: 'Gelen mesajlar bağlansın mı?', body: '<p class="mute">Bird, hatta gelen her WhatsApp mesajını şu adrese gönderecek:</p><p class="url" style="margin:10px 0;word-break:break-all">' + e(d.hookUrl) + '</p><p class="mute small">İmza anahtarını sunucu üretir ve saklar; hiçbir yerde gösterilmez. Bird’deki Inbox çalışmaya devam eder.</p>', ok: 'Bağla' }))) return;
        H.busy(c, 1, 'Bağlanıyor…'); try { await H.api('inbox/connect', 'POST', {}); H.toast('Gelen mesajlar bağlandı', 'ok'); H.render(); } catch (err) { H.busy(c, 0); H.toast(err.message, 'bad'); }
      }
      if (x) { if (!(await H.modal({ title: 'Bağlantı kaldırılsın mı?', text: 'Yeni gelen mesajlar HQ’da görünmez; eskiler yerinde kalır.', ok: 'Kaldır', danger: 1 }))) return; try { await H.api('inbox/connect', 'DELETE', {}); H.toast('Bağlantı kaldırıldı', 'ok'); H.render(); } catch (err) { H.toast(err.message, 'bad'); } }
    };
    async function open(key) {
      var r; try { r = await H.api('inbox/' + key); } catch (err) { return H.toast(err.message, 'bad'); }
      var t = r.thread, bubbles = function (ms) { return ms.map(function (m) { return '<div class="bub ' + m.dir + '"><div>' + (m.kind !== 'text' && !m.text ? '<i>[' + e(m.kind) + '] Bu içerik Bird’de açılır.</i>' : e(m.text)) + (m.kind !== 'text' && m.text ? '<br><i class="small">[' + e(m.kind) + ']</i>' : '') + '</div><span>' + H.fmtTime(m.at) + (m.by ? ' · ' + e(m.by) : '') + '</span></div>'; }).join(''); };
      var dr = H.drawer({ title: who(t), onClose: function () { H.render(); }, body: '<p class="mute small" style="margin-bottom:12px">' + e(t.phone) + (t.name && t.name !== who(t) ? ' · WhatsApp adı: ' + e(t.name) : '') + '</p>' + (t.optOut ? '<div style="margin-bottom:12px">' + H.note('warn', 'Bu kişi STOP yazdı: artık davet mesajı gönderilmez.') + '</div>' : '') + '<div class="chat" id="chat">' + bubbles(r.messages) + '</div>' +
        (ro ? '' : r.canReply ? '<form class="form" id="rf" style="margin-top:16px">' + H.field({ name: 'text', label: 'Yanıt', type: 'textarea', rows: 3, required: 1, full: 1, max: 4000, hint: 'More Life hattından gider. Yanıt süresi ' + H.fmtTime(r.windowEnds) + '’e kadar açık.' }) + '<p class="msg bad full" role="alert"></p></form>' : '<div style="margin-top:16px">' + H.note('', 'Son mesajın üzerinden 24 saat geçti; serbest metinle yanıt kapalı. Yeniden yazarsa açılır.') + '</div>'),
        foot: (t.contactId ? '<button class="btn" type="button" data-nav="view=crm&kisi=' + t.contactId + '">Kişi kartı</button>' : '') + (!ro && r.canReply ? '<button class="btn pri" type="submit" form="rf">Gönder</button>' : '') });
      var chat = dr.querySelector('#chat'); chat.scrollTop = chat.scrollHeight;
      if (!ro && t.unread) H.api('inbox/' + key + '/read', 'POST', {}).then(H.refreshBadge).catch(function () {});
      var rf = dr.querySelector('#rf');
      if (rf) rf.onsubmit = async function (ev) { ev.preventDefault(); var btn = dr.querySelector('button[type=submit]'), msg = dr.querySelector('.msg'); msg.textContent = ''; H.busy(btn, 1, 'Gönderiliyor…'); try { var s = await H.api('inbox/' + key + '/reply', 'POST', H.vals(rf)); chat.insertAdjacentHTML('beforeend', bubbles([s.message])); chat.scrollTop = chat.scrollHeight; rf.reset(); } catch (err) { msg.textContent = err.message; } H.busy(btn, 0); };
    }
  };
})();
