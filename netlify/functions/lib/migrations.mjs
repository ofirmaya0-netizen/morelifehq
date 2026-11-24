// Schema migrations for the HQ store. Each runs once, in order; the applied version is kept at meta/schema.
// Human-readable schema: db/schema.md. Add a new entry here (and a note in db/migrations/) for every change.
import { slugify, now } from './util.mjs';
import { snapshot } from './model.mjs';

export const MIGRATIONS = [
  { v: 1, name: 'init', async up() {} },
  { v: 2, name: 'events: slug, publish snapshot, invite settings, attendance flags', async up(s) {
    for (const k of await s.list('events/')) {
      const e = await s.get(k); if (!e) continue;
      e.slug = e.slug || slugify(e.title) || e.id.toLowerCase();
      e.invite = { enabled: true, opensAt: '', closesAt: '', plusOnes: 0, askPhone: 'optional', askNote: true, ...(e.invite || {}) };
      e.seo = e.seo || {}; e.eventStatus = e.eventStatus || 'scheduled'; e.tz = 'Europe/Istanbul';
      if (e.useTickets == null) e.useTickets = !!e.ticketUrl;
      if (e.useRsvp == null) e.useRsvp = true;
      if (e.status === 'published' && !e.live) { e.live = snapshot(e); e.publishedAt = e.publishedAt || now(); }
      await s.set(k, e); await s.set('slugs/' + e.slug, { id: e.id });
    }
  } },
  { v: 3, name: 'check-ins: one atomic record per pass', async up(s) {
    for (const k of await s.list('rsvps/')) {
      const r = await s.get(k);
      if (r && r.checkedInAt) await s.create('checkins/' + r.eventId + '/' + r.id, { at: r.checkedInAt });
    }
  } }
];
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].v;

let done = '';
export const resetMigrate = () => { done = ''; }; // after a restore the stored version may be older again
export async function migrate(s, storeName) {
  if (done === storeName) return;
  const meta = (await s.get('meta/schema')) || { version: 0, applied: [] };
  for (const m of MIGRATIONS) {
    if (m.v <= meta.version) continue;
    await m.up(s);
    meta.version = m.v; meta.applied.push({ v: m.v, name: m.name, at: now() });
    await s.set('meta/schema', meta);
  }
  done = storeName;
}
