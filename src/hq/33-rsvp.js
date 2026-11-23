/* Davetler & RSVP (etkinlik seçerek) ve Check-in ekranı */
(function () {
  var H = HQ, e = H.esc;
  function picker(evs, cur, view) { return '<label class="sr" for="evp">Etkinlik</label><select id="evp" style="width:auto;max-width:min(340px,100%)">' + evs.map(function (x) { return '<option value="' + x.id + '"' + (x.id === cur ? ' selected' : '') + '>' + e(x.title) + ' · ' + H.fmtDate(x.date) + '</option>'; }).join('') + '</select>'; }
  H.views.rsvp = async function (main) {
    var d = await H.api('events'), evs = d.events.filter(function (x) { return x.status !== 'archived'; }), want = H.q().get('event'), f = H.q().get('durum');
    if (!evs.length) { main.innerHTML = H.head({ title: 'Davetler & RSVP' }) + H.empty('mail', 'Önce bir etkinlik oluşturun.', 'Davet linki ve başvurular etkinliğe bağlıdır.', '<button class="btn pri" type="button" data-nav="view=etkinlikler&yeni=1">Yeni etkinlik</button>'); return; }
    var ev = evs.filter(function (x) { return x.id === want; })[0] || evs.filter(function (x) { return x.counts.pending; })[0] || evs.filter(function (x) { return x.status === 'published'; })[0] || evs[0];
    main.innerHTML = H.head({ title: 'Davetler & RSVP', sub: 'Başvuruları onaylayın, bekleme listesine alın, giriş kartlarını paylaşın.', acts: picker(evs, ev.id, 'rsvp') + '<button class="btn" type="button" data-nav="view=etkinlik&id=' + ev.id + '&tab=davet">Davet ayarları</button>' }) + '<div id="apps"></div>';
    main.querySelector('#evp').onchange = function () { H.go('view=rsvp&event=' + this.value); };
    await H.parts.apps(main.querySelector('#apps'), ev.id, { f: f || (ev.counts.pending ? 'pending' : 'all') });
  };
  H.views.kapi = async function (main) {
    var d = await H.api('events'), evs = d.events.filter(function (x) { return x.status === 'published'; }), td = H.today();
    if (!evs.length) { main.innerHTML = H.head({ title: 'Check-in' }) + H.empty('qr', 'Yayında etkinlik yok.', 'Check-in ekranı yayındaki etkinlikler için açılır.'); return; }
    var up = evs.filter(function (x) { return !x.date || (x.endDate || x.date) >= td; }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var ev = evs.filter(function (x) { return x.id === H.q().get('event'); })[0] || up[0] || evs[0];
    main.innerHTML = H.head({ title: 'Check-in', sub: e(ev.title) + ' · ' + H.fmtDate(ev.date), acts: picker(evs, ev.id, 'kapi') }) + '<div id="door" style="max-width:720px"></div>';
    main.querySelector('#evp').onchange = function () { H.go('view=kapi&event=' + this.value); };
    return H.parts.door(main.querySelector('#door'), ev.id);
  };
  H.views.gorevler = async function (main) {
    main.innerHTML = H.head({ title: 'Görevler', sub: 'Etkinliklere bağlı işler: sorumlu, son tarih, öncelik ve durum.' }) + '<div id="tk"></div>';
    await H.parts.tasks(main.querySelector('#tk'), { f: H.q().get('durum') || 'open' });
  };
})();
