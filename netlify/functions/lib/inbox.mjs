// Incoming WhatsApp messages. Bird posts every message sent to the More Life line to /api/public/wa-hook; each one is
// checked against the signing key, stored once and shown in HQ → Mesajlar, where it can be answered inside WhatsApp's
// 24-hour window. The signing key is made by the server when the hook is connected and never leaves it.
import crypto from 'node:crypto';
import { json, fail, now, str, normPhone, body } from './util.mjs';
import { hash, id } from './auth.mjs';
import { all } from './store.mjs';
import { waStatus, waCall, channelId } from './whatsapp.mjs';

const CFG = 'config/waHook', WINDOW = 24 * 3600 * 1000, MAX_BODY = 256 * 1024;
const OPT_OUT = /^\s*(stop|unsubscribe|dur|durdur)\s*[.!]?\s*$/i, OPT_TAG = 'mesaj-istemiyor';
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
const hookKey = async (s) => process.env.BIRD_WEBHOOK_SECRET || ((await s.get(CFG)) || {}).key || '';
export async function hookStatus(s) { const c = (await s.get(CFG)) || {}; return { connected: !!(c.id || process.env.BIRD_WEBHOOK_SECRET), url: c.url || '', at: c.at || '', manual: !c.id && !!process.env.BIRD_WEBHOOK_SECRET }; }

// Bird's Channels API signs: timestamp \n request URL \n sha256(body), HMAC-SHA256 with the subscription's signing key.
function signedChannels(raw, h, urls, key) {
  const sig = h.get('messagebird-signature'), ts = h.get('messagebird-request-timestamp');
  if (!sig || !ts) return false;
  const got = Buffer.from(sig, 'base64'), sum = crypto.createHash('sha256').update(raw).digest();
  return urls.some((u) => same(crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from(ts + '\n' + u + '\n'), sum])).digest(), got));
}
// Bird's newer webhooks (a whsec_ secret) sign: id.timestamp.body, and are refused when older than five minutes.
function signedStandard(raw, h, key) {
  const wid = h.get('webhook-id'), ts = h.get('webhook-timestamp'), sig = h.get('webhook-signature');
  if (!wid || !ts || !sig || !/^whsec_/.test(key) || !(Math.abs(Date.now() / 1000 - Number(ts)) <= 300)) return false;
  const exp = crypto.createHmac('sha256', Buffer.from(key.slice(6), 'base64')).update(Buffer.concat([Buffer.from(wid + '.' + ts + '.'), raw])).digest();
  return sig.split(' ').filter((x) => x.startsWith('v1,')).some((x) => same(exp, Buffer.from(x.slice(3), 'base64')));
}

const KIND = { image: 'Görsel', file: 'Dosya', document: 'Dosya', audio: 'Ses kaydı', video: 'Video', sticker: 'Çıkartma', location: 'Konum', contact_cards: 'Kişi kartı', list: 'Liste yanıtı' };
// One shape for both of Bird's payloads: { birdId, phone, name, at, kind, text } or null when it is not an incoming message.
export function parseInbound(j) {
  if (j && j.event === 'whatsapp.inbound' && j.payload) {
    const p = j.payload, c = (p.sender && p.sender.contact) || {}, b = p.body || {}, kind = str(b.type, 20) || 'text', part = b[kind] || {};
    const text = str((b.text && b.text.text) || part.text || part.caption || '', 4000);
    return { birdId: str(p.id, 80), phone: normPhone(c.identifierValue), name: str((c.annotations && c.annotations.name) || '', 120), at: p.createdAt, kind, text };
  }
  if (j && j.type === 'whatsapp.received' && j.data) {
    const d = j.data, f = d.from || {}, kind = ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact_cards'].find((k) => d[k]) || (d.interactive_reply ? 'text' : 'unsupported');
    const ir = d.interactive_reply && (d.interactive_reply.button || d.interactive_reply.list), part = d[kind] || {};
    return { birdId: str(d.whatsapp_id, 80), phone: normPhone(f.phone_number), name: str(f.display_name || '', 120), at: j.timestamp, kind, text: str((ir && ir.text) || part.body || part.caption || part.name || '', 4000) };
  }
  return null;
}
const threadKey = (phone) => hash(phone).slice(0, 24);
const iso = (t) => { const ms = Date.parse(t || ''); return ms && ms <= Date.now() + 60000 ? new Date(ms).toISOString() : now(); };

export async function waHook(req, s, url) {
  if (req.method !== 'POST') return fail(405, 'Method not allowed');
  const key = await hookKey(s);
  if (!key) return fail(503, 'Not connected');
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY) return fail(413, 'Too large');
  const cfg = (await s.get(CFG)) || {}, urls = [...new Set([req.url, url.origin + url.pathname, cfg.url].filter(Boolean))];
  if (!signedChannels(raw, req.headers, urls, key) && !signedStandard(raw, req.headers, key)) return fail(401, 'Bad signature');
  let j = null; try { j = JSON.parse(raw.toString('utf8')); } catch {}
  const m = parseInbound(j);
  if (!m || !m.birdId || !/^\+\d{8,15}$/.test(m.phone)) return json({ ok: true, stored: false }); // other events are acknowledged and dropped
  if (!(await s.create('waseen/' + hash(m.birdId), { at: now() }))) return json({ ok: true, stored: false }); // Bird delivers at least once
  const k = threadKey(m.phone), at = iso(m.at), hit = await s.get('contactPhone/' + hash(m.phone)), c = hit && await s.get('contacts/' + hit.id);
  const stop = m.kind === 'text' && OPT_OUT.test(m.text);
  await s.set('wamsgs/' + k + '/' + at + '~' + id(), { dir: 'in', at, kind: m.kind, text: m.text, birdId: m.birdId });
  const t = (await s.get('wathreads/' + k)) || { key: k, phone: m.phone, createdAt: now(), readAt: '' };
  Object.assign(t, { name: m.name || t.name || '', contactId: c ? c.id : '', lastAt: at > (t.lastAt || '') ? at : t.lastAt, lastInAt: at > (t.lastInAt || '') ? at : t.lastInAt });
  if (t.lastAt === at) { t.lastText = preview(m); t.lastDir = 'in'; }
  if (stop) t.optOut = at;
  await s.set('wathreads/' + k, t);
  // "Reply STOP to opt out" is the promise in the invitation's footer: the contact is never sent an invitation again.
  if (stop && c && !(c.tags || []).includes(OPT_TAG)) { c.tags = (c.tags || []).concat(OPT_TAG); c.updatedAt = now(); await s.set('contacts/' + c.id, c); }
  return json({ ok: true, stored: true });
}
const preview = (m) => (m.kind === 'text' || !KIND[m.kind] ? m.text || (m.kind === 'text' ? '' : '[' + (KIND[m.kind] || 'Desteklenmeyen mesaj') + ']') : '[' + KIND[m.kind] + ']' + (m.text ? ' ' + m.text : '')).slice(0, 160);
const unread = (t) => !!t.lastInAt && t.lastInAt > (t.readAt || '');
export const unreadThreads = async () => (await all('wathreads/')).filter(unread).length;

async function connect(s, origin, me) {
  const url = origin + '/api/public/wa-hook', prev = (await s.get(CFG)) || {}, key = crypto.randomBytes(32).toString('base64');
  if (prev.id) { try { await waCall('/webhook-subscriptions/' + prev.id, 'DELETE'); } catch {} }
  const ch = await channelId(s);
  await s.set(CFG, { key, url, at: '', id: '' }); // the key is in place before Bird can send the first message
  let j; try { j = await waCall('/webhook-subscriptions', 'POST', { service: 'channels', event: 'whatsapp.inbound', url, signingKey: key, eventFilters: [{ key: 'channelId', value: ch }] }); }
  catch (e) { await s.del(CFG); throw e; }
  await s.set(CFG, { key, url, id: str(j.id, 80), channelId: ch, at: now(), by: me.name });
}

export async function inboxRoute(req, parts, url, s, me) {
  const m = req.method;
  if (!parts[1] && m === 'GET') {
    const names = new Map(); const ts = (await all('wathreads/')).sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
    for (const t of ts) if (t.contactId && !names.has(t.contactId)) { const c = await s.get('contacts/' + t.contactId); names.set(t.contactId, c ? c.name : ''); }
    return json({ whatsapp: waStatus(), hook: await hookStatus(s), hookUrl: url.origin + '/api/public/wa-hook', threads: ts.map((t) => ({ ...t, contactName: names.get(t.contactId) || '', unread: unread(t) })) });
  }
  if (parts[1] === 'connect') {
    if (!waStatus().connected) return fail(409, 'WhatsApp bağlı değil.');
    if (m === 'POST') { try { await connect(s, url.origin, me); } catch (e) { return fail(502, 'Bird bağlantıyı kabul etmedi: ' + String(e.message || e)); } return json({ hook: await hookStatus(s) }); }
    if (m === 'DELETE') { const c = (await s.get(CFG)) || {}; if (c.id) { try { await waCall('/webhook-subscriptions/' + c.id, 'DELETE'); } catch (e) { return fail(502, 'Bird bağlantıyı kaldırmadı: ' + String(e.message || e)); } } await s.del(CFG); return json({ hook: await hookStatus(s) }); }
    return fail(404, 'Bulunamadı.');
  }
  const k = str(parts[1], 40).replace(/[^a-f0-9]/g, ''), t = k && await s.get('wathreads/' + k);
  if (!t) return fail(404, 'Konuşma bulunamadı.');
  const open = !!t.lastInAt && Date.now() - Date.parse(t.lastInAt) < WINDOW;
  if (!parts[2] && m === 'GET') {
    const c = t.contactId && await s.get('contacts/' + t.contactId);
    return json({ thread: { ...t, contactName: c ? c.name : '', unread: unread(t) }, messages: (await all('wamsgs/' + k + '/')).sort((a, b) => a.at.localeCompare(b.at)), canReply: open && waStatus().connected, windowEnds: t.lastInAt ? new Date(Date.parse(t.lastInAt) + WINDOW).toISOString() : '' });
  }
  if (parts[2] === 'read' && m === 'POST') { t.readAt = now(); await s.set('wathreads/' + k, t); return json({ ok: true }); }
  if (parts[2] === 'reply' && m === 'POST') {
    const text = str((await body(req)).text, 4000);
    if (!text) return fail(400, 'Mesaj boş.');
    if (!waStatus().connected) return fail(409, 'WhatsApp bağlı değil.');
    if (!open) return fail(409, 'Bu kişinin son mesajının üzerinden 24 saat geçti. WhatsApp bu süreden sonra yalnızca onaylı şablon mesajına izin verir.');
    let j; try { j = await waCall('/channels/' + (await channelId(s)) + '/messages', 'POST', { receiver: { contacts: [{ identifierValue: t.phone, identifierKey: 'phonenumber' }] }, body: { type: 'text', text: { text } } }); }
    catch (e) { return fail(502, 'WhatsApp gönderilemedi: ' + String(e.message || e)); }
    const at = now(), msg = { dir: 'out', at, kind: 'text', text, birdId: str(j.id, 80), by: me.name };
    await s.set('wamsgs/' + k + '/' + at + '~' + id(), msg);
    Object.assign(t, { lastAt: at, lastText: text.slice(0, 160), lastDir: 'out', readAt: at }); await s.set('wathreads/' + k, t);
    return json({ message: msg, thread: t });
  }
  return fail(404, 'Bulunamadı.');
}
