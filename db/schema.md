# More Life HQ — veritabanı şeması

Depolama: **Netlify Blobs** (site kapsamlı, kalıcı, güçlü tutarlılık). Canlı ortam `morelife-hq`,
preview ve dal yayınları `morelife-hq-preview` deposunu kullanır; ikisi birbirini görmez.
Her kayıt bir JSON belgesidir. Anahtar düzeni:

| Anahtar | İçerik |
|---|---|
| `meta/schema` | Uygulanan migration sürümü ve geçmişi |
| `config/sessionSecret` | `HQ_SESSION_SECRET` tanımlı değilse sunucunun ürettiği oturum imza anahtarı |
| `events/<id>` | Etkinlik: taslak alanları + `live` (son yayınlanan public alanlar), `invite` ayarları, `seo`, `inviteToken` |
| `slugs/<slug>` | slug → etkinlik id |
| `redirects/<eski-slug>` | `{ to }` — slug değişince 301 hedefi |
| `invites/<token>` | davet anahtarı → etkinlik id |
| `rsvps/<eventId>/<id>` | Başvuru: kişi bilgisi, durum, `passToken`, `utm`, `contactId` |
| `rsvpEmail/<eventId>/<hash>` | Aynı e-postanın aynı etkinliğe ikinci başvurusunu engelleyen kayıt |
| `doors/<token>` | Kapı linki anahtarı → etkinlik id (yalnızca o etkinliğin check-in listesi) |
| `passes/<token>` | giriş kartı anahtarı → etkinlik + başvuru |
| `checkins/<eventId>/<rsvpId>` | Giriş kaydı. **Atomik oluşturulur**: aynı kart iki cihazda okutulursa yalnızca biri yazar |
| `contacts/<id>` | CRM kişisi |
| `contactEmail/<hash>`, `contactPhone/<hash>` | Normalleştirilmiş e-posta / telefon → kişi id |
| `audiences/<id>` | CRM kitlesi: ad, not ve kurallar (`tags`, `tagMode`, `exclude`, `source`, `reach`, `eventId`, `eventState`). Üyeler saklanmaz, her seferinde CRM'den hesaplanır |
| `tasks/<id>` | Görev |
| `enquiries/<id>` | Site formlarından gelen talep (iletişim, brief, community, partnerlik) |
| `images/<id>` | Yüklenen görsel (ikili) |
| `pages/<key>` | Site sayfası içeriği: `draft`, `live`, `versions[]`, `publishedAt` |
| `settings/seo` | SEO varsayılanları ve organizatör kimliği |
| `utm/<id>` | Kaydedilmiş kampanya linki |
| `hits/<eventId>/<gün>/<tür>/<id>` | Sayfa görüntüleme / bilet linki tıklaması (kişisel veri ve link anahtarı içermez) |
| `rate/<key>` | Kötüye kullanım sınırı sayaçları |

Şema değişiklikleri `netlify/functions/lib/migrations.mjs` içindeki sıralı listeyle uygulanır;
her birinin açıklaması `db/migrations/` altındadır. Migration'lar ilk istekte, eksik olan sürümden başlayarak çalışır.

## Guest list and message fields (no migration needed; absent values use the defaults)
- `events/<id>.wideImageId` — landscape cover (1.91:1) for WhatsApp and link previews; published with the other public fields.
- `events/<id>.waPromo` — one-paragraph promo line for the WhatsApp invitation (operational, not shown on the site).
- `events/<id>.invite.showGuests` — guest list on the event page; default on.
- `rsvps/<event>/<id>.showName` — the guest ticked "show my name"; absent = not shown.

## Guest automation (no migration needed; absent values use the defaults)
- `events/<id>.dressCode`, `.listenUrl` — public; `.galleryUrl` — used in the thank-you mail only.
- `events/<id>.invite.{reminders,thanks,referrals,selfCancel}` default on; `.autoWaitlist` default off.
- `rsvps/<event>/<id>.refCode` + `refs/<code>` → `{eventId, rsvpId}`; `.referredBy` = rsvp id of the guest whose link was used.
- `rsvps/<event>/<id>.offer` = `{token, at, expiresAt, expired?, passedOn?, mail?}` + `offers/<token>`; `offerTaken/<token>` is the atomic claim.
- `rsvps/<event>/<id>.cancelledBy` = `guest` when the guest released the place; `.reminders`, `.thanks` = provider results.
- `sent/<event>/<rsvp>/<kind>` (kind: d1, h4, thanks) — atomic claim so an automatic message is sent once.
- Contacts get the tag `katıldı` at their first check-in.

## Audience invitations (no migration needed)
- `sent/<event>/c-<contactId>/invite-wa`, `.../invite-mail` — atomic claim so a contact gets an event's invitation once per channel; holds `{at, id, audienceId}` and is removed again when the provider refuses the message.
- Contacts tagged `mesaj-istemiyor` are never sent an invitation.

## Booking pipeline, team, record of actions, backups (no migration needed; new key groups)
| Key | Content |
|---|---|
| `bookings/<id>` | One artist deal: artist, agency, agent, `eventId`, date, venue, `fee` + `currency`, `stage` (`offer` → `confirmed` → `contract` → `deposit` → `balance`, or `cancelled`), `offerExpires`, `payments[]` (label, kind, amount, currency, due, `paidAt`, `paidBy`), `files[]` (metadata), `history[]` of stage changes |
| `files/<id>` | Booking file (binary). Served only through `/api/hq/bookings/<id>/files/<fileId>` to owner and manager roles, always as a download |
| `users/<id>` | Team member: name, e-mail, `role` (`manager`, `rsvp`, `door`, `viewer`), `active`, `pass` (scrypt salt + key), `sv` (session version; raising it signs the member out), `setup` (one-time link) |
| `userEmail/<hash>` | Normalised e-mail → member id (atomic create: one member per e-mail) |
| `setup/<token>` | One-time password link → member id. Valid 72 hours, deleted on use |
| `audit/<iso time>~<id>` | One line of the record of actions: who, what, on what. Written after every successful change; keys sort by time |
| `meta/contactsStamp`, `cache/contacts` | CRM snapshot: all contacts in one record, trusted only while its stamp matches (see `allContacts` in `store.mjs`) |

- `rsvps/<event>/<id>.decidedBy`, `.checkedInBy` and `checkins/<event>/<rsvp>.by` hold the name of the person who decided or checked the guest in.
- The owner is not a record: it comes from `HQ_ADMIN_EMAIL` / `HQ_ADMIN_PASSWORD` (optional `HQ_ADMIN_NAME` for the name shown in the log).
- Backups live in a second store, `<store>-backups`: `snap/<id>` (every record except `rate/`, `cache/`, `config/`, `setup/`, `hits/`), `meta/<id>`, `bin/<key>` (copies of `images/` and `files/`), `lock/<day>` (one automatic backup a day). A restore never touches `audit/`, `users/` or `userEmail/`.
