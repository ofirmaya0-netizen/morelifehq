/* CRM */
(function () {
  var H = HQ, e = H.esc;
  var FIELDS = [['name', 'Ad soyad', 'text'], ['email', 'E-posta', 'email'], ['phone', 'Telefon', 'tel'], ['instagram', 'Instagram', 'text'], ['company', 'Şirket / mekân', 'text'], ['source', 'Kaynak', 'text'], ['tags', 'Etiketler', 'text']];
  var GUESS = { name: ['name', 'isim', 'ad', 'ad soyad', 'full name', 'adsoyad', 'ad-soyad'], email: ['email', 'e-posta', 'eposta', 'e-mail', 'mail'], phone: ['phone', 'telefon', 'tel', 'gsm', 'cep'], instagram: ['instagram', 'ig'], company: ['company', 'şirket', 'sirket', 'mekan', 'mekân', 'firma'], source: ['source', 'kaynak'], tags: ['tags', 'etiket', 'etiketler'], notes: ['notes', 'not', 'notlar'] };
  H.crmTabs = function (cur) { return '<div class="tabs" role="tablist">' + [['kisiler', 'Kişiler', 'view=crm'], ['kitleler', 'Kitleler', 'view=crm&tab=kitleler']].map(function (t) { return '<button type="button" role="tab" aria-selected="' + (t[0] === cur) + '" data-nav="' + t[2] + '">' + t[1] + '</button>'; }).join('') + '</div>'; };
  function parseCsv(text) {
  var rows = [], row = [], cur = '', inq = false, sep = (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length) ? ';' : ',';
  text = text.replace(/^\uFEFF/, '');
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inq) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inq = false; else cur += c; }
    else if (c === '"') inq = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(function (x) { return x.trim(); })) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(function (x) { return x.trim(); })) rows.push(row);
  return rows;
}
  H.views.crm = async function (main) {
    if (H.q().get('tab') === 'kitleler') return H.audiences(main);
    // The list comes one page at a time; search and the tag filter run on the server, so the screen stays quick however large the CRM gets.
    var PAGE = 100, st = { q: H.q().get('ara') || '', tag: H.q().get('etiket') || '' }, d = { contacts: [], matched: 0, total: 0, next: null, tags: [] }, seq = 0;
    async function load(more, focus) {
      var n = ++seq, r = await H.api('contacts?limit=' + PAGE + '&offset=' + (more ? d.next : 0) + (st.q.trim() ? '&q=' + encodeURIComponent(st.q.trim()) : '') + (st.tag ? '&tag=' + encodeURIComponent(st.tag) : ''));
      if (n !== seq) return; // a newer search has started
      r.contacts = more ? d.contacts.concat(r.contacts) : r.contacts; d = r; draw(focus);
    }
    function draw(focus) {
      var r = d.contacts, qs = (st.q.trim() ? '&q=' + encodeURIComponent(st.q.trim()) : '') + (st.tag ? '&tag=' + encodeURIComponent(st.tag) : '');
      main.innerHTML = H.head({ title: 'CRM', sub: 'Kişiler, etiketler ve etkinlik geçmişi. Başvuru yapan herkes tek bir kişi kartında toplanır.', acts: '<button class="btn pri" type="button" id="c-new">' + H.ico('plus') + 'Kişi ekle</button><label class="btn" for="csv-file">CSV içe aktar</label><input class="sr" id="csv-file" type="file" accept=".csv,text/csv"><a class="btn" href="/api/hq/contacts.csv?' + qs.slice(1) + '">' + H.ico('down') + (qs ? 'Filtreyi dışa aktar (' + d.matched + ')' : 'CSV dışa aktar') + '</a>' }) +
        H.crmTabs('kisiler') +
        '<div class="row" style="margin-bottom:14px"><label class="search"><span class="sr">Ara</span>' + H.ico('search') + '<input id="c-q" type="search" placeholder="İsim, e-posta, telefon, etiket…" value="' + e(st.q) + '"></label><label class="sr" for="c-tag">Etiket</label><select id="c-tag" style="width:auto;min-width:160px"><option value="">Tüm etiketler</option>' + d.tags.map(function (x) { return '<option value="' + e(x.name) + '"' + (x.name === st.tag ? ' selected' : '') + '>' + e(x.name) + ' (' + x.count + ')</option>'; }).join('') + '</select><span class="small dim">' + d.matched + ' / ' + d.total + ' kişi</span></div>' +
        (r.length ? '<div class="card flat"><div class="scroll"><table><thead><tr><th>Kişi</th><th>İletişim</th><th>Etiketler</th><th>Kaynak</th><th></th></tr></thead><tbody>' + r.map(function (c) {
          return '<tr class="click" data-open="' + c.id + '" style="cursor:pointer"><td><div class="row" style="flex-wrap:nowrap"><span class="av">' + H.initials(c.name) + '</span><b>' + e(c.name) + '</b></div></td><td class="small mute">' + [c.email, c.phone].filter(Boolean).map(e).join('<br>') + '</td><td>' + (c.tags || []).map(function (x) { return '<span class="pill plain">' + e(x) + '</span>'; }).join(' ') + '</td><td class="small mute">' + e(c.source || '—') + '</td><td class="r"><button class="btn sm" type="button" data-open="' + c.id + '">Aç</button></td></tr>';
        }).join('') + '</tbody></table></div></div>' + (d.next != null ? '<div class="row" style="justify-content:center;margin-top:14px"><button class="btn" type="button" id="c-more">Sonraki ' + Math.min(PAGE, d.matched - r.length) + ' kişiyi göster</button><span class="small dim">' + r.length + ' / ' + d.matched + '</span></div>' : '') : H.empty('users', d.total ? 'Kişi bulunamadı.' : 'Henüz kişi yok.', d.total ? 'Aramayı ya da etiket filtresini değiştirin.' : 'Kişileri elle ekleyin, CSV’den aktarın ya da başvurularla kendiliğinden oluşsun.'));
      var qi = main.querySelector('#c-q'); if (focus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    }
    await load();
    var timer, oops = function (err) { H.toast(err.message, 'bad'); };
    main.oninput = function (ev) { if (ev.target.id === 'c-q') { st.q = ev.target.value; clearTimeout(timer); timer = setTimeout(function () { load(false, 1).catch(oops); }, 250); } };
    main.onchange = function (ev) { if (ev.target.id === 'c-tag') { st.tag = ev.target.value; load().catch(oops); } if (ev.target.id === 'csv-file') importCsv(ev.target); };
    main.onclick = function (ev) { var more = ev.target.closest('#c-more'); if (more) { H.busy(more, 1, 'Yükleniyor…'); load(true).catch(oops); return; } var o = ev.target.closest('[data-open]'); if (o) card(o.getAttribute('data-open')); if (ev.target.closest('#c-new')) card(null); };
    if (H.q().get('kisi')) { var k = H.q().get('kisi'); history.replaceState(null, '', '/hq?view=crm'); card(k); }

    async function card(id) {
      var det = id ? await H.api('contacts/' + id).catch(function (err) { H.toast(err.message, 'bad'); return null; }) : { contact: {}, history: [] }; if (!det) return;
      var c = det.contact, F = H.field;
      var dr = H.drawer({ title: id ? c.name : 'Yeni kişi', body: '<form class="form" id="cf">' + FIELDS.map(function (f) { return F({ name: f[0], label: f[1], type: f[2], value: f[0] === 'tags' ? (c.tags || []).join(', ') : c[f[0]], hint: f[0] === 'tags' ? 'Virgülle ayırın' : '', full: f[0] === 'name' }); }).join('') + F({ name: 'notes', label: 'Notlar', type: 'textarea', rows: 4, value: c.notes, full: 1 }) + '<p class="msg bad full" id="cf-msg" role="alert"></p></form>' +
        (id ? '<h3 class="eye" style="margin:24px 0 10px">Etkinlik geçmişi</h3>' + (det.history.length ? (function () { var hs = det.history, ap = hs.filter(function (h) { return h.status === 'approved'; }), came = hs.filter(function (h) { return h.checkedInAt; }).length, miss = ap.filter(function (h) { return h.past && !h.checkedInAt; }).length;
          return '<div class="row" style="gap:8px;margin-bottom:12px">' + H.pill('archived', hs.length + ' başvuru') + H.pill('ok', ap.length + ' onay') + H.pill('ok', came + ' katılım') + (miss ? H.pill('bad', miss + ' kez gelmedi') : '') + '</div>'; })() : '') + (det.history.length ? '<div class="card flat"><div class="list">' + det.history.map(function (h) { return '<div class="item"><div class="main"><span class="t">' + e(h.event) + '</span><span class="mute small">' + H.fmtDate(h.date) + ' · ' + h.guests + ' kişi · başvuru ' + H.fmtTime(h.createdAt) + (h.campaign ? ' · ' + e(h.campaign) : '') + '</span>' + (h.checkedInAt ? '<span class="small" style="color:var(--ok)">Giriş: ' + H.fmtTime(h.checkedInAt) + '</span>' : '') + '</div>' + H.pill(h.checkedInAt ? 'checkedin' : h.status) + '</div>'; }).join('') + '</div></div>' : '<p class="mute small">Henüz etkinlik geçmişi yok.</p>') : ''),
        foot: '<button class="btn ghost" type="button" id="cf-x">Vazgeç</button><button class="btn pri" type="submit" form="cf">Kaydet</button>' });
      dr.querySelector('#cf-x').onclick = H.closeLayer;
      dr.querySelector('#cf').onsubmit = async function (ev) {
        ev.preventDefault(); var btn = dr.querySelector('button[type=submit]'); H.busy(btn, 1);
        try { await H.api(id ? 'contacts/' + id : 'contacts', id ? 'PUT' : 'POST', H.vals(this)); H.closeLayer(); H.toast('Kişi kaydedildi', 'ok'); H.render(); } catch (err) { dr.querySelector('#cf-msg').textContent = err.message; H.busy(btn, 0); }
      };
    }
    async function importCsv(input) {
      var file = input.files[0]; input.value = ''; if (!file) return;
      var table; try { table = parseCsv(await file.text()); } catch (x) { H.toast('Dosya okunamadı.', 'bad'); return; }
      if (table.length < 2) { H.toast('CSV’de başlık satırı ve en az bir kayıt olmalı.', 'bad'); return; }
      var head = table.shift(), low = head.map(function (h) { return h.trim().toLocaleLowerCase('tr'); }), keys = FIELDS.map(function (f) { return f; }).concat([['notes', 'Notlar']]);
      var opts = [['', '— Kullanma —']].concat(head.map(function (h, i) { return [String(i), h || 'Sütun ' + (i + 1)]; }));
      var dr = H.drawer({ title: 'CSV içe aktar · ' + file.name, body: '<p class="mute" style="margin-bottom:14px">' + table.length + ' satır bulundu. Önce sütunları eşleştirin.</p><form class="form" id="mf">' + keys.map(function (k) { var g = low.findIndex(function (h) { return GUESS[k[0]].indexOf(h) > -1; }); return H.field({ name: k[0], label: k[1], type: 'select', value: g > -1 ? String(g) : '', options: opts }); }).join('') + '</form><div id="imp" style="margin-top:18px"></div>', foot: '<button class="btn ghost" type="button" id="mf-x">Vazgeç</button><button class="btn" type="button" id="mf-pv">Önizle</button><button class="btn pri" type="button" id="imp-go" disabled>İçe aktar</button>' });
      var data = [], box = dr.querySelector('#imp'), goBtn = dr.querySelector('#imp-go');
      dr.querySelector('#mf-x').onclick = H.closeLayer;
      dr.querySelector('#mf').onchange = function () { goBtn.disabled = true; box.innerHTML = ''; };
      dr.querySelector('#mf-pv').onclick = async function () {
        var map = H.vals(dr.querySelector('#mf'));
        if (map.name === '' && map.email === '') { box.innerHTML = H.note('bad', '“Ad soyad” ya da “E-posta” için bir sütun seçin.'); return; }
        data = table.map(function (r) { var o = {}; Object.keys(map).forEach(function (k) { if (map[k] !== '') o[k] = r[+map[k]] || ''; }); return o; });
        var pv = this; H.busy(pv, 1, 'Kontrol ediliyor…');
        try {
          var p = await sendAll(false, function (done) { pv.textContent = 'Kontrol ediliyor… ' + done + ' / ' + data.length; }), L = { 'new': ['ok', 'Yeni'], match: ['info', 'Eşleşti'], conflict: ['bad', 'Çakışma'], 'duplicate-in-file': ['warn', 'Dosyada mükerrer'], invalid: ['bad', 'Hatalı'] }, t = p.totals;
          box.innerHTML = '<div class="grid g4" style="margin-bottom:12px">' + [['Yeni kayıt', t.new], ['Eşleşen', t.match], ['Çakışan', t.conflict], ['Mükerrer', t.duplicateInFile], ['Hatalı', t.invalid]].map(function (x) { return '<div class="card" style="padding:12px"><p class="eye">' + x[0] + '</p><p style="font-size:24px;font-weight:600">' + x[1] + '</p></div>'; }).join('') + '</div>' +
            '<p class="small mute" style="margin-bottom:10px">Eşleşen kişiler yeniden oluşturulmaz; yalnızca yeni etiketleri eklenir. Çakışan satırlar (e-posta bir kişiyle, telefon başka bir kişiyle eşleşiyor) otomatik birleştirilmez ve atlanır.</p>' +
            '<div class="card flat"><div class="scroll" style="max-height:340px;overflow-y:auto"><table><thead><tr><th>Satır</th><th>Ad</th><th>E-posta</th><th>Telefon</th><th>Sonuç</th></tr></thead><tbody>' + p.rows.map(function (o) { return '<tr><td class="num-t">' + o.line + '</td><td>' + e(o.row.name) + '</td><td>' + e(o.row.email) + '</td><td>' + e(o.row.phone) + '</td><td>' + H.pill(L[o.status][0], L[o.status][1]) + (o.match ? ' <span class="small mute">' + e(o.match.name) + '</span>' : '') + (o.reason ? '<br><span class="small" style="color:var(--bad)">' + e(o.reason) + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
          goBtn.disabled = !(t.new + t.match); goBtn.textContent = t.new + ' yeni kişiyi içe aktar';
        } catch (err) { box.innerHTML = H.note('bad', e(err.message)); }
        H.busy(this, 0);
      };
      // Big files go up in windows of 250 rows so no single request runs long; a failed window is retried once.
      async function sendAll(commit, tick) {
        var acc = { totals: { 'new': 0, match: 0, conflict: 0, duplicateInFile: 0, invalid: 0 }, rows: [], created: 0, updated: 0 }, from = 0;
        while (from !== null) {
          var req = { rows: data, commit: commit, from: from, size: 250 }, r;
          try { r = await H.api('contacts/import', 'POST', req); } catch (x) { r = await H.api('contacts/import', 'POST', req); }
          Object.keys(acc.totals).forEach(function (k) { acc.totals[k] += r.totals[k]; });
          if (r.rows && acc.rows.length < 500) acc.rows = acc.rows.concat(r.rows).slice(0, 500);
          acc.created += r.created || 0; acc.updated += r.updated || 0;
          from = r.next; tick(from === null ? data.length : from);
        }
        return acc;
      }
      goBtn.onclick = async function () {
        H.busy(goBtn, 1, 'Aktarılıyor…');
        try { var r = await sendAll(true, function (done) { goBtn.textContent = 'Aktarılıyor… ' + done + ' / ' + data.length; }); H.closeLayer(); H.toast(r.created + ' kişi eklendi, ' + r.updated + ' kişi güncellendi', 'ok'); H.render(); }
        catch (err) { H.busy(goBtn, 0); box.insertAdjacentHTML('afterbegin', H.note('bad', e(err.message) + ' Aktarılan satırlar kaydedildi; “İçe aktar”a yeniden basarak kaldığı yerden devam edebilirsiniz, kimse iki kez eklenmez.')); }
      };
    }
  };
})();
