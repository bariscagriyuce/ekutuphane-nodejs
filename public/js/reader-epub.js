/* reader-epub.js — foliate-js tabanlı EPUB/MOBI/AZW3 okuyucu */
import { makeBook } from 'https://cdn.jsdelivr.net/gh/johnfactotum/foliate-js@main/view.js';
import { fromRange } from 'https://cdn.jsdelivr.net/gh/johnfactotum/foliate-js@main/epubcfi.js';
import { Overlayer } from 'https://cdn.jsdelivr.net/gh/johnfactotum/foliate-js@main/overlayer.js';
import {
  STATE, $, $$, COLORS, api, toast, settings, bindSettings, notes,
  openNoteModal, saveProgress, setProgressUI, showTip, hideTip, bindKeys,
  closeDrawers, escapeHtml,
} from './reader-common.js';

const viewer = $('#foliate-viewer');
const loader = $('#rloader');

let book = null;
let currentDoc = null;
let currentIndex = null;
let baseCfi = null;

/* ---------- Metin yönü ----------
   Bazı EPUB'lar kitap dilini yanlış bildiriyor (ör. Türkçe bir kitapta
   dc:language = "ar-SA", çünkü Arapça alıntılar var). foliate bu bilgiye
   bakıp tüm belgeye dir="rtl" uyguluyor ve Türkçe metin sağa dayanıyor.

   Çözüm: yönü belgenin KENDİ dil bilgisinden belirle (body/html xml:lang),
   yoksa kitap diline düş. Paragraf düzeyindeki dir="rtl" işaretlerine
   dokunulmaz; Arapça alıntılar doğru yönde kalır. Kullanıcı ayarlardan
   elle de zorlayabilir. */
const RTL_LANG = /^(ar|fa|he|iw|ur|yi|ji|ps|sd|ug|dv|ckb)\b/i;

function langOf(node) {
  return (node?.getAttribute?.('xml:lang') || node?.getAttribute?.('lang') || '').replace('_', '-');
}

const RTL_CHAR = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /\p{Script=Latin}|\p{Script=Cyrillic}|\p{Script=Greek}/u;

/**
 * Sayfadaki harflere bakarak yönü belirler.
 *
 * Dil etiketlerine güvenilemiyor: Arapça alıntı içeren Türkçe kitaplarda
 * hem dc:language hem de <html xml:lang> "ar" olarak yazılabiliyor. Metnin
 * kendisi bu konuda yanılmaz; hangi yazı sistemi baskınsa yön odur.
 */
function detectByContent(doc) {
  const text = (doc?.body?.textContent || '').slice(0, 4000);
  let rtl = 0;
  let ltr = 0;
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) rtl += 1;
    else if (LTR_CHAR.test(ch)) ltr += 1;
  }
  if (rtl + ltr < 20) return null; // karar vermeye yetecek harf yok
  return rtl > ltr ? 'rtl' : 'ltr';
}

function autoDirection(doc) {
  // 1) Metnin kendisi
  const byContent = detectByContent(doc);
  if (byContent) return byContent;

  // 2) Belgenin dil etiketi
  const docLang = langOf(doc?.body) || langOf(doc?.documentElement);
  if (docLang) return RTL_LANG.test(docLang) ? 'rtl' : 'ltr';

  // 3) Kitap metadatası
  const meta = book?.metadata?.language;
  const bookLang = Array.isArray(meta) ? meta[0] : meta;
  return RTL_LANG.test(String(bookLang || '')) ? 'rtl' : 'ltr';
}

function applyDirection(doc = currentDoc) {
  if (!doc?.documentElement) return;
  const chosen = settings.direction === 'auto' ? autoDirection(doc) : settings.direction;
  doc.documentElement.setAttribute('dir', chosen);
  doc.body?.removeAttribute('dir');
}

/* ---------- iframe içi stiller ---------- */
function paperColors() {
  const map = {
    light: { bg: '#ffffff', fg: '#14181f', link: '#3b52c0' },
    sepia: { bg: '#f4ecd8', fg: '#4a3c28', link: '#8a5a2b' },
    dark: { bg: '#14171e', fg: '#dfe4ec', link: '#8aa2ff' },
  };
  return map[settings.theme] || map.dark;
}

function contentStyles() {
  const c = paperColors();
  const pad = settings.maxWidth === 0 ? '0 6vw' : '0 2rem';
  const width = settings.maxWidth === 0 ? 'none' : settings.maxWidth + 'px';
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${settings.theme === 'light' || settings.theme === 'sepia' ? 'light' : 'dark'} !important;
      /* Vurgu katmanının okunabilirliği: açık zeminde çarpma, koyu zeminde normal */
      --overlayer-highlight-opacity: ${settings.theme === 'dark' ? '.34' : '.5'};
      --overlayer-highlight-blend-mode: ${settings.theme === 'dark' ? 'normal' : 'multiply'};
    }
    html, body { background: ${c.bg} !important; color: ${c.fg} !important; }
    body {
      font-family: ${settings.fontFamily} !important;
      font-size: ${settings.fontSize}px !important;
      line-height: ${settings.lineHeight} !important;
      max-width: ${width} !important;
      margin: 0 auto !important;
      padding: ${pad} !important;
      text-align: initial;
      hyphens: auto;
    }
    p, li, blockquote, dd, div, span, td { color: ${c.fg} !important; }
    h1, h2, h3, h4, h5, h6 { color: ${c.fg} !important; line-height: 1.3 !important; }
    a:link, a:visited { color: ${c.link} !important; }
    img, svg { max-width: 100% !important; height: auto !important; }
    ::selection { background: rgba(108, 140, 255, .35); }
    /* Dipnot işaretleri üst simge olduğu için 8-10 piksellik hedefler oluyor;
       özellikle dokunmatikte isabet ettirmek zor. Satır yüksekliğini
       bozmadan dokunma alanını büyütüyoruz (satır içi öğede dikey dolgu
       satır kutusunu etkilemez). */
    sup a, sub a,
    a[class*="footnote" i], a[class*="Footnote"],
    a[class*="dipnot" i], a[class*="note-link" i],
    a[epub|type~="noteref"] {
      padding: 0.5em 0.35em !important;
      margin: -0.5em -0.2em !important;
    }
    html, body, p, li, blockquote, dd, span, div, h1, h2, h3, h4, h5, h6 {
      -webkit-user-select: text !important; user-select: text !important;
    }
  `;
}

function applyStyles() {
  viewer?.renderer?.setStyles?.(contentStyles());
}

/* ---------- Vurgular ----------
   foliate-js'in kendi Overlayer katmanı kullanılır: metin DOM'una dokunmadan
   SVG üzerine çizildiği için sayfa akışı ve CFI'lar bozulmaz. */
function drawAll() {
  for (const ann of notes.items) {
    if (String(ann.cfi_range).startsWith('epubcfi')) {
      viewer.addAnnotation({ value: ann.cfi_range, color: ann.color }).catch(() => {});
    }
  }
}

viewer.addEventListener('draw-annotation', (e) => {
  const { draw, annotation } = e.detail;
  const ann = notes.items.find((a) => a.cfi_range === annotation.value);
  draw(Overlayer.highlight, { color: COLORS[ann?.color || annotation.color] || COLORS.yellow });
});

viewer.addEventListener('create-overlay', () => drawAll());

viewer.addEventListener('show-annotation', (e) => {
  const ann = notes.items.find((a) => a.cfi_range === e.detail.value);
  if (ann) {
    openNoteModal({ id: ann.id, cfi: ann.cfi_range, text: ann.selected_text, note: ann.note_text, color: ann.color });
  }
});

/** Not eklendiğinde/silindiğinde katmanı tazeler. */
let drawnValues = new Set(notes.items.map((a) => a.cfi_range));
notes.onChange = () => {
  const current = new Set(notes.items.map((a) => a.cfi_range));
  for (const value of drawnValues) {
    if (!current.has(value)) viewer.deleteAnnotation({ value }).catch(() => {});
  }
  drawnValues = current;
  drawAll();
};

/* ---------- Dipnotlar ----------
   Kitap içi bağlantılar (24, 25, HAŞİYE …) tıklanınca sayfanın sonuna
   atlamak yerine notun içeriğini bulunduğun yerde küçük bir kartta gösterir.
   foliate'in "link" olayı iptal edilebilir; iptal edilirse kendi gezinmesini
   yapmaz. Not çıkarılamazsa normal gezinmeye düşülür. */

/** Not kutusunun içeriğini güvenli hâle getirir (betik/olay/bağlantı temizliği). */
function sanitizeNote(node) {
  const clone = node.cloneNode(true);
  for (const el of clone.querySelectorAll('script, style, iframe, object, embed, video, audio')) el.remove();
  for (const el of clone.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === 'srcset') el.removeAttribute(attr.name);
    }
  }
  // Notun başındaki geri-dönüş bağlantısı (kartta başlıkta zaten var) atılır,
  // diğer bağlantılar düz metne çevrilir (karttan gezinme yapılmamalı).
  for (const a of clone.querySelectorAll('a')) {
    const isBack = BACKLINK.test(String(a.getAttribute('class') || '') + ' ' + String(a.getAttribute('href') || ''));
    if (isBack) a.remove();
    else {
      const span = clone.ownerDocument.createElement('span');
      span.innerHTML = a.innerHTML;
      a.replaceWith(span);
    }
  }
  return clone.innerHTML.trim();
}

/** Gövde hâlâ "23 " gibi bir işaretle başlıyorsa onu da kırpar. */
function stripLeadingMarker(html, marker) {
  const trimmed = String(marker || '').trim();
  if (!trimmed) return html;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp('^(\\s*(?:<[^>]+>\\s*)*)' + escaped + '[\\s.:)\\]]*', 'i'), '$1');
}

const NOTE_CLASS = /footnote|endnote|rearnote|dipnot|hasiye|haşiye/i;
const NOTE_TYPE = /footnote|endnote|rearnote|note/i;
const BACKLINK = /backlink|footnoteanchor|noteback/i;

const BLOCK_TAG = /^(DIV|ASIDE|SECTION|ARTICLE|P|LI|DD|TD|BLOCKQUOTE)$/;

/**
 * Etiket adını büyük harfe çevirir.
 * EPUB içerikleri XHTML olarak ayrıştırıldığı için tagName KÜÇÜK harf döner
 * ("a", "p", "div"); HTML belgelerinde ise büyük harftir. Doğrudan
 * karşılaştırma yapılırsa kontroller XHTML kitaplarda hiç eşleşmez.
 */
const tag = (node) => String(node?.tagName || '').toUpperCase();

/**
 * Hedef düğümden yukarı çıkarak notun gövdesini bulur.
 *
 * Yalnızca blok düzeyindeki kutular aday olabilir: bazı kitaplarda hedef
 * doğrudan <a class="footnote-anchor">1</a> gibi satır içi bir bağlantı olur;
 * sınıfında "footnote" geçtiği için orada durursak kart yalnızca "1" içerir
 * ve boş görünür. Asıl not gövdesi onu saran <p class="Dipnot">'tur.
 */
function findNoteBlock(el) {
  let node = el;
  let fallback = null;
  while (node && node.nodeType === 1 && tag(node) !== 'BODY') {
    if (BLOCK_TAG.test(tag(node))) {
      const cls = String(node.getAttribute('class') || '');
      const type = String(node.getAttribute('epub:type') || '') + ' ' + String(node.getAttribute('role') || '');
      // Çoğul sarmalayıcı (tüm notlar) yerine tekil not kutusunu yakalarız:
      // döngü en yakın eşleşmede durduğu için doğru olan seçilir.
      if (NOTE_CLASS.test(cls) || NOTE_TYPE.test(type) || tag(node) === 'ASIDE') {
        return { el: node, isNote: true };
      }
      if (!fallback) fallback = node;
    }
    node = node.parentElement;
  }
  return { el: fallback, isNote: false };
}

const metinVar = (node) => Boolean((node?.textContent || '').trim());

/**
 * Hedef kutu boşsa notu sonraki kardeşlerde arar.
 *
 * MOBI/Kindle kitaplarında dipnot hedefi boş bir çapadır
 * (<p><a id="filepos0000314881"></a></p>) ve notun metni bir sonraki
 * paragraftadır. Yeni bir çapa işaretine rastlarsak dururuz; aksi hâlde
 * bir sonraki notun metnini gösterirdik.
 */
function noteBodyFrom(el) {
  if (metinVar(el)) return el;
  let node = el;
  for (let i = 0; i < 6; i += 1) {
    node = node?.nextElementSibling;
    if (!node) break;
    if (metinVar(node)) return node;
    if (node.querySelector?.('a[id]')) break; // sonraki notun sınırı
  }
  return null;
}

/** Bağlantı metni "24", "*", "HAŞİYE" gibi kısa bir işaret mi? */
function looksLikeMarker(text) {
  const t = (text || '').trim();
  return t.length > 0 && t.length <= 8 && !/\s{2,}/.test(t);
}

async function documentForSection(index) {
  if (index === currentIndex && currentDoc) return currentDoc;
  try {
    return await book.sections?.[index]?.createDocument?.();
  } catch {
    return null;
  }
}

/** @returns {Promise<{title:string, html:string}|null>} */
async function resolveNote(a, href) {
  if (BACKLINK.test(String(a.getAttribute('class') || '') + ' ' + href)) return null;

  // AZW3/KF8 kitaplarda resolveHref ASENKRONdur (EPUB ve MOBI'de eşzamanlı).
  // await ikisini de karşılar; beklemezsek elimize Promise geçer ve index
  // okunamadığı için not hiç bulunamaz.
  const resolved = await book?.resolveHref?.(href);
  if (!resolved || resolved.index == null) return null;

  const doc = await documentForSection(resolved.index);
  if (!doc) return null;

  const target = typeof resolved.anchor === 'function' ? resolved.anchor(doc) : null;
  const targetEl = target?.nodeType === 1 ? target : target?.startContainer?.parentElement;
  if (!targetEl) return null;

  const { el: blok, isNote } = findNoteBlock(targetEl);

  // Çapa hiçbir blok kutunun içinde olmayabilir (MOBI'de doğrudan <body>
  // altında duran <a id="filepos…"></a> gibi); o zaman aramaya çapanın
  // kendisinden başlarız.
  const el = noteBodyFrom(blok || targetEl);
  if (!el) return null;

  const text = el.textContent?.trim() || '';
  if (!text) return null;
  // Not gibi işaretlenmemişse yalnızca kısa işaretli ve makul uzunluktaki
  // hedefleri kart olarak gösteririz; gerisi normal gezinme olmalı.
  if (!isNote && !(looksLikeMarker(a.textContent) && text.length < 1500)) return null;

  const title = (a.textContent || '').trim() || 'Not';
  const html = stripLeadingMarker(sanitizeNote(el), title);

  // Numarayı kırptıktan sonra geriye anlamlı bir şey kalmadıysa kart açmak
  // yerine bağlantının kendi işini yapmasına izin veririz.
  const kalan = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (kalan.length < 2) return null;

  return { title, html };
}

function showNotePopup({ title, html }, anchorRect) {
  const pop = $('#note-popup');
  $('#note-popup-title').textContent = title;
  $('#note-popup-body').innerHTML = html;
  pop.classList.add('open');

  // Dar ekranda alttan açılan sayfa; geniş ekranda bağlantının yanında kart
  if (window.matchMedia('(max-width: 640px)').matches || !anchorRect) {
    pop.classList.add('sheet');
    pop.style.top = pop.style.left = '';
    return;
  }
  pop.classList.remove('sheet');
  pop.style.top = '0px';
  pop.style.left = '0px';
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let top = anchorRect.bottom + 10;
  if (top + h > window.innerHeight - 12) top = Math.max(12, anchorRect.top - h - 10);
  let left = anchorRect.left + anchorRect.width / 2 - w / 2;
  left = Math.min(Math.max(12, left), window.innerWidth - w - 12);
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

export function hideNotePopup() {
  $('#note-popup')?.classList.remove('open');
}

$('#note-popup-close')?.addEventListener('click', hideNotePopup);
document.addEventListener('click', (e) => {
  if (!e.target.closest('#note-popup')) hideNotePopup();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideNotePopup();
});
// Sayfa değişince veya bölüm yüklenince kart açık kalmasın
window.addEventListener('page-next', hideNotePopup);
window.addEventListener('page-prev', hideNotePopup);

viewer.addEventListener('link', (e) => {
  const { a, href } = e.detail;
  if (!href) return;

  // Kararı eşzamanlı vermek zorundayız (olay iptal edilebilir olduğu için).
  // Bu yüzden önce iptal edip, not çıkaramazsak gezinmeyi kendimiz yaparız.
  e.preventDefault();

  const rect = (() => {
    try {
      const r = a.getBoundingClientRect();
      const frame = a.ownerDocument?.defaultView?.frameElement;
      const off = frame ? frame.getBoundingClientRect() : { top: 0, left: 0 };
      return { top: r.top + off.top, bottom: r.bottom + off.top, left: r.left + off.left, width: r.width };
    } catch {
      return null;
    }
  })();

  resolveNote(a, href)
    .then((note) => {
      if (note) showNotePopup(note, rect);
      else viewer.goTo(href).catch(() => {});
    })
    .catch(() => viewer.goTo(href).catch(() => {}));
});

/* ---------- Sayfa gezinme ---------- */
const turnDistance = () => Math.max(300, Math.floor(($('#rviewport')?.clientHeight || window.innerHeight) * 0.88));
const next = () => viewer?.next(turnDistance());
const prev = () => viewer?.prev(turnDistance());
window.addEventListener('page-next', next);
window.addEventListener('page-prev', prev);
bindKeys({ next, prev });

/* ---------- İçindekiler ---------- */
function renderToc(toc) {
  const list = $('#toc-list');
  if (!list) return;
  if (!toc?.length) {
    list.innerHTML = '<p style="padding:1.25rem;text-align:center;opacity:.6;font-size:.8125rem">Bu kitapta içindekiler bilgisi yok.</p>';
    return;
  }
  const rows = [];
  const walk = (items, depth = 0) => {
    for (const item of items) {
      rows.push(
        `<button class="toc-item" data-depth="${Math.min(depth, 2)}" data-href="${escapeHtml(item.href || '')}">${escapeHtml(item.label || '')}</button>`
      );
      if (item.subitems?.length) walk(item.subitems, depth + 1);
    }
  };
  walk(toc);
  list.innerHTML = rows.join('');
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('.toc-item');
    if (!btn?.dataset.href) return;
    closeDrawers();
    $$('.rheader .btn.on').forEach((b) => b.classList.remove('on'));
    try {
      await viewer.goTo(btn.dataset.href);
    } catch {
      toast('Bu bölüme gidilemedi.', 'error');
    }
  });
}

/* ---------- Metin seçimi ---------- */
function buildCfi(range) {
  const relative = fromRange(range);
  if (!baseCfi) return relative;
  const inner = (s) => String(s).replace(/^epubcfi\((.*)\)$/, '$1');
  return `epubcfi(${inner(baseCfi)}!${inner(relative)})`;
}

function hookSelection(doc) {
  const handle = () => {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return hideTip();
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const frame = doc.defaultView?.frameElement;
    const offset = frame ? frame.getBoundingClientRect() : { top: 0, left: 0 };
    try {
      showTip(
        { top: rect.top + offset.top, bottom: rect.bottom + offset.top, left: rect.left + offset.left, width: rect.width },
        { cfi: buildCfi(range), text: sel.toString().trim() }
      );
    } catch {
      hideTip();
    }
  };
  doc.addEventListener('pointerup', handle);
  doc.addEventListener('touchend', handle);
  doc.addEventListener('mousedown', (e) => {
    if (!e.target.closest?.('mark.hl')) hideTip();
    // Dipnot kartı iframe dışında olduğu için tıklama olayı üst belgeye
    // ulaşmıyor; burada da kapatmak gerekiyor.
    if (!e.target.closest?.('a')) hideNotePopup();
  });
  window.addEventListener('clear-selection', () => doc.getSelection()?.removeAllRanges());
}

/* Dokunmatik kaydırma ile sayfa çevirme */
function hookSwipe(doc) {
  let x0 = 0;
  let y0 = 0;
  doc.addEventListener('touchstart', (e) => {
    x0 = e.changedTouches[0].screenX;
    y0 = e.changedTouches[0].screenY;
  }, { passive: true });
  doc.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].screenX - x0;
    const dy = e.changedTouches[0].screenY - y0;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 55) (dx < 0 ? next : prev)();
  }, { passive: true });
}

/* Tek başına duran görselleri sayfaya sığdır */
function scaleStandaloneImages(doc) {
  for (const el of doc.querySelectorAll('img, svg')) {
    const parent = el.parentElement;
    if (!parent || !['P', 'DIV', 'BODY', 'SECTION'].includes(tag(parent))) continue;
    if (parent.children.length !== 1 && parent.textContent.trim() !== '') continue;
    const width = Number.parseFloat(doc.defaultView?.getComputedStyle(el).width) || 0;
    const attr = Number.parseInt(el.getAttribute('width') || '0', 10);
    if ((width > 0 && width < 150) || (attr > 0 && attr < 150)) continue;
    if (tag(el) === 'SVG' && !el.getAttribute('viewBox') && el.getAttribute('width') && el.getAttribute('height')) {
      el.setAttribute('viewBox', `0 0 ${el.getAttribute('width')} ${el.getAttribute('height')}`);
    }
    el.style.setProperty('width', '100%', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('display', 'block', 'important');
    el.style.setProperty('margin', '1rem auto', 'important');
  }
}

/* ---------- Başlat ---------- */
async function init() {
  try {
    book = await makeBook(STATE.fileUrl);
    await viewer.open(book);

    // Akış: kaydırmalı — bölüm içinde ekran ekran ilerlemeyi sağlar
    viewer.renderer?.setAttribute('flow', 'scrolled');
    viewer.renderer?.setAttribute('max-column-count', '1');

    bindSettings(() => {
      applyStyles();
      applyDirection();
    });
    renderToc(book.toc);

    viewer.addEventListener('load', (e) => {
      currentDoc = e.detail.doc;
      currentIndex = e.detail.index;
      hideNotePopup();
      applyStyles();
      applyDirection(currentDoc);
      scaleStandaloneImages(currentDoc);
      hookSelection(currentDoc);
      hookSwipe(currentDoc);
      currentDoc.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowRight') next();
        if (ev.key === 'ArrowLeft') prev();
      });
    });

    viewer.addEventListener('relocate', (e) => {
      const cfi = e.detail.cfi;
      if (cfi) {
        const bang = cfi.indexOf('!');
        baseCfi = bang === -1 ? cfi : cfi.slice(0, bang) + ')';
      }
      const percentage = Math.round((e.detail.fraction || 0) * 100);
      const label = e.detail.tocItem?.label || book.sections?.[e.detail.index]?.label || '';
      setProgressUI(percentage, label);
      $$('#toc-list .toc-item').forEach((b) =>
        b.classList.toggle('current', !!e.detail.tocItem && b.textContent === e.detail.tocItem.label)
      );
      if (cfi) saveProgress(cfi, percentage);
    });

    // Kayıtlı ilerlemeden devam et
    const saved = await api(`/api/progress/${STATE.bookId}`);
    try {
      if (saved.found && saved.progress_value) await viewer.goTo(saved.progress_value);
      else await viewer.goTo(0);
    } catch {
      await viewer.goTo(0);
    }

    loader.classList.add('hide');
    setTimeout(() => (loader.style.display = 'none'), 450);
  } catch (err) {
    console.error(err);
    loader.innerHTML = `<div class="inner" style="max-width:340px;text-align:center">
      <strong>Kitap açılamadı</strong>
      <span style="opacity:.75">${escapeHtml(err.message || 'Bilinmeyen hata')}</span>
      <a class="btn btn-outline btn-sm" href="/">Kütüphaneye dön</a>
    </div>`;
  }
}

/* İlerleme çubuğuyla atlama */
$('#progress-slider')?.addEventListener('input', (e) => {
  $('#progress-label').textContent = '%' + e.target.value;
});
$('#progress-slider')?.addEventListener('change', async (e) => {
  try {
    await viewer.goToFraction(Number(e.target.value) / 100);
  } catch {
    toast('Bu konuma gidilemedi.', 'error');
  }
});

/* Not panelinden vurguya git */
window.addEventListener('goto-annotation', async (e) => {
  closeDrawers();
  $$('.rheader .btn.on').forEach((b) => b.classList.remove('on'));
  try {
    await viewer.goTo(e.detail.cfi_range);
  } catch {
    toast('Bu vurguya gidilemedi.', 'error');
  }
});

init();
