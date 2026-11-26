/* Mekân portalı: mekâna verilen tek link. O mekândaki yayındaki etkinliklerde kim geliyor, kimin masası var. */
(function () {
  var H = HQ, e = H.esc;
  // The event's tables as the venue sees them: add one by hand, change or remove a hand-added one, and one short note per
  // table (birthday, bottles ordered ahead, VIP). A note is saved when its field is left. edit: key of the table in the form.
  H.parts.venueTables = async function (eventId, title, edit) {
    var d; try { d = await H.api('venue-links/notes?event=' + eventId); } catch (err) { H.toast(err.message, 'bad'); return; }
    var can = H.me.role !== 'viewer', AREA = { backstage: 'Backstage', standard: 'Normal masa' }, F = H.field, again = function (k) { H.parts.venueTables(eventId, title, k); };
    var cur = edit ? d.tables.filter(function (t) { return t.key === edit; })[0] : null, v = cur || { people: 4, area: 'standard' };
    var dr = H.drawer({ title: 'Masalar ve notlar' + (title ? ' · ' + title : ''), body:
      (can ? '<form id="vt-add" class="card" style="margin-bottom:18px"><h3 class="h2" style="margin-bottom:4px">' + (cur ? 'Masayı düzenle' : 'Masa ekle') + '</h3><p class="small mute" style="margin-bottom:12px">' + (cur ? e(cur.name) + ' adına elle eklenen masa. Değişiklik mekânın portalında hemen görünür.' : 'Bilet ya da masa talebi olmadan ayırdığınız masalar için (telefonla satılan, misafiriniz olan). Mekânın portalında diğer masalarla birlikte, isimle ayrılmış olarak görünür.') + '</p><div class="form">' +
        F({ name: 'name', label: 'Kimin adına', value: v.name, required: 1, max: 120, full: 1 }) + F({ name: 'people', label: 'Kişi sayısı', type: 'number', value: v.people, attrs: ' min="1" max="200" inputmode="numeric"' }) + F({ name: 'area', label: 'Alan', type: 'select', value: v.area, options: [['standard', 'Normal masa'], ['backstage', 'Backstage']] }) +
        F({ name: 'label', label: 'Masa no', value: v.label, max: 20, ph: 'B4', hint: 'İsteğe bağlı' }) + F({ name: 'note', label: 'Mekân için not', value: v.note, max: 200, ph: 'Doğum günü, şişe ön siparişi, VIP', full: 1 }) + '</div><div class="row between" style="margin-top:12px"><p class="msg bad" role="alert"></p><div class="row">' + (cur ? '<button class="btn" type="button" id="vt-cancel">Vazgeç</button>' : '') + '<button class="btn pri" type="submit">' + (cur ? 'Kaydet' : 'Masa ekle') + '</button></div></div></form>' : '') +
      '<p class="small mute" style="margin-bottom:14px">Not, mekânın portalda masanın altında gördüğü kısa bilgidir; misafire gitmez.</p>' +
      (d.tables.length ? '<div class="stack">' + d.tables.map(function (t, i) { return '<div class="f"><div class="row between"><label for="vn-' + i + '"><b>' + e(t.name) + '</b> · ' + e([t.label, AREA[t.area] || t.area, t.people + ' kişi'].filter(Boolean).join(' · ')) + (t.manual ? ' · <span class="dim">elle eklendi</span>' : '') + '</label>' + (t.manual && can ? '<span class="row" style="gap:4px"><button class="btn sm ghost" type="button" data-edit="' + e(t.key) + '">Düzenle</button><button class="btn sm ghost" type="button" data-del="' + e(t.key) + '" data-name="' + e(t.name) + '">Sil</button></span>' : '') + '</div><input id="vn-' + i + '" data-key="' + e(t.key) + '" value="' + e(t.note || '') + '" maxlength="200" placeholder="Not yok"' + (can ? '' : ' disabled') + '>' + (can ? '<div class="row" style="margin-top:6px"><button class="btn sm" type="button" data-save="' + i + '">Notu kaydet</button><span class="hint" aria-live="polite"></span></div>' : '') + '</div>'; }).join('') + '</div>' : H.empty('qr', 'Henüz masa yok', 'Satılan, onaylanan ya da elle eklediğiniz masalar burada listelenir.')) });
    dr.querySelectorAll('input[data-key]').forEach(function (inp) {
      var last = inp.value;
      var sb = inp.parentNode.querySelector('[data-save]'); if (!sb) return;
      sb.onclick = async function () { var hint = inp.parentNode.querySelector('.hint'), val = inp.value.trim(); if (val === last) { hint.textContent = 'Değişiklik yok'; return; } try { await H.api('venue-links/notes', 'PUT', { event: eventId, key: inp.getAttribute('data-key'), note: val }); last = val; hint.textContent = val ? 'Kaydedildi' : 'Not silindi'; } catch (err) { hint.textContent = err.message; } };
    });
    var add = dr.querySelector('#vt-add'), cancel = dr.querySelector('#vt-cancel'); if (cancel) cancel.onclick = function () { again(); };
    if (add) add.onsubmit = async function (x) { x.preventDefault(); var btn = add.querySelector('button[type=submit]'), msg = add.querySelector('.msg'); msg.textContent = ''; H.busy(btn, 1); try { await H.api('venue-links/notes', cur ? 'PUT' : 'POST', Object.assign({ event: eventId }, cur ? { key: cur.key } : {}, H.vals(add))); H.toast(cur ? 'Masa güncellendi' : 'Masa eklendi', 'ok'); again(); } catch (err) { msg.textContent = err.message; H.busy(btn, 0); } };
    dr.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { again(b.getAttribute('data-edit')); }; });
    dr.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = async function () { if (!(await H.modal({ title: 'Masa silinsin mi?', text: b.getAttribute('data-name') + ' adına elle eklenen masa mekânın portalından da kalkar.', ok: 'Sil', danger: 1 }))) { again(); return; } try { await H.api('venue-links/notes', 'DELETE', { event: eventId, key: b.getAttribute('data-del') }); H.toast('Masa silindi', 'ok'); } catch (err) { H.toast(err.message, 'bad'); } again(); }; });
  };
  // One list of an event's tables, wherever it is shown (the Masalar tab, the Masalar filter in Başvurular).
  H.parts.tableRows = function (tables, q) {
    var AREA = { backstage: 'Backstage', standard: 'Normal masa' }, tq = (q || '').trim().toLocaleLowerCase('tr'), trs = tables.filter(function (x) { return !tq || (x.name + ' ' + (x.label || '') + ' ' + (x.note || '')).toLocaleLowerCase('tr').indexOf(tq) > -1; });
    var ppl = tables.reduce(function (n, x) { return n + x.people; }, 0), can = H.me.role !== 'viewer';
    return '<div class="row between" style="margin-bottom:10px"><span class="small mute"><b style="color:var(--ink)">' + tables.length + '</b> masa · <b style="color:var(--ink)">' + ppl + '</b> kişi</span><button class="btn sm' + (can ? ' pri' : '') + '" type="button" id="ap-tables-edit">' + H.ico('plus') + (can ? 'Masa ekle / düzenle' : 'Masalar ve notlar') + '</button></div>' +
      (trs.length ? '<div class="card flat"><div class="list">' + trs.map(function (x) {
        var src = x.manual ? 'Elle eklendi' : x.request ? 'Onaylı masa talebi' : 'Satın alındı';
        return '<div class="item"><span class="av' + (x.in ? ' in' : '') + '">' + H.initials(x.name) + '</span><div class="main"><div class="row"><span class="t">' + e(x.name) + '</span><span class="pill plain">' + x.people + ' kişi</span>' + (x.label ? '<span class="pill plain">' + e(x.label) + '</span>' : '') + (x.in != null ? H.pill(x.in ? 'checkedin' : 'approved', x.in >= x.people ? 'Hepsi içeride' : x.in + ' / ' + x.people + ' içeride') : '') + '</div>' +
          '<span class="mute small">' + e(AREA[x.area] || x.area) + ' · ' + src + (x.due ? ' · <b style="color:var(--warn)">Mekânda ' + H.money(x.due, x.currency) + ' alınacak</b>' : '') + '</span>' + (x.note ? '<span class="small">Mekâna not: “' + e(x.note) + '”</span>' : '') + '</div></div>';
      }).join('') + '</div></div>' : H.empty('qr', tq ? 'Eşleşen masa yok' : 'Henüz masa yok', tq ? '' : 'Satılan, onaylanan ya da elle eklediğiniz masalar burada listelenir.'));
  };
  // Etkinlik · Masalar: every table of the event in one place, with the table requests still waiting and the way to the plan.
  H.parts.tables = async function (root, eventId, title) {
    var q = '';
    async function load() {
      var d, pend = [];
      try { d = await H.api('venue-links/notes?event=' + eventId); } catch (err) { root.innerHTML = H.note('bad', e(err.message)); return; }
      try { pend = (await H.api('enquiries')).enquiries.filter(function (x) { return x.kind === 'table' && x.eventId === eventId && !x.table && x.status !== 'archived'; }); } catch (err) {}
      root.innerHTML = '<div id="tb-plan"></div>' + (pend.length ? '<div class="card" style="margin-bottom:16px"><div class="row between" style="margin-bottom:8px"><h2 class="h2">Onay bekleyen masa talepleri<span class="pill warn" style="margin-left:8px">' + pend.length + '</span></h2><button class="btn sm" type="button" data-nav="view=talepler">Talepler’de aç</button></div>' + pend.map(function (x) { return '<div class="row" style="gap:8px;padding:6px 0"><b>' + e(x.name) + '</b><span class="mute small">' + (x.party || '?') + ' kişi · ' + (x.area === 'backstage' ? 'Backstage' : x.area === 'standard' ? 'Normal masa' : 'Fark etmez') + ' · ' + H.fmtTime(x.createdAt) + '</span></div>'; }).join('') + '<p class="small dim" style="margin-top:6px">Talebi Talepler’de onayladığınızda misafire onay mesajı gider ve masa aşağıdaki listeye eklenir.</p></div>' : '') +
        '<div class="row" style="margin-bottom:14px"><label class="search" style="max-width:none;flex:1"><span class="sr">Ara</span>' + H.ico('search') + '<input type="search" id="tb-q" placeholder="İsim, masa no veya not" value="' + e(q) + '"></label><button class="btn sm" type="button" data-nav="view=etkinlik&id=' + eventId + '&tab=biletler">Masa planı ve satış (Biletler)</button></div><div id="tb-list"></div>';
      var list = root.querySelector('#tb-list'), draw = function () { list.innerHTML = H.parts.tableRows(d.tables, q); list.querySelector('#ap-tables-edit').onclick = function () { H.parts.venueTables(eventId, title); var t = setInterval(function () { if (document.querySelector('.drawer')) return; clearInterval(t); if (document.body.contains(root)) load(); }, 600); }; };
      root.querySelector('#tb-q').oninput = function () { q = this.value; draw(); };
      draw();
      H.parts.floorPlan(root.querySelector('#tb-plan'), eventId, title, async function () { try { d = await H.api('venue-links/notes?event=' + eventId); draw(); } catch (err) {} });
    }
    await load();
  };
  H.parts.venueLink = async function (box, venue, eventId) {
    var head = '<h2 class="h2" style="margin-bottom:6px">Mekân portalı</h2>';
    if (!venue) { box.innerHTML = head + '<p class="small mute">Bu etkinliğin mekânı girilmemiş. “Genel Bilgiler”e mekânı yazıp yayınlayın; link mekân adına göre açılır.</p>'; return; }
    async function draw() {
      var d;
      try { d = await H.api('venue-links?venue=' + encodeURIComponent(venue)); } catch (err) { box.innerHTML = head + '<p class="small mute">' + e(err.message) + '</p>'; return; }
      var l = d.link, can = H.can('etkinlikler') && H.me.role !== 'viewer';
      box.innerHTML = head + '<p class="small mute" style="margin-bottom:10px"><b>' + e(venue) + '</b> için tek link: mekân kendi etkinliklerinde (şu an ' + d.events + ') kimin geldiğini ve kimin masası olduğunu görür.</p>' +
        (l ? '<div class="row" style="gap:6px;margin-bottom:10px">' + H.pill(l.scan ? 'ok' : 'archived', 'QR okuma ' + (l.scan ? 'açık' : 'kapalı')) + H.pill(l.invite ? 'ok' : 'archived', 'Davet linki ' + (l.invite ? 'açık' : 'kapalı')) + '</div>' : '') +
        '<details class="small mute" style="margin-bottom:12px"><summary style="cursor:pointer">Mekân neyi görür, neyi görmez?</summary><p style="margin-top:8px">Görür: isim, kişi sayısı, masa, giriş durumu ve sizin “Masalar ve notlar”a yazdığınız notlar. Görmez: e-posta, telefon, misafirin yazdığı not, ödenen tutarlar. Etkinlik, tarihinden iki gün sonra listeden düşer; kapasite girilmişse içerideki sayı %90’a ulaşınca mekân da uyarılır.</p><p style="margin-top:8px"><b>QR okuma</b> açıkken mekânın kapı ekibi portaldaki “QR okuyucu” ile yalnızca o etkinliğin giriş kartlarını ve biletlerini okutur (etkinliğin kapı linkiyle aynı ekran).</p><p style="margin-top:8px"><b>Davet linki</b> açıkken mekân her etkinlik için kendi davet linkini alır; bu linkten gelen başvurular “Mekân daveti” etiketiyle görünür ve yine sizin onayınızı bekler. Kapatırsanız daha önce paylaştığı linkler de açılmaz.</p></details>' +
        (l ? '<p class="url" style="padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid var(--line)">' + e(location.origin + l.url) + '</p><div class="row" style="margin-top:12px"><button class="btn pri" type="button" data-copy="' + e(l.url) + '" data-copied="Mekân linki kopyalandı">' + H.ico('copy') + 'Kopyala</button><a class="btn" href="' + e(l.url) + '" target="_blank" rel="noopener">' + H.ico('ext') + 'Aç</a>' + (can ? '<button class="btn" type="button" data-vl="' + (l.scan ? 'scanoff' : 'scanon') + '">' + (l.scan ? 'QR okumayı kapat' : 'QR okumayı aç') + '</button><button class="btn" type="button" data-vl="' + (l.invite ? 'invoff' : 'invon') + '">' + (l.invite ? 'Davet linkini kapat' : 'Davet linkini aç') + '</button><button class="btn" type="button" data-vl="renew">Yenile</button><button class="btn" type="button" data-vl="close">Kapat</button>' : '') + '</div>'
          : can ? '<button class="btn pri" type="button" data-vl="new">Mekân linki oluştur</button>' : '<p class="small dim">Henüz link oluşturulmadı.</p>') +
        (eventId ? '<div class="row" style="margin-top:12px"><button class="btn" type="button" data-vl="notes">Masalar ve notlar</button></div>' : '');
    }
    box.onclick = async function (x) {
      var b = x.target.closest('[data-vl]'); if (!b) return; var a = b.getAttribute('data-vl');
      if (a === 'notes') { H.parts.venueTables(eventId); return; }
      if (a === 'invon' || a === 'invoff') { try { await H.api('venue-links', 'POST', { venue: venue, invite: a === 'invon' }); H.toast(a === 'invon' ? 'Mekânın davet linki açıldı' : 'Mekânın davet linki kapatıldı', 'ok'); await draw(); } catch (err) { H.toast(err.message, 'bad'); } return; }
      if (a === 'scanon' || a === 'scanoff') { try { await H.api('venue-links', 'POST', { venue: venue, scan: a === 'scanon' }); H.toast(a === 'scanon' ? 'QR okuma açıldı' : 'QR okuma kapatıldı', 'ok'); await draw(); } catch (err) { H.toast(err.message, 'bad'); } return; }
      if (a !== 'new' && !(await H.modal({ title: a === 'close' ? 'Mekân linki kapatılsın mı?' : 'Mekân linki yenilensin mi?', text: 'Mevcut link hemen çalışmaz olur; mekâna yeniden göndermeniz gerekir.', ok: a === 'close' ? 'Kapat' : 'Yenile', danger: 1 }))) return;
      try { await H.api('venue-links', 'POST', { venue: venue, close: a === 'close' }); H.toast(a === 'close' ? 'Mekân linki kapatıldı' : 'Mekân linki hazır', 'ok'); await draw(); } catch (err) { H.toast(err.message, 'bad'); }
    };
    await draw();
  };
})();
