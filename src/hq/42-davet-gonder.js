/* Etkinlik · Mesajlar: send the invitation to a CRM audience */
(function () {
  var H = HQ, e = H.esc;
  H.inviteSend = async function (el, eventId) {
    var d; try { d = await H.api('events/' + eventId + '/invite-sends'); } catch (err) { el.innerHTML = H.note('bad', e(err.message)); return; }
    var R = d.ready, pre = H.q().get('kitle') || '', plan = null;
    var chk = function (name, label, on, why) { return '<label class="check" for="is-' + name + '"><input type="checkbox" id="is-' + name + '" name="' + name + '"' + (on ? ' checked' : ' disabled') + '><span>' + label + (on ? '' : '<small>' + e(why) + '</small>') + '</span></label>'; };
    el.innerHTML = '<div class="row between" style="margin-bottom:6px"><h2 class="h2">Kitleye davet gönder</h2><span class="small mute">Şimdiye kadar: <b>' + d.sent.wa + '</b> WhatsApp · <b>' + d.sent.mail + '</b> e-posta</span></div>' +
      '<p class="small mute" style="margin-bottom:14px">Davet yalnızca seçtiğiniz kitleye gider; herkese kendi kişisel linki gider, böylece kimin başvurduğu ve linki kime ilettiği aşağıdaki “Davet takibi”nde görünür. Aynı kişiye bu etkinlik için aynı kanaldan ikinci kez gönderilmez; başvurmuş olanlar ve “' + e(d.optOutTag) + '” etiketli kişiler atlanır.</p>' +
      (R.block ? H.note('warn', e(R.block)) : !d.audiences.length ? H.note('info', 'Henüz kitle yok. <button class="btn sm" type="button" data-nav="view=crm&tab=kitleler" style="margin-left:8px">Kitle oluştur</button>') :
        '<form id="isf"><div class="form"><div class="f"><label for="is-aud">Kitle</label><select id="is-aud" name="audienceId">' + d.audiences.map(function (a) { return '<option value="' + a.id + '"' + (a.id === pre ? ' selected' : '') + '>' + e(a.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label>Kanal</label>' + chk('wa', 'WhatsApp', R.wa, R.waWhy) + chk('mail', 'E-posta', R.mail, R.mailWhy) + '</div></div>' +
        '<div class="row" style="margin-top:12px;gap:8px"><button class="btn" type="submit">Kimlere gidecek?</button><button class="btn" type="button" id="is-pv">E-posta önizlemesi</button><button class="btn pri" type="button" id="is-go" disabled>Daveti gönder</button></div></form><div id="is-out" style="margin-top:14px" aria-live="polite"></div>');
    var f = el.querySelector('#isf'); if (!f) return;
    var out = el.querySelector('#is-out'), go = el.querySelector('#is-go');
    function req() { var v = H.vals(f); return { audienceId: v.audienceId, channels: { wa: !!v.wa, mail: !!v.mail } }; }
    function skips(s) { return [[s.applied, 'zaten başvurmuş'], [s.already, 'daha önce gönderilmiş'], [s.optOut, 'mesaj istemiyor'], [s.noContact, 'seçilen kanalda iletişim bilgisi yok'], [s.badPhone, 'telefonu +90… biçiminde değil']].filter(function (x) { return x[0]; }).map(function (x) { return x[0] + ' ' + x[1]; }).join(' · '); }
    f.onchange = function () { plan = null; go.disabled = true; out.innerHTML = ''; };
    el.querySelector('#is-pv').onclick = function () { H.drawer({ title: 'Davet e-postası', body: '<p class="small mute" style="margin-bottom:10px">Konu: ' + e(d.mail.subject) + '</p><iframe title="E-posta önizlemesi" sandbox="" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:12px;background:#0E0B0A"></iframe><p class="small dim" style="margin-top:10px">Örnek misafir adıyla gösterilir.</p>' }).querySelector('iframe').srcdoc = d.mail.html; };
    f.onsubmit = async function (ev) {
      ev.preventDefault(); var r = req(), btn = f.querySelector('button[type=submit]');
      if (!r.channels.wa && !r.channels.mail) { out.innerHTML = H.note('bad', 'En az bir kanal seçin.'); return; }
      H.busy(btn, 1, 'Kontrol ediliyor…');
      try {
        var p = await H.api('events/' + eventId + '/invite-send', 'POST', Object.assign({ dryRun: true }, r)); plan = p.plan; var sk = skips(plan.skip);
        out.innerHTML = '<div class="card" style="padding:14px"><p class="eye">' + e(p.audience.name) + ' · ' + p.audience.count + ' kişi</p><div class="astats"><span><b>' + plan.people + '</b> kişiye gidecek</span>' + (r.channels.wa ? '<span><b>' + plan.wa + '</b> WhatsApp</span>' : '') + (r.channels.mail ? '<span><b>' + plan.mail + '</b> e-posta</span>' : '') + '</div>' +
          (p.sample.length ? '<p class="small mute" style="margin-top:8px">' + p.sample.map(e).join(', ') + (plan.people > p.sample.length ? ' ve ' + (plan.people - p.sample.length) + ' kişi daha' : '') + '</p>' : '') + (sk ? '<p class="small dim" style="margin-top:8px">Atlanacak: ' + e(sk) + '</p>' : '') + '</div>';
        go.disabled = !plan.people;
      } catch (err) { out.innerHTML = H.note('bad', e(err.message)); }
      H.busy(btn, 0);
    };
    go.onclick = async function () {
      if (!plan) return; var r = req(), what = [r.channels.wa && plan.wa ? plan.wa + ' WhatsApp mesajı' : '', r.channels.mail && plan.mail ? plan.mail + ' e-posta' : ''].filter(Boolean).join(' ve ');
      if (!(await H.modal({ title: 'Davet gönderilsin mi?', text: plan.people + ' kişiye ' + what + ' gönderilecek.' + (r.channels.wa && plan.wa ? ' WhatsApp mesajları ücretlidir.' : '') + ' Gönderilen mesaj geri alınamaz.', ok: 'Gönder' }))) return;
      H.busy(go, 1, 'Gönderiliyor…'); var sent = { wa: 0, mail: 0 }, failed = [], from = 0;
      try {
        while (from !== null) {
          var x = await H.api('events/' + eventId + '/invite-send', 'POST', Object.assign({ from: from, size: 10 }, r));
          sent.wa += x.sent.wa; sent.mail += x.sent.mail; failed = failed.concat(x.failed); from = x.next; go.textContent = 'Gönderiliyor… ' + (from === null ? x.total : from) + ' / ' + x.total;
        }
      } catch (err) { failed.push({ name: 'Gönderim yarıda kesildi', channel: '', error: err.message + ' “Kimlere gidecek?” ile kalanları görüp devam edebilirsiniz; gönderilenler tekrar gitmez.' }); }
      H.busy(go, 0); go.disabled = true; plan = null;
      out.innerHTML = H.note(failed.length ? 'warn' : 'ok', '<b>' + sent.wa + '</b> WhatsApp ve <b>' + sent.mail + '</b> e-posta gönderildi.' + (failed.length ? ' ' + failed.length + ' gönderim başarısız:' : '')) +
        (failed.length ? '<div class="card flat" style="margin-top:10px"><div class="scroll" style="max-height:240px;overflow-y:auto"><table><tbody>' + failed.map(function (x) { return '<tr><td><b>' + e(x.name) + '</b></td><td class="small mute">' + (x.channel === 'wa' ? 'WhatsApp' : x.channel === 'mail' ? 'E-posta' : '') + '</td><td class="small" style="color:var(--bad)">' + e(x.error) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '');
      H.toast('Davet gönderimi tamamlandı', failed.length ? '' : 'ok');
    };
  };
})();
