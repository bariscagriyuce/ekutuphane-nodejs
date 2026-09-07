// library.js — Kütüphane sayfaları ve kitap listeleme API'si
import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';
import { listBooks, continueReading, shelfCounts, formatCounts, SORTS } from '../services/books.js';
import { PAGE_SIZE, BOOK_FORMATS } from '../config.js';

export const router = Router();
router.use(requireLogin);

const SHELVES = {
  all: { label: 'Tüm Kitaplar', empty: 'Kütüphanede henüz kitap yok.' },
  favorites: { label: 'Favorilerim', empty: 'Henüz favori kitabınız yok. Kitap kartındaki kalbe dokunun.' },
  reading: { label: 'Okumaya Devam Et', empty: 'Şu an okuduğunuz bir kitap yok.' },
  finished: { label: 'Bitirdiklerim', empty: 'Henüz bitirdiğiniz bir kitap yok.' },
};

function parseParams(req) {
  const shelf = SHELVES[req.query.shelf] ? req.query.shelf : 'all';
  const sort = SORTS[req.query.sort] ? req.query.sort : 'recent';
  const format = BOOK_FORMATS.includes(String(req.query.format).toLowerCase())
    ? String(req.query.format).toLowerCase()
    : '';
  const search = String(req.query.q || '').trim().slice(0, 120);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  return { shelf, sort, format, search, page };
}

router.get('/', (req, res) => {
  const userId = req.session.user.id;
  const { shelf, sort, format, search, page } = parseParams(req);
  const offset = (page - 1) * PAGE_SIZE;

  const { books, total } = listBooks({ userId, search, format, shelf, sort, limit: PAGE_SIZE, offset });
  const showContinueShelf = shelf === 'all' && !search && !format && page === 1;

  // Şablonda filtre bağlantıları üretmek için
  const buildUrl = (overrides = {}) => {
    const merged = { shelf, sort, format, q: search, ...overrides };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value && !(key === 'sort' && value === 'recent') && !(key === 'shelf' && value === 'all')) {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `/?${qs}` : '/';
  };

  res.render('library', {
    title: SHELVES[shelf].label,
    shelf,
    shelves: SHELVES,
    sort,
    format,
    search,
    page,
    pageSize: PAGE_SIZE,
    total,
    books,
    counts: shelfCounts(userId),
    formats: formatCounts(),
    continueShelf: showContinueShelf ? continueReading(userId) : [],
    emptyMessage: SHELVES[shelf].empty,
    buildUrl,
  });
});

// Sonsuz kaydırma / anlık arama için JSON uç noktası
router.get('/api/books', (req, res) => {
  const userId = req.session.user.id;
  const { shelf, sort, format, search, page } = parseParams(req);
  const offset = (page - 1) * PAGE_SIZE;
  const { books, total } = listBooks({ userId, search, format, shelf, sort, limit: PAGE_SIZE, offset });
  res.json({
    success: true,
    page,
    total,
    hasMore: offset + books.length < total,
    books,
  });
});
