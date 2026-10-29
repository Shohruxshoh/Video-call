# Aloqa

Faqat o'zingiz taklif qilgan do'stlar bilan xabar yozish, ovozli va video qo'ng'iroqlar uchun brauzer ilovasi.
Telefonda ham, kompyuterda ham ishlaydi, PWA sifatida o'rnatiladi va sekin internetga moslashgan.
Pul faqat serverga to'lanadi (1 CPU / 2 GB RAM / 20 GB disk yetadi).

Manzil: **https://video.n-shohrux.uz**

## Imkoniyatlar

- **Do'stlik faqat taklif havolasi orqali.** Havola bir martalik va 7 kun amal qiladi, uni bekor qilsa ham bo'ladi.
  Men Ali va Vali bilan do'st bo'lsam, Ali va Vali bir-birini umuman ko'rmaydi: na ro'yxatda, na online holatda, na qidiruvda (qidiruvning o'zi yo'q).
  Bu qoida serverda har bir so'rovda tekshiriladi (`server/test/privacy.test.ts`).
- **Chat:** real vaqtda yetkaziladi, internet uzilsa xabarlar navbatda turadi va keyin yuboriladi.
  "Yetkazildi" / "o'qildi" belgilari va "yozmoqda…" holati bor.
- **Ovozli va video qo'ng'iroq (1:1):** WebRTC, media to'g'ridan-to'g'ri foydalanuvchilar o'rtasida yuradi.
  - **Mikrofon va kamera default o'chiq**, qo'ng'iroq paytida yoqiladi va o'chiriladi.
    O'chirilganda qurilma to'liq bo'shatiladi, kamera chirog'i ham o'chadi.
  - Telefonda old va orqa kamerani almashtirsa bo'ladi.
- **Sekin internet uchun:**
  - Opus kodek, jimlikda paket yuborilmaydi (DTX).
  - Video VGA dan oshmaydi, "Tejamkor" rejimda 320×240 bo'ladi.
  - Kanal torayib qolsa, video avtomatik to'xtaydi va ovoz davom etadi.
  - Wi-Fi ↔ mobil internet almashganda qo'ng'iroq qayta ulanadi.
  - Ilova taxminan 42 KB (gzip), ikkinchi ochilishdan boshlab keshdan ochiladi.
- **Bildirishnomalar:** ilova orqa fonda ochiq turganda yangi xabar va qo'ng'iroq haqida xabar beradi.

## Arxitektura

```
 brauzer ──HTTPS/WSS──► Cloudflare ──► serverdagi nginx (HTTPS) ──► web konteyneri (127.0.0.1:8090) ──► app
    ║                                                                 ilova fayllari, /api, /ws          Node.js + SQLite
    ╚═══ ovoz/video: P2P (WebRTC); ulanmasa ──► coturn, to'g'ridan-to'g'ri 46.224.22.135:3478 (Cloudflare'siz)
```

Serverdagi nginx boshqa saytlar bilan birga ishlaydi. Unga faqat `video.n-shohrux.uz` sayti qo'shiladi
(`deploy/host-nginx.conf`, HTTPS uchun boshqa subdomenlardagi Cloudflare Origin sertifikati ishlatiladi).
Qolgani Docker'da (`docker-compose.yml`):

| Konteyner | Vazifasi |
|---|---|
| `web` | nginx: ilova fayllari, `/api` va `/ws` ni `app` ga uzatadi; faqat `127.0.0.1:8090` da ochiq |
| `app` | Node.js server; baza `app-data` volume'ida (`/data/app.db`); tashqariga ochilmaydi |
| `coturn` | TURN relay; to'g'ridan-to'g'ri ulanib bo'lmaydigan qo'ng'iroqlar uchun (mobil operatorlar, qattiq Wi-Fi) |

- **TURN IP orqali ishlaydi:** Cloudflare veb-trafikni o'tkazadi, lekin UDP'ni o'tkazmaydi.
- **coturn host tarmog'ida:** 800 dan ortiq UDP portni Docker orqali ochish serverni ortiqcha yuklaydi.
  U ochiq IP'ga bog'langan, aks holda Docker'ning ichki manzillaridan birini relay sifatida berib qo'yishi mumkin.

## Serverga joylash

Server: Ubuntu 24.04, Docker va nginx allaqachon o'rnatilgan, domen Cloudflare orqali ishlaydi.
`video.n-shohrux.uz` DNS yozuvi Cloudflare'da bor (to'q sariq bulut yoqilgan holda qolsin).

### 1. Hetzner firewall

Hetzner panelida Cloud Firewall yoqilgan bo'lsa, qo'ng'iroqlar uchun shu portlarni oching
(80/443 boshqa saytlar uchun allaqachon ochiq):

| Protokol | Portlar |
|---|---|
| UDP | 3478, 49160–49999 |
| TCP | 3478 |

### 2. O'rnatish

Serverda (root):

```bash
git clone https://github.com/Shohruxshoh/Video-call.git /opt/aloqa && cd /opt/aloqa
```

```bash
bash deploy/install.sh
```

Skript nima qiladi:
- `.env` faylini yaratadi: domen, serverning ochiq IP'si, tasodifiy TURN kaliti, ichki port 8090 va sertifikat yo'li.
- Docker image'larini build qiladi va `app`, `web`, `coturn` konteynerlarini ishga tushiradi.
- Serverdagi nginx'ga `video.n-shohrux.uz` saytini qo'shadi.
  Avval `nginx -t` bilan tekshiradi: xato bo'lsa, o'zgarishni qaytaradi va boshqa saytlarga tegmaydi.
- Oxirida butun yo'lni tekshiradi va `Tayyor: https://video.n-shohrux.uz` chiqaradi.

Birinchi kirgan odam ro'yxatdan o'tadi va "Taklif qilish" orqali do'stlarini chaqiradi.

### Yangilash

Yangi versiya GitHub'ga yuklangach, serverda:

```bash
cd /opt/aloqa && git pull && bash deploy/install.sh
```

`.env` (git'da yo'q) va baza saqlanib qoladi.

### Disk joyi

Docker build keshi vaqt o'tishi bilan ko'p joy egallaydi. Faqat keshni tozalash (ishlab turgan konteynerlarga tegmaydi):

```bash
docker builder prune -f
```

### Kundalik buyruqlar

`/opt/aloqa` papkasida:

```bash
docker compose ps
```

```bash
docker compose logs -f app
```

```bash
docker compose restart app
```

### Zaxira nusxa

Hamma ma'lumot bitta faylda (`app-data` volume'idagi `/data/app.db`):

```bash
docker compose stop app && docker compose cp app:/data/app.db ./aloqa-$(date +%F).db && docker compose start app
```

### Muammolar

| Belgi | Qayerdan qarash |
|---|---|
| Cloudflare 502 xatosi | `docker compose ps` (`web` ishlayaptimi), `curl http://127.0.0.1:8090/api/health` |
| Cloudflare 526 xatosi | sertifikat `video.n-shohrux.uz` ni qamramaydi: `.env` dagi `SSL_CERT` / `SSL_KEY` |
| Oq sahifa | Cloudflare'da Rocket Loader o'chiq bo'lsin (u skriptlarni o'zgartiradi) |
| Kirish yoki chat ishlamayapti | `docker compose logs app web` |
| Qo'ng'iroq "Ulanmoqda…" da qolib ketyapti | `docker compose logs coturn`; Hetzner firewall'da UDP 3478 va 49160–49999 ochiqmi |

Server NAT ortida bo'lsa (tarmoq kartasida xususiy IP bo'lsa), `deploy/turnserver.conf` dagi `external-ip` qatorini oching, ochiq IP'ni yozing va `docker compose restart coturn` qiling.

## Kompyuterda ishga tushirish (dasturlash uchun)

Kerak: Node.js 22.18 yoki yangiroq.

```bash
npm install
```

Sinov foydalanuvchilari (`men`, `ali`, `vali`; parol `server/scripts/seed-dev.ts` faylida):

```bash
npm run seed:dev -w server
```

Ikki terminalda:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Brauzerda http://localhost:5173 ni oching. Ikkinchi foydalanuvchi uchun http://app.localhost:5173 ni oching:
bu boshqa manzil bo'lgani uchun cookie alohida bo'ladi va ikkita tabda ikki xil odam bo'lib kira olasiz.

Testlar (Ali/Vali maxfiylik ssenariysi, chat, qo'ng'iroq signalizatsiyasi):

```bash
npm test
```

Telefonda kamera va mikrofon faqat HTTPS orqali ishlaydi, shuning uchun telefondan to'liq sinash uchun serverga joylang.

## Cheklovlar

- **Ilova yopiq bo'lsa,** kiruvchi qo'ng'iroq haqida xabar kelmaydi. Ilova (yoki brauzer tabi) fonda ochiq tursa, bildirishnoma keladi.
  Web Push (ilova yopiq bo'lsa ham) keyingi bosqichda qo'shiladi.
- **Telefonda boshqa ilovaga o'tilsa,** video to'xtaydi. Android'da ovoz odatda davom etadi, iPhone'da bu ishonchsizroq.
- **Qo'ng'iroqlar doim shifrlangan** (DTLS-SRTP), TURN serveri ham ularni ocholmaydi.
  **Chat xabarlari** yo'lda shifrlangan (HTTPS), lekin serverda ochiq saqlanadi.
- **Faqat 1:1 qo'ng'iroq.** Guruh qo'ng'iroq "Ali va Vali bir-birini ko'rmasin" qoidasiga zid bo'lgani uchun qo'shilmagan.

## Loyiha tuzilmasi

```
server/
  src/app.ts          Fastify ilovasi, CSRF/Origin himoyasi, /ws
  src/hub.ts          WebSocket: online holat, chat yetkazish, qo'ng'iroq signalizatsiyasi
  src/db.ts           SQLite sxema va so'rovlar
  src/routes/         kirish, takliflar, do'stlar, xabarlar tarixi, TURN parollari
  test/               maxfiylik va realtime testlari
web/
  src/lib/state.svelte.ts   ilova holati, chat, offline navbat
  src/lib/call.svelte.ts    WebRTC: qo'ng'iroq, sifatga moslashish, qayta ulanish
  src/lib/socket.svelte.ts  o'zini tiklaydigan WebSocket
  src/components/           ekranlar
  public/sw.js              service worker (offline ochilish)
Dockerfile            app (Node) va web (nginx) image'lari
docker-compose.yml    app, web, coturn
.env.example          server sozlamalari namunasi
deploy/
  install.sh          serverga o'rnatish va yangilash
  host-nginx.conf     serverdagi nginx uchun sayt (HTTPS, Cloudflare real IP, WebSocket)
  nginx/              web konteyneridagi nginx sozlamasi
  turnserver.conf     coturn sozlamasi
```
