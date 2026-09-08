// reader.js — Tarayıcı içi okuyucu ve yetki kontrollü dosya sunumu
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireLogin } from '../middleware/auth.js';
import { getBook } from '../services/books.js';
import { db } from '../db.js';
import { READABLE_FORMATS, COVER_FORMATS, resolveDataPath } from '../config.js';

export const router = Router();
router.use(requireLogin);

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.mobi8-ebook',
};

/** Ek/indirme için güvenli dosya adı üretir. */
export function downloadName(book) {
  const clean = String(book.title)
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return `${clean || 'ekitap_' + book.id}.${String(book.file_format).toLowerCase()}`;
}

/** Kitabın diskteki yolunu doğrular. */
export function bookFilePath(book) {
  const abs = resolveDataPath(book?.file_path);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

router.get('/read/:id', (req, res) => {
  const bookId = Number.parseInt(req.params.id, 10);
  const book = bookId > 0 ? getBook(bookId, req.session.user.id) : null;

  if (!book) {
    return res.status(404).render('error', { title: 'Kitap Bulunamadı', message: 'Aradığınız kitap kütüphanede yok.' });
  }

  const format = String(book.file_format).toLowerCase();
  if (!READABLE_FORMATS.includes(format)) {
    return res.status(415).render('error', {
      title: 'Desteklenmeyen Format',
      message: `${format.toUpperCase()} formatı tarayıcıda okunamıyor. Kitabı indirebilir veya e-okuyucunuza gönderebilirsiniz.`,
    });
  }

  const annotations = db
    .prepare(
      `SELECT id, cfi_range, selected_text, note_text, color, created_at
       FROM annotations WHERE user_id = ? AND book_id = ? ORDER BY created_at ASC`
    )
    .all(req.session.user.id, bookId);

  res.render('reader', {
    title: book.title,
    book,
    format,
    engine: format === 'pdf' ? 'pdf' : 'epub',
    annotations,
  });
});

// Kitap dosyasını sunar. ?inline=1 → okuyucu içinde açmak için.
router.get('/file/:id', (req, res) => {
  const bookId = Number.parseInt(req.params.id, 10);
  const book = bookId > 0 ? db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) : null;
  if (!book) return res.status(404).send('Kitap bulunamadı.');

  const abs = bookFilePath(book);
  if (!abs) return res.status(404).send('Kitap dosyası sunucuda bulunamadı.');

  const format = String(book.file_format).toLowerCase();
  const inline = req.query.inline === '1';

  res.setHeader('Content-Type', CONTENT_TYPES[format] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(downloadName(book))}`
  );
  res.sendFile(abs, { acceptRanges: true, cacheControl: false, headers: { 'Cache-Control': 'private, max-age=0' } }, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

// Kapak görselleri (yalnızca uploads/covers içinden)
router.get('/covers/:file', (req, res) => {
  const name = path.basename(req.params.file);
  if (!COVER_FORMATS.includes(path.extname(name).slice(1).toLowerCase())) return res.status(404).end();
  const abs = resolveDataPath(path.posix.join('uploads/covers', name));
  if (!abs || !fs.existsSync(abs)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(abs);
});
