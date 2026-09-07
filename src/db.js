// db.js — SQLite bağlantısı, şema kurulumu ve indeksler
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { DB_FILE, PROJECT_ROOT } from './config.js';
import { searchKey } from './services/search.js';
import path from 'node:path';

export const db = new DatabaseSync(DB_FILE);

// busy_timeout HER ŞEYDEN ÖNCE ayarlanmalı: LiteSpeed gibi çalıştırıcılar
// uygulamayı birden fazla süreç olarak aynı anda başlatıyor. Zaman aşımı
// tanımlı değilken kilitli bir veritabanına yazmaya çalışan süreç beklemek
// yerine anında "database is locked" ile düşüyor.
db.exec('PRAGMA busy_timeout = 10000;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');

/** Eşzamanlı açılışta çakışabilecek şema işlemleri uygulamayı düşürmemeli. */
function tryExec(sql, what) {
  try {
    db.exec(sql);
    return true;
  } catch (err) {
    console.warn(`⚠ ${what} atlandı: ${err.message}`);
    return false;
  }
}

// WAL kalıcı bir ayardır; ilk süreç uyguladıktan sonra diğerleri için gereksizdir.
tryExec('PRAGMA journal_mode = WAL;', 'WAL kipine geçiş');

// --- Şema (mevcut PHP veritabanıyla birebir uyumlu) ---------------------
tryExec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  kindle_email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_format TEXT NOT NULL,
  cover_path TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  progress_value TEXT NOT NULL,
  percentage INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id)
);

CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  cfi_range TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  note_text TEXT,
  color TEXT DEFAULT 'yellow',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT NOT NULL,
  ip TEXT NOT NULL,
  attempts INTEGER DEFAULT 1,
  last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (username, ip)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  data TEXT NOT NULL
);
`, 'şema oluşturma');

// --- İndeksler (6000+ kitaplık kütüphanede arama/sıralama için) ---------
tryExec(`
CREATE INDEX IF NOT EXISTS idx_books_added      ON books(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_format     ON books(file_format);
CREATE INDEX IF NOT EXISTS idx_books_title      ON books(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_books_author     ON books(author COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_progress_user    ON progress(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_user   ON favorites(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_ub   ON annotations(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`, 'indeks oluşturma');

// --- Türkçe arama anahtarları ------------------------------------------
// books tablosuna sadeleştirilmiş arama/sıralama sütunları eklenir.
// Eski PHP veritabanında bu sütunlar yok; ilk açılışta oluşturulup doldurulur.
const bookColumns = new Set(db.prepare('PRAGMA table_info(books)').all().map((c) => c.name));
for (const column of ['title_key', 'author_key']) {
  // Aynı anda açılan başka bir süreç sütunu eklemiş olabilir; hata yutulur.
  if (!bookColumns.has(column)) tryExec(`ALTER TABLE books ADD COLUMN ${column} TEXT`, `${column} sütunu`);
}

export function backfillSearchKeys() {
  const selectPending = 'SELECT id, title, author FROM books WHERE title_key IS NULL';

  // Ucuz ön kontrol: doldurulacak bir şey yoksa kilit almadan çıkılır.
  try {
    if (db.prepare(selectPending + ' LIMIT 1').get() === undefined) return 0;
  } catch {
    return 0; // sütun henüz eklenememişse sonraki açılışta denenir
  }

  const update = db.prepare('UPDATE books SET title_key = ?, author_key = ? WHERE id = ?');
  try {
    // IMMEDIATE: yazma kilidini baştan alır, işlemin ortasında çakışmayı önler.
    db.exec('BEGIN IMMEDIATE');
    // Kilidi aldıktan sonra tekrar bak: başka bir süreç bu arada doldurmuş
    // olabilir; aynı işi altı kez yapmanın anlamı yok.
    const pending = db.prepare(selectPending).all();
    if (pending.length === 0) {
      db.exec('COMMIT');
      return 0;
    }
    for (const row of pending) update.run(searchKey(row.title), searchKey(row.author), row.id);
    db.exec('COMMIT');
    return pending.length;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* zaten açık işlem yoksa yoksay */
    }
    // Başka bir süreç aynı anda dolduruyor olabilir; uygulamayı düşürmeye
    // değmez, bir sonraki açılışta tamamlanır.
    console.warn(`⚠ Arama anahtarları bu açılışta doldurulamadı: ${err.message}`);
    return 0;
  }
}

const filled = backfillSearchKeys();
if (filled > 0) console.log(`  ✔ ${filled} kitap için arama anahtarı oluşturuldu.`);

tryExec('CREATE INDEX IF NOT EXISTS idx_books_title_key  ON books(title_key);', 'title_key indeksi');
tryExec('CREATE INDEX IF NOT EXISTS idx_books_author_key ON books(author_key);', 'author_key indeksi');

// --- Varsayılan SMTP ayarları ------------------------------------------
const defaultSettings = {
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_secure: 'tls',
  smtp_from: '',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);

// --- İlk kurulum: yönetici hesabı --------------------------------------
const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
if (adminCount === 0) {
  const plain = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const hash = bcrypt.hashSync(plain, 12);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run('admin', hash);
  // Şifreyi dosyaya yazmayı dener; yazamazsa (salt okunur uygulama klasörü)
  // log'a basar. Bu adım hiçbir şekilde uygulamayı düşürmemeli.
  const credFile = path.join(PROJECT_ROOT, 'admin_password.txt');
  let written = false;
  try {
    fs.writeFileSync(
      credFile,
      'İlk kurulum yönetici hesabı\n' +
        'Kullanıcı adı : admin\n' +
        `Şifre         : ${plain}\n\n` +
        'Giriş yaptıktan sonra şifrenizi değiştirin ve bu dosyayı SİLİN.\n',
      { mode: 0o600 }
    );
    written = true;
  } catch {
    /* aşağıda log'a basılacak */
  }

  console.log(
    '\n  ✔ Yönetici hesabı oluşturuldu — kullanıcı adı: admin\n' +
      (written
        ? `    Şifre şu dosyada: ${credFile}\n`
        : `    Şifre: ${plain}\n    (dosyaya yazılamadı; giriş yapıp hemen değiştirin)\n`)
  );
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  );
}
