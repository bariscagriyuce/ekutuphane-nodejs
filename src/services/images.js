// images.js — Kapak görsellerinin gerçekten görsel olduğunu doğrular.
// Uzantı kullanıcı beyanıdır; dosyanın ilk baytları (magic number) değildir.
import fs from 'node:fs';

/** @returns {'jpg'|'png'|'gif'|'webp'|null} */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function sniffImageFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(12);
      const n = fs.readSync(fd, buf, 0, 12, 0);
      return sniffImage(buf.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
