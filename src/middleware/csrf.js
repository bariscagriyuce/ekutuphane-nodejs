// csrf.js — Oturum tabanlı CSRF koruması (PHP sürümündeki csrf_token ile aynı mantık)
import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrf(req, res, next) {
  req.csrfToken = () => {
    if (!req.session) return '';
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
  };

  if (SAFE_METHODS.has(req.method)) return next();

  const sent =
    req.get('x-csrf-token') ||
    req.body?.csrf_token ||
    req.body?._csrf ||
    '';
  const known = req.session?.csrfToken || '';

  const ok =
    typeof sent === 'string' &&
    sent.length > 0 &&
    known.length === sent.length &&
    crypto.timingSafeEqual(Buffer.from(known), Buffer.from(sent));

  if (!ok) {
    const message = 'Güvenlik doğrulaması başarısız (CSRF). Sayfayı yenileyip tekrar deneyin.';
    if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json')) {
      return res.status(403).json({ success: false, message });
    }
    return res.status(403).render('error', { title: 'Güvenlik Hatası', message });
  }

  return next();
}
