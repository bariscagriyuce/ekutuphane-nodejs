// assets.js — Statik dosyalar için sürüm damgası.
//
// Dosya adları dağıtımlar arasında değişmediği için, uzun süreli önbellekle
// birlikte tarayıcı eski CSS/JS'i günlerce kullanmaya devam ediyordu. Eski PHP
// sürümündeki `styles.css?v=<filemtime>` yaklaşımının karşılığı: public/
// altındaki en son değişiklik zamanından tek bir sürüm üretilir ve tüm varlık
// bağlantılarına eklenir. Her dağıtım yeni bir değer verir, tarayıcı da
// aradaki proxy/CDN de yeni dosyayı çekmek zorunda kalır.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, IS_PROD } from './config.js';

const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else if (entry.isFile()) {
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        /* yoksay */
      }
    }
  }
  return newest;
}

function computeVersion() {
  const mtime = newestMtime(PUBLIC_DIR);
  return mtime ? Math.floor(mtime / 1000).toString(36) : Date.now().toString(36);
}

// Üretimde açılışta bir kez hesaplanır; geliştirmede her istekte tazelenir ki
// dosyayı kaydeder kaydetmez tarayıcıda görünsün.
let cached = computeVersion();

export function assetVersion() {
  if (!IS_PROD) cached = computeVersion();
  return cached;
}

/** "/static/css/app.css" → "/static/css/app.css?v=abc123" */
export function asset(urlPath) {
  return `${urlPath}?v=${assetVersion()}`;
}
