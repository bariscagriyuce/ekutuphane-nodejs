// api.js — İstemci tarafı AJAX uç noktaları
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireLogin } from '../middleware/auth.js';
import { toggleFavorite, saveProgress, getProgress } from '../services/books.js';
import { sendMail } from '../services/mailer.js';
import { bookFilePath, downloadName } from './reader.js';
import { verifyPassword } from './auth.js';

export const router = Router();
router.use(requireLogin);

const VALID_COLORS = ['yellow', 'green', 'pink', 'blue'];
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// --- Favoriler ---------------------------------------------------------
router.post('/favorites', (req, res) => {
  const bookId = Number.parseInt(req.body.book_id, 10);
  const action = ['add', 'remove', 'toggle'].includes(req.body.action) ? req.body.action : 'toggle';
  if (!(bookId > 0)) return res.status(400).json({ success: false, message: 'Geçersiz kitap kimliği.' });

  const isFavorite = toggleFavorite(req.session.user.id, bookId, action);
  res.json({
    success: true,
    is_favorite: isFavorite,
    message: isFavorite ? 'Kitap favorilerinize eklendi.' : 'Kitap favorilerinizden çıkarıldı.',
  });
});

// --- Okuma ilerlemesi --------------------------------------------------
router.post('/progress', (req, res) => {
  const bookId = Number.parseInt(req.body.book_id, 10);
  const value = String(req.body.progress_value || '').trim();
  const percentage = Math.min(100, Math.max(0, Number.parseInt(req.body.percentage, 10) || 0));
  if (!(bookId > 0) || !value) return res.status(400).json({ success: false, message: 'Eksik parametreler.' });

  saveProgress(req.session.user.id, bookId, value, percentage);
  res.json({ success: true });
});

router.get('/progress/:bookId', (req, res) => {
  const bookId = Number.parseInt(req.params.bookId, 10);
  const row = bookId > 0 ? getProgress(req.session.user.id, bookId) : null;
  res.json({ success: true, found: !!row, ...(row || {}) });
});

// --- Notlar & vurgular -------------------------------------------------
router.get('/annotations/:bookId', (req, res) => {
  const bookId = Number.parseInt(req.params.bookId, 10);
  const rows = db
    .prepare(
      `SELECT id, cfi_range, selected_text, note_text, color, created_at
       FROM annotations WHERE user_id = ? AND book_id = ? ORDER BY created_at ASC`
    )
    .all(req.session.user.id, bookId || 0);
  res.json({ success: true, annotations: rows });
});

router.post('/annotations', (req, res) => {
  const userId = req.session.user.id;
  const id = Number.parseInt(req.body.id, 10) || 0;
  const bookId = Number.parseInt(req.body.book_id, 10);
  const cfi = String(req.body.cfi_range || '').trim();
  const text = String(req.body.selected_text || '').trim();
  const note = req.body.note_text == null ? null : String(req.body.note_text).trim();
  const color = VALID_COLORS.includes(req.body.color) ? req.body.color : 'yellow';

  if (id > 0) {
    const r = db
      .prepare('UPDATE annotations SET note_text = ?, color = ? WHERE id = ? AND user_id = ?')
      .run(note, color, id, userId);
    if (r.changes === 0) return res.status(404).json({ success: false, message: 'Not bulunamadı.' });
    return res.json({ success: true, id, message: 'Not güncellendi.' });
  }

  if (!(bookId > 0) || !cfi || !text) {
    return res.status(400).json({ success: false, message: 'Eksik veya geçersiz parametreler.' });
  }
  const info = db
    .prepare(
      'INSERT INTO annotations (user_id, book_id, cfi_range, selected_text, note_text, color) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(userId, bookId, cfi, text, note, color);
  res.json({ success: true, id: Number(info.lastInsertRowid), message: 'Not kaydedildi.' });
});

router.delete('/annotations/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const r = db.prepare('DELETE FROM annotations WHERE id = ? AND user_id = ?').run(id || 0, req.session.user.id);
  if (r.changes === 0) return res.status(404).json({ success: false, message: 'Not bulunamadı.' });
  res.json({ success: true, message: 'Not silindi.' });
});

// --- Profil ------------------------------------------------------------
router.post('/profile', (req, res) => {
  const userId = req.session.user.id;
  const kindleEmail = String(req.body.kindle_email || '').trim();
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const confirm = String(req.body.new_password_confirm || '');

  if (kindleEmail && !isEmail(kindleEmail)) {
    return res.status(400).json({ success: false, message: 'Geçersiz e-posta adresi formatı.' });
  }

  const changingPassword = Boolean(current || next || confirm);
  if (changingPassword) {
    if (!current || !next || !confirm) {
      return res.status(400).json({ success: false, message: 'Şifre değiştirmek için tüm şifre alanlarını doldurun.' });
    }
    if (next.length < 10) {
      return res.status(400).json({ success: false, message: 'Yeni şifre en az 10 karakter olmalıdır.' });
    }
    if (next !== confirm) {
      return res.status(400).json({ success: false, message: 'Yeni şifreler eşleşmiyor.' });
    }
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(userId);
    if (!row || !verifyPassword(current, row.password)) {
      return res.status(400).json({ success: false, message: 'Mevcut şifreniz yanlış.' });
    }
    db.prepare('UPDATE users SET kindle_email = ?, password = ? WHERE id = ?').run(
      kindleEmail || null,
      bcrypt.hashSync(next, 12),
      userId
    );
  } else {
    db.prepare('UPDATE users SET kindle_email = ? WHERE id = ?').run(kindleEmail || null, userId);
  }

  req.session.user.kindle_email = kindleEmail;
  res.json({
    success: true,
    message: changingPassword ? 'Profiliniz ve şifreniz güncellendi.' : 'Profiliniz güncellendi.',
  });
});

// --- E-okuyucuya gönder ------------------------------------------------
router.post('/send-to-reader', async (req, res) => {
  const bookId = Number.parseInt(req.body.book_id, 10);
  if (!(bookId > 0)) return res.status(400).json({ success: false, message: 'Geçersiz kitap kimliği.' });

  const user = db.prepare('SELECT kindle_email FROM users WHERE id = ?').get(req.session.user.id);
  if (!user?.kindle_email) {
    return res.status(400).json({
      success: false,
      message: 'Profilinizde kayıtlı bir e-okuyucu adresi yok. Ayarlar penceresinden tanımlayabilirsiniz.',
    });
  }

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  const abs = book ? bookFilePath(book) : null;
  if (!abs) return res.status(404).json({ success: false, message: 'Kitap dosyası sunucuda bulunamadı.' });

  try {
    await sendMail({
      to: user.kindle_email,
      subject: `E-Kitap: ${book.title}`,
      text: `Kütüphanenizden talep ettiğiniz e-kitap ektedir: ${book.title}`,
      attachment: { path: abs, filename: downloadName(book) },
    });
    res.json({ success: true, message: `Kitap ${user.kindle_email} adresine gönderildi.` });
  } catch (err) {
    console.error('send-to-reader:', err.message);
    res.status(500).json({ success: false, message: `Gönderim başarısız: ${err.message}` });
  }
});
