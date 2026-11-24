/* Booking: sanatçı anlaşmaları — teklif, onay, kontrat, depozito, bakiye; ödeme takvimi ve dosyalar */
(function () {
  var H = HQ, e = H.esc, F = H.field;
  var TONE = { offer: 'warn', confirmed: 'info', contract: 'info', deposit: 'ok', balance: 'ok', cancelled: 'archived' };
  var FILE_KIND = [['contract', 'Kontrat'], ['rider', 'Rider'], ['offer', 'Teklif'], ['invoice', 'Fatura'], ['other', 'Diğer']], PAY_KIND = [['deposit', 'Depozito'], ['balance', 'Bakiye'], ['other', 'Diğer']];
  var label = function (list, k) { var x = list.filter(function (y) { return y[0] === k; })[0]; return x ? x[1] : k; };
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function due(p) { var n = H.daysTo(p.due); return !p.due ? 'Vade yok' : (n < 0 ? '<span style="color:var(--bad)">' + H.fmtDate(p.due) + ' · ' + (-n) + ' gün gecikti</span>' : H.fmtDate(p.due) + ' · ' + H.inDays(n)); }

  H.views.booking = async function (main) {
    if (H.q().get('id')) return detail(main, H.q().get('id'));
    var d = await H.api('bookings'), st = { off: false, ev: H.q().get('etkinlik') || '' }, live = d.stages.filter(function (s) { return s.key !== 'cancelled'; });
    function draw() {
      var all = d.bookings.filter(function (b) { return !st.ev || b.eventId === st.ev; }), open = all.filter(function (b) { return b.stage !== 'cancelled'; }), off = all.filter(function (b) { return b.stage === 'cancelled'; });
      var unpaid = {}, late = 0; open.forEach(function (b) { Object.keys(b.unpaid).forEach(function (c) { unpaid[c] = (unpaid[c] || 0) + b.unpaid[c]; }); late += b.overdue; });
      var card = function (b) {
        var np = b.nextPayment;
        return '<button class="bk" type="button" data-nav="view=booking&id=' + b.id + '"><span class="t">' + e(b.artist) + '</span><span class="mute small">' + e([b.agency, b.date ? H.fmtDate(b.date) : '', b.venue].filter(Boolean).join(' · ') || 'Ajans ve tarih yok') + '</span>' +
          '<span class="row" style="margin-top:8px;gap:6px"><b class="num-t">' + (b.fee != null ? H.money(b.fee, b.currency) : '<span class="dim">Ücret yok</span>') + '</b>' + (b.files ? '<span class="pill plain">' + H.ico('file') + b.files + '</span>' : '') + (b.offerExpired ? H.pill('bad', 'Teklif süresi doldu') : '') + '</span>' +
          (np ? '<span class="small ' + (b.overdue ? '' : 'mute') + '" style="margin-top:6px' + (b.overdue ? ';color:var(--bad)' : '') + '">' + e(np.label) + ' ' + H.money(np.amount, np.currency) + (np.due ? ' · ' + H.fmtDate(np.due) : '') + (b.overdue ? ' · gecikti' : '') + '</span>' : (b.stage === 'balance' ? '<span class="small" style="margin-top:6px;color:var(--ok)">Tüm ödemeler tamam</span>' : '')) + '</button>';
      };
      main.innerHTML = H.head({ title: 'Booking', sub: 'Her sanatçı anlaşması tek kartta: teklif, onay, kontrat, depozito ve bakiye. Ödeme takvimi, rider ve kontrat dosyaları kartın içinde.', acts: '<button class="btn pri" type="button" id="b-new">' + H.ico('plus') + 'Yeni booking</button>' }) +
        (d.bookings.length ? '<div class="grid g4" style="margin-bottom:18px"><div class="stat"><span class="lbl">Açık anlaşma</span><span class="num">' + open.filter(function (b) { return b.stage !== 'balance'; }).length + '</span></div><div class="stat"><span class="lbl">Ödenecek toplam</span><span class="num sm">' + H.sums(unpaid) + '</span></div><div class="stat' + (late ? ' alert' : '') + '"><span class="lbl">Vadesi geçen ödeme</span><span class="num">' + late + '</span></div>' +
          '<div class="stat"><label class="lbl" for="b-ev">Etkinliğe göre</label><select id="b-ev"><option value="">Tüm etkinlikler</option>' + d.events.filter(function (x) { return d.bookings.some(function (b) { return b.eventId === x.id; }); }).map(function (x) { return '<option value="' + x.id + '"' + (x.id === st.ev ? ' selected' : '') + '>' + e(x.title) + '</option>'; }).join('') + '</select></div></div>' +
          '<div class="board">' + live.map(function (s) { var col = open.filter(function (b) { return b.stage === s.key; }); return '<section class="col"><h2><span class="pill ' + TONE[s.key] + '">' + e(s.label) + '</span><span class="dim num-t">' + col.length + '</span></h2>' + (col.length ? col.map(card).join('') : '<p class="none">—</p>') + '</section>'; }).join('') + '</div>' +
          (off.length ? '<div class="sec"><button class="btn ghost sm" type="button" id="b-off">' + (st.off ? 'Olmayanları gizle' : 'Olmayanlar (' + off.length + ')') + '</button>' + (st.off ? '<div class="board" style="margin-top:10px"><section class="col" style="flex:1 1 100%;max-width:340px">' + off.map(card).join('') + '</section></div>' : '') + '</div>' : '')
          : H.empty('mic', 'Henüz booking yok.', 'İlk teklifi ekleyin; onaydan bakiyeye kadar her adım ve ödeme burada izlenir.', '<button class="btn pri" type="button" id="b-new2" style="margin-top:14px">Yeni booking</button>'));
    }
    draw();
    main.onchange = function (x) { if (x.target.id === 'b-ev') { st.ev = x.target.value; draw(); } };
    main.onclick = function (x) { if (x.target.closest('#b-new,#b-new2')) create(); if (x.target.closest('#b-off')) { st.off = !st.off; draw(); } };
    if (H.q().get('yeni')) { history.replaceState(null, '', '/hq?view=booking'); create(); }

    function create() {
      var pre = d.events.filter(function (x) { return x.id === st.ev; })[0] || {};
      var dr = H.drawer({ title: 'Yeni booking', body: '<form class="form" id="bf">' + F({ name: 'artist', label: 'Sanatçı', required: 1, full: 1, value: pre.artist, max: 160 }) + F({ name: 'agency', label: 'Ajans', ph: 'WME, CAA, Wasserman…' }) + F({ name: 'agent', label: 'Ajans yetkilisi' }) +
        F({ name: 'eventId', label: 'Etkinlik', type: 'select', full: 1, value: pre.id || '', options: [['', 'Henüz etkinlik yok']].concat(d.events.map(function (x) { return [x.id, x.title + (x.date ? ' · ' + H.fmtDate(x.date) : '')]; })), hint: 'Seçerseniz tarih ve mekân etkinlikten doldurulur.' }) +
        F({ name: 'date', label: 'Gösteri tarihi', type: 'date', value: pre.date }) + F({ name: 'venue', label: 'Mekân', value: pre.venue }) + F({ name: 'fee', label: 'Ücret', type: 'number', attrs: ' min="0" step="0.01" inputmode="decimal"' }) + F({ name: 'currency', label: 'Para birimi', type: 'select', value: 'EUR', options: d.currencies.map(function (c) { return [c, c]; }) }) +
        F({ name: 'offerExpires', label: 'Teklif geçerlilik tarihi', type: 'date', full: 1, hint: 'Yanıt bu tarihe kadar gelmezse Özet ekranında hatırlatılır.' }) + '<p class="msg bad f full" role="alert"></p></form>', foot: '<button class="btn pri" type="submit" form="bf">Teklif olarak ekle</button>' });
      var form = dr.querySelector('#bf');
      form.onchange = function (x) { if (x.target.name !== 'eventId') return; var ev = d.events.filter(function (y) { return y.id === x.target.value; })[0]; if (!ev) return; ['date', 'venue', 'artist'].forEach(function (k) { var el = form.querySelector('[name=' + k + ']'); if (!el.value && ev[k]) el.value = ev[k]; }); };
      form.onsubmit = async function (x) { x.preventDefault(); var btn = dr.querySelector('button[type=submit]'), v = H.vals(form), ev = d.events.filter(function (y) { return y.id === v.eventId; })[0]; if (ev && !v.city) v.city = ev.city; H.busy(btn, 1); try { var r = await H.api('bookings', 'POST', v); H.closeLayer(); H.toast('Booking eklendi', 'ok'); H.go('view=booking&id=' + r.booking.id); } catch (err) { form.querySelector('.msg').textContent = err.message; H.busy(btn, 0); } };
    }
  };

  async function detail(main, id) {
    var d = await H.api('bookings/' + id), b = d.booking, evs = (await H.api('events')).events.filter(function (x) { return x.status !== 'archived' || x.id === b.eventId; });
    function draw() {
      var off = b.stage === 'cancelled', idx = d.stages.map(function (s) { return s.key; }).indexOf(b.stage), steps = d.stages.filter(function (s) { return s.key !== 'cancelled'; });
      main.innerHTML = H.head({ back: ['view=booking', 'Booking'], title: e(b.artist), sub: e([b.agency, b.date ? H.fmtDate(b.date) : '', b.venue, b.city].filter(Boolean).join(' · ') || 'Ajans ve tarih henüz girilmedi'),
        acts: (d.event && H.can('etkinlikler') ? '<button class="btn" type="button" data-nav="view=etkinlik&id=' + d.event.id + '">' + H.ico('cal') + e(d.event.title) + '</button>' : '') + (off ? '<button class="btn" type="button" data-stage="offer">Yeniden aç</button>' : '<button class="btn ghost" type="button" data-stage="cancelled">Olmadı</button>') }) +
        '<div class="card" style="margin-bottom:18px"><div class="steps5' + (off ? ' off' : '') + '" role="group" aria-label="Durum">' + steps.map(function (s, i) { return '<button type="button" data-stage="' + s.key + '" class="' + (off ? '' : i < idx ? 'done' : i === idx ? 'cur' : '') + '" aria-pressed="' + (!off && i === idx) + '"><i>' + (!off && i < idx ? H.ico('check') : i + 1) + '</i><span>' + e(s.label) + '</span></button>'; }).join('') + '</div>' +
        '<p class="small mute" style="margin-top:12px">' + (off ? 'Bu anlaşma <b>olmadı</b> olarak işaretli; ödemeleri Özet ekranında hatırlatılmaz.' : 'Adıma tıklayarak durumu değiştirin. Depozito ödendi işaretlenince “Depozito”ya, tüm ödemeler bitince “Bakiye”ye kendiliğinden geçer.') + (b.history && b.history.length ? ' Son değişiklik: ' + e(b.history[b.history.length - 1].by || '') + ', ' + H.fmtTime(b.history[b.history.length - 1].at) + '.' : '') + '</p>' +
        (b.offerExpired ? '<div style="margin-top:12px">' + H.note('bad', 'Teklifin geçerlilik tarihi ' + H.fmtDate(b.offerExpires) + ' tarihinde doldu. Ajansla teyit edin ya da tarihi güncelleyin.') + '</div>' : '') + '</div>' +
        '<div class="split"><div class="stack"><form class="card" id="df"><h2 class="h2" style="margin-bottom:14px">Anlaşma</h2><div class="form">' +
        F({ name: 'artist', label: 'Sanatçı', value: b.artist, required: 1, full: 1, max: 160 }) + F({ name: 'agency', label: 'Ajans', value: b.agency }) + F({ name: 'agent', label: 'Ajans yetkilisi', value: b.agent }) + F({ name: 'agentEmail', label: 'Yetkili e-postası', type: 'email', value: b.agentEmail, full: 1 }) +
        F({ name: 'eventId', label: 'Etkinlik', type: 'select', full: 1, value: b.eventId, options: [['', 'Etkinliğe bağlı değil']].concat(evs.map(function (x) { return [x.id, x.title + (x.date ? ' · ' + H.fmtDate(x.date) : '')]; })) }) +
        F({ name: 'date', label: 'Gösteri tarihi', type: 'date', value: b.date }) + F({ name: 'offerExpires', label: 'Teklif geçerlilik tarihi', type: 'date', value: b.offerExpires }) + F({ name: 'venue', label: 'Mekân', value: b.venue }) + F({ name: 'city', label: 'Şehir', value: b.city }) +
        F({ name: 'fee', label: 'Ücret', type: 'number', value: b.fee == null ? '' : b.fee, attrs: ' min="0" step="0.01" inputmode="decimal"' }) + F({ name: 'currency', label: 'Para birimi', type: 'select', value: b.currency, options: d.currencies.map(function (c) { return [c, c]; }) }) +
        F({ name: 'feeNote', label: 'Ücrete dahil olmayanlar', value: b.feeNote, full: 1, ph: 'Uçuş, otel, transfer, stopaj, ajans komisyonu…', max: 300 }) + F({ name: 'notes', label: 'Notlar', type: 'textarea', rows: 5, value: b.notes, full: 1 }) +
        '</div><div class="row between" style="margin-top:16px"><button class="btn ghost sm bad" type="button" id="b-del">Booking’i sil</button><div class="row"><p class="msg bad" role="alert"></p><button class="btn pri" type="submit">Kaydet</button></div></div></form></div>' +

        '<div class="stack"><div class="card"><div class="row between" style="margin-bottom:4px"><h2 class="h2">Ödemeler</h2><span class="small mute num-t">' + (Object.keys(b.planned).length ? 'Ödenen ' + (Object.keys(b.paid).length ? H.sums(b.paid) : '0') + ' / ' + H.sums(b.planned) : '') + '</span></div>' +
        (b.planMismatch ? '<p class="small" style="color:var(--warn);margin-bottom:8px">Ödeme satırlarının toplamı (' + H.sums(b.planned) + ') ücretle (' + H.money(b.fee, b.currency) + ') eşleşmiyor.</p>' : '') +
        (b.payments.length ? '<div class="list tight">' + b.payments.map(function (p) {
          return '<div class="item"><div class="main"><span class="t">' + e(p.label) + ' <span class="num-t">' + H.money(p.amount, p.currency) + '</span></span><span class="mute small">' + (p.paidAt ? '<span style="color:var(--ok)">Ödendi · ' + H.fmtDate(p.paidAt) + (p.paidBy ? ' · ' + e(p.paidBy) : '') + '</span>' : due(p)) + '</span></div><div class="acts">' +
            (p.paidAt ? '<button class="btn sm ghost" type="button" data-unpay="' + p.id + '">Geri al</button>' : '<button class="btn sm ok" type="button" data-pay="' + p.id + '">' + H.ico('check') + 'Ödendi</button>') + '<button class="btn sm ghost" type="button" data-pdel="' + p.id + '" aria-label="Ödeme satırını sil">Sil</button></div></div>';
        }).join('') + '</div>' : '<p class="mute small" style="margin:8px 0">Henüz ödeme satırı yok. Depozito ve bakiyeyi vadeleriyle ekleyin; vadesi yaklaşınca Özet ekranında görünür.</p>') +
        '<form id="pf" class="form addrow"><div class="f"><label for="p-kind">Tür</label><select id="p-kind" name="kind">' + PAY_KIND.map(function (k) { return '<option value="' + k[0] + '"' + ((b.payments.some(function (p) { return p.kind === 'deposit'; }) ? 'balance' : 'deposit') === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>' +
        F({ name: 'amount', id: 'p-amount', label: 'Tutar (' + b.currency + ')', type: 'number', required: 1, attrs: ' min="0" step="0.01" inputmode="decimal"' }) + F({ name: 'due', id: 'p-due', label: 'Vade', type: 'date' }) + '<div class="f" style="justify-content:flex-end"><button class="btn" type="submit">' + H.ico('plus') + 'Ekle</button></div><p class="msg bad f full" role="alert"></p></form></div>' +

        '<div class="card"><h2 class="h2" style="margin-bottom:4px">Dosyalar</h2><p class="small dim" style="margin-bottom:10px">Kontrat, rider, teklif, fatura. Yalnızca Sahip ve Yönetici rolü indirebilir; dosyaların herkese açık adresi yoktur.</p>' +
        (b.files.length ? '<div class="list tight">' + b.files.map(function (f) { return '<div class="item"><span class="chip-i">' + H.ico('file') + '</span><div class="main"><span class="t">' + e(f.name) + '</span><span class="mute small">' + label(FILE_KIND, f.kind) + ' · ' + size(f.size) + ' · ' + H.fmtTime(f.at) + (f.by ? ' · ' + e(f.by) : '') + '</span></div><div class="acts"><a class="btn sm" href="/api/hq/bookings/' + b.id + '/files/' + f.id + '">' + H.ico('down') + 'İndir</a><button class="btn sm ghost" type="button" data-fdel="' + f.id + '" aria-label="Dosyayı sil">Sil</button></div></div>'; }).join('') + '</div>' : '') +
        '<form id="ff" class="form addrow"><div class="f"><label for="f-kind">Tür</label><select id="f-kind" name="kind">' + FILE_KIND.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('') + '</select></div><div class="f" style="grid-column:span 2"><label for="f-file">Dosya</label><input id="f-file" type="file" required accept=".pdf,.doc,.docx,.xlsx,image/jpeg,image/png,image/webp"><span class="hint">PDF, Word, Excel ya da görsel · en fazla ' + size(d.maxFile) + '</span></div><div class="f" style="justify-content:flex-end"><button class="btn" type="submit">' + H.ico('up') + 'Yükle</button></div><p class="msg bad f full" role="alert"></p></form></div></div></div>';
    }
    draw();
    function took(r, msg) { b = r.booking; if (r.event !== undefined) d.event = r.event; draw(); H.toast(r.stageChanged ? 'Durum: ' + r.stageChanged : msg, 'ok'); }
    main.onsubmit = async function (x) {
      x.preventDefault(); var form = x.target, btn = form.querySelector('button[type=submit]'), msg = form.querySelector('.msg'); msg.textContent = '';
      try {
        if (form.id === 'df') { H.busy(btn, 1); took(await H.api('bookings/' + id, 'PUT', H.vals(form)), 'Kaydedildi'); }
        else if (form.id === 'pf') { H.busy(btn, 1, 'Ekleniyor…'); took(await H.api('bookings/' + id + '/payments', 'POST', H.vals(form)), 'Ödeme satırı eklendi'); }
        else if (form.id === 'ff') {
          var file = form.querySelector('#f-file').files[0]; if (!file) return;
          if (file.size > d.maxFile) { msg.textContent = 'Dosya ' + size(d.maxFile) + ' sınırından büyük (' + size(file.size) + ').'; return; }
          H.busy(btn, 1, 'Yükleniyor…'); took(await H.api('bookings/' + id + '/files', 'POST', { name: file.name, kind: form.querySelector('#f-kind').value, dataUrl: await H.readFile(file) }), 'Dosya yüklendi');
        }
      } catch (err) { msg.textContent = err.message; H.busy(btn, 0); }
    };
    main.onclick = async function (x) {
      var s = x.target.closest('[data-stage]'), pay = x.target.closest('[data-pay]'), un = x.target.closest('[data-unpay]'), pd = x.target.closest('[data-pdel]'), fd = x.target.closest('[data-fdel]');
      try {
        if (s) { var to = s.getAttribute('data-stage'); if (to === b.stage) return; if (to === 'cancelled' && !(await H.modal({ title: 'Anlaşma olmadı mı?', text: 'Booking silinmez; “Olmayanlar” altında durur ve istediğiniz zaman yeniden açılır.', ok: 'Olmadı olarak işaretle', danger: 1 }))) return; took(await H.api('bookings/' + id, 'PUT', { stage: to }), 'Durum güncellendi'); }
        else if (pay) took(await H.api('bookings/' + id + '/payments/' + pay.getAttribute('data-pay'), 'PUT', { paid: true }), 'Ödendi olarak işaretlendi');
        else if (un) took(await H.api('bookings/' + id + '/payments/' + un.getAttribute('data-unpay'), 'PUT', { paid: false }), 'Ödeme işareti geri alındı');
        else if (pd) { if (await H.modal({ title: 'Ödeme satırı silinsin mi?', text: 'Bu işlem geri alınamaz.', ok: 'Sil', danger: 1 })) took(await H.api('bookings/' + id + '/payments/' + pd.getAttribute('data-pdel'), 'DELETE', {}), 'Ödeme satırı silindi'); }
        else if (fd) { if (await H.modal({ title: 'Dosya silinsin mi?', text: 'Dosya HQ’dan kaldırılır. Son yedekte bir kopyası kalır.', ok: 'Sil', danger: 1 })) took(await H.api('bookings/' + id + '/files/' + fd.getAttribute('data-fdel'), 'DELETE', {}), 'Dosya silindi'); }
        else if (x.target.closest('#b-del')) { if (await H.modal({ title: 'Booking silinsin mi?', text: b.artist + ' anlaşması, ödeme satırları ve dosyalarıyla birlikte silinir.', ok: 'Sil', danger: 1 })) { await H.api('bookings/' + id, 'DELETE', {}); H.toast('Booking silindi', 'ok'); H.go('view=booking'); } }
      } catch (err) { H.toast(err.message, 'bad'); }
    };
  }
})();
