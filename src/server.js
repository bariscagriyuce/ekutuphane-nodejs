// server.js — Uygulama giriş noktası
import './preflight.js'; // ortam denetimi diğer modüllerden önce çalışmalı
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORT, PROJECT_ROOT, SESSION_SECRET, IS_PROD, DATA_ROOT, DB_FILE, TRUST_PROXY } from './config.js';
import { db } from './db.js';
import { SqliteStore } from './session-store.js';
import { csrf } from './middleware/csrf.js';
import { securityHeaders, jsonForScript } from './middleware/security.js';
import { localsMiddleware } from './middleware/auth.js';
import { icon } from './icons.js';
import { asset, assetVersion } from './assets.js';

import { router as authRoutes } from './routes/auth.js';
import { router as libraryRoutes } from './routes/library.js';
import { router as readerRoutes } from './routes/reader.js';
import { router as apiRoutes } from './routes/api.js';
import { router as adminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', TRUST_PROXY);
app.set('view engine', 'ejs');
app.set('views', path.join(PROJECT_ROOT, 'views'));
app.disable('x-powered-by');
app.locals.icon = icon;
app.locals.asset = asset;
app.locals.assetVersion = assetVersion;
app.locals.jsonForScript = jsonForScript;

app.use(compression());
app.use(securityHeaders);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
// Statik dosyalar: bağlantılar ?v=<sürüm> taşıdığı için içerik değişince URL
// de değişir. Yine de "no-cache" veriyoruz; böylece sürümsüz istekler (ör. bir
// JS modülünün içindeki import) her seferinde doğrulanır — değişmemişse 304
// döner, değişmişse yenisi iner. Hiçbir durumda bayat dosya kullanılmaz.
app.use(
  '/static',
  express.static(path.join(PROJECT_ROOT, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// HTML yanıtları kullanıcıya özeldir; ne tarayıcı ne de aradaki bir vekil
// sunucu saklamalı.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

app.use(
  session({
    name: 'ekutuphane.sid',
    secret: SESSION_SECRET,
    store: new SqliteStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

app.use(csrf);
app.use(localsMiddleware);

app.use(authRoutes);
app.use(readerRoutes);
app.use('/api', apiRoutes);
app.use(adminRoutes);
app.use(libraryRoutes);

// 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Uç nokta bulunamadı.' });
  }
  res.status(404).render('error', {
    title: 'Sayfa Bulunamadı',
    message: 'Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.',
  });
});

// Hata yakalayıcı
app.use((err, req, res, _next) => {
  console.error(err);
  const message = IS_PROD ? 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' : err.message;
  if (req.path.startsWith('/api/')) return res.status(500).json({ success: false, message });
  res.status(500).render('error', { title: 'Sunucu Hatası', message });
});

const server = app.listen(PORT, () => {
  // Açılışta ne okunduğunu yazmak, yanlış veritabanına bakıldığını
  // (ör. yükleme sonrası bayat -wal dosyası) tek bakışta görünür kılar.
  let summary = '';
  try {
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const books = db.prepare('SELECT COUNT(*) AS c FROM books').get().c;
    summary = `${users} kullanıcı · ${books.toLocaleString('tr-TR')} kitap`;
  } catch (err) {
    summary = `okunamadı: ${err.message}`;
  }

  console.log(`\n  📚 E-Kütüphane  http://localhost:${PORT}`);
  console.log(`     Veri klasörü : ${DATA_ROOT}`);
  console.log(`     Veritabanı   : ${DB_FILE}`);
  console.log(`     İçerik       : ${summary}`);
  console.log(`     Varlık sürümü: ${assetVersion()}\n`);
});

/**
 * Düzgün kapanış: WAL'i ana dosyaya işleyip veritabanını kapatır.
 *
 * Paylaşımlı hostinglerde uygulamayı durdurma seçeneği yok, yalnızca
 * "Restart" var. Kapanışta WAL boşaltılmazsa yanında kalan -wal dosyası
 * sonradan yüklenen bir database.sqlite'ın üzerine uygulanıyor ve uygulama
 * eski veriyi okumaya devam ediyor. Bu kanca, yeniden başlatmanın ardında
 * temiz ve tek parça bir veritabanı bırakır.
 */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  server.close(() => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.close();
      console.log(`\n  ${signal}: veritabanı düzgün kapatıldı.\n`);
    } catch (err) {
      console.error(`  ${signal}: veritabanı kapatılırken hata: ${err.message}`);
    }
    process.exit(0);
  });

  // Açık bağlantılar kapanmıyorsa da takılıp kalma
  setTimeout(() => process.exit(0), 8000).unref();
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => shutdown(signal));
}
