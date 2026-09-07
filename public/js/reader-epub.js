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
    if (!parent || !['P', 'DIV', 'BODY', 'SECTION'].includes(parent.tagName)) continue;
    if (parent.children.length !== 1 && parent.textContent.trim() !== '') continue;
    const width = Number.parseFloat(doc.defaultView?.getComputedStyle(el).width) || 0;
    const attr = Number.parseInt(el.getAttribute('width') || '0', 10);
    if ((width > 0 && width < 150) || (attr > 0 && attr < 150)) continue;
    if (el.tagName === 'svg' && !el.getAttribute('viewBox') && el.getAttribute('width') && el.getAttribute('height')) {
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

    bindSettings(applyStyles);
    renderToc(book.toc);

    viewer.addEventListener('load', (e) => {
      currentDoc = e.detail.doc;
      currentIndex = e.detail.index;
      applyStyles();
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
