#!/usr/bin/env node
// check-data.js — Veritabanı ile disk arşivinin uyumunu denetler.
// Kullanım: npm run check
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { DATA_ROOT, DB_FILE, BOOKS_DIR, COVERS_DIR, resolveDataPath } from '../config.js';

const books = db.prepare('SELECT id, title, file_path, cover_path FROM books').all();

const missingBooks = [];
const missingCovers = [];
let totalBytes = 0;

for (const book of books) {
  const bookPath = resolveDataPath(book.file_path);
  if (!bookPath || !fs.existsSync(bookPath)) {
    missingBooks.push(book);
  } else {
    totalBytes += fs.statSync(bookPath).size;
  }
  if (book.cover_path) {
    const coverPath = resolveDataPath(book.cover_path);
    if (!coverPath || !fs.existsSync(coverPath)) missingCovers.push(book);
  }
}

// Veritabanında karşılığı olmayan dosyalar (yetim arşiv dosyaları)
const known = new Set(books.map((b) => path.basename(b.file_path)));
const onDisk = fs.existsSync(BOOKS_DIR) ? fs.readdirSync(BOOKS_DIR).filter((f) => !f.startsWith('.')) : [];
const orphans = onDisk.filter((f) => !known.has(f));

const gb = (bytes) => (bytes / 1024 ** 3).toFixed(2) + ' GB';

console.log(`\nVeri klasörü   : ${DATA_ROOT}`);
console.log(`Veritabanı     : ${DB_FILE}`);
console.log(`Kullanıcı      : ${db.prepare('SELECT COUNT(*) AS c FROM users').get().c}`);
console.log(`Kitap kaydı    : ${books.length}`);
console.log(`Diskteki dosya : ${onDisk.length} (${gb(totalBytes)})`);
console.log(`Kapak görseli  : ${fs.existsSync(COVERS_DIR) ? fs.readdirSync(COVERS_DIR).length : 0}`);
console.log(`Okuma kaydı    : ${db.prepare('SELECT COUNT(*) AS c FROM progress').get().c}`);
console.log(`Not & vurgu    : ${db.prepare('SELECT COUNT(*) AS c FROM annotations').get().c}\n`);

if (missingBooks.length) {
  console.log(`⚠  Dosyası eksik ${missingBooks.length} kitap kaydı (ilk 10):`);
  for (const b of missingBooks.slice(0, 10)) console.log(`   #${b.id} ${b.title} → ${b.file_path}`);
  console.log('   → uploads/books eşitlemesi eksik kalmış olabilir.\n');
}

if (missingCovers.length) {
  console.log(`ℹ  Kapak dosyası eksik ${missingCovers.length} kayıt (kart yerine yedek kapak gösterilir).\n`);
}

if (orphans.length) {
  console.log(`ℹ  Veritabanında karşılığı olmayan ${orphans.length} dosya (ilk 5):`);
  for (const f of orphans.slice(0, 5)) console.log(`   ${f}`);
  console.log('   → Eski veritabanı + yeni arşiv kopyalanmış olabilir.\n');
}

if (!missingBooks.length && !orphans.length) {
  console.log('✓ Veritabanı ile arşiv birebir uyumlu.\n');
}
