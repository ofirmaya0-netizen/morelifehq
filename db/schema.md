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
| `linkhits/<gün>/<etiket>/<id>` | Link sayfası (`/links`) sayacı: `view` = sayfa ziyareti, diğer etiketler basılan link (kişisel veri içermez) |
| `rate/<key>` | Kötüye kullanım sınırı sayaçları |

Şema değişiklikleri `netlify/functions/lib/migrations.mjs` içindeki sıralı listeyle uygulanır;
her birinin açıklaması `db/migrations/` altındadır. Migration'lar ilk istekte, eksik olan sürümden başlayarak çalışır.

## Guest list and message fields (no migration needed; absent values use the defaults)
- `events/<id>.wideImageId` — landscape cover (1.91:1) for WhatsApp and link previews; published with the other public fields.
- `events/<id>.waPromo` — one-paragraph promo line for the WhatsApp invitation (operational, not shown on the site).
- `events/<id>.invite.showGuests` — guest list on the event page; default on.
- `rsvps/<event>/<id>.showName` — the guest ticked "show my name"; absent = not shown.

- `settings/whatsapp.pass.qr` — the pass template has an image header (variable `qr`): the message is sent with `qr` = `/api/public/pass-qr/<pass key>.png`, the entry QR as a PNG. Off by default; the route answers only for an approved guest or a valid ticket.

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

## Ticket sales (no migration needed; new key groups)
| Key | Content |
|---|---|
| `settings/tickets` | Provider (`test`, `iyzico`), service fee, seller details, terms of sale, refund policy, support e-mail |
| `tshop/<eventId>` | Per event: sales on/off, currency, whether buyers may change the name on a ticket |
| `ttypes/<eventId>/<id>` | Ticket type: name, price, `stock` (0 = unlimited), min/max per order, `admits` (tickets issued per unit), sale window, `hidden`, `after` (opens when that type is sold out or over) |
| `tstock/<typeId>/<n>` | One unit of stock, held or sold. **Created atomically**: two buyers can never take the same unit. Unlimited types use `u<id>` keys |
| `tcodes/<eventId>/<CODE>`, `tcodeUse/<eventId>/<CODE>/<orderId>` | Discount / access code and one record per order that used it |
| `orders/<eventId>/<id>` | Order: number, buyer, items with prices at purchase, discount, fee, total, status (`pending`, `paid`, `partial`, `refunded`, `expired`, `cancelled`), channel (`online`, `comp`, `boxoffice`), stock keys, ticket ids, refunds, accepted terms, campaign tags |
| `orderTok/<token>` | Private order link → order |
| `pending/<eventId>/<orderId>` | Unpaid basket and when its hold ends; removed on payment or when the stock is given back |
| `tickets/<eventId>/<id>` | One ticket per person admitted: type, holder name and e-mail, QR key, `valid` / `void`, check-in |
| `passes/<token>` | Now also `{ eventId, ticketId }`: a bought ticket opens in the same pass page and scans at the same door as an approved guest |
| `checkins/<eventId>/tk-<ticketId>` | Atomic check-in record of a ticket |

- Card details never reach HQ. The provider adapters are in `lib/payments.mjs`; keys live only in `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL`.
- The `test` provider moves no money and is refused on the live store (`morelife-hq`) unless `HQ_PAYMENTS_TEST=1`.
- `twait/<eventId>/<id>` — someone who asked to be told when a type can be bought (sold out, or sale not open yet): type, e-mail, quantity, language, `waiting` / `notified`. One record per e-mail and type.
- `tresale/<typeId>/<ticketId>` — a ticket its holder put back on sale; `tresaleTaken/<typeId>/<ticketId>` — the atomic claim of a basket that is buying it. On payment the old ticket is voided and its price refunded to the first buyer.
- `orders/….lang` (`en` / `tr`) decides the language of that buyer's mails; `orders/….reminded` records the one unpaid-basket reminder.
- `tpromo/<eventId>/<CODE>` + `tpromoTok/<token>` — a promoter: name, commission (% and/or fixed per ticket), private panel key. Orders carry `promoter` when the buyer came through `?p=CODE`.
- `orders/….refCode` + `refs/<code>` → `{ eventId, orderId }` — the buyer's link for friends; orders bought through it carry `referredBy`.
- `ttypes/….earlyFor` (audience id) + `.earlyUntil` — early access: until then only e-mails in that CRM audience can buy the type.
- `tshop/<eventId>.look` — theme, accent colour, heading and button text of the shop; `/tickets/<slug>` is the shop alone, `?embed=1` its iframe form (`/js/embed.js`).
- `pnl/<eventId>` — profit and loss: reporting currency, rates entered by hand, income / expense lines. Ticket income and booking fees are read live, not stored.
- `tmap/<eventId>` — table plan: optional floor-plan image and tables `{ id, label, typeId, n, seats, x, y }`. A table is unit `n` of its type's stock (`tstock/<typeId>/<n>`); numbers are never reused. `tickets/….slot` is the unit a ticket came from and `.table` its table name.
- `tshop/<eventId>.questions` — up to five extra questions asked at checkout; answers are kept in `orders/….answers`.
- `settings/webhooks` — up to five outgoing hooks `{ url, events, secret, active, last }`; calls are signed with HMAC-SHA256 (`x-morelife-signature`).

## Ticketing: add-ons, deposits, door without a connection

- `ttypes/<eventId>/<id>` gains `addon` (sold only together with a ticket, not counted as a ticket, 0 guests at the door) and `deposit` (the part charged online; the rest is due at the venue).
- `orders/...` items gain `unitPay` (charged online per unit), `unitDue` (left to pay at the venue) and `addon`; the order gains `due` and, once taken at the door, `collected { at, by, amount, method }`. `total` is always what was charged online.
- `tickets/<eventId>/<id>` gains `addon` and `due` (on the first ticket of a unit, cleared when collected).
- Door lists (`/api/door/list`, `rsvps/<eventId>` for HQ) carry `h`: the first 20 hex characters of sha256 of the QR key. The key itself never leaves the server; a device without a connection matches scans against `h`, queues the entries in its own storage and sends them later with `at` (accepted when within the last 24 hours).
- Nothing new is stored for notices to ticket holders, "My tickets" or the settlement report: they read orders and tickets. Rate-limit counters: `mine/<ip>`, `mine-to/<email>`.

## Incoming WhatsApp messages (no migration needed; new key groups)
| Key | Content |
|---|---|
| `config/waHook` | Bird webhook subscription: `id`, `url`, `channelId`, when and by whom it was connected, and the signing `key`. Made by the server, never returned by any route, left out of backups like the rest of `config/` |
| `wathreads/<key>` | One conversation per phone number (`key` = hash of the number): `phone`, WhatsApp `name`, `contactId` when the number is in the CRM, `lastAt`, `lastText`, `lastDir`, `lastInAt`, `readAt`, `optOut` |
| `wamsgs/<key>/<time>~<id>` | One message: `dir` (`in` / `out`), `at`, `kind`, `text`, Bird's id, and `by` for a reply sent from HQ |
| `waseen/<hash of Bird's message id>` | Atomic claim: Bird delivers at least once, a message is stored once |

- `POST /api/public/wa-hook` accepts only requests signed with the subscription's key (`BIRD_WEBHOOK_SECRET` overrides the stored key when the subscription is created by hand in Bird).
- A conversation is unread while `lastInAt` is later than `readAt`. A reply is allowed for 24 hours after `lastInAt`.
- A message that is exactly `STOP` (also `unsubscribe`, `dur`, `durdur`) tags the matching CRM contact `mesaj-istemiyor`.
- “Geçmiş mesajları yükle” reads the channel's incoming messages from Bird page by page (`POST /api/hq/inbox/import`). A message already stored is skipped; one older than 24 hours arrives as read.
- Media is not copied into HQ: such a message shows its type and caption, the file stays in Bird.
