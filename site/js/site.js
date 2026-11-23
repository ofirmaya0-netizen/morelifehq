(function () {
'use strict';
var TICKETS = 'https://shop.weeztix.com/fe62448d-f428-11ef-a9cb-7e126431635e';
var MAIL = 'info@morelife.events';
var HQ = /(^|\.)morelife\.events$/.test(location.hostname) ? '' : 'https://morelife.events';
var LB = 'Lucca Beach, Bodrum', BS = 'Before Sunset, Çeşme';
var EVENTS = [
  { slug: 'adam-ten-2026', artist: 'Adam Ten', date: '09.08.2026', venue: BS },
  { slug: 'francis-mercier-2026', artist: 'Francis Mercier', date: '02.08.2026', venue: BS },
  { slug: 'shimza-2026', artist: 'Shimza', date: '26.07.2026', venue: BS },
  { slug: 'blondish', artist: 'BLOND:ISH', date: '16.08.2025', time: '17:30', venue: LB },
  { slug: 'maxi-meraki', artist: 'Maxi Meraki', date: '15.08.2025', venue: LB },
  { slug: 'maz', artist: 'Maz', date: '09.08.2025', venue: LB },
  { slug: 'alex-wann', artist: 'Alex Wann', date: '26.07.2025', venue: LB },
  { slug: 'pawsa', artist: 'PAWSA', date: '19.07.2025', time: '17:30', venue: LB, partner: 'More Life × TemaCC' },
  { slug: 'mont-rouge-monobase', artist: 'Mont Rouge & Monobase', date: '14.07.2025', venue: LB, series: 'Lucca Beach invites GOSPËL' },
  { slug: 'guy-gerber', artist: 'Guy Gerber', date: '12.07.2025', venue: LB, series: 'RUMORS' },
  { slug: 'francis-mercier', artist: 'Francis Mercier', date: '06.07.2025', venue: LB, series: 'Solèy' },
  { slug: 'themba', artist: 'THEMBA', date: '29.06.2025', venue: LB }
];
var ARTISTS = ['Adam Ten', 'Alex Wann', 'Ankhoi', 'Antdot', 'BLOND:ISH', 'Dorian Craft', 'Francis Mercier', 'Guy Gerber', 'Imad', 'Joezi', 'Joseph (CH)', 'Kaz James', 'Lilya Mandre', 'Liva K', 'Maesic', 'Marc Gonen', 'Maxi Meraki', 'Mayssa', 'Maz', 'MoBlack', 'Monobase', 'Mont Rouge', 'Moojo', 'Nick Morgan', 'Nico Bernardini', 'PAWSA', 'Ralo', 'Sasson', 'Shimza', 'Soubeiran', 'Sparrow & Barbossa', 'Supersnake', 'Themba', 'Villanova'];
var VENUES = [['Lucca by the Sea', 'lucca-by-the-sea'], ['Lucca Beach', 'lucca-beach'], ['Before Sunset', 'before-sunset'], ['Gospel New York', 'gospel'], ['Istar Madrid', 'istar'], ['Nobu Istanbul', 'nobu'], ['Frankhan', 'frankhan'], ['Sunset Grill & Bar', 'sunset-grill'], ['Emirgan Group', 'emirgan'], ['Mandarin Oriental Bodrum', 'mandarin-oriental'], ['Hillside Beach Club', 'hillside'], ['Upperist', 'upperist']];
var AGENCIES = [['WME', 'wme'], ['Wasserman', 'wasserman'], ['CAA', 'caa'], ['Alegria Agency', 'alegria'], ['NWE Agency', 'nwe'], ['AAA Events & Booking', 'aaa'], ['Primary Talent', 'primary-talent'], ['THE·TEAM', 'the-team']];
var PROJECTS = ['pawsa', 'francis-mercier-2026', 'adam-ten-2026'];
var SHOP = ['Cap', 'T-shirt', 'Hoodie', 'Socks'];
var SERVICES = {
  'event-production': { n: '01', name: 'Event production', title: 'Event production in Türkiye',
    short: 'From the first concept to the last guest. Lineup, venue, stage, sound and light, ticketing, door, security, F&B and hospitality. Beach-club days, sunset series and large-format open-air shows.',
    lead: 'Independent shows, produced around the artist, the venue and the audience. More Life is based in Istanbul, with an event archive spanning Bodrum and Çeşme.',
    blocks: [['From concept to doors', 'We work across concept, lineup, venue, stage, sound and lighting, ticketing, door operations, security, food and beverage coordination and hospitality. We agree the responsibilities and production scope with you before the project moves forward.'],
      ['The venue shapes the plan', 'A beach-club afternoon and an open-air show need different plans. Share your venue, capacity, access arrangements and any operating restrictions in the brief so these can be considered alongside the artist and audience.'],
      ['An archive you can explore', 'Explore the dated More Life event records at Lucca Beach, Bodrum and Before Sunset, Çeşme. These are completed shows; new events are announced separately when confirmed.']] },
  'artist-booking': { n: '02', name: 'Talent booking', title: 'International artist booking in Türkiye',
    short: 'International DJs and live acts for our own shows, promoters, venues and brands. Agency negotiation, contracts, local tax and invoicing coordination, travel, advancing and on-site artist care.',
    lead: 'From the first agency conversation to the artist’s final transfer. More Life works with venues, promoters, festivals and brands on international DJ and live-act bookings.',
    blocks: [['Start with the right brief', 'Tell us the city, dates, venue capacity, musical direction and budget range. If you have a particular artist in mind, include their name; if not, describe the audience and the experience you want to create.'],
      ['The booking process', 'Our work includes agency negotiation, contracts, local tax and invoicing coordination, travel, advancing and on-site artist care. Availability, commercial terms and the scope of our work are confirmed for each project.'],
      ['A booking history, not an exclusive roster', 'Our artist archive records previous bookings. It does not mean that More Life exclusively represents those artists or that they are available for your dates. Each new enquiry starts with your project and the relevant agency.']] },
  'brand-partnerships': { n: '03', name: 'Brand partnerships', title: 'Music event partnerships for brands',
    short: 'Spaces and activations built into our events. A considered way for brands to meet Istanbul’s music and nightlife audience.',
    lead: 'Bring your brand into a music-led experience. More Life develops event partnerships, activations and talent-led projects with brands and venues.',
    blocks: [['Define the audience and purpose', 'Tell us who you want to reach, the city, the timing and what a successful collaboration would look like for your brand. Include your budget range and any existing venue or creative direction.'],
      ['Choose the right scope', 'A collaboration can involve a presence within an event, a dedicated experience or artist booking and production. Deliverables, permissions and availability need to be agreed for the specific project.'],
      ['Start a conversation', 'Send a brief to discuss your idea and request the More Life partnership presentation. Our references show past venue and agency relationships; they do not imply an existing sponsorship for your project.']] }
};
var OFFER = [
  ['Concept & lineup', 'The idea, the format and the artists that fit it.', 'concept-lineup'],
  ['Talent booking', 'International DJs and live acts. Agency negotiation, contracts, local tax and invoicing.', 'artist-booking'],
  ['Venue & stage', 'The right room, the stage design and the build.', 'venue-stage'],
  ['Sound & lighting', 'Systems, design and crew, matched to the artist and the space.', 'sound-lighting'],
  ['Ticketing', 'Ticket setup, sales and reporting, from first release to the door.', 'ticketing'],
  ['Door & security', 'Entry, guest list and a safe night for everyone.', 'door-security'],
  ['F&B & hospitality', 'Bars, tables and backstage, coordinated with the venue.', 'fb-hospitality'],
  ['Artist travel & care', 'Flights, transfers, advancing and on-site artist care.', 'artist-travel-care'],
  ['Digital event marketing', 'Announcements, content and paid campaigns that sell the show.', 'digital-event-marketing'],
  ['Brand partnerships', 'Spaces and activations built into our events.', 'brand-partnerships']
];

var MORE = {
  'concept-lineup': { title: 'Concept & lineup', lead: 'Every show starts with an idea and the artists that fit it.', blocks: [
    ['The format', 'A beach-club day, a sunset series or a large open-air show. We shape the format around the venue, the season and the audience.'],
    ['The lineup', 'Headliner, support and running order, chosen to work together across the day or night.'],
    ['The brief', 'Tell us the city, dates, capacity and budget range. We come back with a direction and the artists we would approach.']] },
  'venue-stage': { title: 'Venue & stage', lead: 'The room shapes the show. We plan the stage around it.', blocks: [
    ['The right venue', 'Capacity, access and operating restrictions are considered alongside the artist and the audience.'],
    ['Stage design', 'Position, sightlines and the DJ booth, designed for the space and the performance.'],
    ['The build', 'Suppliers, schedule and load-in, coordinated with the venue team.']] },
  'sound-lighting': { title: 'Sound & lighting', lead: 'Sound and light matter as much as the lineup.', blocks: [
    ['Sound', 'A system specified for the space, the crowd size and the artist’s technical rider.'],
    ['Lighting', 'A lighting design that follows the music and the time of day.'],
    ['Crew', 'Technicians on site from load-in to the last track.']] },
  'ticketing': { title: 'Ticketing', lead: 'From the first release to the door.', blocks: [
    ['Setup', 'Ticket types, release phases and capacity, set up before the announcement.'],
    ['Sales', 'Ticket purchases are handled by Weeztix. We manage the shop and follow sales through the campaign.'],
    ['At the door', 'Scanning and entry on the night, with reporting after the show.']] },
  'door-security': { title: 'Door & security', lead: 'A smooth entry and a safe night for everyone.', blocks: [
    ['Door', 'Ticket scanning, guest list and table arrivals, run by one team.'],
    ['Security', 'Security planning agreed with the venue for the capacity and the layout.'],
    ['Flow', 'Entrances, queues and exits planned so the crowd moves easily.']] },
  'fb-hospitality': { title: 'F&B & hospitality', lead: 'Bars, tables and backstage, coordinated with the venue.', blocks: [
    ['Bars', 'Bar positions and service planned for the expected crowd.'],
    ['Tables', 'VIP table and floorplan details depend on the event. Contact us with the event name and group size.'],
    ['Backstage', 'Artist hospitality prepared to the rider.']] },
  'artist-travel-care': { title: 'Artist travel & care', lead: 'From the airport to the last transfer.', blocks: [
    ['Travel', 'Flights, hotels and ground transfers, coordinated with the artist’s team.'],
    ['Advancing', 'Technical and hospitality details confirmed with the agency before the show.'],
    ['On site', 'A dedicated contact with the artist from arrival to departure.']] },
  'digital-event-marketing': { title: 'Digital event marketing', lead: 'Announcements, content and campaigns that sell the show.', blocks: [
    ['Announcement', 'Artwork, copy and timing for the lineup announcement and each ticket release.'],
    ['Content', 'Photo and video from our shows, edited for social channels.'],
    ['Campaigns', 'Paid campaigns and community updates, followed through to the day of the show.']] }
};
Object.keys(MORE).forEach(function (k) { SERVICES[k] = MORE[k]; });
var PEOPLE = [
  { name: 'Ofir Maya', role: 'Founder', focus: 'Booking, partnerships, finance.', photo: '', linkedin: '' },
  { name: 'Can Özalp', role: 'COO', focus: 'Operations and production.', photo: '', linkedin: '' },
  { name: 'Doğa Çapan', role: 'CMO', focus: 'Brand, digital marketing, storytelling.', photo: '', linkedin: '' }
];
var VENUE_LOGO = { 'Lucca Beach, Bodrum': 'lucca-beach', 'Before Sunset, Çeşme': 'before-sunset' };
var FAQ = [
  ['What is More Life?', 'More Life is an independent event production and international talent booking company founded in Istanbul in 2023. We produce electronic music shows and work with venues, promoters and brands in Türkiye.', 'Meet the team', '#about'],
  ['Where does More Life produce events?', 'Our work spans Istanbul, Bodrum and Çeşme. The public archive includes shows at Lucca Beach in Bodrum and Before Sunset in Çeşme. Archive entries are past events, not current ticket offers.', 'Explore the event archive', '#events'],
  ['Can More Life book a DJ for a venue, festival or brand?', 'Yes. More Life handles international DJ and live-act bookings project by project, including agency negotiation, contracts, travel coordination, advancing and on-site artist care. Previous bookings do not imply exclusive artist representation or current availability.', 'View previous bookings', '#artists'],
  ['What should I include in a booking enquiry?', 'Share your city, preferred dates, venue, capacity, artist or musical direction and budget range. Tell us whether you need artist booking, full event production or a brand activation. The team can then assess the brief and discuss availability and scope.', 'Send your brief', '#book'],
  ['What does event production include?', 'More Life works across concept, lineup, venue, stage, sound and lighting, ticketing, door operations, security, food and beverage coordination and hospitality. The scope is agreed for each project.', 'Discuss a production', '#service-event-production'],
  ['Where can I find tickets and VIP table information?', 'Check the Events page for announced shows and follow the official ticket link when sales are available. Ticket purchases are handled by Weeztix. VIP table and floorplan details depend on the event; contact More Life with the event name and group size for assistance.', 'Ask about an event', '#contact']
];
var BUDGETS = [['under-10000', 'Under €10,000'], ['10000-25000', '€10,000–25,000'], ['25000-50000', '€25,000–50,000'], ['50000-100000', '€50,000–100,000'], ['100000-plus', '€100,000+'], ['to-discuss', 'To discuss']];
var FORMS = {
  contact: { kind: 'contact', subject: 'Enquiry', submit: 'Send request', ok: 'Your message has been received by More Life.', fields: [
    ['name', 'Full name', 'text', 1], ['email', 'Email', 'email', 1], ['company', 'Company / venue (optional)', 'text', 0, 'full'],
    ['topic', 'Topic', ['Booking & production', 'Brand partnership', 'Tickets & events', ['General', 'General enquiry']], 1, 'full'], ['message', 'Your message', 'area', 1, 'full']] },
  brief: { kind: 'contact', brief: true, subject: 'Project brief', submit: 'Send request', ok: 'Your message has been received by More Life.', fields: [
    ['name', 'Full name', 'text', 1], ['email', 'Email', 'email', 1], ['company', 'Company / venue (optional)', 'text', 0],
    ['service', 'Service', [['artist-booking', 'Artist booking'], ['event-production', 'Event production'], ['brand-partnerships', 'Brand partnership']], 1], ['city', 'City', 'text', 0], ['preferredDates', 'Preferred dates / flexibility', 'text', 0],
    ['venue', 'Venue / still looking', 'text', 0], ['capacity', 'Estimated capacity', 'text', 0], ['budget', 'Total project budget (EUR)', BUDGETS, 0],
    ['artist', 'Artist / musical direction (optional)', 'text', 0], ['message', 'Your message', 'area', 1, 'full']],
    note: 'Budget ranges describe your brief, not our prices or an artist fee quote.' },
  community: { kind: 'community', subject: 'Community sign-up', submit: 'Join the community', ok: 'You’re on the list. Your preferences have been saved.', fields: [
    ['name', 'Full name', 'text', 1], ['email', 'Email', 'email', 1], ['city', 'Where would you like to hear from us?', [['all', 'All cities'], 'Istanbul', 'Bodrum', 'Çeşme'], 1, 'full']],
    consent: 'I want to receive More Life event announcements and early ticket updates by email. I can withdraw consent by emailing info@morelife.events.' },
  partner: { kind: 'partner', subject: 'Partnership enquiry', submit: 'Send request', ok: 'Your message has been received by More Life.', fields: [
    ['name', 'Full name', 'text', 1], ['email', 'Email', 'email', 1], ['company', 'Company / venue (optional)', 'text', 0, 'full'], ['message', 'Your message', 'area', 1, 'full']] }
};
var VIEWS = ['home', 'events', 'gallery', 'artists', 'references', 'shop', 'about', 'contact', 'book', 'community', 'partnerships', 'guide', 'privacy'];

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function ev(slug) { for (var i = 0; i < EVENTS.length; i++) { if (EVENTS[i].slug === slug) return EVENTS[i]; } return null; }
function accent(text) {
  var parts = String(text).split(' ');
  if (parts.length < 2) return esc(text);
  var last = parts.pop();
  return esc(parts.join(' ')) + ' <span class="serif accent">' + esc(last) + '</span>';
}

var filt = { year: '', venue: '' };

/* ---------- renderers ---------- */
var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function eventRow(e) {
  var d = e.date.split('.');
  return '<a class="erow rise" data-sc="in" href="#event-' + e.slug + '">' +
    '<span class="erow-date"><b>' + d[0] + '</b><span>' + MON[parseInt(d[1], 10) - 1] + ' ' + d[2] + '</span></span>' +
    '<span class="erow-main"><span class="erow-t">' + esc(e.artist) + '</span>' + (e.series ? '<em>' + esc(e.series) + '</em>' : '') + '</span>' +
    '<span class="erow-venue"><img src="img/logos/' + VENUE_LOGO[e.venue] + '.png" alt=""><span>' + esc(e.venue) + '</span></span>' +
    '<span class="erow-go" aria-hidden="true">↗</span></a>';
}
function ticket(e) {
  var d = e.date.split('.'), live = !!e.upcoming;
  return '<aside class="tix" aria-label="Tickets">' +
    '<div class="tix-top"><span class="tix-k">More Life presents</span><span class="tix-stamp' + (live ? ' is-live' : '') + '">' + (live ? 'On sale' : 'Past event') + '</span></div>' +
    '<div class="tix-name">' + esc(e.artist) + '</div>' +
    '<div class="tix-grid"><div><span class="tix-k">Date</span><b>' + d[0] + ' ' + MON[parseInt(d[1], 10) - 1] + ' ' + d[2] + '</b></div>' +
    (e.time ? '<div><span class="tix-k">Doors</span><b>' + e.time + '</b></div>' : '') +
    '<div style="grid-column:1/-1"><span class="tix-k">Venue</span><b>' + esc(e.venue) + '</b></div></div>' +
    '<div class="tix-cut" aria-hidden="true"></div>' +
    '<div class="tix-foot"><p>' + (live ? 'Ticket purchases are handled by Weeztix.' : 'This event has ended. Explore the ticket shop for current events.') + '</p>' +
    '<a class="tix-btn" href="' + (e.ticketUrl || TICKETS) + '" target="_blank" rel="noopener">' + (live ? 'Get tickets' : 'Open ticket shop') + ' ↗</a>' +
    '<a class="tix-link" href="#community">Early ticket updates →</a>' +
    '<div class="tix-bar" aria-hidden="true"></div></div></aside>';
}
function eventAssets(e) {
  var req;
  try { req = fetch(HQ + '/api/event-assets?event=' + encodeURIComponent(e.slug)); } catch (err) { return; }
  req.then(function (r) { return r.ok ? r.json() : { items: [] }; }).then(function (d) {
    var items = (d && d.items) || [], photos = items.filter(function (x) { return x.kind === 'photo'; }), video = items.filter(function (x) { return x.kind === 'video'; })[0];
    var strip = $('#event-body .ev-strip'), note = $('#event-body .ev-note');
    if (!strip || current !== 'event:' + e.slug) return;
    if (photos.length) {
      strip.innerHTML = photos.map(function (x) { return '<figure class="shot"><img src="' + HQ + '/api/assets/' + encodeURIComponent(x.id) + '" alt="' + esc(x.caption || e.artist + ' event photo') + '" loading="lazy" draggable="false"></figure>'; }).join('');
      if (note) note.textContent = 'From the night.';
    }
    if (video) {
      var v = document.createElement('video'); v.className = 'ev-film'; v.controls = true; v.playsInline = true; v.preload = 'metadata';
      v.src = HQ + '/api/assets/' + encodeURIComponent(video.id); v.setAttribute('aria-label', video.caption || e.artist + ' aftermovie');
      strip.parentNode.insertBefore(v, strip);
    }
  }).catch(function () {});
}
function renderUpcoming() {
  var up = EVENTS.filter(function (e) { return e.upcoming; });
  $('#upcoming').innerHTML = (up.length
    ? '<span class="eyebrow">Next up</span><div class="up-grid">' + up.map(function (e) {
        return '<a class="up-card" href="#event-' + e.slug + '"><span class="tix-stamp is-live">On sale</span><span class="row-t">' + esc(e.artist) + '</span><span style="color:var(--mute)">' + e.date + ' · ' + esc(e.venue) + '</span></a>';
      }).join('') + '</div>'
    : '<div class="up-empty"><div class="stack" style="gap:14px"><span class="eyebrow">Next up</span><h2 class="h2">More nights. <span class="serif accent">More Life.</span></h2><p style="color:var(--mute)">New shows are announced here first.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px"><a class="btn" href="#community">Join the community</a></div></div></div>');
}
function loadHqEvents() {
  var req;
  try { req = fetch('/api/public/events'); } catch (err) { return; }
  req.then(function (r) { return r.ok ? r.json() : { events: [] }; }).then(function (d) {
    var evs = (d && d.events) || [];
    if (!evs.length) return;
    $('#upcoming').innerHTML = '<span class="eyebrow">Next up</span><div class="up-grid">' + evs.map(function (e) {
      var dt = e.date ? e.date.split('-').reverse().join('.') : '';
      return '<a class="up-card" href="' + esc(e.url) + '">' + (e.image ? '<img src="' + esc(e.image) + '" alt="' + esc(e.imageAlt || '') + '" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:16px">' : '') +
        '<span class="tix-stamp is-live">Upcoming</span><span class="row-t" style="font-size:clamp(30px,4vw,52px)">' + esc(e.title) + '</span><span style="color:var(--mute)">' + [dt + (e.time ? ' · ' + esc(e.time) : ''), esc(e.venue)].filter(Boolean).join(' · ') + '</span></a>';
    }).join('') + '</div>';
  }).catch(function () {});
}
function renderEvents() {
  var y = filt.year, v = filt.venue;
  var list = EVENTS.filter(function (e) { return (!y || e.date.slice(-4) === y) && (!v || e.venue === v); });
  $('#events-list').innerHTML = list.map(eventRow).join('') || '<p style="padding:40px 0;color:var(--mute)">No events match these filters.</p>';
  $('#f-count').textContent = list.length + (list.length === 1 ? ' event' : ' events');
  tick();
}
function projectCard(slug) {
  var e = ev(slug);
  return '<a class="card rise" data-sc="in" href="#event-' + e.slug + '"><span class="eyebrow">Past project</span>' +
    '<h3 class="h3 push">' + esc(e.artist) + ' at ' + esc(e.venue) + '</h3><p>' + e.date + '. A completed show in the More Life event archive.</p><span class="link">Explore project ↗</span></a>';
}
function renderEvent(slug) {
  var e = ev(slug);
  if (!e) { location.hash = 'events'; return; }
  var i = EVENTS.indexOf(e), next = EVENTS[(i + 1) % EVENTS.length];
  var same = EVENTS.filter(function (x) { return x.venue === e.venue && x !== e; }).slice(0, 4);
  var shots = '';
  for (var k = 0; k < 4; k++) { var n = ((i * 3 + k) % 8) + 1; shots += '<figure class="shot"><img src="img/photos/community-0' + n + '.jpg" alt="More Life archive photo" loading="lazy" draggable="false"></figure>'; }
  $('#event-body').innerHTML =
    '<div class="hero ev-hero"><div class="wrap"><a class="link up" style="--d:.05s" href="#events">← All events</a>' +
    '<span class="eyebrow up" style="--d:.1s">More Life presents' + (e.series ? ' · ' + esc(e.series) : '') + '</span>' +
    '<h1 data-split>' + esc(e.artist) + '</h1>' +
    '<div class="chips up" style="--d:.7s"><span class="chip">' + e.date + (e.time ? ' · ' + e.time : '') + '</span><span class="chip">' + esc(e.venue) + '</span>' +
    (e.series ? '<span class="chip">' + esc(e.series) + '</span>' : '') + (e.partner ? '<span class="chip">' + esc(e.partner) + '</span>' : '') + '</div></div></div>' +
    '<div class="sec"><div class="wrap ev-grid"><div class="stack" style="gap:24px">' +
    '<div class="panel plain" style="min-height:0"><div class="panel-text"><span class="eyebrow">The venue</span><img src="img/logos/' + VENUE_LOGO[e.venue] + '.png" alt="' + esc(e.venue) + '" style="height:80px;width:auto">' +
    '<p style="color:var(--mute)">' + esc(e.venue) + '</p><a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e.venue) + '">Open in Maps ↗</a></div></div>' +
    '<div class="strip ev-strip">' + shots + '</div><p class="note-sm ev-note">From the More Life archive.</p>' +
    '</div>' + ticket(e) + '</div></div>' +
    (same.length ? '<div class="sec sec-line"><div class="wrap stack" style="gap:24px"><span class="eyebrow">More at ' + esc(e.venue) + '</span><div class="rows">' + same.map(eventRow).join('') + '</div></div></div>' : '') +
    '<div class="wrap" style="padding-bottom:64px"><a class="panel rise" data-sc="in" style="min-height:240px;text-decoration:none" href="#event-' + next.slug + '">' +
    '<div class="panel-text"><span class="eyebrow">Next in the archive</span><span class="row-t">' + esc(next.artist) + '</span><span style="color:var(--mute)">' + next.date + ' · ' + esc(next.venue) + '</span></div></a></div>';
  eventAssets(e);
  waves();
}
function renderService(key) {
  var s = SERVICES[key];
  if (!s) { location.hash = 'book'; return; }
  $('#service-body').innerHTML =
    '<div class="hero"><div class="wrap"><a class="link up" style="--d:.05s" href="#book">← All services</a>' +
    '<h1 class="long" data-split>' + accent(s.title) + '</h1>' +
    '<p class="lead up">' + esc(s.lead) + '</p><div class="up" style="--d:.8s"><a class="btn" href="#contact">Discuss your project ↗</a></div></div></div>' +
    '<div class="sec"><div class="wrap grid">' + s.blocks.map(function (b, i) {
      return '<div class="card rise" data-sc="in"><h3 class="h3 push">' + esc(b[0]) + '</h3><p>' + esc(b[1]) + '</p></div>';
    }).join('') + '</div></div>';
}
function renderStatic() {
  $('#home-archive').innerHTML = ['pawsa', 'blondish', 'francis-mercier-2026'].map(function (s) { return eventRow(ev(s)); }).join('');
  $('#az').innerHTML = ARTISTS.map(function (a) { return '<span class="rise" data-sc="in">' + esc(a) + '</span>'; }).join('');
  function logos(list) {
    function one(a, hid) { return '<span class="mq-item"><img src="img/logos/' + a[1] + '.png" alt="' + (hid ? '' : esc(a[0])) + '" draggable="false"></span>'; }
    var rep = list.length < 10 ? 2 : 1, first = '', i;
    for (i = 0; i < rep; i++) first += list.map(function (a) { return one(a, i > 0); }).join('');
    return '<div class="mq-track">' + first + '<span aria-hidden="true" style="display:contents">' + first.replace(/alt="[^"]*"/g, 'alt=""') + '</span></div>';
  }
  $('#venues').innerHTML = logos(VENUES);
  $('#agencies').innerHTML = logos(AGENCIES);
  $$('[data-projects]').forEach(function (el) { el.innerHTML = PROJECTS.map(projectCard).join(''); });
  var ICON = {
    'concept-lineup': 'M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2',
    'artist-booking': 'M4 14v-2a8 8 0 0116 0v2M4 14h3v6H4zM17 14h3v6h-3z',
    'venue-stage': 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    'sound-lighting': 'M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4',
    'ticketing': 'M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4zM14 6v12',
    'door-security': 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    'fb-hospitality': 'M6 3h12l-1 7a5 5 0 01-10 0zM12 15v6M8 21h8',
    'artist-travel-care': 'M3 13l18-8-6 16-3-7z',
    'digital-event-marketing': 'M4 10v4l10 4V6zM17 9a4 4 0 010 6M6 14.5V19h3v-3.3',
    'brand-partnerships': 'M12 3l9 9-9 9-9-9z'
  };
  var WIDE = { 'artist-booking': 1, 'digital-event-marketing': 1 };
  function svc(o, i) {
    var wide = WIDE[o[2]];
    return '<a class="svc rise' + (wide ? ' svc-wide' : '') + '" data-sc="in" href="#service-' + o[2] + '">' +
      '<span class="svc-top"><span class="svc-ic"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICON[o[2]] + '"/></svg></span><span class="svc-arrow" aria-hidden="true">↗</span></span>' +
      (wide ? '<canvas class="svc-wave" data-wave aria-hidden="true"></canvas>' : '') +
      '<span class="svc-body"><h3>' + esc(o[0]) + '</h3><p>' + esc(o[1]) + '</p></span></a>';
  }
  $('#offer').innerHTML = OFFER.map(svc).join('');
  $$('[data-services]').forEach(function (el) { el.className = 'svcs'; el.innerHTML = OFFER.map(svc).join(''); });
  $$('.svc').forEach(function (c) {
    c.addEventListener('pointermove', function (e) { var r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  });
  $('#people').innerHTML = PEOPLE.map(function (p) {
    var ini = p.name.split(' ').map(function (w) { return w.charAt(0); }).join('');
    return '<article class="person rise" data-sc="in"><div class="person-top"></div><div class="person-photo">' +
      (p.photo ? '<img src="' + p.photo + '" alt="' + esc(p.name) + '">' : '<span aria-hidden="true">' + esc(ini) + '</span>') + '</div>' +
      '<div class="person-body"><h3 class="h3" style="font-size:26px">' + esc(p.name) + '</h3><span class="eyebrow">' + esc(p.role) + ' · More Life</span><p>' + esc(p.focus) + '</p>' +
      (p.linkedin ? '<a class="btn btn-ghost" style="height:44px;margin-top:8px" href="' + p.linkedin + '" target="_blank" rel="noopener">LinkedIn ↗</a>' : '<span class="note-sm">[LinkedIn link to be added]</span>') +
      '</div></article>';
  }).join('');
  $('#shop-grid').innerHTML = SHOP.map(function (p, i) {
    return '<div class="card rise" data-sc="in" style="min-height:0"><div class="ph" style="aspect-ratio:1;align-items:center;justify-content:center;gap:18px"><img src="img/logo.svg" alt=""><span>Product images coming soon</span></div><h3 class="h3">' + p + '</h3><p>Coming soon</p></div>';
  }).join('');
  var strip = '';
  for (var i = 1; i <= 8; i++) { strip += '<figure class="shot"><img src="img/photos/community-0' + i + '.jpg" alt="More Life — archive 0' + i + '" loading="lazy" draggable="false"></figure>'; }
  $('#strip').innerHTML = strip;
  $('#faq').innerHTML = FAQ.map(function (f, i) {
    return '<details' + (i === 0 ? ' open' : '') + '><summary><span>' + esc(f[0]) + '</span></summary><div class="ans"><p>' + esc(f[1]) + '</p><a class="link" style="color:var(--ink)" href="' + f[3] + '">' + f[2] + ' ↗</a></div></details>';
  }).join('');
}

/* ---------- forms ---------- */
var uid = 0;
function buildForm(form) {
  var cfg = FORMS[form.getAttribute('data-form')], h = '';
  cfg.fields.forEach(function (f) {
    var id = 'f' + (++uid), req = f[3] ? ' required' : '', cls = 'field' + (f[4] ? ' full' : ''), ctl;
    if (Array.isArray(f[2])) {
      h += '<fieldset class="field full chipset"><legend>' + esc(f[1]) + '</legend><div class="chips">' + f[2].map(function (o, k) {
        var val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
        return '<label class="chip"><input class="sr" type="radio" name="' + f[0] + '" value="' + esc(val) + '"' + (k === 0 ? req : '') + '><span>' + esc(lab) + '</span></label>';
      }).join('') + '</div></fieldset>';
      return;
    } else if (f[2] === 'area') {
      ctl = '<textarea id="' + id + '" name="' + f[0] + '"' + req + '></textarea>';
    } else {
      ctl = '<input id="' + id + '" name="' + f[0] + '" type="' + f[2] + '"' + req + (f[2] === 'email' ? ' autocomplete="email"' : '') + '>';
    }
    h += '<div class="' + cls + '"><label for="' + id + '">' + esc(f[1]) + '</label>' + ctl + '</div>';
  });
  if (cfg.consent) { var cid = 'f' + (++uid); h += '<label class="check" for="' + cid + '"><input id="' + cid + '" type="checkbox" name="consent" required><span>' + esc(cfg.consent) + '</span></label>'; }
  if (cfg.note) h += '<p class="note">' + esc(cfg.note) + '</p>';
  h += '<p class="note">Your details are shared with the More Life team to handle this request. <a href="#privacy">Privacy information</a></p>';
  h += '<div class="actions"><button class="btn" type="submit">' + cfg.submit + '</button></div><div class="result" hidden></div>';
  form.innerHTML = h;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var box = $('.result', form);
    if (!form.checkValidity()) {
      var bad = $(':invalid', form);
      box.hidden = false; box.setAttribute('role', 'alert');
      box.innerHTML = '<p>Please complete the required fields, then try again.</p>';
      if (bad) bad.focus();
      return;
    }
    var data = { website: '' }, lines = ['More Life — ' + cfg.subject, ''];
    cfg.fields.forEach(function (f) {
      var v = form.elements[f[0]].value.trim(); data[f[0]] = v;
      if (v) lines.push(f[1].replace(' (optional)', '') + ': ' + v);
    });
    data.kind = cfg.kind; data.eventId = ''; data.zoneId = ''; data.brief = !!cfg.brief;
    data.analytics = null; data.analyticsPath = '/' + location.hash.replace(/^#/, '');
    data.consent = !!(form.elements.consent && form.elements.consent.checked);
    var sub = $('button[type=submit]', form);
    sub.disabled = true; sub.textContent = 'Sending…';
    function finish() { sub.disabled = false; sub.textContent = cfg.submit; box.hidden = false; }
    function fallback() {
      finish(); box.setAttribute('role', 'alert');
      box.innerHTML = '<p><strong>Not sent.</strong> We could not reach More Life from this page, so nothing left your browser. Copy the message below and email it to <a href="mailto:' + MAIL + '">' + MAIL + '</a>.</p>' +
        '<label class="sr" for="out' + uid + '">Your message</label><textarea id="out' + uid + '" readonly></textarea><div><button class="btn btn-ghost" type="button">Copy message</button></div>';
      var ta = $('textarea', box), btn = $('button', box);
      ta.value = lines.join('\n');
      btn.addEventListener('click', function () {
        function done() { btn.textContent = 'Copied'; }
        function sel() { ta.focus(); ta.select(); btn.textContent = 'Selected — press Ctrl/⌘ + C'; }
        try { navigator.clipboard.writeText(ta.value).then(done, sel); } catch (err) { sel(); }
      });
    }
    var req;
    try { req = fetch(HQ + '/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); } catch (err) { fallback(); return; }
    req.then(function (res) {
      if (res.ok) { finish(); box.setAttribute('role', 'status'); box.innerHTML = '<p><strong>' + esc(cfg.ok) + '</strong></p>'; form.reset(); return; }
      if (res.status === 429) { finish(); box.setAttribute('role', 'alert'); box.innerHTML = '<p>Too many requests. Please try again in a few minutes.</p>'; return; }
      fallback();
    }, fallback);
  });
}

/* ---------- text splitting ---------- */
function splitNode(node, st) {
  Array.prototype.slice.call(node.childNodes).forEach(function (n) {
    if (n.nodeType === 3) {
      var frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach(function (tok) {
        if (!tok) return;
        if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
        var w = document.createElement('span'); w.className = 'w';
        Array.from(tok).forEach(function (c) {
          var s = document.createElement('span'); s.className = 'ch'; s.textContent = c;
          s.style.animationDelay = (0.05 + st.i++ * st.step).toFixed(3) + 's';
          w.appendChild(s);
        });
        frag.appendChild(w);
      });
      n.parentNode.replaceChild(frag, n);
    } else if (n.nodeType === 1 && n.tagName !== 'BR' && n.tagName !== 'IMG') { splitNode(n, st); }
  });
}
function prepare(root) {
  $$('[data-split]', root).forEach(function (el) {
    if (el.getAttribute('data-done')) return;
    el.setAttribute('data-done', '1');
    var text = el.textContent.replace(/\s+/g, ' ').trim();
    var n = text.length, start = parseInt(el.getAttribute('data-split-start') || '0', 10);
    if (el.getAttribute('aria-hidden') !== 'true') {
      var inner = document.createElement('span'); inner.setAttribute('aria-hidden', 'true');
      while (el.firstChild) inner.appendChild(el.firstChild);
      el.appendChild(inner); el.setAttribute('aria-label', text);
      splitNode(inner, { i: start, step: n > 30 ? 0.018 : 0.045 });
    } else {
      splitNode(el, { i: start, step: 0.07 });
    }
  });
  $$('[data-words]', root).forEach(function (el) {
    if (el.getAttribute('data-done')) return;
    el.setAttribute('data-done', '1');
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach(function (w, i) {
      var s = document.createElement('span'); s.className = 'pw'; s.style.setProperty('--i', i); s.textContent = w;
      el.appendChild(s); el.appendChild(document.createTextNode(' '));
    });
    el.style.setProperty('--n', words.length);
    el.setAttribute('data-sc', 'in');
  });
}

/* ---------- scroll engine ---------- */
var raf = 0;
function tick() {
  raf = 0;
  var vh = window.innerHeight;
  $$('.view.is-active [data-sc], .foot [data-sc]').forEach(function (el) {
    var r = el.getBoundingClientRect(), p;
    if (el.getAttribute('data-sc') === 'pin') { p = (vh * 0.75 - r.top) / Math.max(1, r.height - vh * 0.25); }
    else { p = (vh * 1.02 - r.top) / (vh * 0.16); }
    p = Math.max(0, Math.min(1, p));
    el.style.setProperty('--p', p.toFixed(4));
  });
}
function queue() { if (!raf) raf = requestAnimationFrame(tick); }

/* ---------- router ---------- */
var current = null, timer = 0;
function parse() {
  var h = location.hash.replace(/^#/, '');
  if (h.indexOf('event-') === 0) return { view: 'event', arg: h.slice(6), nav: 'events' };
  if (h.indexOf('service-') === 0) return { view: 'service', arg: h.slice(8), nav: '' };
  if (VIEWS.indexOf(h) > -1) return { view: h, nav: h };
  return { view: 'home', nav: '' };
}
function activate(r) {
  if (r.view === 'event') renderEvent(r.arg);
  if (r.view === 'service') renderService(r.arg);
  $$('.view').forEach(function (v) { v.classList.remove('is-active', 'is-in'); });
  var el = $('#v-' + r.view);
  prepare(el);
  el.classList.add('is-active');
  void el.offsetWidth;
  el.classList.add('is-in');
  window.scrollTo(0, 0);
  $$('.nav [data-nav]').forEach(function (a) {
    if (a.getAttribute('data-nav') === r.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  var h1 = $('h1', el);
  document.title = (r.view === 'home' ? 'More Life' : (h1 ? (h1.getAttribute('aria-label') || h1.textContent) + ' — More Life' : 'More Life'));
  tick();
}
function route() {
  var r = parse(), key = r.view + ':' + (r.arg || '');
  closeMenu();
  if (key === current) return;
  var first = current === null;
  current = key;
  clearTimeout(timer);
  if (first || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { activate(r); return; }
  document.body.classList.add('is-switching');
  timer = setTimeout(function () {
    activate(r);
    timer = setTimeout(function () { document.body.classList.remove('is-switching'); }, 160);
  }, 320);
}

/* ---------- menu, carousel, gallery ---------- */
var toggle = $('.nav-toggle'), menu = $('#menu');
function closeMenu() { menu.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Menu'; }
toggle.addEventListener('click', function () {
  var open = !menu.classList.contains('is-open');
  menu.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Close' : 'Menu';
});
$$('a', menu).forEach(function (a) { a.addEventListener('click', closeMenu); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

function carousel() {
  var slides = $$('#slides .slide'), i = 0;
  function go(d) {
    slides[i].classList.remove('is-on');
    i = (i + d + slides.length) % slides.length;
    slides[i].classList.add('is-on');
  }
  $('#prev').addEventListener('click', function () { go(-1); });
  $('#next').addEventListener('click', function () { go(1); });
}
function dragStrip() {
  var s = $('#strip'), down = false, x0 = 0, l0 = 0;
  s.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') return; down = true; x0 = e.clientX; l0 = s.scrollLeft; s.classList.add('dragging'); s.setPointerCapture(e.pointerId); });
  s.addEventListener('pointermove', function (e) { if (down) s.scrollLeft = l0 - (e.clientX - x0); });
  function up() { down = false; s.classList.remove('dragging'); }
  s.addEventListener('pointerup', up); s.addEventListener('pointercancel', up);
}

/* ---------- time-of-day theme ---------- */
var ACC = '224,112,95', themeChoice = 'auto';
var TH = { day: '242,140,56', sunset: '246,126,112', night: '224,112,95' };
function themeNow() { var h = new Date().getHours(); return h >= 6 && h < 17 ? 'day' : (h >= 17 && h < 20 ? 'sunset' : 'night'); }
function applyTheme() {
  var t = themeChoice === 'auto' ? themeNow() : themeChoice;
  document.documentElement.setAttribute('data-theme', t); ACC = TH[t];
  $$('#theme .chip').forEach(function (b) { var on = b.getAttribute('data-v') === themeChoice; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
}
function theme() {
  try { var s = localStorage.getItem('ml-theme'); if (s && (s === 'auto' || TH[s])) themeChoice = s; } catch (e) {}
  $$('#theme .chip').forEach(function (b) {
    b.addEventListener('click', function () { themeChoice = b.getAttribute('data-v'); try { localStorage.setItem('ml-theme', themeChoice); } catch (e) {} applyTheme(); });
  });
  applyTheme();
  setInterval(applyTheme, 60000);
}

/* ---------- interactive sound wave ---------- */
function waves() {
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $$('canvas[data-wave]').forEach(function (c) {
    if (c._w) return; c._w = 1;
    var ctx = c.getContext('2d'), W = 0, H = 0, mx = -1, my = 0.5, energy = 0, seen = false, t0 = Math.random() * 100;
    function size() { var d = Math.min(2, window.devicePixelRatio || 1); W = c.clientWidth; H = c.clientHeight; c.width = W * d; c.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
    function draw(ms) {
      if (!W || W !== c.clientWidth || H !== c.clientHeight) size();
      if (!W) return;
      var t = t0 + ms / 1000, n = Math.max(24, Math.floor(W / 9)), gap = W / n, bw = Math.max(2, gap * 0.42);
      ctx.clearRect(0, 0, W, H);
      energy += ((mx >= 0 ? 1 : 0) - energy) * 0.06;
      for (var i = 0; i < n; i++) {
        var x = (i + 0.5) / n;
        var base = 0.5 + 0.5 * Math.sin(x * 9 + t * 1.7) * Math.sin(x * 3.1 - t * 0.9);
        var beat = 0.5 + 0.5 * Math.sin(t * 4.2 + i * 0.55);
        var env = Math.sin(Math.PI * x);
        var near = mx >= 0 ? Math.exp(-Math.pow((x - mx) * 5.5, 2)) : 0;
        var a = (0.1 + 0.34 * base * env + 0.1 * beat * env) * (0.75 + 0.5 * (1 - my) * energy) + near * 0.42 * energy;
        var hh = Math.min(0.94, a) * H;
        ctx.fillStyle = near > 0.25 ? 'rgba(' + ACC + ',' + (0.55 + 0.45 * near) + ')' : 'rgba(243,238,230,' + (0.3 + 0.6 * base * env) + ')';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(i * gap + (gap - bw) / 2, (H - hh) / 2, bw, hh, bw / 2); else ctx.rect(i * gap + (gap - bw) / 2, (H - hh) / 2, bw, hh);
        ctx.fill();
      }
    }
    function loop(ms) { if (!c.isConnected) return; if (seen && c.getClientRects().length) draw(ms); if (!still) requestAnimationFrame(loop); }
    c.addEventListener('pointermove', function (e) { var r = c.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width; my = (e.clientY - r.top) / r.height; });
    c.addEventListener('pointerleave', function () { mx = -1; });
    if ('IntersectionObserver' in window) { new IntersectionObserver(function (en) { seen = en[0].isIntersecting; if (still && seen) draw(0); }).observe(c); } else { seen = true; }
    requestAnimationFrame(loop);
  });
}

/* ---------- spotify ---------- */
function spotify() {
  var b = $('#sp-btn'), p = $('#sp-panel');
  var mounted = false;
  function mount() {
    if (mounted || /claude|anthropic/.test(location.hostname)) return; mounted = true;
    var f = document.createElement('iframe');
    f.src = 'https://open.spotify.com/embed/playlist/41r6iGbQ2qOjOlNV2Qvqqg?utm_source=generator&theme=0';
    f.title = 'More Life Selects on Spotify'; f.loading = 'lazy'; f.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    $('#sp-embed').appendChild(f); $('#sp-wave').style.display = 'none';
  }
  function set(open) { if (open) mount(); p.hidden = !open; b.setAttribute('aria-expanded', String(open)); $('#sp-label').textContent = open ? 'Close playlist' : 'Listen on Spotify'; }
  b.addEventListener('click', function () { set(p.hidden); });
  $('#sp-close').addEventListener('click', function () { set(false); b.focus(); });
}

/* ---------- boot ---------- */
theme();
renderStatic();
$$('form[data-form]').forEach(buildForm);
[['#f-year', 'year'], ['#f-venue', 'venue']].forEach(function (g) {
  $$('.chip', $(g[0])).forEach(function (b) {
    b.addEventListener('click', function () {
      filt[g[1]] = b.getAttribute('data-v');
      $$('.chip', $(g[0])).forEach(function (o) { var on = o === b; o.classList.toggle('is-on', on); o.setAttribute('aria-pressed', String(on)); });
      renderEvents();
    });
  });
});
renderEvents();
renderUpcoming();
loadHqEvents();
carousel();
dragStrip();
waves();
spotify();
window.addEventListener('scroll', queue, { passive: true });
window.addEventListener('resize', queue);
window.addEventListener('hashchange', route);
route();
})();
