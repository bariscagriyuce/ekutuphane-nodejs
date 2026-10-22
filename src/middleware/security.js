// security.js — HTTP güvenlik başlıkları ve İçerik Güvenlik Politikası (CSP)
//
// CSP, sayfaya enjekte edilen bir betiğin çalışmasını engeller; XSS'in ikinci
// savunma hattıdır. Satır içi betikler istek başına üretilen bir nonce ile
// izinlidir (şablonlar <script nonce="<%= cspNonce %>"> kullanır); dış betik
// yalnızca kendi sunucumuzdan ve okuyucu kütüphanelerinin CDN'lerinden gelir.
//
// blob: kaynakları foliate-js (EPUB içeriğini blob iframe'lerinde çizer) ve
// PDF.js (worker'ı blob sarmalayıcıyla başlatır) için gereklidir.
import crypto from 'node:crypto';
import { IS_PROD } from '../config.js';

export function securityHeaders(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline' blob:",
    "font-src 'self' data: blob:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // HSTS yalnızca gerçekten HTTPS üzerinden sunulurken anlamlıdır.
  if (IS_PROD && req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

/**
 * <script> içine gömülecek JSON. JSON.stringify "</script>" dizisini
 * kaçırmaz; "<" karakteri < olarak yazılırsa HTML ayrıştırıcısı etiketi
 * göremez, JSON.parse ise değeri aynen geri verir. U+2028/2029 eski
 * tarayıcılarda satır sonu sayıldığı için onlar da kaçırılır.
 */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
