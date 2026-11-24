// WhatsApp through Bird's Channels API. Active only when BIRD_ACCESS_KEY and BIRD_WORKSPACE_ID are set.
// Business-initiated messages must use a template Meta has approved; nothing is recorded as sent unless Bird accepted it.
import { normPhone, dateEn } from './util.mjs';
const API = () => (process.env.BIRD_API_URL || 'https://api.bird.com').replace(/\/$/, '');
const WS = () => process.env.BIRD_WORKSPACE_ID;
export const waStatus = () => ({ connected: !!(process.env.BIRD_ACCESS_KEY && WS()), missing: ['BIRD_ACCESS_KEY', 'BIRD_WORKSPACE_ID'].filter((k) => !process.env[k]) });
const DEFAULTS = { channelId: '', pass: { projectId: '', version: '', locale: 'en' }, invite: { projectId: '', version: '', locale: 'en' } };
export const waSettings = async (s) => { const v = (await s.get('settings/whatsapp')) || {}; return { ...DEFAULTS, ...v, pass: { ...DEFAULTS.pass, ...(v.pass || {}) }, invite: { ...DEFAULTS.invite, ...(v.invite || {}) } }; };

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
    return { status: 'sent', at: new Date().toISOString(), id: String(j.id || ''), state: String(j.status || 'accepted') };
  } catch (e) { return { status: 'failed', at: new Date().toISOString(), error: String(e.message || e) }; }
}
export const passParams = (e, r) => ({ name: r.name.split(' ')[0], event: e.title, date: [dateEn(e.date), e.time].filter(Boolean).join(' · '), venue: [e.venue, e.city].filter(Boolean).join(', '), token: r.passToken });
export const sendPassWa = async (s, e, r) => waSend(s, r.phone, (await waSettings(s)).pass, passParams(e, r));
// What the invitation message will say for this event. The wording mirrors the template submitted to Meta;
// only the cover, title, date line, promo line and first name change per event.
export const invitePreview = (e, r) => ({ image: e.wideImageId || e.imageId || '', wide: !!e.wideImageId, title: e.title, line: [dateEn(e.date), e.time, [e.venue, e.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '), promo: e.waPromo || '', name: r.name.split(' ')[0], button: 'Request your place', footer: 'Reply STOP to opt out' });
// Variables of the invitation template. The keys must match the variable names of the template in Bird.
// A contact saved without a name carries its e-mail as the name; greet those without one.
export const greetName = (c) => (/@/.test(c.name || '') ? '' : String(c.name || '').trim().split(/\s+/)[0]);
export const inviteParams = (e, c, origin, token) => { const p = invitePreview(e, { name: greetName(c) || 'Hi' }); return { name: p.name, title: p.title, line: p.line, promo: p.promo, image: p.image ? origin + '/api/public/image/' + p.image : '', token }; };
