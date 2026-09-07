// books.js — Kitap sorguları: arama, filtre, sıralama, sayfalama
import path from 'node:path';
import { db } from '../db.js';
import { READABLE_FORMATS } from '../config.js';

export const SORTS = {
  recent: 'b.added_at DESC, b.id DESC',
  title: 'b.title COLLATE NOCASE ASC',
  author: 'b.author COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC',
  progress: 'COALESCE(p.percentage, -1) DESC, b.added_at DESC',
};

export function decorate(book) {
  if (!book) return book;
  return {
    ...book,
    coverUrl: book.cover_path ? '/covers/' + encodeURIComponent(path.basename(book.cover_path)) : null,
    isFavorite: !!book.is_favorite,
    percentage: book.percentage == null ? null : Number(book.percentage),
    readable: READABLE_FORMATS.includes(String(book.file_format).toLowerCase()),
  };
}

/**
 * Kitapları filtreleyerek listeler.
 * @param {object} o
 * @param {number} o.userId
 * @param {string} [o.search]      başlık/yazar araması
 * @param {string} [o.format]      epub|pdf|mobi|azw3
 * @param {string} [o.shelf]       all|favorites|reading|finished
 * @param {string} [o.sort]        recent|title|author|progress
 * @param {number} [o.limit]
 * @param {number} [o.offset]
 */
export function listBooks({
  userId,
  search = '',
  format = '',
  shelf = 'all',
  sort = 'recent',
  limit = 24,
  offset = 0,
}) {
  const where = [];
  const params = { user_id: userId };

  let join = `
    LEFT JOIN progress p ON p.book_id = b.id AND p.user_id = :user_id
    LEFT JOIN favorites f ON f.book_id = b.id AND f.user_id = :user_id
  `;

  if (shelf === 'favorites') where.push('f.id IS NOT NULL');
  if (shelf === 'reading') where.push('p.percentage IS NOT NULL AND p.percentage > 0 AND p.percentage < 98');
  if (shelf === 'finished') where.push('p.percentage >= 98');

  if (search.trim()) {
    where.push('(b.title LIKE :search OR b.author LIKE :search)');
    params.search = `%${search.trim()}%`;
  }
  if (format.trim()) {
    where.push('LOWER(b.file_format) = :format');
    params.format = format.trim().toLowerCase();
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  let orderSql = SORTS[sort] || SORTS.recent;
  if (shelf === 'favorites' && sort === 'recent') orderSql = 'f.created_at DESC';
  if (shelf === 'reading' && sort === 'recent') orderSql = 'p.updated_at DESC';

  const rows = db
    .prepare(
      `SELECT b.*, p.percentage, p.progress_value, p.updated_at AS read_at,
              CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS is_favorite
       FROM books b ${join} ${whereSql}
       ORDER BY ${orderSql}
       LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit, offset });

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM books b ${join} ${whereSql}`)
    .get(params).c;

  return { books: rows.map(decorate), total };
}

export function getBook(bookId, userId) {
  const row = db
    .prepare(
      `SELECT b.*, p.percentage, p.progress_value,
              CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS is_favorite
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id AND p.user_id = ?
       LEFT JOIN favorites f ON f.book_id = b.id AND f.user_id = ?
       WHERE b.id = ?`
    )
    .get(userId, userId, bookId);
  return decorate(row);
}

/** Ana sayfadaki "Okumaya devam et" rafı */
export function continueReading(userId, limit = 12) {
  const rows = db
    .prepare(
      `SELECT b.*, p.percentage, p.progress_value, p.updated_at AS read_at,
              CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS is_favorite
       FROM progress p
       JOIN books b ON b.id = p.book_id
       LEFT JOIN favorites f ON f.book_id = b.id AND f.user_id = ?
       WHERE p.user_id = ? AND p.percentage > 0 AND p.percentage < 98
       ORDER BY p.updated_at DESC
       LIMIT ?`
    )
    .all(userId, userId, limit);
  return rows.map(decorate);
}

/** Kenar çubuğundaki sayaçlar */
export function shelfCounts(userId) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM books').get().c;
  const favorites = db.prepare('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?').get(userId).c;
  const reading = db
    .prepare('SELECT COUNT(*) AS c FROM progress WHERE user_id = ? AND percentage > 0 AND percentage < 98')
    .get(userId).c;
  const finished = db
    .prepare('SELECT COUNT(*) AS c FROM progress WHERE user_id = ? AND percentage >= 98')
    .get(userId).c;
  return { total, favorites, reading, finished };
}

/** Format filtresi için mevcut formatlar ve adetleri */
export function formatCounts() {
  return db
    .prepare('SELECT LOWER(file_format) AS format, COUNT(*) AS count FROM books GROUP BY 1 ORDER BY 2 DESC')
    .all();
}

export function toggleFavorite(userId, bookId, action = 'toggle') {
  const exists = db.prepare('SELECT 1 AS x FROM favorites WHERE user_id = ? AND book_id = ?').get(userId, bookId);
  const shouldAdd = action === 'add' || (action === 'toggle' && !exists);
  if (shouldAdd) {
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, book_id) VALUES (?, ?)').run(userId, bookId);
    return true;
  }
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND book_id = ?').run(userId, bookId);
  return false;
}

export function saveProgress(userId, bookId, value, percentage) {
  db.prepare(
    `INSERT INTO progress (user_id, book_id, progress_value, percentage, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, book_id) DO UPDATE SET
       progress_value = excluded.progress_value,
       percentage = excluded.percentage,
       updated_at = CURRENT_TIMESTAMP`
  ).run(userId, bookId, value, percentage);
}

export function getProgress(userId, bookId) {
  return db
    .prepare('SELECT progress_value, percentage FROM progress WHERE user_id = ? AND book_id = ?')
    .get(userId, bookId);
}
