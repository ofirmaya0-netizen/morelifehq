/* CRM · Kitleler: saved segments worked out from the CRM by rules */
(function () {
  var H = HQ, e = H.esc;
  var REACH = { any: 'Herkes', phone: 'Telefonu olanlar', email: 'E-postası olanlar', both: 'Telefonu ve e-postası olanlar' };
  var STATE = { applied: 'başvuranlar', approved: 'onaylananlar', attended: 'katılanlar', noshow: 'onaylanıp gelmeyenler', none: 'başvurmayanlar' };
  function blank() { return { tags: [], tagMode: 'any', exclude: [], source: '', reach: 'any', eventId: '', eventState: 'applied' }; }
  function summary(r, evs) {
    var out = [], ev = evs.filter(function (x) { return x.id === r.eventId; })[0];
    if (r.tags.length) out.push('Etiket: ' + r.tags.join(r.tagMode === 'all' ? ' ve ' : ' veya '));
    if (r.exclude.length) out.push('Hariç: ' + r.exclude.join(', '));
    if (r.source) out.push('Kaynak: ' + r.source);
    if (r.reach !== 'any') out.push(REACH[r.reach]);
    if (r.eventId) out.push((ev ? ev.title : 'Etkinlik') + ': ' + STATE[r.eventState]);
    return out.length ? out.join(' · ') : 'CRM’deki herkes';
  }
  function sizes(a) { return '<div class="astats"><span><b>' + a.count + '</b> kişi</span><span><b>' + a.phone + '</b> telefon</span><span><b>' + a.email + '</b> e-posta</span></div>'; }

  H.audiences = async function (main) {
    var d = await H.api('audiences'), O = d.options;
    main.innerHTML = H.head({ title: 'CRM', sub: 'Kitleler, CRM’deki kişileri kurallara göre gruplar. Kurala uyan yeni kişiler kitleye kendiliğinden girer.', acts: '<button class="btn pri" type="button" id="a-new">' + H.ico('plus') + 'Kitle oluştur</button>' }) + H.crmTabs('kitleler') +
      (d.audiences.length ? '<div class="grid g2">' + d.audiences.map(function (a) {
        return '<button class="card aud" type="button" data-aud="' + a.id + '" style="text-align:left"><b style="font-size:17px">' + e(a.name) + '</b><p class="small mute" style="margin-top:6px">' + e(summary(a.rules, O.events)) + '</p>' + (a.note ? '<p class="small dim" style="margin-top:4px">' + e(a.note) + '</p>' : '') + sizes(a) + '</button>';
      }).join('') + '</div>' : H.empty('users', 'Henüz kitle yok.', d.total ? 'Etiket, kaynak ya da etkinlik katılımına göre ilk kitlenizi oluşturun.' : 'Önce CRM’e kişi ekleyin ya da CSV içe aktarın; kitleler o kişilerden oluşur.', '<button class="btn pri" type="button" id="a-new2" style="margin-top:14px">Kitle oluştur</button>'));
    main.onclick = function (ev) {
      if (ev.target.closest('#a-new, #a-new2')) return edit(null);
      var c = ev.target.closest('[data-aud]'); if (c) open(c.getAttribute('data-aud'));
    };

    async function open(id) {
      var x = await H.api('audiences/' + id).catch(function (err) { H.toast(err.message, 'bad'); return null; }); if (!x) return;
      var a = x.audience, m = x.members;
      var dr = H.drawer({ title: a.name, body: '<p class="mute">' + e(summary(a.rules, O.events)) + '</p>' + (a.note ? '<p class="small dim" style="margin-top:6px">' + e(a.note) + '</p>' : '') + '<div style="margin:0 0 16px">' + sizes(a) + '</div>' +
        (m.length ? '<div class="card flat"><div class="scroll" style="max-height:52vh;overflow-y:auto"><table><thead><tr><th>Kişi</th><th>İletişim</th><th>Etiketler</th></tr></thead><tbody>' + m.slice(0, 300).map(function (c) { return '<tr data-nav="view=crm&kisi=' + c.id + '" style="cursor:pointer"><td><b>' + e(c.name) + '</b></td><td class="small mute">' + [c.email, c.phone].filter(Boolean).map(e).join('<br>') + '</td><td>' + c.tags.map(function (t) { return '<span class="pill plain">' + e(t) + '</span>'; }).join(' ') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' + (m.length > 300 ? '<p class="small dim" style="margin-top:8px">İlk 300 kişi gösteriliyor; tamamı CSV’de.</p>' : '') : H.note('info', 'Şu an bu kurallara uyan kişi yok.')),
        foot: '<button class="btn bad" type="button" id="a-del">Sil</button><span style="flex:1"></span><button class="btn" type="button" id="a-inv">Davet gönder</button><button class="btn" type="button" id="a-edit">Düzenle</button><a class="btn pri" href="/api/hq/audiences/' + a.id + '.csv">' + H.ico('down') + 'CSV dışa aktar</a>' });
      dr.querySelector('#a-edit').onclick = function () { edit(a); };
      dr.querySelector('#a-inv').onclick = async function () {
        var up = O.events.filter(function (x) { return !x.date || x.date >= H.today(); });
        if (!up.length) { H.toast('Yaklaşan etkinlik yok. Önce etkinliği oluşturun.', 'bad'); return; }
        var pick = up[0].id, asked = H.modal({ title: 'Hangi etkinliğe davet?', body: '<div class="f"><label for="inv-ev">Etkinlik</label><select id="inv-ev">' + up.map(function (x) { return '<option value="' + x.id + '">' + e(x.title) + (x.date ? ' · ' + H.fmtDate(x.date) : '') + '</option>'; }).join('') + '</select></div><p class="small mute" style="margin-top:10px">Etkinliğin “Mesajlar” sekmesi açılır; gönderimden önce kimlere gideceğini görürsünüz.</p>', ok: 'Devam' });
        document.getElementById('inv-ev').onchange = function () { pick = this.value; };
        if (await asked) H.go('view=etkinlik&id=' + pick + '&tab=mesajlar&kitle=' + id); else open(id);
      };

      dr.querySelector('#a-del').onclick = async function () {
        if (!(await H.modal({ title: 'Kitle silinsin mi?', text: '“' + a.name + '” kitlesi silinir. Kişiler CRM’de kalır.', ok: 'Kitleyi sil', danger: 1 }))) return open(id);
        try { await H.api('audiences/' + id, 'DELETE'); H.toast('Kitle silindi', 'ok'); H.render(); } catch (err) { H.toast(err.message, 'bad'); }
      };
    }

    function edit(a) {
      var r = a ? a.rules : blank(), F = H.field;
      function chips(name, on) { return O.tags.length ? '<div class="chips">' + O.tags.map(function (t) { return '<label><input type="checkbox" data-chip="' + name + '" value="' + e(t.name) + '"' + (on.indexOf(t.name) > -1 ? ' checked' : '') + '><span>' + e(t.name) + ' <i>' + t.count + '</i></span></label>'; }).join('') + '</div>' : '<p class="small mute">CRM’de henüz etiket yok.</p>'; }
      var dr = H.drawer({ title: a ? 'Kitleyi düzenle' : 'Kitle oluştur', body: '<form class="form" id="af">' +
        F({ name: 'name', label: 'Kitle adı', value: a && a.name, required: 1, max: 80, ph: 'Örn. Bodrum VIP', full: 1 }) +
        '<div class="f full"><label>Şu etiketlere sahip olanlar</label>' + chips('tags', r.tags) + '</div>' +
        F({ name: 'tagMode', label: 'Etiket eşleşmesi', type: 'select', value: r.tagMode, options: [['any', 'Seçilenlerden herhangi biri'], ['all', 'Seçilenlerin hepsi']] }) +
        F({ name: 'reach', label: 'Ulaşılabilirlik', type: 'select', value: r.reach, options: Object.keys(REACH).map(function (k) { return [k, REACH[k]]; }) }) +
        '<div class="f full"><label>Şu etiketlere sahip olanları çıkar</label>' + chips('exclude', r.exclude) + '</div>' +
        F({ name: 'source', label: 'Kaynak', type: 'select', value: r.source, options: [['', 'Tüm kaynaklar']].concat(O.sources.map(function (x) { return [x.name, x.name + ' (' + x.count + ')']; })), full: 1 }) +
        F({ name: 'eventId', label: 'Etkinlik', type: 'select', value: r.eventId, options: [['', 'Etkinliğe bakma']].concat(O.events.map(function (x) { return [x.id, x.title + (x.date ? ' · ' + H.fmtDate(x.date) : '')]; })) }) +
        F({ name: 'eventState', label: 'Etkinlikteki durumu', type: 'select', value: r.eventState, options: Object.keys(STATE).map(function (k) { return [k, STATE[k][0].toLocaleUpperCase('tr') + STATE[k].slice(1)]; }) }) +
        F({ name: 'note', label: 'Not', value: a && a.note, max: 300, ph: 'Bu kitle ne için? (isteğe bağlı)', full: 1 }) +
        '<p class="msg bad full" id="af-msg" role="alert"></p></form><div class="card" id="a-live" style="margin-top:16px" aria-live="polite"></div>',
        foot: '<button class="btn ghost" type="button" id="af-x">Vazgeç</button><button class="btn pri" type="submit" form="af">' + (a ? 'Kaydet' : 'Kitleyi oluştur') + '</button>' });
      var form = dr.querySelector('#af'), live = dr.querySelector('#a-live'), timer, seq = 0;
      function rules() { var v = H.vals(form), pick = function (n) { return [].map.call(form.querySelectorAll('[data-chip=' + n + ']:checked'), function (x) { return x.value; }); }; return { tags: pick('tags'), tagMode: v.tagMode, exclude: pick('exclude'), source: v.source, reach: v.reach, eventId: v.eventId, eventState: v.eventState }; }
      async function count() {
        var n = ++seq; form.eventState.disabled = !form.eventId.value;
        try { var p = await H.api('audiences/preview', 'POST', { rules: rules() }); if (n !== seq) return;
          live.innerHTML = '<p class="eye">Bu kurallara uyan</p>' + sizes(p) + '' + (p.sample.length ? '<p class="small mute" style="margin-top:8px">' + p.sample.map(e).join(', ') + (p.count > p.sample.length ? ' ve ' + (p.count - p.sample.length) + ' kişi daha' : '') + '</p>' : '<p class="small mute" style="margin-top:8px">Bu kurallara uyan kişi yok. Kitleyi yine de kaydedebilirsiniz; uyan kişiler eklendikçe dolar.</p>');
        } catch (err) { if (n === seq) live.innerHTML = '<p class="small" style="color:var(--bad)">' + e(err.message) + '</p>'; }
      }
      form.onchange = function (ev) { if (ev.target.name !== 'name' && ev.target.name !== 'note') { clearTimeout(timer); timer = setTimeout(count, 150); } };
      count();
      dr.querySelector('#af-x').onclick = function () { H.closeLayer(); if (a) open(a.id); };
      form.onsubmit = async function (ev) {
        ev.preventDefault(); var btn = dr.querySelector('button[type=submit]'), v = H.vals(form); H.busy(btn, 1);
        try { await H.api(a ? 'audiences/' + a.id : 'audiences', a ? 'PUT' : 'POST', { name: v.name, note: v.note, rules: rules() }); H.closeLayer(); H.toast(a ? 'Kitle güncellendi' : 'Kitle oluşturuldu', 'ok'); H.render(); }
        catch (err) { dr.querySelector('#af-msg').textContent = err.message; H.busy(btn, 0); }
      };
    }
  };
})();
