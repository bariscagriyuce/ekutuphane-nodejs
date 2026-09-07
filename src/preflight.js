// preflight.js — Uygulama açılmadan önce çalışma ortamını doğrular.
// server.js'te ilk import olarak yer alır; böylece eksik bir gereksinim
// anlaşılmaz bir yığın izi yerine anlaşılır bir mesajla bildirilir.

const [major, minor] = process.versions.node.split('.').map(Number);

function fail(lines) {
  console.error('\n' + '─'.repeat(64));
  for (const line of lines) console.error(line);
  console.error('─'.repeat(64) + '\n');
  process.exit(1);
}

if (major < 22 || (major === 22 && minor < 5)) {
  fail([
    `✗ Node.js ${process.versions.node} çok eski.`,
    '',
    '  Bu uygulama yerleşik "node:sqlite" modülünü kullanıyor.',
    '  En az Node.js 22.5 gerekir; önerilen sürüm 24 veya üzeridir.',
  ]);
}

try {
  await import('node:sqlite');
} catch {
  fail([
    `✗ "node:sqlite" modülü Node.js ${process.versions.node} üzerinde etkin değil.`,
    '',
    '  Node 22.x ve 23.3 arası sürümlerde bu modül deneysel bir bayrak ister.',
    '',
    '  Çözüm 1 (önerilen): Node.js 24 veya üzeri bir sürüm kullanın.',
    '  Çözüm 2: Ortam değişkenlerine şunu ekleyin:',
    '           NODE_OPTIONS=--experimental-sqlite',
  ]);
}
