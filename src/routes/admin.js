// admin.js — Yönetici paneli: kitap yükleme, toplu içe aktarma, kullanıcılar, SMTP
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db, getSettings, setSetting } from '../db.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { csrfValid, csrfReject } from '../middleware/csrf.js';
import { sniffImageFile } from '../services/images.js';
import { destroyUserSessions } from '../session-store.js';
import { BOOK_FORMATS, COVER_FORMATS, COVERS_DIR, IMPORT_DIR, TMP_DIR } from '../config.js';
import { addBookFromFile, deleteBook, scanImportDir, importFromImportDir } from '../services/import.js';
import { sendMail, smtpConfigured } from '../services/mailer.js';
import { listBooks } from '../services/books.js';

export const router = Router();
// DİKKAT: Yol verilmeden yazılan router.use(...) bu yönlendiriciye uğrayan
// TÜM isteklere uygulanır. Bu yönlendirici kök dizine bağlı olduğu için
// yönetici kontrolü açıkça '/admin' ile sınırlanmalıdır; aksi hâlde
// kütüphane sayfaları da yönetici gerektirir.
router.use('/admin', requireLogin, requireAdmin);

const upload = multer({
  // Geçici dosyalar veri klasörünün içinde tutulur; böylece kitap dizinine
  // taşıma aynı dosya sistemi üzerinde kalır (bkz. config.js TMP_DIR).
  dest: TMP_DIR,
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 MB
});

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const cleanupTmp = (files = {}) => {
  for (const list of Object.values(files)) for (const f of list) fs.rmSync(f.path, { force: true });
};

// --- Panel -------------------------------------------------------------
router.get('/admin', (req, res) => {
  const flashMessage = req.session.flash || null;
  delete req.session.flash;
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = 20;
  const { books, total } = listBooks({
    userId: req.session.user.id,
    search: q,
    sort: 'recent',
    limit,
    offset: (page - 1) * limit,
  });

  res.render('admin', {
    title: 'Yönetici Paneli',
    books,
    total,
    page,
    limit,
    q,
    users: db.prepare('SELECT id, username, role, kindle_email, created_at FROM users ORDER BY id ASC').all(),
    smtp: getSettings(),
    smtpReady: smtpConfigured(),
    stats: {
      books: db.prepare('SELECT COUNT(*) AS c FROM books').get().c,
      users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      annotations: db.prepare('SELECT COUNT(*) AS c FROM annotations').get().c,
      inProgress: db.prepare('SELECT COUNT(*) AS c FROM progress WHERE percentage > 0').get().c,
    },
    flash: flashMessage,
  });
});

function flash(req, res, type, message, to = '/admin') {
  req.session.flash = { type, message };
  req.session.save(() => res.redirect(to));
}

// --- Kitap yükleme -----------------------------------------------------
router.post(
  '/admin/books',
  upload.fields([{ name: 'book_file', maxCount: 1 }, { name: 'cover_file', maxCount: 1 }]),
  (req, res) => {
    // multipart gövde ancak şimdi ayrıştırıldı; CSRF denetimi burada yapılır
    if (!csrfValid(req)) {
      cleanupTmp(req.files);
      return csrfReject(req, res);
    }

    const bookFile = req.files?.book_file?.[0];
    if (!bookFile) return flash(req, res, 'error', 'Lütfen bir kitap dosyası seçin.');

    const format = path.extname(bookFile.originalname).slice(1).toLowerCase();
    if (!BOOK_FORMATS.includes(format)) {
      cleanupTmp(req.files);
      return flash(req, res, 'error', 'Geçersiz format. Yalnızca EPUB, PDF, MOBI ve AZW3 desteklenir.');
    }

    // Geçici dosyaya gerçek uzantıyı ver (metadata çıkarımı uzantıya bakar)
    const sourcePath = bookFile.path + '.' + format;
    fs.renameSync(bookFile.path, sourcePath);

    let coverPath = null;
    const coverFile = req.files?.cover_file?.[0];
    if (coverFile) {
      const coverExt = path.extname(coverFile.originalname).slice(1).toLowerCase();
      // Uzantı beyandır; dosyanın gerçekten görsel olduğu içeriğinden doğrulanır
      const realExt = sniffImageFile(coverFile.path);
      if (COVER_FORMATS.includes(coverExt) && realExt) {
        const name = `${Date.now().toString(36)}_cover.${realExt}`;
        fs.copyFileSync(coverFile.path, path.join(COVERS_DIR, name));
        coverPath = `uploads/covers/${name}`;
      }
      fs.rmSync(coverFile.path, { force: true });
    }

    try {
      const book = addBookFromFile(sourcePath, {
        mode: 'move',
        title: req.body.title,
        author: req.body.author,
        coverPath,
      });
      return flash(req, res, 'success', `"${book.title}" kütüphaneye eklendi.`);
    } catch (err) {
      fs.rmSync(sourcePath, { force: true });
      console.error('kitap yükleme:', err);
      return flash(req, res, 'error', 'Kitap eklenemedi: ' + err.message);
    }
  }
);

router.post('/admin/books/:id/delete', (req, res) => {
  const ok = deleteBook(Number.parseInt(req.params.id, 10) || 0);
  if (req.get('accept')?.includes('application/json')) {
    return res.json({ success: ok, message: ok ? 'Kitap silindi.' : 'Kitap bulunamadı.' });
  }
  return flash(req, res, ok ? 'success' : 'error', ok ? 'Kitap silindi.' : 'Kitap bulunamadı.');
});

// --- Toplu içe aktarma -------------------------------------------------
router.get('/admin/import/scan', (req, res) => {
  res.json({ success: true, dir: IMPORT_DIR, files: scanImportDir() });
});

router.post('/admin/import/file', (req, res) => {
  try {
    const result = importFromImportDir(String(req.body.file || ''));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// --- Kullanıcılar ------------------------------------------------------
router.post('/admin/users', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const kindleEmail = String(req.body.kindle_email || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'user';

  if (!username || !password) return flash(req, res, 'error', 'Kullanıcı adı ve şifre zorunludur.');
  if (password.length < 10) return flash(req, res, 'error', 'Şifre en az 10 karakter olmalıdır.');
  if (kindleEmail && !isEmail(kindleEmail)) return flash(req, res, 'error', 'Geçersiz e-posta adresi.');
  if (db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(username)) {
    return flash(req, res, 'error', 'Bu kullanıcı adı zaten alınmış.');
  }

  db.prepare('INSERT INTO users (username, password, role, kindle_email) VALUES (?, ?, ?, ?)').run(
    username,
    bcrypt.hashSync(password, 12),
    role,
    kindleEmail || null
  );
  return flash(req, res, 'success', `"${username}" kullanıcısı eklendi.`);
});

// Kullanıcı şifresini sıfırla. Şifreler geri döndürülemez biçimde saklandığı
// için yöneticinin tek seçeneği yeni bir şifre atamaktır. Kullanıcının
// favorileri, okuma ilerlemesi ve notları korunur.
router.post('/admin/users/:id/password', (req, res) => {
  const id = Number.parseInt(req.params.id, 10) || 0;
  const password = String(req.body.password || '');

  if (password.length < 10) {
    return res.status(400).json({ success: false, message: 'Şifre en az 10 karakter olmalıdır.' });
  }

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), id);
  // Şifre sıfırlanınca giriş denemesi kilidi de kalkmalı
  db.prepare('DELETE FROM login_attempts WHERE username = ?').run(user.username);
  // Eski şifreyle açılmış oturumlar kapatılır (yöneticinin kendi oturumu hariç)
  destroyUserSessions(id, id === req.session.user.id ? req.sessionID : null);

  res.json({ success: true, message: `"${user.username}" kullanıcısının şifresi güncellendi.` });
});

router.post('/admin/users/:id/delete', (req, res) => {
  const id = Number.parseInt(req.params.id, 10) || 0;
  if (id === req.session.user.id) return flash(req, res, 'error', 'Kendi hesabınızı silemezsiniz.');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.prepare('DELETE FROM favorites WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM progress WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM annotations WHERE user_id = ?').run(id);
  // Silinen kullanıcının açık oturumları da geçersiz kılınır
  destroyUserSessions(id);
  return flash(req, res, 'success', 'Kullanıcı silindi.');
});

// --- SMTP --------------------------------------------------------------
router.post('/admin/smtp', (req, res) => {
  for (const field of ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_secure', 'smtp_from']) {
    setSetting(field, String(req.body[field] ?? '').trim());
  }
  // Şifre alanı boş bırakıldıysa mevcut şifre korunur
  const pass = String(req.body.smtp_pass ?? '').trim();
  if (pass) setSetting('smtp_pass', pass);
  return flash(req, res, 'success', 'SMTP ayarları kaydedildi.');
});

router.post('/admin/smtp/test', async (req, res) => {
  const to = String(req.body.test_email || '').trim();
  if (!isEmail(to)) return res.status(400).json({ success: false, message: 'Geçerli bir e-posta adresi girin.' });
  try {
    await sendMail({
      to,
      subject: 'E-Kütüphane SMTP Testi',
      text: 'Tebrikler! E-Kütüphane SMTP yapılandırmanız çalışıyor.',
    });
    res.json({ success: true, message: `Test e-postası ${to} adresine gönderildi.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gönderim başarısız: ' + err.message });
  }
});
