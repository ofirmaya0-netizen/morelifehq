/* Etkinlik · Mesajlar: davet takibi. Kişisel linkler: kim açtı, kim başvurdu, kim kime iletti. */
(function () {
  var H = HQ, e = H.esc;
  H.inviteTrack = async function (el, eventId) {
    var d, auds = [];
    try { d = await H.api('events/' + eventId + '/invite-tracking'); auds = (await H.api('events/' + eventId + '/invite-sends')).audiences; } catch (err) { el.innerHTML = H.note('bad', e(err.message)); return; }
    var t = d.totals, only = false;
    // the chain under one person: who they passed the link to, and who those people passed their own link to
    function tree(list, depth) { return list.map(function (f) { return '<div class="row" style="gap:6px;flex-wrap:nowrap;padding-left:' + (depth * 16) + 'px">' + (depth ? '<span class="dim" aria-hidden="true">↳</span>' : '') + '<span>' + e(f.name) + (f.guests > 1 ? ' +' + (f.guests - 1) : '') + '</span>' + H.pill(f.status) + '</div>' + (f.children && f.children.length ? tree(f.children, depth + 1) : ''); }).join(''); }
    var csv = auds.length ? '<div class="row" style="gap:8px"><label class="sr" for="it-aud">Kitle</label><select id="it-aud" style="min-height:36px">' + auds.map(function (a) { return '<option value="' + a.id + '">' + e(a.name) + '</option>'; }).join('') + '</select><a class="btn sm" id="it-csv" href="#">' + H.ico('down') + 'Kişisel linkler (CSV)</a></div>' : '';
    function draw() {
      var rows = d.rows.filter(function (x) { return !only || x.forwarded.length; });
      el.innerHTML = '<div class="row between" style="margin-bottom:6px"><h2 class="h2">Davet takibi</h2>' + csv + '</div>' +
        '<p class="small mute">Her davetlinin linki kendine özeldir. Linkten o kişinin kendi bilgileriyle başvuru gelirse “kendi başvurdu”, başka birinin bilgileriyle gelirse “iletti” sayılır. Başvuran herkes kendi linkini alır; onu ilettiği kişiler alt satırda (↳) görünür, zincir böyle devam eder. Daveti HQ dışından (kendi WhatsApp’ınızdan) atacaksanız kişisel linkleri CSV olarak indirin; ortak davet linkiyle gelenler takip edilemez.</p>' +
        '<div class="astats"><span><b>' + t.links + '</b> kişisel link</span><span><b>' + t.opened + '</b> kişi açtı</span><span><b>' + t.applied + '</b> kendi başvurdu</span><span><b>' + t.forwarders + '</b> kişi iletti</span><span><b>' + t.forwarded + '</b> iletilen başvuru</span>' + (t.rings > 1 ? '<span>zincir <b>' + t.rings + '</b> halka</span>' : '') + '</div>' +
        (d.rows.length ? '<div class="row" style="margin:12px 0 8px"><label class="check small"><input type="checkbox" id="it-only"' + (only ? ' checked' : '') + '><span>Yalnızca iletenleri göster</span></label></div><div class="scroll" style="max-height:460px;overflow-y:auto"><table><thead><tr><th>Davetli</th><th>Gönderim</th><th>Açılma</th><th>Kendi başvurusu</th><th>İlettikleri</th><th></th></tr></thead><tbody>' +
          (rows.length ? rows.map(function (x) {
            return '<tr><td><b>' + e(x.name || '—') + '</b></td><td class="small mute">' + (x.guest ? 'davetli değil · kendi linki' : [x.sent.wa ? 'WhatsApp' : '', x.sent.mail ? 'E-posta' : ''].filter(Boolean).join(' · ') || 'yalnızca link') + '</td><td class="num-t">' + (x.opens || '<span class="dim">—</span>') + '</td><td>' + (x.own ? H.pill(x.own.status) : '<span class="dim small">başvurmadı</span>') + '</td><td>' +
              (x.forwarded.length ? tree(x.forwarded, 0) : '<span class="dim">—</span>') +
              '</td><td>' + (x.url ? '<button class="btn sm ghost" type="button" data-copy="' + e(x.url) + '" data-copied="' + e(x.name) + ' için kişisel link kopyalandı">' + H.ico('copy') + 'Link</button>' : '') + '</td></tr>';
          }).join('') : '<tr><td colspan="6" class="mute">Henüz kimse linkini iletmedi.</td></tr>') + '</tbody></table></div>'
          : '<p class="small dim" style="margin-top:12px">Henüz kişisel link yok. Yukarıdan bir kitleye davet gönderdiğinizde ya da kişisel linkleri CSV olarak indirdiğinizde burada listelenir.</p>');
      var o = el.querySelector('#it-only'); if (o) o.onchange = function () { only = o.checked; draw(); };
      var a = el.querySelector('#it-csv'), sel = el.querySelector('#it-aud');
      if (a) { var set = function () { a.href = '/api/hq/events/' + eventId + '/invite-links.csv?audience=' + encodeURIComponent(sel.value); }; set(); sel.onchange = set; a.onclick = function () { setTimeout(function () { H.inviteTrack(el, eventId); }, 2500); }; }
    }
    draw();
  };
})();
