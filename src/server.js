// server.js — Uygulama giriş noktası
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORT, PROJECT_ROOT, SESSION_SECRET, IS_PROD, DATA_ROOT, DB_FILE } from './config.js';
import { SqliteStore } from './session-store.js';
import { csrf } from './middleware/csrf.js';
import { localsMiddleware } from './middleware/auth.js';
import { icon } from './icons.js';

import { router as authRoutes } from './routes/auth.js';
import { router as libraryRoutes } from './routes/library.js';
import { router as readerRoutes } from './routes/reader.js';
import { router as apiRoutes } from './routes/api.js';
import { router as adminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(PROJECT_ROOT, 'views'));
app.disable('x-powered-by');
app.locals.icon = icon;

app.use(compression());
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(
  '/static',
  express.static(path.join(PROJECT_ROOT, 'public'), {
    maxAge: IS_PROD ? '7d' : 0,
    etag: true,
  })
);

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

app.listen(PORT, () => {
  console.log(`\n  📚 E-Kütüphane  http://localhost:${PORT}`);
  console.log(`     Veri klasörü : ${DATA_ROOT}`);
  console.log(`     Veritabanı   : ${DB_FILE}\n`);
});
