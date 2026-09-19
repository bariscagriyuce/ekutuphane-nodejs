// config.js — Uygulama yapılandırması (ortam değişkenleri + varsayılanlar)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

/**
 * DATA_ROOT: veritabanı ve uploads klasörünün bulunduğu dizin.
 *  1. DATA_ROOT ortam değişkeni verilmişse o kullanılır.
 *  2. Proje eski PHP kütüphanesinin yanına kurulduysa (bir üst klasörde
 *     database.sqlite ya da uploads/ varsa) mevcut veri olduğu gibi devralınır.
 *  3. Aksi hâlde proje kendi içindeki data/ klasörünü kullanır — depo tek
 *     başına klonlandığında sıfırdan çalışır.
 */
function resolveDataRoot() {
  if (process.env.DATA_ROOT) return path.resolve(process.env.DATA_ROOT);

  const parent = path.resolve(PROJECT_ROOT, '..');
  const inheritsPhpProject =
    fs.existsSync(path.join(parent, 'database.sqlite')) || fs.existsSync(path.join(parent, 'uploads'));

  return inheritsPhpProject ? parent : path.join(PROJECT_ROOT, 'data');
}

export const DATA_ROOT = resolveDataRoot();

export const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(DATA_ROOT, 'database.sqlite');

export const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
export const BOOKS_DIR = path.join(UPLOAD_DIR, 'books');
export const COVERS_DIR = path.join(UPLOAD_DIR, 'covers');
export const IMPORT_DIR = path.join(UPLOAD_DIR, 'import');
/**
 * Yüklenen dosyaların geçici olarak indiği klasör. Sistemin /tmp dizini DEĞİL:
 * paylaşımlı hostinglerde /tmp çoğu zaman ayrı bir dosya sistemidir ve oradan
 * BOOKS_DIR'e rename() "EXDEV: cross-device link not permitted" ile düşer.
 * Geçici dosyayı hedefle aynı disk bölümünde tutarsak taşıma tek adımda biter.
 */
export const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');

for (const dir of [UPLOAD_DIR, BOOKS_DIR, COVERS_DIR, IMPORT_DIR, TMP_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(
      `\n✗ Veri klasörü oluşturulamadı: ${dir}\n` +
        `  Sebep: ${err.message}\n` +
        `  DATA_ROOT şu an: ${DATA_ROOT}\n` +
        '  Bu yolun var olduğundan ve uygulamanın yazma izni olduğundan emin olun.\n'
    );
    process.exit(1);
  }
}

export const PORT = Number(process.env.PORT || 3000);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';

/**
 * Ters vekil güveni. Vekil arkasındayken (hosting panelleri, nginx) 1 olmalı ki
 * gerçek istemci IP'si ve HTTPS bilgisi X-Forwarded-* başlıklarından okunsun.
 * Uygulama doğrudan internete açıksa 0/false verin; aksi hâlde istemci
 * X-Forwarded-For ile IP'sini seçip giriş kilidini atlatabilir.
 */
function resolveTrustProxy() {
  const raw = String(process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (raw === '') return 1;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  if (['true', 'yes', 'on'].includes(raw)) return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // ör. "loopback", "10.0.0.0/8"
}
export const TRUST_PROXY = resolveTrustProxy();

// Oturum gizli anahtarı: üretimde .env üzerinden verilmeli.
// Verilmezse dosyaya yazılan rastgele bir anahtar üretilir (yeniden başlatmada
// oturumların düşmemesi için kalıcıdır).
function resolveSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const secretFile = path.join(PROJECT_ROOT, '.session-secret');
  const secret = crypto.randomUUID() + crypto.randomUUID();
  try {
    if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  } catch {
    // Uygulama klasörü salt okunur olabilir (bazı hosting ortamları böyle).
    // Anahtarı bellekte tutarız; uygulama çalışır, yalnızca yeniden
    // başlatıldığında açık oturumlar düşer.
    console.warn(
      '⚠ SESSION_SECRET tanımlı değil ve dosyaya yazılamadı; geçici anahtar üretildi.\n' +
        '  Yeniden başlatmada oturumlar düşer. Ortam değişkenlerine SESSION_SECRET ekleyin.'
    );
  }
  return secret;
}
export const SESSION_SECRET = resolveSessionSecret();

export const READABLE_FORMATS = ['epub', 'pdf', 'mobi', 'azw3'];
export const BOOK_FORMATS = ['epub', 'pdf', 'mobi', 'azw3'];
export const COVER_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// Giriş güvenliği
export const LOGIN_MAX_ATTEMPTS = 5;          // aynı kullanıcı adı + IP
export const LOGIN_MAX_ATTEMPTS_PER_USER = 20; // aynı kullanıcı adı, IP'den bağımsız
export const LOGIN_LOCKOUT_MINUTES = 15;

// Listeleme
export const PAGE_SIZE = 24;

/**
 * Veritabanında saklanan göreli yolu (ör. "uploads/books/x.epub") güvenli bir
 * mutlak yola çevirir. Yol DATA_ROOT dışına çıkıyorsa null döner.
 */
export function resolveDataPath(relOrAbs) {
  if (!relOrAbs) return null;
  const abs = path.resolve(DATA_ROOT, relOrAbs);
  const rel = path.relative(DATA_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}
