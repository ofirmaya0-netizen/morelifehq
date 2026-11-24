/* Ekip & kayıt: kimler girebilir, hangi rolle; ve kim neyi yaptı */
(function () {
  var H = HQ, e = H.esc, F = H.field;
  function tabs(cur) { return H.me.role === 'owner' ? '<div class="tabs" role="tablist">' + [['uyeler', 'Ekip'], ['kayit', 'İşlem kaydı']].map(function (t) { return '<button type="button" role="tab" aria-selected="' + (t[0] === cur) + '" data-nav="view=ekip&tab=' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' : ''; }

  H.views.ekip = async function (main) {
    var owner = H.me.role === 'owner';
    if (!owner || H.q().get('tab') === 'kayit') return log(main);
    var d;
    async function load() { d = await H.api('team'); draw(); }
    function status(m) { return !m.active ? H.pill('archived', 'Erişim kapalı') : m.hasPassword ? H.pill('ok', 'Aktif') : m.linkExpiresAt ? H.pill('warn', 'Şifresini belirlemedi') : H.pill('bad', 'Linkin süresi doldu'); }
    function draw() {
      main.innerHTML = H.head({ title: 'Ekip & kayıt', sub: 'HQ’ya kimlerin, hangi rolle girebildiği. Herkes kendi e-postası ve kendi belirlediği şifreyle girer; yapılan her değişiklik adıyla kaydedilir.', acts: '<button class="btn pri" type="button" id="t-new">' + H.ico('plus') + 'Üye ekle</button>' }) + tabs('uyeler') +
        '<div class="split"><div class="card flat"><div class="list">' +
        '<div class="item"><span class="av">' + H.initials(d.owner.email) + '</span><div class="main"><span class="t">' + e(d.owner.email) + '</span><span class="mute small">Şifre Netlify ortam değişkeninde durur; buradan değiştirilemez.</span></div><div class="acts">' + H.pill('ok', 'Sahip') + '</div></div>' +
        d.members.map(function (m) {
          return '<div class="item"><span class="av">' + H.initials(m.name) + '</span><div class="main"><span class="t">' + e(m.name) + '</span><span class="mute small">' + e(m.email) + ' · ' + (m.lastLoginAt ? 'son giriş ' + H.fmtTime(m.lastLoginAt) : 'henüz giriş yapmadı') + '</span></div><div class="acts">' + status(m) +
            '<label class="sr" for="r-' + m.id + '">Rol</label><select id="r-' + m.id + '" data-role="' + m.id + '" style="width:auto;min-height:36px">' + d.roles.map(function (r) { return '<option value="' + r.key + '"' + (r.key === m.role ? ' selected' : '') + '>' + e(r.label) + '</option>'; }).join('') + '</select>' +
            '<button class="btn sm" type="button" data-link="' + m.id + '">' + H.ico('key') + (m.hasPassword ? 'Şifreyi sıfırla' : 'Yeni link') + '</button><button class="btn sm ghost" type="button" data-act="' + m.id + '">' + (m.active ? 'Erişimi kapat' : 'Erişimi aç') + '</button><button class="btn sm ghost" type="button" data-del="' + m.id + '">Sil</button></div></div>';
        }).join('') + '</div>' + (d.members.length ? '' : '<p class="mute small" style="padding:0 18px 16px">Henüz ekip üyesi yok. Kapı görevlisini ya da RSVP’leri onaylayacak kişiyi ekleyin; herkes yalnızca rolünün izin verdiği ekranları görür.</p>') + '</div>' +
        '<div class="card"><h2 class="h2" style="margin-bottom:12px">Roller</h2><dl class="roles">' + d.roles.map(function (r) { return '<dt>' + e(r.label) + '</dt><dd>' + e(r.text) + '</dd>'; }).join('') + '</dl></div></div>';
    }
    function showLink(m, url, fresh) {
      var abs = location.origin + url;
      H.modal({ title: fresh ? 'Üye eklendi: linki gönderin' : 'Yeni şifre linki', ok: 'Tamam', cancel: '', body: '<p class="mute">Bu linki <b style="color:var(--ink)">' + e(m.name) + '</b> ile paylaşın. Linki açıp kendi şifresini belirler; şifreyi siz görmezsiniz.</p><input readonly value="' + e(abs) + '" onfocus="this.select()" aria-label="Şifre belirleme linki"><button class="btn" type="button" data-copy="' + e(abs) + '" data-copied="Link kopyalandı">' + H.ico('copy') + 'Linki kopyala</button><p class="small dim">Tek kullanımlıktır ve ' + d.linkHours + ' saat geçerlidir. Bu pencereyi kapatınca link bir daha gösterilmez; gerekirse yenisini oluşturursunuz.</p>' });
    }
    function add() {
      var dr = H.drawer({ title: 'Üye ekle', body: '<form class="form" id="mf">' + F({ name: 'name', label: 'Ad soyad', required: 1, full: 1, max: 80 }) + F({ name: 'email', label: 'E-posta', type: 'email', required: 1, full: 1, hint: 'Giriş bu adresle yapılır. HQ bu adrese kendiliğinden e-posta göndermez; linki siz iletirsiniz.' }) +
        '<fieldset class="f full pick"><legend class="lab">Rol</legend>' + d.roles.map(function (r, i) { return '<label><input type="radio" name="role" value="' + r.key + '"' + (r.key === 'door' ? ' checked' : '') + '><span><b>' + e(r.label) + '</b><small>' + e(r.text) + '</small></span></label>'; }).join('') + '</fieldset><p class="msg bad f full" role="alert"></p></form>', foot: '<button class="btn pri" type="submit" form="mf">Ekle ve link oluştur</button>' });
      dr.querySelector('#mf').onsubmit = async function (x) {
        x.preventDefault(); var btn = dr.querySelector('button[type=submit]'), v = { name: this.querySelector('[name=name]').value, email: this.querySelector('[name=email]').value, role: (this.querySelector('[name=role]:checked') || {}).value };
        H.busy(btn, 1); try { var r = await H.api('team', 'POST', v); H.closeLayer(); await load(); showLink(r.member, r.setupUrl, true); } catch (err) { this.querySelector('.msg').textContent = err.message; H.busy(btn, 0); }
      };
    }
    main.onchange = async function (x) { var s = x.target.closest('[data-role]'); if (!s) return; try { await H.api('team/' + s.getAttribute('data-role'), 'PUT', { role: s.value }); H.toast('Rol değişti; hemen geçerli', 'ok'); await load(); } catch (err) { H.toast(err.message, 'bad'); await load(); } };
    main.onclick = async function (x) {
      var one = function (a) { var el = x.target.closest('[' + a + ']'); return el && d.members.filter(function (m) { return m.id === el.getAttribute(a); })[0]; }, m;
      try {
        if (x.target.closest('#t-new')) add();
        else if ((m = one('data-link'))) { if (!m.hasPassword || await H.modal({ title: 'Şifre sıfırlansın mı?', text: m.name + ' tüm cihazlarda oturumdan çıkar ve mevcut şifresi geçersiz olur. Yeni linkle kendi şifresini yeniden belirler.', ok: 'Sıfırla ve link oluştur' })) { var r = await H.api('team/' + m.id + '/link', 'POST', {}); await load(); showLink(r.member, r.setupUrl, false); } }
        else if ((m = one('data-act'))) { if (!m.active || await H.modal({ title: 'Erişim kapatılsın mı?', text: m.name + ' hemen oturumdan çıkar ve yeniden açana kadar giremez. Kaydı ve geçmişi silinmez.', ok: 'Erişimi kapat', danger: 1 })) { await H.api('team/' + m.id, 'PUT', { active: !m.active }); H.toast(m.active ? 'Erişim kapatıldı' : 'Erişim açıldı', 'ok'); await load(); } }
        else if ((m = one('data-del'))) { if (await H.modal({ title: 'Üye silinsin mi?', text: m.name + ' HQ’ya giremez. İşlem kaydındaki geçmiş satırları kalır.', ok: 'Sil', danger: 1 })) { await H.api('team/' + m.id, 'DELETE', {}); H.toast('Üye silindi', 'ok'); await load(); } }
      } catch (err) { H.toast(err.message, 'bad'); }
    };
    await load();
  };

  async function log(main) {
    var st = { uid: H.q().get('kisi') || '', rows: [], next: null }, people = [];
    if (H.me.role === 'owner') { try { var t = await H.api('team'); people = [['owner', 'Sahip']].concat(t.members.map(function (m) { return [m.id, m.name]; })); } catch (x) {} }
    async function load(more) { var r = await H.api('audit?' + (st.uid ? 'uid=' + encodeURIComponent(st.uid) + '&' : '') + (more && st.next ? 'before=' + encodeURIComponent(st.next) : '')); st.rows = more ? st.rows.concat(r.entries) : r.entries; st.next = r.next; draw(); }
    function draw() {
      var day = '';
      main.innerHTML = H.head({ title: H.me.role === 'owner' ? 'Ekip & kayıt' : 'İşlem kaydı', sub: 'Kim, ne zaman, neyi değiştirdi. Girişler, onaylar, yayınlar, ödemeler ve ekip değişiklikleri buraya yazılır; kayıt silinemez ve yedekten geri yüklemede geri alınmaz.',
        acts: people.length ? '<label class="sr" for="a-who">Kişi</label><select id="a-who" style="width:auto;min-width:180px"><option value="">Herkes</option>' + people.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === st.uid ? ' selected' : '') + '>' + e(p[1]) + '</option>'; }).join('') + '</select>' : '' }) + tabs('kayit') +
        (st.rows.length ? '<div class="card flat"><div class="list log">' + st.rows.map(function (r) {
          var d = H.fmtDate(new Date(Date.parse(r.at) + 3 * 36e5).toISOString().slice(0, 10)), head = d !== day ? '<div class="day">' + d + '</div>' : ''; day = d;
          return head + '<div class="item"><span class="time num-t">' + new Date(r.at).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }) + '</span><span class="av sm">' + H.initials(r.name) + '</span><div class="main"><span><b>' + e(r.name || '—') + '</b> ' + e(r.action.charAt(0).toLocaleLowerCase('tr') + r.action.slice(1)) + (r.target ? ': <b>' + e(r.target) + '</b>' : '') + '</span>' + (r.detail ? '<span class="mute small">' + e(r.detail) + '</span>' : '') + '</div></div>';
        }).join('') + '</div></div>' + (st.next ? '<div style="text-align:center;margin-top:14px"><button class="btn" type="button" id="a-more">Daha eski kayıtlar</button></div>' : '')
          : H.empty('shield', 'Kayıt yok.', st.uid ? 'Bu kişinin kayıtlı bir işlemi yok.' : 'İlk değişiklikten itibaren burada görünür.'));
    }
    main.onchange = function (x) { if (x.target.id === 'a-who') { st.uid = x.target.value; load().catch(function (err) { H.toast(err.message, 'bad'); }); } };
    main.onclick = function (x) { var b = x.target.closest('#a-more'); if (b) { H.busy(b, 1, 'Yükleniyor…'); load(true).catch(function (err) { H.toast(err.message, 'bad'); }); } };
    await load();
  }
})();
