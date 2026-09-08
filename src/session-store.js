// session-store.js — express-session için node:sqlite tabanlı kalıcı depo.
// Ek bir bağımlılık gerektirmez; sunucu yeniden başlasa da oturumlar korunur.
import session from 'express-session';
import { db } from './db.js';

const Store = session.Store;

/**
 * Bir kullanıcının tüm oturumlarını sonlandırır (şifre değişince, yönetici
 * şifre sıfırlayınca ya da kullanıcı silinince). exceptSid verilirse o oturum
 * (kullanıcının şu anki tarayıcısı) açık kalır.
 */
export function destroyUserSessions(userId, exceptSid = null) {
  const sql = "DELETE FROM sessions WHERE json_extract(data, '$.user.id') = ?" + (exceptSid ? ' AND sid != ?' : '');
  const args = exceptSid ? [userId, exceptSid] : [userId];
  return db.prepare(sql).run(...args).changes;
}

export class SqliteStore extends Store {
  constructor({ ttlMs = 1000 * 60 * 60 * 24 * 30 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.stmts = {
      get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
      set: db.prepare(
        'INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?) ' +
          'ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data'
      ),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      clear: db.prepare('DELETE FROM sessions'),
      length: db.prepare('SELECT COUNT(*) AS c FROM sessions'),
      prune: db.prepare('DELETE FROM sessions WHERE expires < ?'),
    };
    // Süresi dolmuş oturumları saatte bir temizle
    this.timer = setInterval(() => this.prune(), 60 * 60 * 1000);
    this.timer.unref?.();
    this.prune();
  }

  expiryOf(sess) {
    const cookieExpires = sess?.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + this.ttlMs;
  }

  prune() {
    try {
      this.stmts.prune.run(Date.now());
    } catch {
      /* yoksay */
    }
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        this.stmts.destroy.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.stmts.set.run(sid, this.expiryOf(sess), JSON.stringify(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.stmts.touch.run(this.expiryOf(sess), sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmts.destroy.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  clear(cb) {
    try {
      this.stmts.clear.run();
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  length(cb) {
    try {
      cb(null, this.stmts.length.get().c);
    } catch (err) {
      cb(err);
    }
  }
}
