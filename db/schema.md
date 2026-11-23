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
