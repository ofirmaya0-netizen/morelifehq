// The twelve past shows that are hard-coded in the public site's archive (site/js/site.js).
// "Sitedeki geçmiş etkinlikleri aktar" in HQ → Ayarlar creates them as published public events, once.
const LB = ['Lucca Beach', 'Bodrum'], BS = ['Before Sunset', 'Çeşme'];
export const LEGACY_EVENTS = [
  ['adam-ten-2026', 'Adam Ten', '2026-08-09', '', BS], ['francis-mercier-2026', 'Francis Mercier', '2026-08-02', '', BS], ['shimza-2026', 'Shimza', '2026-07-26', '', BS],
  ['blondish', 'BLOND:ISH', '2025-08-16', '17:30', LB], ['maxi-meraki', 'Maxi Meraki', '2025-08-15', '', LB], ['maz', 'Maz', '2025-08-09', '', LB], ['alex-wann', 'Alex Wann', '2025-07-26', '', LB],
  ['pawsa', 'PAWSA', '2025-07-19', '17:30', LB], ['mont-rouge-monobase', 'Mont Rouge & Monobase', '2025-07-14', '', LB], ['guy-gerber', 'Guy Gerber', '2025-07-12', '', LB], ['francis-mercier', 'Francis Mercier', '2025-07-06', '', LB], ['themba', 'THEMBA', '2025-06-29', '', LB]
].map(([slug, artist, date, time, v]) => ({ slug, title: artist, artist, date, time, venue: v[0], city: v[1] }));
