// auth.js — Giriş / çıkış
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MINUTES } from '../config.js';

export const router = Router();

/** PHP'nin password_hash ($2y$) çıktısı bcryptjs ile doğrulanabilsin diye normalize edilir. */
function verifyPassword(plain, hash) {
  if (!hash) return false;
  const normalized = hash.startsWith('$2y$') ? '$2a$' + hash.slice(4) : hash;
  try {
    return bcrypt.compareSync(plain, normalized);
  } catch {
    return false;
  }
}
export { verifyPassword };

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(safeNext(req.query.next));
  res.render('login', { title: 'Giriş Yap', error: null, username: '', next: req.query.next || '' });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const ip = req.ip || 'unknown';
  const next = safeNext(req.body.next);

  const fail = (error) =>
    res.status(401).render('login', { title: 'Giriş Yap', error, username, next: req.body.next || '' });

  if (!username || !password) return fail('Lütfen tüm alanları doldurun.');

  db.prepare("DELETE FROM login_attempts WHERE last_attempt < datetime('now', ?)").run(
    `-${LOGIN_LOCKOUT_MINUTES} minutes`
  );

  const attempt = db.prepare('SELECT attempts FROM login_attempts WHERE username = ? AND ip = ?').get(username, ip);
  if (attempt && attempt.attempts >= LOGIN_MAX_ATTEMPTS) {
    return fail(`Çok fazla başarısız deneme yaptınız. Lütfen ${LOGIN_LOCKOUT_MINUTES} dakika sonra tekrar deneyin.`);
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password)) {
    db.prepare(
      `INSERT INTO login_attempts (username, ip, attempts, last_attempt)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(username, ip) DO UPDATE SET attempts = attempts + 1, last_attempt = CURRENT_TIMESTAMP`
    ).run(username, ip);
    return fail('Geçersiz kullanıcı adı veya şifre.');
  }

  db.prepare('DELETE FROM login_attempts WHERE username = ? AND ip = ?').run(username, ip);

  // Session fixation koruması: oturum kimliğini yenile
  req.session.regenerate((err) => {
    if (err) return fail('Oturum başlatılamadı. Lütfen tekrar deneyin.');
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      kindle_email: user.kindle_email || '',
    };
    req.session.save(() => res.redirect(next));
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ekutuphane.sid');
    res.redirect('/login');
  });
});

// Tarayıcıdan doğrudan /logout çağrılırsa da çalışsın
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ekutuphane.sid');
    res.redirect('/login');
  });
});
