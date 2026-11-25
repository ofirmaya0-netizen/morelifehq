// WhatsApp through Bird's Channels API. Active only when BIRD_ACCESS_KEY and BIRD_WORKSPACE_ID are set.
// Business-initiated messages must use a template Meta has approved; nothing is recorded as sent unless Bird accepted it.
import { normPhone, dateEn, str, now } from './util.mjs';
import { hash, id } from './auth.mjs';
const API = () => (process.env.BIRD_API_URL || 'https://api.bird.com').replace(/\/$/, '');
const WS = () => process.env.BIRD_WORKSPACE_ID;
export const waStatus = () => ({ connected: !!(process.env.BIRD_ACCESS_KEY && WS()), missing: ['BIRD_ACCESS_KEY', 'BIRD_WORKSPACE_ID'].filter((k) => !process.env[k]) });
const DEFAULTS = { channelId: '', pass: { projectId: '', version: '', locale: 'en', qr: false }, invite: { projectId: '', version: '', locale: 'en' }, table: { projectId: '', version: '', locale: 'en' }, tableOk: { projectId: '', version: '', locale: 'en' }, guestNames: { projectId: '', version: '', locale: 'en' } };
export const waSettings = async (s) => { const v = (await s.get('settings/whatsapp')) || {}; return { ...DEFAULTS, ...v, pass: { ...DEFAULTS.pass, ...(v.pass || {}) }, invite: { ...DEFAULTS.invite, ...(v.invite || {}) }, table: { ...DEFAULTS.table, ...(v.table || {}) }, tableOk: { ...DEFAULTS.tableOk, ...(v.tableOk || {}) }, guestNames: { ...DEFAULTS.guestNames, ...(v.guestNames || {}) } }; };

export async function waCall(path, method, body) {
  const r = await fetch(API() + '/workspaces/' + WS() + path, { method, headers: { authorization: 'AccessKey ' + process.env.BIRD_ACCESS_KEY, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j.message || j.code || (j.errors && JSON.stringify(j.errors)) || 'HTTP ' + r.status).slice(0, 240));
  return j;
}
export async function waChannels() { const j = await waCall('/channels?limit=100', 'GET'); return (j.results || []).filter((c) => /whatsapp/i.test(c.platformId || '')).map((c) => ({ id: c.id, name: c.name, status: c.status, identifier: c.identifier || '' })); }
export async function channelId(s) {
  if (process.env.BIRD_CHANNEL_ID) return process.env.BIRD_CHANNEL_ID;
  const set = await waSettings(s); if (set.channelId) return set.channelId;
  const list = await waChannels(); if (!list.length) throw new Error('Bird’de WhatsApp kanalı bulunamadı.');
  set.channelId = list[0].id; await s.set('settings/whatsapp', set); return set.channelId;
}
// tpl: { projectId, version, locale }; params: { key: value } matching the template's variable names
export async function waSend(s, to, tpl, params) {
  if (!waStatus().connected) return { status: 'off' };
  const phone = normPhone(to);
  if (!/^\+\d{8,15}$/.test(phone)) return { status: 'failed', at: new Date().toISOString(), error: 'Telefon numarası uluslararası biçimde değil (+90…).' };
  if (!tpl || !tpl.projectId || !tpl.version) return { status: 'failed', at: new Date().toISOString(), error: 'WhatsApp şablonu Ayarlar’da tanımlı değil.' };
  try {
    const j = await waCall('/channels/' + (await channelId(s)) + '/messages', 'POST', { receiver: { contacts: [{ identifierValue: phone, identifierKey: 'phonenumber' }] },
      template: { projectId: tpl.projectId, version: tpl.version, locale: tpl.locale || 'en', parameters: Object.entries(params || {}).map(([key, value]) => ({ type: 'string', key, value: String(value == null ? '' : value) })) } });
    const at = new Date().toISOString();
    try { await waRecordOut(s, phone, { birdId: String(j.id || ''), at, kind: 'template', text: tplText(await waSettings(s), tpl, params) }); } catch (e) { console.error('wa log', e); }
    return { status: 'sent', at, id: String(j.id || ''), state: String(j.status || 'accepted') };
  } catch (e) { return { status: 'failed', at: new Date().toISOString(), error: String(e.message || e) }; }
}
// qrUrl: set when the pass template has an image header (variable `qr`); WhatsApp then shows the entry QR in the message itself.
export const passParams = (e, r, qrUrl) => ({ name: r.name.split(' ')[0], event: e.title, date: [dateEn(e.date), e.time].filter(Boolean).join(' · '), venue: [e.venue, e.city].filter(Boolean).join(', '), token: r.passToken, ...(qrUrl ? { qr: qrUrl } : {}) });
export const passQrUrl = (origin, token) => origin + '/api/public/pass-qr/' + token + '.png';
export const sendPassWa = async (s, e, r, origin) => { const tpl = (await waSettings(s)).pass; return waSend(s, r.phone, tpl, passParams(e, r, tpl.qr && origin ? passQrUrl(origin, r.passToken) : '')); };
// Table link (/tables?e=<event id>) for a guest of the event. The keys must match the variable names of the template in Bird.
export const tableParams = (e, r) => ({ name: r.name.split(' ')[0], event: e.title, eventId: e.id });
// Asks an approved guest who is bringing people for their names. Template variables: name, event, guests (how many they bring).
// The answer is an ordinary WhatsApp reply; it arrives in HQ → Mesajlar.
export const guestNamesParams = (e, r) => ({ name: r.name.trim().split(/\s+/)[0], event: e.title, guests: String(Math.max(1, (r.guests || 1) - 1)) });
export const guestNamesText = (p) => 'Hi ' + p.name + ', you are confirmed for ' + p.event + ' with ' + p.guests + (p.guests === '1' ? ' guest' : ' guests') + '.\n\nCould you send us the full name of ' + (p.guests === '1' ? 'your guest' : 'each guest') + '? Just reply to this message.';
export const sendGuestNamesWa = async (s, e, r) => waSend(s, r.phone, (await waSettings(s)).guestNames, guestNamesParams(e, r));
export const sendTableWa = async (s, e, r) => waSend(s, r.phone, (await waSettings(s)).table, tableParams(e, r));
// The same code the pass page draws: scanning it at the door opens /pass?t=… and checks the guest in.
export async function passQrPng(origin, token) { const { default: QR } = await import('qrcode'); return QR.toBuffer(origin + '/pass?t=' + token, { type: 'png', width: 720, margin: 4, errorCorrectionLevel: 'M' }); }
// What the invitation message will say for this event. The wording mirrors the template submitted to Meta;
// only the cover, title, date line, promo line and first name change per event.
export const invitePreview = (e, r) => ({ image: e.wideImageId || e.imageId || '', wide: !!e.wideImageId, title: e.title, line: [dateEn(e.date), e.time, [e.venue, e.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '), promo: e.waPromo || '', name: r.name.split(' ')[0], button: 'Request your place', footer: 'Reply STOP to opt out' });
// Variables of the invitation template. The keys must match the variable names of the template in Bird.
// A contact saved without a name carries its e-mail as the name; greet those without one.
export const greetName = (c) => (/@/.test(c.name || '') ? '' : String(c.name || '').trim().split(/\s+/)[0]);
export const inviteParams = (e, c, origin, token) => { const p = invitePreview(e, { name: greetName(c) || 'Hi' }); return { name: p.name, title: p.title, line: p.line, promo: p.promo, image: p.image ? origin + '/api/public/image/' + p.image : '', token }; };

// Table confirmation: the variables of the "table confirmed" template in Bird, and the same words for the e-mail.
// q: the table request, e: the event as the public sees it (or null), c: what was confirmed, { area, party }.
export const confirmParams = (q, e, c) => ({ name: q.name.trim().split(/\s+/)[0], event: e ? e.title : '', line: e ? [dateEn(e.date), e.time, [e.venue, e.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : '', table: (c.area === 'backstage' ? 'Backstage table' : 'Table') + ' for ' + c.party, under: q.name.trim() });
// The message as the guest reads it. The WhatsApp wording mirrors the template submitted to Meta.
export const confirmText = (p) => 'Hi ' + p.name + ', your table is confirmed.\n\n' + (p.event ? p.event + '\n' + (p.line ? p.line + '\n' : '') + '\n' : '') + p.table + ', under ' + p.under + '.\nGive your name at the door.';

// What a sent template says, in one line, for the conversation in HQ → Mesajlar. The full wording lives in Bird / Meta.
export function tplText(set, tpl, params) {
  const p = params || {}, is = (x) => !!(x && x.projectId && tpl && x.projectId === tpl.projectId), label = is(set.invite) ? 'Davet' : is(set.pass) ? 'Giriş kartı' : is(set.table) ? 'Masa linki' : is(set.tableOk) ? 'Masa onayı' : is(set.guestNames) ? 'Misafir isimleri soruldu' : 'Şablon mesajı';
  const main = [p.title || p.event, p.line || p.date, p.venue, p.table].filter(Boolean);
  const rest = main.length ? main : Object.entries(p).filter(([k, v]) => !['token', 'image', 'name', 'eventId'].includes(k) && v && !/^https?:/.test(String(v))).map(([, v]) => String(v));
  return (label + (rest.length ? ': ' + rest.join(' · ') : '')).slice(0, 600);
}
// Keeps a message sent from the More Life line with its number's conversation. A number that has never written has no
// conversation in the list yet; its messages wait here and appear as history when it first writes.
export const waThreadKey = (phone) => hash(phone).slice(0, 24);
export async function waRecordOut(s, phone, m) {
  if (!/^\+\d{8,15}$/.test(phone) || (m.birdId && !(await s.create('waseen/' + hash(m.birdId), { at: now() })))) return false;
  const k = waThreadKey(phone), at = m.at || now(), msg = { dir: 'out', at, kind: m.kind || 'text', text: str(m.text, 4000), birdId: m.birdId || '', ...(m.by ? { by: m.by } : {}) };
  await s.set('wamsgs/' + k + '/' + at + '~' + id(), msg);
  const t = await s.get('wathreads/' + k);
  if (t && at > (t.lastAt || '')) { Object.assign(t, { lastAt: at, lastText: msg.text.slice(0, 160), lastDir: 'out' }, m.read ? { readAt: at } : {}); await s.set('wathreads/' + k, t); }
  return msg;
}
