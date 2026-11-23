// Server-rendered public pages: home (with published content + SEO tags), event pages, invite pages, sitemap, robots.
import { esc, dateEn, str } from './util.mjs';
import { SITE_URL, eventSeo, homeSeo, eventJsonLd, orgJsonLd, formState } from './model.mjs';
import { SITE_HTML } from './site-html.mjs';

const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
function headTags(seo, extra = '') {
  return '<title>' + esc(seo.title) + '</title>\n<meta name="description" content="' + esc(seo.description) + '">\n' +
    '<link rel="canonical" href="' + esc(seo.canonical) + '">\n<meta name="robots" content="' + (seo.noindex ? 'noindex, nofollow' : 'index, follow') + '">\n' +
    '<meta property="og:type" content="website">\n<meta property="og:site_name" content="More Life">\n<meta property="og:url" content="' + esc(seo.canonical) + '">\n' +
    '<meta property="og:title" content="' + esc(seo.ogTitle) + '">\n<meta property="og:description" content="' + esc(seo.ogDescription) + '">\n' +
    (seo.ogImage ? '<meta property="og:image" content="' + esc(seo.ogImage) + '">\n' : '') +
    '<meta name="twitter:card" content="' + (seo.ogImage ? 'summary_large_image' : 'summary') + '">\n<meta name="twitter:title" content="' + esc(seo.ogTitle) + '">\n<meta name="twitter:description" content="' + esc(seo.ogDescription) + '">\n' +
    (seo.ogImage ? '<meta name="twitter:image" content="' + esc(seo.ogImage) + '">\n' : '') + extra;
}
const banner = (t) => '<div style="position:fixed;z-index:9999;left:50%;bottom:16px;transform:translateX(-50%);padding:10px 16px;border-radius:999px;background:#F2C46B;color:#0E0B0A;font:600 14px Inter Tight,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)">' + esc(t) + '</div>';

/* ---------- home ---------- */
export const HOME_FIELDS = [
  ['tagline', 'Hero alt başlığı', 'Event production & talent booking', 120],
  ['cardTitle', 'Hero kartı başlığı', 'Stay close to the music.', 80],
  ['cardText', 'Hero kartı açıklaması', 'New shows. Early ticket updates.', 120],
  ['ctaText', 'Hero CTA metni', 'Join the community', 40],
  ['ctaHref', 'Hero CTA bağlantısı', '#community', 300],
  ['contactLead', 'Contact kısa açıklaması', 'An artist, a venue, an idea. Tell us what you have in mind.', 200],
  ['contactEmail', 'İletişim e-postası', 'info@morelife.events', 120],
  ['instagramUrl', 'Instagram bağlantısı', 'https://www.instagram.com/themorelifecommunity/', 300]
];
export const homeDefaults = () => Object.fromEntries(HOME_FIELDS.map((f) => [f[0], f[2]]).concat([['featuredEventId', '']]));
const setText = (html, key, text) => html.replace(new RegExp('(<(\\w+)[^>]*data-cms="' + key + '"[^>]*>)([\\s\\S]*?)(</\\2>)', 'g'), (_, open, tag, inner, close) => open + esc(text) + close);
const setHref = (html, key, href) => html.replace(new RegExp('<a([^>]*data-cms="' + key + '"[^>]*)>', 'g'), (m, attrs) => '<a' + attrs.replace(/href="[^"]*"/, 'href="' + esc(href) + '"') + '>');

export function renderHome(pageRec, set, featured, preview) {
  const c = { ...homeDefaults(), ...((preview ? pageRec && pageRec.draft : pageRec && pageRec.live) || {}) };
  const seo = homeSeo({ seo: c.seo }, set);
  if (preview) seo.noindex = true;
  let h = SITE_HTML;
  h = h.replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*>/, headTags(seo, ld(orgJsonLd(set)) + '\n'));
  h = setText(h, 'tagline', c.tagline);
  if (featured) {
    h = setText(h, 'cardTitle', featured.title); h = setText(h, 'cardText', [dateEn(featured.date), featured.venue].filter(Boolean).join(' · '));
    h = setText(h, 'cta', 'View event'); h = setHref(h, 'cta', '/events/' + featured.slug);
  } else { h = setText(h, 'cardTitle', c.cardTitle); h = setText(h, 'cardText', c.cardText); h = setText(h, 'cta', c.ctaText); h = setHref(h, 'cta', c.ctaHref); }
  h = setText(h, 'contactLead', c.contactLead);
  h = setText(h, 'contactEmail', c.contactEmail); h = setHref(h, 'contactEmail', 'mailto:' + c.contactEmail);
  h = setHref(h, 'instagram', c.instagramUrl);
  if (preview) h = h.replace('</body>', banner('Taslak önizleme — yayında değil') + '</body>');
  return h;
}

/* ---------- event + invite ---------- */
const chip = (x) => '<span class="chip" style="cursor:default">' + esc(x) + '</span>';
const para = (t) => esc(t).split(/\n{2,}/).map((p) => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
const STATUS_NOTE = { cancelled: 'This event has been cancelled.', postponed: 'This event has been postponed. A new date will be announced.', rescheduled: 'This event has a new date.' };

// mode: 'public' (/events/slug), 'invite' (/invite?t=…, private or public), 'preview' (admin only)
export function renderEvent(e, set, { mode, token = '', ga = '' }) {
  const seo = eventSeo(e, set), invite = mode === 'invite', state = formState(e);
  if (invite || mode === 'preview') seo.noindex = true;
  if (invite) { seo.canonical = SITE_URL() + '/'; seo.title = (e.inviteTitle || e.title) + ' — Invitation | More Life'; seo.ogTitle = seo.title; seo.ogImage = ''; }
  const i = e.invite || {}, when = [dateEn(e.date) + (e.time ? ' · ' + e.time : ''), e.endDate && e.endDate !== e.date ? 'until ' + dateEn(e.endDate) + (e.endTime ? ' · ' + e.endTime : '') : (e.endTime ? 'until ' + e.endTime : '')].filter(Boolean).join(' ');
  const meta = [when + (when ? ' (Istanbul time)' : ''), [e.venue, e.city].filter(Boolean).join(', '), e.doors ? 'Doors ' + e.doors : '', e.ageLimit ? 'Age ' + e.ageLimit : ''].filter(Boolean);
  const f = (id, label, type, ac, req) => '<div class="field"><label for="g-' + id + '">' + label + (req ? '' : ' <span style="opacity:.6">(optional)</span>') + '</label><input id="g-' + id + '" name="' + id + '" type="' + type + '" autocomplete="' + ac + '"' + (req ? ' required' : '') + '></div>';
  let form = '';
  if (state === 'open') {
    form = '<form class="g-form" id="g-form" novalidate><h2 class="eyebrow" style="grid-column:1/-1">' + (invite ? 'Request your place' : 'RSVP') + '</h2>' +
      (e.inviteText ? '<div style="grid-column:1/-1;color:var(--mute)">' + para(e.inviteText) + '</div>' : '') +
      f('name', 'Full name', 'text', 'name', 1) + f('email', 'Email', 'email', 'email', 1) +
      (i.askPhone !== 'off' ? f('phone', 'Phone', 'tel', 'tel', i.askPhone === 'required') : '') +
      (i.plusOnes > 0 ? '<div class="field"><label for="g-plus">Guests with you</label><select id="g-plus" name="plus">' + Array.from({ length: i.plusOnes + 1 }, (_, n) => '<option value="' + n + '">' + (n ? '+' + n : 'Just me') + '</option>').join('') + '</select></div>' : '') +
      (i.askNote ? '<div class="field" style="grid-column:1/-1"><label for="g-note">Note <span style="opacity:.6">(optional)</span></label><textarea id="g-note" name="note" rows="3"></textarea></div>' : '') +
      '<div style="position:absolute;left:-9999px" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<label class="check" for="g-consent" style="grid-column:1/-1"><input id="g-consent" name="consent" type="checkbox" required><span>More Life may use these details to manage my attendance at this event.</span></label>' +
      '<p class="g-msg" id="g-msg" role="alert" style="grid-column:1/-1"></p><button class="btn" type="submit" style="grid-column:1/-1">Send request</button></form>';
  } else if (e.useRsvp && state !== 'off') form = '<p style="color:var(--mute)">' + (state === 'early' ? 'Requests for this event are not open yet.' : 'Requests for this event are closed.') + '</p>';
  const tickets = e.useTickets && e.ticketUrl && e.eventStatus !== 'cancelled' ? '<a class="btn" id="g-tix" href="' + esc(e.ticketUrl) + '" target="_blank" rel="noopener">Get tickets ↗</a>' : '';
  const cfg = { e: e.id, t: invite ? token : '', slug: invite ? '' : e.slug, track: mode !== 'preview', ga };
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    headTags(seo, mode === 'public' ? ld(eventJsonLd(e, set)) + '\n' : '') +
    (invite ? '<meta name="referrer" content="no-referrer">\n' : '') +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600&display=swap">\n<link rel="stylesheet" href="/css/site.css">\n<link rel="stylesheet" href="/css/guest.css">\n</head>\n<body>\n<div class="g-wrap">\n' +
    '<a class="g-logo" href="/"><img src="/img/logo.svg" alt="">more life</a>\n<main class="g-card" id="card">' +
    (e.imageId ? '<img class="g-img" src="/api/public/image/' + esc(e.imageId) + '" alt="' + esc(e.imageAlt || '') + '">' : '') +
    '<p class="eyebrow">More Life presents' + (invite && e.visibility === 'private' ? ' · Private invitation' : '') + '</p>' +
    '<h1 class="g-title">' + esc(invite && e.inviteTitle ? e.inviteTitle : e.title) + '</h1>' +
    (STATUS_NOTE[e.eventStatus] ? '<p class="g-msg bad" style="font-weight:600">' + STATUS_NOTE[e.eventStatus] + '</p>' : '') +
    (e.artist || e.support ? '<p style="font-size:20px">' + esc(e.artist) + (e.support ? '<span style="color:var(--mute)"> · with ' + esc(e.support) + '</span>' : '') + '</p>' : '') +
    '<div class="g-meta">' + meta.map(chip).join('') + '</div>' +
    (e.description ? '<div class="g-desc" style="display:flex;flex-direction:column;gap:12px;color:var(--mute)">' + para(e.description) + '</div>' : '') +
    tickets + form + '</main>\n' + (mode === 'public' ? '<p style="margin-top:22px"><a class="link" href="/#events">All events</a></p>\n' : '') + '</div>\n' +
    (mode === 'preview' ? banner('Taslak önizleme — yayında değil') : '') +
    '<script>window.ML=' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';</script>\n<script src="/js/guest.js" defer></script>\n</body>\n</html>';
}

export const notFound = (title, text) => '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' + esc(title) + ' — More Life</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600&display=swap"><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/guest.css"></head><body><div class="g-wrap"><a class="g-logo" href="/"><img src="/img/logo.svg" alt="">more life</a><main class="g-card"><h1 class="g-title">' + esc(title) + '</h1><p style="color:var(--mute)">' + esc(text) + '</p><a class="btn" href="/">Go to morelife.events</a></main></div></body></html>';

/* ---------- sitemap + robots ---------- */
export function sitemap(homeIndexable, events, set) {
  const urls = [];
  if (homeIndexable) urls.push({ loc: SITE_URL() + '/' });
  for (const e of events) { const s = eventSeo(e, set); if (!s.noindex && s.canonical === s.url) urls.push({ loc: s.url, lastmod: str(e.publishedAt, 10) }); }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => '<url><loc>' + esc(u.loc) + '</loc>' + (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '</url>').join('\n') + '\n</urlset>\n';
}
export const robots = () => 'User-agent: *\nAllow: /\nDisallow: /hq\nDisallow: /api/\nDisallow: /invite\nDisallow: /pass\n\nSitemap: ' + SITE_URL() + '/sitemap.xml\n';
