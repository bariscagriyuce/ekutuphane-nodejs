import { shelfCounts } from '../services/books.js';

// auth.js — Oturum ve yetki kontrolü ara katmanları
function wantsJson(req) {
  return (
    req.xhr ||
    req.path.startsWith('/api/') ||
    (req.get('accept') || '').includes('application/json')
  );
}

export function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  if (wantsJson(req)) {
    return res.status(401).json({ success: false, message: 'Oturumunuz sona ermiş. Lütfen tekrar giriş yapın.' });
  }
  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?next=${next_}`);
}

export function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  if (wantsJson(req)) {
    return res.status(403).json({ success: false, message: 'Bu işlem için yönetici yetkisi gerekir.' });
  }
  return res.status(403).render('error', {
    title: 'Yetkisiz Erişim',
    message: 'Bu sayfayı görüntülemek için yönetici olmanız gerekiyor.',
  });
}

// Şablonlarda her zaman erişilebilir ortak değişkenler
export function localsMiddleware(req, res, next) {
  res.locals.user = req.session?.user || null;
  res.locals.csrfToken = req.session ? req.csrfToken?.() : '';
  res.locals.currentPath = req.path;
  res.locals.query = req.query;

  // Kenar çubuğu sayaçları yalnızca şablon isterse hesaplanır (tembel getter)
  let cached;
  Object.defineProperty(res.locals, 'counts', {
    configurable: true,
    enumerable: true,
    get() {
      if (!cached) {
        cached = req.session?.user
          ? shelfCounts(req.session.user.id)
          : { total: 0, favorites: 0, reading: 0, finished: 0 };
      }
      return cached;
    },
    set(v) {
      cached = v;
    },
  });

  next();
}
