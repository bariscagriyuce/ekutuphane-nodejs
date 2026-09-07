// epub.js — EPUB dosyasından başlık, yazar ve kapak görselini çıkarır.
// PHP sürümündeki epub_helper.php'nin Node karşılığıdır (ZipArchive + DOMXPath yerine
// adm-zip + fast-xml-parser kullanır).
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function canonicalize(p) {
  const out = [];
  for (const part of String(p).replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const textOf = (node) => {
  if (node == null) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'object') return String(node['#text'] ?? '').trim();
  return String(node).trim();
};

function readEntry(zip, name) {
  const tryNames = [name, decodeURIComponent(name), encodeURI(name)];
  for (const n of tryNames) {
    const entry = zip.getEntry(n);
    if (entry) return zip.readFile(entry);
  }
  // Büyük/küçük harf farkına karşı son çare
  const lower = name.toLowerCase();
  const match = zip.getEntries().find((e) => e.entryName.toLowerCase() === lower);
  return match ? zip.readFile(match) : null;
}

/**
 * @returns {{title:string, author:string, coverData:Buffer|null, coverName:string|null}|null}
 */
export function getEpubMetadata(filePath) {
  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch {
    return null;
  }

  try {
    const containerBuf = readEntry(zip, 'META-INF/container.xml');
    if (!containerBuf) return null;

    const container = parser.parse(containerBuf.toString('utf8'));
    const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0];
    const opfPath = rootfile?.['@_full-path'];
    if (!opfPath) return null;

    const opfBuf = readEntry(zip, opfPath);
    if (!opfBuf) return null;
    const opf = parser.parse(opfBuf.toString('utf8'));
    const pkg = opf?.package;
    if (!pkg) return null;

    const metadata = pkg.metadata || {};
    const title = textOf(asArray(metadata.title)[0]);
    const author = textOf(asArray(metadata.creator)[0]);

    // --- Kapak görselini bul ---
    const items = asArray(pkg.manifest?.item);
    let coverHref = '';

    // 1) <meta name="cover" content="id">
    const coverMeta = asArray(metadata.meta).find((m) => m?.['@_name'] === 'cover');
    const coverId = coverMeta?.['@_content'];
    if (coverId) {
      coverHref = items.find((i) => i['@_id'] === coverId)?.['@_href'] || '';
    }
    // 2) properties="cover-image"
    if (!coverHref) {
      coverHref =
        items.find((i) => String(i['@_properties'] || '').includes('cover-image'))?.['@_href'] || '';
    }
    // 3) id/href içinde "cover" geçen ilk görsel
    if (!coverHref) {
      coverHref =
        items.find(
          (i) =>
            String(i['@_media-type'] || '').startsWith('image/') &&
            /cover/i.test(String(i['@_id'] || '') + String(i['@_href'] || ''))
        )?.['@_href'] || '';
    }

    let coverData = null;
    let coverName = null;
    if (coverHref) {
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
      const inZip = canonicalize(opfDir ? `${opfDir}/${coverHref}` : coverHref);
      coverData = readEntry(zip, inZip) || readEntry(zip, coverHref);
      if (coverData) coverName = coverHref.split('/').pop();
    }

    return { title, author, coverData, coverName };
  } catch {
    return null;
  }
}

/** Dosya adından "Yazar - Başlık" kalıbını çözer. */
export function parseFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  if (base.includes(' - ')) {
    const [first, ...rest] = base.split(' - ');
    return { author: first.trim(), title: rest.join(' - ').trim() };
  }
  return { author: 'Bilinmeyen Yazar', title: base };
}
