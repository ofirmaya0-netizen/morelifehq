// Team access: who may sign in to HQ, what each role may do, and the record of who did what.
// The owner comes from the environment variables and cannot be edited or removed here. Team members are records in the
// store; they choose their own password through a one-time link, so nobody else ever sees or types it.
import { session, sessionCookie, hashPassword, token, id, hash } from './auth.mjs';
import { json, fail, now, str, emailOk, normEmail, body } from './util.mjs';

export const ROLES = {
  owner: { label: 'Sahip', text: 'Her şey: ekip, yedekler ve tüm kayıtlar.' },
  manager: { label: 'Yönetici', text: 'Ekip ve yedekler dışında her şey; booking ve ödemeler dahil.' },
  rsvp: { label: 'RSVP onayı', text: 'Başvuruları görür, onaylar ya da reddeder, giriş kartı gönderir ve check-in yapar.' },
  door: { label: 'Kapı', text: 'Yalnızca check-in: onaylı misafirlerin adını ve kişi sayısını görür.' },
  viewer: { label: 'Sadece görüntüleme', text: 'Etkinlik, başvuru, CRM ve raporları görür; hiçbir şeyi değiştiremez. Booking ve ödemeleri görmez.' }
};
const MEMBER_ROLES = ['manager', 'rsvp', 'door', 'viewer'];
const SETUP_HOURS = 72, MIN_PASSWORD = 10;

export const ownerUser = () => ({ id: 'owner', email: process.env.HQ_ADMIN_EMAIL.trim().toLowerCase(), name: str(process.env.HQ_ADMIN_NAME, 80) || 'Sahip', role: 'owner' });

// The signed-in person, or null. A member who was removed, switched off or had their link renewed is signed out at once.
export async function currentUser(req, s) {
  const p = session(req);
  if (!p) return null;
  if (p.uid === 'owner') return ownerUser();
  const u = await s.get('users/' + p.uid);
  if (!u || !u.active || !u.pass || u.email !== p.email || (u.sv || 0) !== p.v) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}
export async function findMember(s, email) {
  const e = normEmail(email), ref = e && await s.get('userEmail/' + hash(e));
  const u = ref && await s.get('users/' + ref.id);
  return u && u.email === e ? u : null;
}

// What a role may reach. Every admin route passes through here after the session check.
const HIDDEN_FROM_VIEWER = ['bookings', 'audit', 'pnl'];
export function allowed(u, m, parts) {
  const a = parts[0], r = u.role;
  if (a === 'session' || a === 'me') return true;
  if (r === 'owner') return true;
  if (a === 'team' || a === 'backups') return false;
  if (r === 'manager') return true;
  if (r === 'viewer') return m === 'GET' && !HIDDEN_FROM_VIEWER.includes(a);
  if (a === 'summary') return m === 'GET';
  if (a === 'events') return m === 'GET' && parts.length <= 2;
  if (a === 'checkin') return m === 'POST';
  if (a === 'rsvps') return r === 'rsvp' ? true : m === 'GET' && parts.length === 2;
  if (a === 'rsvps.csv') return r === 'rsvp';
  return false;
}
// The screens each role gets in the menu (the server check above is what actually protects the data).
export function screens(role) {
  if (role === 'owner') return ['ozet', 'etkinlikler', 'satislar', 'booking', 'rsvp', 'kapi', 'crm', 'mesajlar', 'talepler', 'gorevler', 'website', 'seo', 'marketing', 'ekip', 'yedekler', 'ayarlar'];
  if (role === 'manager') return ['ozet', 'etkinlikler', 'satislar', 'booking', 'rsvp', 'kapi', 'crm', 'mesajlar', 'talepler', 'gorevler', 'website', 'seo', 'marketing', 'ekip', 'ayarlar'];
  if (role === 'viewer') return ['ozet', 'etkinlikler', 'satislar', 'rsvp', 'crm', 'mesajlar', 'talepler', 'gorevler', 'website', 'seo', 'marketing', 'ayarlar'];
  if (role === 'rsvp') return ['ozet', 'rsvp', 'kapi'];
  return ['ozet', 'kapi'];
}

/* ---------- record of actions ---------- */
// Keys sort by time, so the newest page is read without opening the whole log.
export async function logAudit(s, who, action, target, detail) {
  const at = now();
  await s.set('audit/' + at + '~' + id(), { at, uid: who.id || '', name: who.name || '', email: who.email || '', role: who.role || '', action: str(action, 200), target: str(target, 300), detail: str(detail, 500) });
}
const DECISION = { approved: 'onayladı', rejected: 'reddetti', waitlist: 'bekleme listesine aldı', cancelled: 'iptal etti', pending: 'beklemeye aldı' };
// Turns a finished admin request into one line of the log. b: request body, j: response body.
export async function describe(s, parts, m, b, j) {
  const [a, p1, p2, p3] = parts, title = async (eid) => { const e = eid && await s.get('events/' + eid); return e ? e.title : ''; };
  const del = m === 'DELETE', put = m === 'PUT';
  if (a === 'events') {
    const t = (j.event && j.event.title) || await title(p1);
    if (!p1) return ['Etkinlik oluşturdu', t];
    if (!p2) return ['Etkinliği düzenledi', t];
    if (p2 === 'publish') return ['Etkinliği yayınladı', t];
    if (p2 === 'status') return [b.status === 'archived' ? 'Etkinliği arşivledi' : 'Etkinliği taslağa aldı', t];
    if (p2 === 'door-link') return [b.close ? 'Kapı linkini kapattı' : 'Kapı linkini yeniledi', t];
    if (p2 === 'invite-token') return ['Davet linkini yeniledi', t];
    if (p2 === 'invite-send') { // sent in windows: one line for the whole send, written with its first window
      if (b.dryRun || parseInt(b.from, 10) > 0) return null;
      const au = await s.get('audiences/' + str(b.audienceId, 40));
      return ['Kitleye davet gönderdi', t, (au ? au.name + ' · ' : '') + [b.channels && b.channels.wa ? 'WhatsApp' : '', b.channels && b.channels.mail ? 'e-posta' : ''].filter(Boolean).join(' + ')];
    }
    return null;
  }
  if (a === 'rsvps') {
    const t = await title(p1);
    if (p2 === 'bulk') return b.dryRun ? null : [j.count + ' başvuruyu ' + (DECISION[b.decision] || b.decision), t, j.guests + ' kişi'];
    const who = (j.rsvp && j.rsvp.name) || '';
    if (p3 === 'decision') return ['Başvuruyu ' + (DECISION[b.decision] || b.decision), who, t];
    if (p3 === 'send-table') return ['Masa linkini gönderdi', who, t];
    if (p3 === 'send-pass') return ['Giriş kartını e-postayla gönderdi', who, t];
    if (p3 === 'send-pass-wa') return ['Giriş kartını WhatsApp’tan gönderdi', who, t];
    return null;
  }
  if (a === 'checkin') return b.undo && j.rsvp ? ['Girişi geri aldı', j.rsvp.name, await title(j.rsvp.eventId)] : null; // each entry is kept on the guest's own record
  if (a === 'contacts') {
    if (p1 === 'import') return b.commit ? ['CSV’den kişi aktardı', '', j.created + ' yeni, ' + j.updated + ' güncellendi'] : null;
    return [put ? 'Kişiyi düzenledi' : 'Kişi ekledi', (j.contact && j.contact.name) || ''];
  }
  if (a === 'audiences') return p1 === 'preview' ? null : [del ? 'Kitleyi sildi' : put ? 'Kitleyi düzenledi' : 'Kitle oluşturdu', (j.audience && j.audience.name) || ''];
  if (a === 'tasks') return [del ? 'Görevi sildi' : put ? (b.status === 'done' ? 'Görevi bitirdi' : 'Görevi düzenledi') : 'Görev ekledi', (j.task && j.task.title) || ''];
  if (a === 'enquiries' && p2 === 'confirm') return b.dryRun || !j.enquiry ? null : ['Masayı onayladı', j.enquiry.name, [j.enquiry.eventTitle, j.enquiry.table.party + ' kişi', [j.enquiry.table.mail.status === 'sent' ? 'e-posta' : '', j.enquiry.table.wa.status === 'sent' ? 'WhatsApp' : ''].filter(Boolean).join(' + ')].filter(Boolean).join(' · ')];
  if (a === 'enquiries') return ['Talebi güncelledi', (j.enquiry && j.enquiry.name) || '', b.status ? 'durum: ' + b.status : ''];
  if (a === 'site') return [p2 === 'publish' ? 'Ana sayfayı yayınladı' : p2 === 'rollback' ? 'Ana sayfayı önceki sürüme döndürdü' : 'Ana sayfa taslağını düzenledi', ''];
  if (a === 'seo') return ['SEO varsayılanlarını düzenledi', ''];
  if (a === 'utm') return [del ? 'Kampanya linkini sildi' : 'Kampanya linki oluşturdu', (j.link && j.link.name) || ''];
  if (a === 'inbox') return p1 === 'connect' ? [del ? 'WhatsApp gelen mesaj bağlantısını kaldırdı' : 'WhatsApp gelen mesajlarını bağladı', ''] : p2 === 'reply' ? ['WhatsApp mesajını yanıtladı', (j.thread && (j.thread.name || j.thread.phone)) || ''] : p1 === 'import' && !b.pageToken && b.direction !== 'outgoing' ? ['Geçmiş WhatsApp mesajlarını yükledi', ''] : null;
  if (a === 'whatsapp') return [p1 === 'test' ? 'WhatsApp test mesajı gönderdi' : 'WhatsApp şablonlarını düzenledi', ''];
  if (a === 'automation') return ['Otomasyonu elle çalıştırdı', ''];
  if (a === 'import-site-events') return ['Geçmiş etkinlikleri aktardı', '', j.created + ' etkinlik'];
  if (a === 'bookings') {
    const t = (j.booking && j.booking.artist) || '';
    if (!p1) return ['Booking oluşturdu', t];
    if (p2 === 'payments') { const pay = j.payment || {}; return [del ? 'Ödeme satırını sildi' : !p3 ? 'Ödeme satırı ekledi' : 'paid' in b ? (b.paid ? 'Ödemeyi ödendi işaretledi' : 'Ödeme işaretini geri aldı') : 'Ödeme satırını düzenledi', t, [pay.label, pay.amount != null ? pay.amount + ' ' + pay.currency : ''].filter(Boolean).join(' · ')]; }
    if (p2 === 'files') return [del ? 'Dosyayı sildi' : 'Dosya yükledi', t, (j.file && j.file.name) || ''];
    if (del) return ['Booking’i sildi', (j.deleted && j.deleted.artist) || ''];
    return [j.stageChanged ? 'Booking durumunu değiştirdi' : 'Booking’i düzenledi', t, j.stageChanged ? j.stageChanged : ''];
  }
  if (a === 'team') {
    const t = (j.member && j.member.name) || '';
    if (!p1) return ['Ekibe üye ekledi', t, j.member ? ROLES[j.member.role].label : ''];
    if (p2 === 'link') return ['Şifre belirleme linki oluşturdu', t];
    if (del) return ['Ekip üyesini sildi', (j.deleted && j.deleted.name) || ''];
    return ['Ekip üyesini düzenledi', t, j.member ? ROLES[j.member.role].label + (j.member.active ? '' : ' · erişim kapalı') : ''];
  }
  if (a === 'venue-links' && p1 === 'notes') return [b.note ? 'Mekân için masa notu yazdı' : 'Mekân için masa notunu sildi', j.eventTitle || '', j.table ? j.table.name + (j.table.label ? ' · ' + j.table.label : '') : ''];
  if (a === 'venue-links' && typeof b.invite === 'boolean' && !b.close) return [b.invite ? 'Mekânın davet linkini açtı' : 'Mekânın davet linkini kapattı', j.venue || ''];
  if (a === 'venue-links' && typeof b.scan === 'boolean' && !b.close) return [b.scan ? 'Mekân portalında QR okumayı açtı' : 'Mekân portalında QR okumayı kapattı', j.venue || ''];
  if (a === 'venue-links') return [b.close ? 'Mekân portalı linkini kapattı' : j.renewed ? 'Mekân portalı linkini yeniledi' : 'Mekân portalı linki oluşturdu', j.venue || ''];
  if (a === 'backups') {
    if (!p1) return ['Yedek aldı', '', (j.backup && j.backup.total) + ' kayıt'];
    if (p2 === 'restore') return b.step === 'begin' ? ['Yedekten geri yüklemeyi başlattı', p1] : b.step === 'finish' ? ['Yedekten geri yükleme tamamlandı', p1] : null;
    return null;
  }
  if (a === 'tickets') {
    const t = j.eventTitle || await title(p1);
    if (p1 === 'webhooks') return p3 === 'test' ? null : [del ? 'Webhook sildi' : put ? 'Webhook ayarını değiştirdi' : 'Webhook ekledi', '', (j.hook && j.hook.url) || ''];
    if (p2 === 'message') return b.dryRun || parseInt(b.from, 10) > 0 ? null : ['Bilet sahiplerine mesaj gönderdi', t, str(b.subject, 100) + ' · ' + j.total + ' kişi'];
    if (p2 === 'map') return ['Masa planını kaydetti', t, (j.map ? j.map.tables.length : 0) + ' masa'];
    if (p1 === 'settings') return ['Bilet satış ayarlarını düzenledi', '', b.provider != null ? 'sağlayıcı: ' + (b.provider || 'yok') : ''];
    if (p2 === 'shop') return ['enabled' in b ? (b.enabled ? 'Bilet satışını açtı' : 'Bilet satışını kapattı') : 'Bilet satış ayarını düzenledi', t];
    if (p2 === 'types') return [del ? 'Bilet türünü sildi' : put ? 'Bilet türünü düzenledi' : 'Bilet türü ekledi', t, j.type ? j.type.name + ' · ' + j.type.price + (j.type.stock ? ' · stok ' + j.type.stock : '') : ''];
    if (p2 === 'promoters') return [del ? 'Promoteri sildi' : put ? 'Promoteri düzenledi' : 'Promoter ekledi', t, j.promoter ? j.promoter.name + ' · ' + j.promoter.code : ''];
    if (p2 === 'codes') return [del ? 'Kodu sildi' : put ? 'Kodu düzenledi' : 'Kod oluşturdu', t, j.code ? j.code.code : ''];
    if (p2 === 'orders') {
      const o = j.order || {}, who = (o.buyer && o.buyer.name) || '';
      if (!p3) return [o.channel === 'boxoffice' ? 'Kapıda bilet sattı' : 'Davetiye bileti verdi', who, t + ' · ' + (o.items || []).map((i) => i.qty + '× ' + i.name).join(', ') + (o.total ? ' · ' + o.total + ' ' + o.currency : '')];
      if (parts[4] === 'refund') return ['Bilet iadesi yaptı', who, t + ' · ' + o.no + ' · ' + j.refund.tickets + ' bilet · ' + j.refund.amount + ' ' + j.refund.currency];
      if (parts[4] === 'resend') return ['Biletleri yeniden gönderdi', who, t + ' · ' + o.no];
      if (parts[4] === 'collect') return ['Kalan tutarı kapıda tahsil etti', who, t + ' · ' + o.no + ' · ' + o.collected.amount + ' ' + o.currency];
    }
    return null;
  }
  if (a === 'pnl') return [j.removed ? 'Kâr/zarar satırını sildi' : j.line ? 'Kâr/zarar satırı kaydetti' : 'Kâr/zarar ayarını düzenledi', j.eventTitle || await title(p1), j.line ? j.line.label + ' · ' + j.line.amount + ' ' + j.line.currency : j.removed ? j.removed.label : ''];
  if (a === 'images' || a === 'me') return null;
  return [m + ' ' + parts.join('/'), ''];
}
export async function auditRoute(url, s) {
  const limit = 80, before = str(url.searchParams.get('before'), 80), uid = str(url.searchParams.get('uid'), 40);
  let keys = (await s.list('audit/')).sort().reverse();
  if (before) keys = keys.filter((k) => k < before);
  const out = []; let last = '';
  for (const k of keys) { // newest first; with a person filter this walks further back until a page is full
    const r = await s.get(k); last = k;
    if (r && (!uid || r.uid === uid)) out.push(r);
    if (out.length >= limit) break;
  }
  return json({ entries: out, next: out.length >= limit && last !== keys[keys.length - 1] ? last : null });
}

/* ---------- members ---------- */
const view = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, hasPassword: !!u.pass, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || '', linkExpiresAt: u.setup && Date.parse(u.setup.expiresAt) > Date.now() ? u.setup.expiresAt : '' });
async function newLink(s, u) { // one link at a time: the previous one stops working
  if (u.setup && u.setup.token) await s.del('setup/' + u.setup.token);
  u.setup = { token: token(24), expiresAt: new Date(Date.now() + SETUP_HOURS * 3600 * 1000).toISOString() };
  await s.set('setup/' + u.setup.token, { uid: u.id });
  return '/hq?kur=' + u.setup.token;
}
export async function teamRoute(req, parts, s) {
  const m = req.method;
  if (!parts[1] && m === 'GET') {
    const us = []; for (const k of await s.list('users/')) { const u = await s.get(k); if (u) us.push(view(u)); }
    return json({ owner: { ...ownerUser(), roleLabel: ROLES.owner.label }, members: us.sort((a, b) => a.name.localeCompare(b.name, 'tr')), roles: MEMBER_ROLES.map((k) => ({ key: k, ...ROLES[k] })), linkHours: SETUP_HOURS });
  }
  if (!parts[1] && m === 'POST') {
    const b = await body(req), u = { id: id(), name: str(b.name, 80), email: normEmail(b.email), role: MEMBER_ROLES.includes(b.role) ? b.role : '', active: true, pass: null, sv: 0, createdAt: now(), updatedAt: now() };
    if (!u.name || !emailOk(u.email)) return fail(400, 'Ad ve geçerli bir e-posta gerekli.');
    if (!u.role) return fail(400, 'Bir rol seçin.');
    if (u.email === ownerUser().email) return fail(409, 'Bu e-posta HQ sahibine ait.');
    if (!(await s.create('userEmail/' + hash(u.email), { id: u.id }))) return fail(409, 'Bu e-postayla bir ekip üyesi zaten var.');
    const link = await newLink(s, u); await s.set('users/' + u.id, u);
    return json({ member: view(u), setupUrl: link }, 201);
  }
  const u = await s.get('users/' + parts[1]); if (!u) return fail(404, 'Ekip üyesi bulunamadı.');
  if (parts[2] === 'link' && m === 'POST') { // also the way to reset a forgotten password: every open session of theirs ends
    u.sv = (u.sv || 0) + 1; u.pass = null; u.updatedAt = now();
    const link = await newLink(s, u); await s.set('users/' + u.id, u);
    return json({ member: view(u), setupUrl: link });
  }
  if (!parts[2] && m === 'PUT') {
    const b = await body(req);
    if ('name' in b) { u.name = str(b.name, 80); if (!u.name) return fail(400, 'Ad boş olamaz.'); }
    if ('role' in b) { if (!MEMBER_ROLES.includes(b.role)) return fail(400, 'Geçersiz rol.'); u.role = b.role; }
    if ('active' in b) { u.active = !!b.active; if (!u.active) u.sv = (u.sv || 0) + 1; }
    u.updatedAt = now(); await s.set('users/' + u.id, u);
    return json({ member: view(u) });
  }
  if (!parts[2] && m === 'DELETE') {
    if (u.setup && u.setup.token) await s.del('setup/' + u.setup.token);
    await s.del('userEmail/' + hash(u.email)); await s.del('users/' + u.id);
    return json({ ok: true, deleted: { name: u.name } });
  }
  return fail(404, 'Bulunamadı.');
}

// The one-time link: shows whose account it is, then stores the password that person chose and signs them in.
export async function setupRoute(req, url, s) {
  const b = req.method === 'POST' ? await body(req) : {}, t = str(req.method === 'POST' ? b.t : url.searchParams.get('t'), 60);
  const ref = t && await s.get('setup/' + t), u = ref && await s.get('users/' + ref.uid);
  if (!u || !u.active || !u.setup || u.setup.token !== t || Date.parse(u.setup.expiresAt) < Date.now()) return fail(404, 'Bu link geçerli değil ya da süresi dolmuş. Yeni bir link isteyin.');
  if (req.method === 'GET') return json({ name: u.name, email: u.email, role: ROLES[u.role].label, minLength: MIN_PASSWORD });
  if (req.method !== 'POST') return fail(405, 'Desteklenmiyor.');
  const pw = String(b.password || '');
  if (pw.length < MIN_PASSWORD) return fail(400, 'Şifre en az ' + MIN_PASSWORD + ' karakter olmalı.');
  if (pw.length > 200) return fail(400, 'Şifre çok uzun.');
  await s.del('setup/' + t);
  u.pass = hashPassword(pw); u.setup = null; u.sv = (u.sv || 0) + 1; u.lastLoginAt = now(); u.updatedAt = now();
  await s.set('users/' + u.id, u);
  await logAudit(s, { id: u.id, name: u.name, email: u.email, role: u.role }, 'Şifresini belirledi', '');
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req, u) });
}

// A member changes their own password; other devices are signed out, this one stays in.
export async function meRoute(req, parts, s, me) {
  if (parts[1] !== 'password' || req.method !== 'POST') return fail(404, 'Bulunamadı.');
  if (me.id === 'owner') return fail(400, 'Sahip şifresi Netlify’daki HQ_ADMIN_PASSWORD değişkeninden değiştirilir.');
  const { verifyPassword } = await import('./auth.mjs');
  const b = await body(req), u = await s.get('users/' + me.id), pw = String(b.next || '');
  if (!u || !verifyPassword(b.current, u.pass)) return fail(400, 'Mevcut şifre hatalı.');
  if (pw.length < MIN_PASSWORD || pw.length > 200) return fail(400, 'Yeni şifre en az ' + MIN_PASSWORD + ' karakter olmalı.');
  u.pass = hashPassword(pw); u.sv = (u.sv || 0) + 1; u.updatedAt = now(); await s.set('users/' + u.id, u);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req, u) });
}
