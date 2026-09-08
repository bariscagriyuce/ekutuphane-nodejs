// csrf.js — Oturum tabanlı CSRF koruması (PHP sürümündeki csrf_token ile aynı mantık)
import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// multipart/form-data gövdesi bu ara katman çalışırken henüz ayrıştırılmamıştır
// (multer rotada çalışır). Yalnızca burada listelenen rotalar denetimi
// erteleyebilir; o rotalar multer'dan SONRA csrfValid() ile doğrulamak
// zorundadır. Listede olmayan bir yola gelen multipart istek, gövdede token
// olamayacağı için başlık taşımıyorsa reddedilir.
const MULTIPART_ROUTES = new Set(['/admin/books']);

function sentToken(req) {
  return req.get('x-csrf-token') || req.body?.csrf_token || req.body?._csrf || '';
}

/** Gönderilen token oturumdakiyle eşleşiyor mu? */
export function csrfValid(req) {
  const sent = sentToken(req);
  const known = req.session?.csrfToken || '';
  return (
    typeof sent === 'string' &&
    sent.length > 0 &&
    known.length === sent.length &&
    crypto.timingSafeEqual(Buffer.from(known), Buffer.from(sent))
  );
}

export function csrfReject(req, res) {
  const message = 'Güvenlik doğrulaması başarısız (CSRF). Sayfayı yenileyip tekrar deneyin.';
  if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json')) {
    return res.status(403).json({ success: false, message });
  }
  return res.status(403).render('error', { title: 'Güvenlik Hatası', message });
}

export function csrf(req, res, next) {
  req.csrfToken = () => {
    if (!req.session) return '';
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
  };
  // Hata sayfası dâhil her şablon bu değişkeni bekler; denetim reddetse bile
  // tanımlı olmalı.
  res.locals.csrfToken = req.csrfToken();

  if (SAFE_METHODS.has(req.method)) return next();

  if (req.is('multipart/form-data') && MULTIPART_ROUTES.has(req.path) && !req.get('x-csrf-token')) {
    req.csrfDeferred = true;
    return next();
  }

  return csrfValid(req) ? next() : csrfReject(req, res);
}
