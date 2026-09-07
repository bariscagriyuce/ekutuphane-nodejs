// import.js — uploads/import klasörünü tarayıp kitapları kütüphaneye aktarır
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db.js';
import {
  BOOKS_DIR,
  COVERS_DIR,
  IMPORT_DIR,
  BOOK_FORMATS,
  COVER_FORMATS,
  resolveDataPath,
} from '../config.js';
import { getEpubMetadata, parseFilename } from './epub.js';

const uid = () => crypto.randomBytes(8).toString('hex');
const safeName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

/** İçe aktarma klasörünü özyinelemeli tarar. */
export function scanImportDir(dir = IMPORT_DIR, base = IMPORT_DIR) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...scanImportDir(full, base));
    } else if (entry.isFile()) {
      const format = path.extname(entry.name).slice(1).toLowerCase();
      if (!BOOK_FORMATS.includes(format)) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        /* yoksay */
      }
      out.push({
        relativePath: path.relative(base, full).split(path.sep).join('/'),
        filename: entry.name,
        size,
        format,
      });
    }
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'tr'));
}

/** Yol, hedef dizinin gerçekten içinde mi? (path traversal koruması) */
export function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function saveCover(coverData, coverName) {
  if (!coverData || !coverName) return null;
  let ext = path.extname(coverName).slice(1).toLowerCase();
  if (!COVER_FORMATS.includes(ext)) ext = 'jpg';
  const name = `${uid()}_cover.${ext}`;
  fs.writeFileSync(path.join(COVERS_DIR, name), coverData);
  return `uploads/covers/${name}`;
}

/**
 * Kaynak dosyayı kütüphaneye ekler.
 * @param {string} sourcePath  okunacak dosyanın tam yolu
 * @param {object} [opts]
 * @param {'copy'|'move'} [opts.mode='copy']
 * @param {string} [opts.title] elle verilen başlık (yoksa metadata/dosya adı)
 * @param {string} [opts.author]
 * @param {string} [opts.coverPath] elle yüklenen kapak (uploads/covers/... göreli yolu)
 */
export function addBookFromFile(sourcePath, opts = {}) {
  const { mode = 'copy' } = opts;
  const format = path.extname(sourcePath).slice(1).toLowerCase();
  if (!BOOK_FORMATS.includes(format)) {
    throw new Error(`Desteklenmeyen format: ${format.toUpperCase()}`);
  }

  let title = opts.title?.trim() || '';
  let author = opts.author?.trim() || '';
  let coverPath = opts.coverPath || null;

  if (format === 'epub' && (!title || !author || !coverPath)) {
    const meta = getEpubMetadata(sourcePath);
    if (meta) {
      if (!title) title = meta.title;
      if (!author) author = meta.author;
      if (!coverPath) coverPath = saveCover(meta.coverData, meta.coverName);
    }
  }

  if (!title) {
    const parsed = parseFilename(path.basename(sourcePath));
    title = parsed.title;
    if (!author) author = parsed.author;
  }
  if (!author) author = 'Bilinmeyen Yazar';

  title = title.slice(0, 255);
  author = author.slice(0, 255);

  const targetName = `${uid()}_${safeName(path.basename(sourcePath))}`;
  const targetRel = `uploads/books/${targetName}`;
  const targetFull = path.join(BOOKS_DIR, targetName);

  if (mode === 'move') fs.renameSync(sourcePath, targetFull);
  else fs.copyFileSync(sourcePath, targetFull);

  try {
    const info = db
      .prepare('INSERT INTO books (title, author, file_path, file_format, cover_path) VALUES (?, ?, ?, ?, ?)')
      .run(title, author, targetRel, format, coverPath);
    return { id: Number(info.lastInsertRowid), title, author, format, coverPath };
  } catch (err) {
    fs.rmSync(targetFull, { force: true });
    if (coverPath && !opts.coverPath) fs.rmSync(path.join(COVERS_DIR, path.basename(coverPath)), { force: true });
    throw err;
  }
}

/** import klasöründeki tek bir dosyayı aktarır ve kaynağı temizler. */
export function importFromImportDir(relativePath) {
  const full = path.resolve(IMPORT_DIR, relativePath);
  if (!isInside(full, IMPORT_DIR)) {
    throw new Error('Güvenlik ihlali: dosya içe aktarma dizininin dışında.');
  }
  if (!fs.existsSync(full)) throw new Error('Dosya bulunamadı.');

  const result = addBookFromFile(full, { mode: 'copy' });
  fs.rmSync(full, { force: true });

  // Boşalan alt klasörleri temizle
  let dir = path.dirname(full);
  while (isInside(dir, IMPORT_DIR)) {
    try {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
  return result;
}

/** Kitabı ve dosyalarını siler. */
export function deleteBook(bookId) {
  const book = db.prepare('SELECT file_path, cover_path FROM books WHERE id = ?').get(bookId);
  if (!book) return false;
  db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
  db.prepare('DELETE FROM favorites WHERE book_id = ?').run(bookId);
  db.prepare('DELETE FROM progress WHERE book_id = ?').run(bookId);
  db.prepare('DELETE FROM annotations WHERE book_id = ?').run(bookId);
  for (const rel of [book.file_path, book.cover_path]) {
    const abs = resolveDataPath(rel);
    if (abs) fs.rmSync(abs, { force: true });
  }
  return true;
}
