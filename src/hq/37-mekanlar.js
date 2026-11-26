/* Mekânlar: yayındaki etkinliği ya da portal linki olan her mekân; linki, etkinlikleri ve masaları tek yerde. */
(function () {
  var H = HQ, e = H.esc;
  H.views.mekanlar = async function (main) {
    var d = await H.api('venue-links/overview');
    main.innerHTML = H.head({ title: 'Mekânlar', sub: 'Mekân portalı linkleri, etkinlikler ve masalar' }) +
      (d.venues.length ? '<div class="stack" style="gap:18px">' + d.venues.map(function (v, i) {
        return '<section class="split" style="align-items:start"><div class="card"><div class="row between" style="margin-bottom:10px"><h2 class="h2">' + e(v.venue) + (v.city ? ' <span class="dim" style="font-weight:400">· ' + e(v.city) + '</span>' : '') + '</h2>' + '<span class="row" style="gap:6px">' + (v.plan ? H.pill('ok', 'Masa planı · ' + v.plan.tables + ' masa') : '') + H.pill(v.link ? 'ok' : 'archived', v.link ? 'Portal linki açık' : 'Portal linki yok') + '</span></div>' + (v.plan ? '<p class="small mute" style="margin-bottom:10px">' + e(v.plan.name) + ' kat planı tanımlı. Oturtmak için etkinliğin <b>Masalar</b> bölümünü açın.</p>' : '') +
          (v.events.length ? '<div class="scroll"><table><thead><tr><th>Etkinlik</th><th>Tarih</th><th>Beklenen</th><th>Masa</th><th>İçeride</th><th></th></tr></thead><tbody>' + v.events.map(function (x) { var c = x.counts;
            return '<tr><td><button type="button" class="t" data-nav="view=etkinlik&id=' + x.id + '&tab=masalar" style="background:none;border:0;padding:0;text-align:left"><b>' + e(x.title) + '</b></button></td><td class="small mute" style="white-space:nowrap">' + (H.fmtDate(x.date) || '—') + '</td><td class="num-t">' + c.expected + '</td><td class="num-t">' + c.tables + (c.tablePeople ? ' <span class="dim small">(' + c.tablePeople + ' kişi)</span>' : '') + '</td><td class="num-t">' + c.in + (c.capacity ? ' / ' + c.capacity : '') + (c.level ? ' ' + H.pill(c.level === 'full' ? 'bad' : 'warn', c.level === 'full' ? 'Doldu' : 'Yaklaştı') : '') + '</td><td><button class="btn sm" type="button" data-tables="' + x.id + '" data-title="' + e(x.title) + '">Masalar</button></td></tr>'; }).join('') + '</tbody></table></div>'
            : '<p class="small mute">Bu mekânda yayında, tarihi geçmemiş etkinlik yok. Link açık kalır; yeni etkinlik yayınlandığında mekân aynı linkte görür.</p>') +
          '</div><div class="card" data-venue="' + i + '"></div></section>';
      }).join('') + '</div>' : H.empty('key', 'Henüz mekân yok', 'Mekânı girilmiş bir etkinlik yayınladığınızda mekân burada listelenir; portal linkini buradan oluşturursunuz.'));
    main.querySelectorAll('[data-venue]').forEach(function (box) { H.parts.venueLink(box, d.venues[+box.getAttribute('data-venue')].venue, ''); });
    main.querySelectorAll('[data-tables]').forEach(function (b) { b.onclick = function () { H.parts.venueTables(b.getAttribute('data-tables'), b.getAttribute('data-title')); }; });
  };
})();
