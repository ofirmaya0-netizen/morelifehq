// Data shapes and rules shared by the admin API, the guest API and the public page renderer.
import { str, int, slugify, isoIst, dateEn, istNow, TZ } from './util.mjs';

export const SITE_URL = () => (process.env.URL && process.env.CONTEXT === 'production' ? process.env.URL : 'https://morelife.events').replace(/\/$/, '');
export const RSVP_STATUS = ['pending', 'approved', 'waitlist', 'rejected', 'cancelled'];

// Fields a visitor can see. They are copied into event.live when the event is published;
// edits stay in the draft until "Değişiklikleri yayınla".
export const PUBLIC_FIELDS = ['slug', 'title', 'artist', 'support', 'venue', 'city', 'date', 'time', 'endDate', 'endTime', 'doors', 'ageLimit', 'description', 'imageId', 'imageAlt', 'ticketUrl', 'useTickets', 'useRsvp', 'eventStatus', 'inviteTitle', 'inviteText', 'wideImageId', 'seo'];
const TEXT = { title: 160, artist: 160, support: 300, venue: 160, city: 80, description: 4000, imageId: 60, wideImageId: 60, waPromo: 300, imageAlt: 200, ticketUrl: 500, ageLimit: 20, inviteTitle: 160, inviteText: 1500 };
const SEO_TEXT = { title: 120, description: 320, canonical: 300, ogTitle: 120, ogDescription: 320, ogImageId: 60 };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v), isTime = (v) => /^\d{2}:\d{2}$/.test(v), isDT = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);

export function seoInput(b, prev = {}) {
  const s = { ...prev };
  for (const k of Object.keys(SEO_TEXT)) if (b && k in b) s[k] = str(b[k], SEO_TEXT[k]);
  if (b && 'index' in b) s.index = ['index', 'noindex'].includes(b.index) ? b.index : 'default';
  if (s.canonical && !/^https:\/\//.test(s.canonical)) return { error: 'Canonical adres https:// ile başlamalı.' };
  return { seo: s };
}

export function eventInput(b, prev = {}) {
  const e = { ...prev, invite: { enabled: true, opensAt: '', closesAt: '', plusOnes: 0, askPhone: 'optional', askNote: true, showGuests: true, ...(prev.invite || {}) }, seo: { ...(prev.seo || {}) } };
  for (const f of Object.keys(TEXT)) if (f in b) e[f] = str(b[f], TEXT[f]);
  if ('waPromo' in b) e.waPromo = e.waPromo.replace(/\s+/g, ' ').trim(); // WhatsApp template variables cannot contain line breaks
  for (const f of ['date', 'endDate']) if (f in b) { e[f] = str(b[f], 10); if (e[f] && !isDate(e[f])) return { error: 'Tarih geçersiz.' }; }
  for (const f of ['time', 'endTime', 'doors']) if (f in b) { e[f] = str(b[f], 5); if (e[f] && !isTime(e[f])) return { error: 'Saat geçersiz.' }; }
  if ('slug' in b) e.slug = slugify(b.slug);
  if ('capacity' in b) e.capacity = int(b.capacity, 0, 100000);
  if ('visibility' in b) e.visibility = b.visibility === 'private' ? 'private' : 'public';
  if ('useTickets' in b) e.useTickets = !!b.useTickets;
  if ('useRsvp' in b) e.useRsvp = !!b.useRsvp;
  if ('eventStatus' in b) e.eventStatus = ['cancelled', 'postponed', 'rescheduled'].includes(b.eventStatus) ? b.eventStatus : 'scheduled';
  if (b.invite && typeof b.invite === 'object') {
    const i = b.invite, t = e.invite;
    if ('enabled' in i) t.enabled = !!i.enabled;
    for (const f of ['opensAt', 'closesAt']) if (f in i) { t[f] = str(i[f], 16); if (t[f] && !isDT(t[f])) return { error: 'Form açılış/kapanış zamanı geçersiz.' }; }
    if ('plusOnes' in i) t.plusOnes = int(i.plusOnes, 0, 10);
    if ('askPhone' in i) t.askPhone = ['off', 'required'].includes(i.askPhone) ? i.askPhone : 'optional';
    if ('askNote' in i) t.askNote = !!i.askNote;
    if ('showGuests' in i) t.showGuests = !!i.showGuests;
    if (t.opensAt && t.closesAt && t.closesAt <= t.opensAt) return { error: 'Form kapanışı açılıştan sonra olmalı.' };
  }
  if (b.seo) { const r = seoInput(b.seo, e.seo); if (r.error) return r; e.seo = r.seo; }
  if (!e.title) return { error: 'Etkinlik adı gerekli.' };
  if (!e.slug) e.slug = slugify(e.title) || 'etkinlik';
  if (e.ticketUrl && !/^https:\/\//.test(e.ticketUrl)) return { error: 'Bilet linki https:// ile başlamalı.' };
  if (e.endDate && e.date && (e.endDate + (e.endTime || '')) < (e.date + (e.time || ''))) return { error: 'Bitiş, başlangıçtan önce olamaz.' };
  e.tz = TZ;
  if (e.useTickets == null) e.useTickets = !!e.ticketUrl;
  if (e.useRsvp == null) e.useRsvp = true;
  e.eventStatus = e.eventStatus || 'scheduled';
  return { event: e };
}

export const snapshot = (e) => { const o = {}; for (const f of PUBLIC_FIELDS) o[f] = f === 'seo' ? { ...(e.seo || {}) } : e[f]; return o; };
export const isDirty = (e) => !!e.live && JSON.stringify(snapshot(e)) !== JSON.stringify(snapshot({ ...e.live }));
export const live = (e) => (e.status === 'published' && e.live ? { ...e, ...e.live } : null); // what the public sees
export const isListed = (e) => e.status === 'published' && e.visibility === 'public' && !!e.live;

export function formState(e) {
  const i = e.invite || {}, t = istNow();
  if (!e.useRsvp || i.enabled === false) return 'off';
  if (e.eventStatus === 'cancelled') return 'off';
  if (i.opensAt && t < i.opensAt) return 'early';
  if (i.closesAt && t > i.closesAt) return 'closed';
  return 'open';
}

/* ---------- SEO ---------- */
export const DEFAULT_SEO_SETTINGS = {
  orgName: 'More Life', siteName: 'More Life',
  homeTitle: 'More Life — Event production & talent booking',
  homeDescription: 'More Life is an independent event production and talent booking company, founded in Istanbul in 2023.',
  eventTitle: '{title} — {venue}, {date} | More Life',
  eventDescription: '{title} at {venue}, {city} on {date}. Tickets, line-up and details from More Life.',
  defaultOgImageId: '', sameAs: ['https://www.instagram.com/themorelifecommunity/']
};
const fill = (tpl, e) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (k === 'date' ? dateEn(e.date) : str(e[k], 200)) || '').replace(/\s+—\s*,/g, ' —').replace(/ at , /g, ' ').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').replace(/[\s,—|-]+$/g, '').replace(/—\s*\|/g, '|').trim();
const img = (id) => (id ? SITE_URL() + '/api/public/image/' + id : '');

// Effective tags for one page plus where each value came from ("custom" or "default").
export function eventSeo(e, set) {
  const s = e.seo || {}, from = {}, pick = (k, v, d) => { from[k] = v ? 'custom' : 'default'; return v || d; };
  const url = SITE_URL() + '/events/' + e.slug;
  const title = pick('title', s.title, fill(set.eventTitle, e) || e.title);
  const description = pick('description', s.description, (e.description ? str(e.description.replace(/\s+/g, ' '), 155) : fill(set.eventDescription, e)));
  const noindex = e.visibility === 'private' || s.index === 'noindex';
  return { url, title, description, canonical: pick('canonical', s.canonical, url), noindex, indexSetting: s.index || 'default',
    ogTitle: pick('ogTitle', s.ogTitle, title), ogDescription: pick('ogDescription', s.ogDescription, description),
    ogImage: pick('ogImage', img(s.ogImageId), img(e.wideImageId) || img(e.imageId) || img(set.defaultOgImageId)), from };
}
export function homeSeo(p, set) {
  const s = (p && p.seo) || {}, from = {}, pick = (k, v, d) => { from[k] = v ? 'custom' : 'default'; return v || d; };
  const url = SITE_URL() + '/';
  const title = pick('title', s.title, set.homeTitle), description = pick('description', s.description, set.homeDescription);
  return { url, title, description, canonical: pick('canonical', s.canonical, url), noindex: s.index === 'noindex', indexSetting: s.index || 'default',
    ogTitle: pick('ogTitle', s.ogTitle, title), ogDescription: pick('ogDescription', s.ogDescription, description),
    ogImage: pick('ogImage', img(s.ogImageId), img(set.defaultOgImageId)), from };
}

export function eventJsonLd(e, set) {
  const status = { cancelled: 'EventCancelled', postponed: 'EventPostponed', rescheduled: 'EventRescheduled' }[e.eventStatus] || 'EventScheduled';
  const ld = { '@context': 'https://schema.org', '@type': 'MusicEvent', name: e.title, url: SITE_URL() + '/events/' + e.slug,
    eventStatus: 'https://schema.org/' + status, eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    organizer: { '@type': 'Organization', name: set.orgName, url: SITE_URL() + '/' } };
  if (e.date) ld.startDate = isoIst(e.date, e.time);
  if (e.endDate) ld.endDate = isoIst(e.endDate, e.endTime);
  if (e.doors && e.date) ld.doorTime = isoIst(e.date, e.doors);
  if (e.description) ld.description = str(e.description, 1000);
  if (e.imageId) ld.image = [img(e.imageId)];
  if (e.venue) ld.location = { '@type': 'Place', name: e.venue, address: e.city ? { '@type': 'PostalAddress', addressLocality: e.city } : undefined };
  const acts = [e.artist, ...(e.support || '').split(',')].map((x) => str(x, 120)).filter(Boolean);
  if (acts.length) ld.performer = acts.map((name) => ({ '@type': 'PerformingGroup', name }));
  if (e.ageLimit) ld.typicalAgeRange = e.ageLimit;
  // Only a ticket link the admin entered and switched on counts as an offer; no price is claimed.
  if (e.useTickets && e.ticketUrl && e.eventStatus !== 'cancelled') ld.offers = { '@type': 'Offer', url: e.ticketUrl };
  return ld;
}
export const orgJsonLd = (set) => ({ '@context': 'https://schema.org', '@type': 'Organization', name: set.orgName, url: SITE_URL() + '/', logo: SITE_URL() + '/img/logo.svg', sameAs: (set.sameAs || []).filter(Boolean) });

/* ---------- views of an event ---------- */
export const guestEvent = (e) => ({ slug: e.slug, title: e.title, artist: e.artist, support: e.support, date: e.date, time: e.time, endDate: e.endDate, endTime: e.endTime, doors: e.doors, ageLimit: e.ageLimit, venue: e.venue, city: e.city, description: e.description, eventStatus: e.eventStatus,
  ticketUrl: e.useTickets ? e.ticketUrl : '', image: e.imageId ? '/api/public/image/' + e.imageId : '', imageAlt: e.imageAlt || '', url: '/events/' + e.slug });
// Guest list shown on the event page: only approved guests who ticked "show my name". Initials for everyone,
// full names only for a visitor who holds a valid entry pass for the same event.
export const initials = (name) => { const w = String(name || '').trim().split(/\s+/).filter(Boolean); return ((w[0] || '').slice(0, 1) + (w.length > 1 ? w[w.length - 1].slice(0, 1) : '')).toLocaleUpperCase('tr'); };
export function guestList(rs, withNames) {
  const ok = rs.filter((r) => r.status === 'approved'), shown = ok.filter((r) => r.showName).sort((a, b) => (a.decidedAt || '').localeCompare(b.decidedAt || ''));
  return { going: ok.reduce((n, r) => n + (r.guests || 1), 0), names: !!withNames, guests: shown.map((r) => (withNames ? { i: initials(r.name), n: r.name, g: r.guests || 1 } : { i: initials(r.name) })) };
}
export const guestsOf = (rs, status) => rs.filter((r) => r.status === status).reduce((n, r) => n + (r.guests || 1), 0);
export const counts = (rs) => ({ pending: rs.filter((r) => r.status === 'pending').length, approved: guestsOf(rs, 'approved'), approvedCount: rs.filter((r) => r.status === 'approved').length, waitlist: rs.filter((r) => r.status === 'waitlist').length,
  rejected: rs.filter((r) => r.status === 'rejected').length, cancelled: rs.filter((r) => r.status === 'cancelled').length, checkedIn: rs.filter((r) => r.checkedInAt).reduce((n, r) => n + (r.guests || 1), 0), total: rs.length });
