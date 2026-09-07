#!/usr/bin/env node
// import-cli.js — uploads/import klasöründeki kitapları komut satırından aktarır.
// Kullanım: npm run import [-- --dry]
import { IMPORT_DIR } from '../config.js';
import { scanImportDir, importFromImportDir } from '../services/import.js';

const dry = process.argv.includes('--dry');
const files = scanImportDir();

console.log(`\nİçe aktarma klasörü : ${IMPORT_DIR}`);
console.log(`Bulunan dosya       : ${files.length}\n`);

if (files.length === 0) {
  console.log('Aktarılacak dosya yok. Kitapları yukarıdaki klasöre kopyalayın.\n');
  process.exit(0);
}

if (dry) {
  for (const f of files) console.log(`  • ${f.relativePath} (${f.format}, ${Math.round(f.size / 1024)} KB)`);
  console.log('\n--dry verildiği için hiçbir dosya aktarılmadı.\n');
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const [i, file] of files.entries()) {
  const prefix = `[${i + 1}/${files.length}]`;
  try {
    const book = importFromImportDir(file.relativePath);
    ok += 1;
    console.log(`${prefix} ✓ ${book.author} — ${book.title}`);
  } catch (err) {
    failed += 1;
    console.error(`${prefix} ✗ ${file.relativePath}: ${err.message}`);
  }
}

console.log(`\nTamamlandı: ${ok} eklendi, ${failed} hata.\n`);
