# E-Kütüphane

Kişisel e-kitap kütüphanesi ve tarayıcı içi okuyucu. EPUB, MOBI, AZW3 ve PDF
dosyalarınızı tarayıcıdan okur, kaldığınız yeri hatırlar, vurgu ve not almanızı
sağlar, kitapları Kindle/e-okuyucu adresinize e-posta ile gönderir.

Node.js + Express + SQLite ile yazılmıştır. Yerel derleme gerektiren bağımlılığı
yoktur; `npm install` ve `npm start` ile çalışır.

> Bu proje, aynı işi yapan PHP + SQLite uygulamasının yeniden yazılmış hâlidir.
> Eski kurulumun yanına konursa mevcut `database.sqlite` ve `uploads/` içeriğini
> (kullanıcılar, kitaplar, favoriler, okuma ilerlemesi, notlar) olduğu gibi
> devralır — eski bcrypt şifreler dâhil.

## Özellikler

**Kütüphane**

- Sol kenar çubuğunda raflar: Tüm Kitaplar, Okumaya Devam, Favorilerim, Bitirdiklerim (canlı sayaçlarla)
- Yazarken arama (sayfa yenilenmez), format çipleri, sıralama (yeni / başlık / yazar / ilerleme)
- Izgara ⇄ liste görünümü, sonsuz kaydırma + "Daha fazla göster" düğmesi
- Ana sayfada "Kaldığın yerden devam et" rafı
- Açık / koyu tema, tam duyarlı (mobil çekmece menü), `/` ile aramaya odaklanma

**Okuyucu**

- EPUB, MOBI, AZW3 ([foliate-js](https://github.com/johnfactotum/foliate-js)) ve PDF ([PDF.js](https://mozilla.github.io/pdf.js/))
- Kaldığınız yeri hatırlar, ilerleme çubuğuyla kitabın herhangi bir yerine atlar
- Üç kağıt teması: açık, sepya, koyu
- Yazı boyutu, satır aralığı, sayfa genişliği, serif/sans yazı tipi ayarları (tarayıcıda saklanır)
- İçindekiler paneli, notlar & vurgular paneli
- Dört renkte vurgu — foliate-js'in kendi katmanı kullanılır, metin DOM'una dokunulmaz
- Vurguya tıklayınca not düzenleme, panelden vurguya atlama
- Klavye: `←` `→` sayfa, `F` odak modu, `Esc` kapat; mobilde kaydırma hareketi
- PDF: iptal edilebilir çizim (hızlı sayfa değiştirmede takılmaz), yakınlaştırma, sayfa notları, koyu modda ters çevirme

**Yönetim**

- Kullanıcı hesapları, roller (yönetici / okuyucu)
- Sekmeli panel: kitaplar (arama + sayfalama), kitap ekle (sürükle-bırak), toplu içe aktarma (ilerleme çubuğuyla), kullanıcılar, SMTP
- Toplu içe aktarma komut satırından da çalışır: `npm run import`

## Kurulum

Gereksinim: **Node.js 22.5 veya üstü** (`node:sqlite` modülü için).

```bash
git clone <depo-adresi>
cd <klasör>
npm install
npm start
```

Tarayıcıda `http://localhost:3000`.

İlk çalıştırmada `data/` klasörü ve boş bir veritabanı oluşturulur; rastgele
şifreli bir `admin` hesabı açılır ve şifre `admin_password.txt` dosyasına
yazılır. Giriş yaptıktan sonra şifrenizi değiştirip bu dosyayı silin.

### Veri klasörü

Veritabanı ve kitaplar `DATA_ROOT` altında tutulur:

```
<DATA_ROOT>/
├── database.sqlite
└── uploads/
    ├── books/     kitap dosyaları
    ├── covers/    kapak görselleri
    └── import/    toplu içe aktarma kuyruğu
```

`DATA_ROOT` sırayla şöyle belirlenir:

1. `.env` içindeki `DATA_ROOT` değeri,
2. bir üst klasörde `database.sqlite` veya `uploads/` varsa o klasör
   (eski PHP kurulumunun yanına konulduğunda veriyi devralmak için),
3. yoksa projenin kendi `data/` klasörü.

Veritabanı da kitaplar da depoya dâhil edilmez (`.gitignore`).

### Geliştirme

```bash
npm run dev
```

### Toplu içe aktarma

Kitapları `uploads/import/` klasörüne kopyalayın, sonra:

```bash
npm run import
```

Önce ne aktarılacağını görmek için:

```bash
npm run import -- --dry
```

Aynı işi yönetici panelindeki **Toplu İçe Aktarma** sekmesinden de yapabilirsiniz.

### Veri denetimi

Veritabanı ile disk arşivinin uyumunu kontrol eder (eksik dosyalar, yetim
kayıtlar):

```bash
npm run check
```

## Paylaşımlı hostinge kurulum (Hostinger vb.)

Git tabanlı Node.js dağıtımı kullanan panellerde ayarlar şöyle olmalı:

| Alan | Değer |
|---|---|
| Framework preset | Express |
| Branch | `main` |
| **Node version** | **24 veya üzeri** (aşağıdaki nota bakın) |
| Root directory | `./` |
| Build command | `npm install --omit=dev` |
| Start command | `npm start` |

**Node sürümü:** `node:sqlite` modülü Node 22.5'te geldi ama 23.4'e kadar
`--experimental-sqlite` bayrağı istiyor. Panelde 24 veya üzeri bir sürüm varsa
onu seçin. Yalnızca 22.x sunuluyorsa ortam değişkenlerine
`NODE_OPTIONS=--experimental-sqlite` ekleyin. Yanlış sürümde uygulama açılışta
ne yapılması gerektiğini yazan bir hata verip durur.

**Ortam değişkenleri:**

| Değişken | Değer |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | Rastgele uzun bir dize (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `DATA_ROOT` | Uygulama klasörünün **dışında**, kalıcı bir yol — ör. `/home/<kullanici>/ebook-data` |

`PORT` genelde panel tarafından otomatik verilir; elle eklemeyin.

**`DATA_ROOT` neden dışarıda olmalı:** her git dağıtımında uygulama klasörü
yeniden oluşturulabilir. Veritabanı ve kitap arşivi orada durursa dağıtımla
birlikte silinme riski taşır. Klasörü bir kez oluşturup yolunu `DATA_ROOT`
olarak verin; uygulama içindeki `uploads/` alt klasörlerini kendisi açar.

**HTTPS:** `NODE_ENV=production` iken oturum çerezi yalnızca HTTPS üzerinden
gönderilir. Uygulama ters vekil arkasında çalıştığını varsayar
(`trust proxy`), yani panelin SSL'i açık olmalıdır. Giriş yaptıktan sonra
sürekli giriş sayfasına dönüyorsanız ilk bakılacak yer budur.

**Disk:** Kitap arşivi hosting kotanıza dâhildir. Yükleme yapmadan önce
paketinizin disk alanını kontrol edin.

## Güvenlik

- Tüm durum değiştiren istekler oturum tabanlı CSRF token'ı ister
- Giriş denemesi kullanıcı+IP başına 5 ile sınırlı, 15 dakika kilit
- Kitap dosyaları web'den doğrudan erişilemez; yalnızca oturum açmış kullanıcılara `/file/:id` üzerinden sunulur
- Dosya yolları `DATA_ROOT` dışına çıkamaz (path traversal koruması)
- Oturum çerezi `httpOnly` + `sameSite=lax`; `NODE_ENV=production` ise `secure`
- Şifreler bcrypt ile saklanır (cost 12)

Üretimde `NODE_ENV=production`, kendi `SESSION_SECRET`'ınız ve HTTPS sonlandıran
bir ters vekil sunucu (nginx/Caddy) kullanın.

## Proje yapısı

```
├── src/
│   ├── server.js            Express uygulaması, ara katmanlar, rota bağlama
│   ├── config.js            Ortam değişkenleri, yollar, sabitler
│   ├── db.js                SQLite bağlantısı, şema, indeksler, ayarlar
│   ├── session-store.js     express-session için SQLite deposu
│   ├── icons.js             Şablonlarda kullanılan SVG ikonlar
│   ├── middleware/          auth.js (yetki), csrf.js
│   ├── services/            books.js, epub.js, mailer.js, import.js
│   ├── routes/              auth, library, reader, api, admin
│   └── scripts/             import-cli.js
├── views/                   EJS şablonları (+ partials/)
└── public/
    ├── css/                 app.css, reader.css
    └── js/                  app.js, admin.js, reader-common.js,
                             reader-epub.js, reader-pdf.js
```

## Uç noktalar

| Yol | Açıklama |
|---|---|
| `GET /` | Kütüphane (raf, arama, filtre, sıralama, sayfalama) |
| `GET /api/books` | Kitap listesi (JSON) — anlık arama ve sonsuz kaydırma |
| `GET /read/:id` | Okuyucu (EPUB/MOBI/AZW3 veya PDF) |
| `GET /file/:id` | Kitap dosyası — `?inline=1` okuyucu için |
| `GET /covers/:file` | Kapak görseli |
| `POST /api/favorites` | Favori ekle/çıkar |
| `GET/POST /api/progress` | Okuma ilerlemesi |
| `GET/POST/DELETE /api/annotations` | Not ve vurgular |
| `POST /api/profile` | E-okuyucu adresi ve şifre |
| `POST /api/send-to-reader` | Kitabı e-posta ile gönder |
| `GET /admin` | Yönetici paneli |

## Notlar

- Okuyucu kütüphaneleri (foliate-js, PDF.js) CDN'den yüklenir; okuyucu sayfası için internet bağlantısı gerekir.
- `node:sqlite` Node 22.5+ ile gelir; `better-sqlite3` gibi derleme gerektiren bir bağımlılık yoktur.
- Kitap dosyalarını depoya koymayın — `.gitignore` `data/` ve `uploads/` klasörlerini zaten dışarıda bırakır.

## Lisans

MIT
