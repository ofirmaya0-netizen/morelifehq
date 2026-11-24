/* Talepler: site formlarından gelenler */
(function () {
  var H = HQ, e = H.esc, AREA = { backstage: 'Backstage', standard: 'Normal masa', either: 'Fark etmez' }, ST = { 'new': ['warn', 'Yeni'], open: ['info', 'İlgileniliyor'], done: ['ok', 'Kapandı'] };
  H.views.talepler = async function (main) {
    var d = await H.api('enquiries'), f = H.q().get('durum') || 'new', rows = d.enquiries.filter(function (x) { return f === 'all' || x.status === f; });
    var n = function (s) { return d.enquiries.filter(function (x) { return x.status === s; }).length; };
    main.innerHTML = H.head({ title: 'Talepler', sub: 'Sitedeki Contact, Book, Community, Partnerships formlarından ve masa talebi sayfasından gelenler. Her talep CRM’de bir kişiye bağlanır.', acts: '<button class="btn" type="button" data-copy="/tables" data-copied="Masa talebi linki kopyalandı">' + H.ico('link') + 'Masa talebi linki</button><a class="btn" href="/api/hq/enquiries.csv' + (f !== 'all' ? '?status=' + f : '') + '">' + H.ico('down') + 'CSV (' + rows.length + ')</a>' }) +
      (d.email.connected ? '' : '<div style="margin-bottom:14px">' + H.note('', 'E-posta servisi bağlı değil: yeni talepler için bildirim e-postası gelmez, yalnızca burada görünür.') + '</div>') +
      '<div class="row" style="margin-bottom:14px">' + H.seg([['new', 'Yeni', n('new')], ['open', 'İlgileniliyor', n('open')], ['done', 'Kapandı', n('done')], ['all', 'Tümü', d.enquiries.length]], f, 'data-ef') + '</div>' +
      (rows.length ? '<div class="card flat"><div class="list">' + rows.map(function (x) {
        return '<div class="item click" data-open="' + x.id + '"><span class="av">' + H.initials(x.name) + '</span><div class="main"><div class="row"><span class="t">' + e(x.name) + '</span><span class="pill plain">' + e(x.kindLabel) + '</span>' + H.pill(ST[x.status][0], ST[x.status][1]) + (x.table ? H.pill('ok', 'Masa onaylandı') : '') + '</div><span class="mute small">' + e(x.email) + (x.company ? ' · ' + e(x.company) : '') + ' · ' + H.fmtTime(x.createdAt) + '</span>' + (x.kind === 'table' ? '<span class="small"><b>' + (x.party || '?') + ' kişi</b> · ' + AREA[x.area || 'either'] + (x.eventTitle ? ' · ' + e(x.eventTitle) : '') + (x.preferredDates ? ' · ' + e(x.preferredDates) : '') + '</span>' : '') + (x.message ? '<span class="small trunc" style="max-width:640px">' + e(x.message) + '</span>' : '') + '</div><div class="acts"><button class="btn sm" type="button" data-open="' + x.id + '">Aç</button></div></div>';
      }).join('') + '</div></div>' : H.empty('mail', d.enquiries.length ? 'Bu durumda talep yok.' : 'Henüz talep yok.', d.enquiries.length ? '' : 'Sitedeki formlardan biri gönderildiğinde burada görünür.'));
    main.onclick = function (ev) {
      var b = ev.target.closest('[data-ef]'), o = ev.target.closest('[data-open]');
      if (b) H.go('view=talepler&durum=' + b.getAttribute('data-ef'));
      else if (o) open(d.enquiries.filter(function (x) { return x.id === o.getAttribute('data-open'); })[0]);
    };
    // Confirming a table: choose what is confirmed, read the exact message, then send. Nothing goes out before the last button.
    function confirmTable(x) {
      var tb = x.table, F = H.field, P = 'enquiries/' + x.id + '/confirm';
      var dr = H.drawer({ title: 'Masayı onayla · ' + x.name, body: '<form class="form" id="tf">' + F({ name: 'area', label: 'Onaylanan alan', type: 'select', value: tb ? tb.area : x.area === 'backstage' ? 'backstage' : 'standard', options: [['backstage', 'Backstage'], ['standard', 'Normal masa']] }) + F({ name: 'party', label: 'Kişi sayısı', type: 'number', value: tb ? tb.party : x.party || 1, attrs: ' min="1" max="200"' }) + '</form>' +
        (tb ? '<div style="margin-top:14px">' + H.note('warn', 'Bu talep için onay mesajı ' + H.fmtTime(tb.at) + ' tarihinde gönderildi. Yeniden gönderirseniz misafir ikinci bir mesaj alır.') + '</div>' : '') +
        '<p class="eye" style="margin:18px 0 8px">Misafire gidecek mesaj</p><div class="card" id="tp" style="white-space:pre-wrap">…</div><div id="tc" style="margin-top:14px"></div><p class="msg bad" role="alert" id="tm" style="margin-top:12px"></p>',
        foot: '<button class="btn ghost" type="button" id="tb-back">Geri</button><button class="btn pri" type="button" id="tb-send" disabled>' + (tb ? 'Yeniden gönder' : 'Onayla ve gönder') + '</button>' });
      var form = dr.querySelector('#tf'), send = dr.querySelector('#tb-send'), msg = dr.querySelector('#tm'), seq = 0;
      var line = function (label, c) { return '<div class="item"><div class="main"><span class="t">' + label + '</span><span class="mute small">' + (c.on ? e(c.to) : e(c.why)) + '</span></div><div class="acts">' + H.pill(c.on ? 'ok' : 'plain', c.on ? 'Gidecek' : 'Gitmeyecek') + '</div></div>'; };
      async function preview() {
        var n = ++seq; send.disabled = true; msg.textContent = '';
        try {
          var p = (await H.api(P, 'POST', Object.assign(H.vals(form), { dryRun: true }))).preview; if (n !== seq) return;
          dr.querySelector('#tp').textContent = p.text;
          dr.querySelector('#tc').innerHTML = '<div class="card flat"><div class="list">' + line('E-posta', p.mail) + line('WhatsApp', p.wa) + '</div></div>';
          send.disabled = !(p.mail.on || p.wa.on); if (send.disabled) msg.textContent = 'Mesajı gönderecek bir kanal yok; talebi WhatsApp ya da e-posta düğmesiyle elle yanıtlayabilirsiniz.';
        } catch (err) { if (n === seq) msg.textContent = err.message; }
      }
      form.oninput = form.onchange = preview; form.onsubmit = function (ev) { ev.preventDefault(); };
      dr.querySelector('#tb-back').onclick = function () { open(x); };
      send.onclick = async function () {
        H.busy(send, 1, 'Gönderiliyor…'); msg.textContent = '';
        try { var r = await H.api(P, 'POST', Object.assign(H.vals(form), tb ? { again: true } : {})); H.closeLayer(); H.toast('Masa onaylandı, misafire ' + sentTo(r.enquiry.table) + ' ile bildirildi', 'ok'); H.render(); }
        catch (err) { msg.textContent = err.message; H.busy(send, 0); }
      };
      preview();
    }
    function sentTo(t) { return [t.mail.status === 'sent' ? 'e-posta' : '', t.wa.status === 'sent' ? 'WhatsApp' : ''].filter(Boolean).join(' + '); }
    function open(x) {
      var tb = x.table;
      var rows = [['Tür', x.kindLabel], ['Etkinlik', x.eventTitle], ['Kişi sayısı', x.party], ['Alan', x.kind === 'table' ? AREA[x.area || 'either'] : ''], ['Masa onayı', tb ? AREA[tb.area] + ' · ' + tb.party + ' kişi · ' + H.fmtTime(tb.at) + (tb.by ? ' · ' + tb.by : '') + ' · ' + sentTo(tb) + ' ile bildirildi' : ''], ['Telefon', x.phone], ['E-posta', x.email], ['Şirket / mekân', x.company], ['Konu', x.topic || x.service], ['Şehir', x.city], ['Tarihler', x.preferredDates], ['Mekân', x.venue], ['Kapasite', x.capacity], ['Bütçe', x.budget], ['Sanatçı / yön', x.artist], ['Gönderildiği sayfa', x.path], ['Tarih', H.fmtTime(x.createdAt)], ['Duyuru izni', x.kind === 'community' ? (x.consent ? 'Verildi' : 'Yok') : '']].filter(function (r) { return r[1]; });
      var dr = H.drawer({ title: x.name, body: '<dl class="kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + e(r[1]) + '</dd>'; }).join('') + '</dl>' + (x.message ? '<p class="eye" style="margin:18px 0 8px">Mesaj</p><div class="card" style="white-space:pre-wrap">' + e(x.message) + '</div>' : '') +
        '<form class="form" id="qf" style="margin-top:18px">' + H.field({ name: 'status', label: 'Durum', type: 'select', value: x.status, options: [['new', 'Yeni'], ['open', 'İlgileniliyor'], ['done', 'Kapandı']] }) + H.field({ name: 'note', label: 'İç not', type: 'textarea', rows: 3, value: x.note, full: 1 }) + '<p class="msg bad full" role="alert"></p></form>',
        foot: (x.kind === 'table' && !H.me.readOnly ? '<button class="btn" type="button" id="tb-ok">' + (tb ? 'Onayı yeniden gönder' : 'Masayı onayla') + '</button>' : '') + (x.contactId ? '<button class="btn" type="button" data-nav="view=crm&kisi=' + x.contactId + '">Kişi kartı</button>' : '') + (x.phone ? '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + e(String(x.phone).replace(/[^0-9]/g, '').replace(/^0(?=5)/, '90')) + '">WhatsApp</a>' : '') + '<a class="btn" href="mailto:' + e(x.email) + '">E-posta yaz</a><button class="btn pri" type="submit" form="qf">Kaydet</button>' });
      var tbBtn = dr.querySelector('#tb-ok'); if (tbBtn) tbBtn.onclick = function () { confirmTable(x); };
      dr.querySelector('#qf').onsubmit = async function (ev) { ev.preventDefault(); var btn = dr.querySelector('button[type=submit]'); H.busy(btn, 1); try { await H.api('enquiries/' + x.id, 'PUT', H.vals(this)); H.closeLayer(); H.toast('Talep güncellendi', 'ok'); H.render(); } catch (err) { dr.querySelector('.msg').textContent = err.message; H.busy(btn, 0); } };
    }
  };
})();
