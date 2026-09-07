/* reader-pdf.js — PDF.js tabanlı PDF okuyucu */
import {
  STATE, $, api, toast, settings, bindSettings, openNoteModal,
  saveProgress, setProgressUI, bindKeys, closeDrawers, escapeHtml,
} from './reader-common.js';

const { pdfjsLib } = window;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const canvas = $('#pdf-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const scroller = $('#pdf-scroll');
const loader = $('#rloader');

let pdf = null;
let pageNum = 1;
let pageCount = 0;
let zoom = Number(localStorage.getItem('pdfZoom')) || 0; // 0 = genişliğe sığdır
let renderTask = null;
let renderSeq = 0;

/* ---------- Çizim ----------
   Yeni sayfa istendiğinde devam eden çizim iptal edilir; böylece hızlı sayfa
   değiştirmede kuyruk birikmez ve arayüz kilitlenmez. */
async function renderPage(num) {
  if (!pdf) return;
  num = Math.min(pageCount || num, Math.max(1, num));

  // Arayüzü beklemeden güncelle
  pageNum = num;
  $('#pdf-page-input').value = num;
  const percentage = pageCount ? Math.round((num / pageCount) * 100) : 0;
  setProgressUI(percentage, `Sayfa ${num} / ${pageCount}`);
  saveProgress(num, percentage);

  const seq = ++renderSeq;
  renderTask?.cancel();

  try {
    const page = await pdf.getPage(num);
    if (seq !== renderSeq) return;

    const base = page.getViewport({ scale: 1 });
    const available = (scroller.clientWidth || window.innerWidth) - 48;
    const scale = zoom > 0 ? zoom : Math.min(2.4, available / base.width);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = viewport.width / dpr + 'px';
    canvas.style.height = viewport.height / dpr + 'px';
    scroller.scrollTop = 0;

    renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    renderTask = null;
    updateZoomLabel();
  } catch (err) {
    if (err?.name === 'RenderingCancelledException') return;
    console.error(err);
    toast('Sayfa çizilemedi.', 'error');
  }
}

function updateZoomLabel() {
  const el = $('#val-zoom');
  if (el) el.textContent = zoom > 0 ? `%${Math.round(zoom * 100)}` : 'Sığdır';
}

const goTo = (n) => renderPage(Math.min(pageCount, Math.max(1, n)));
const next = () => goTo(pageNum + 1);
const prev = () => goTo(pageNum - 1);

window.addEventListener('page-next', next);
window.addEventListener('page-prev', prev);
bindKeys({ next, prev });

$('#pdf-next')?.addEventListener('click', next);
$('#pdf-prev')?.addEventListener('click', prev);
$('#pdf-page-input')?.addEventListener('change', (e) => goTo(Number.parseInt(e.target.value, 10) || 1));

/* Yakınlaştırma */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-zoom]');
  if (!btn) return;
  const mode = Number(btn.dataset.zoom);
  if (mode === 0) zoom = 0;
  else {
    const current = zoom || 1;
    zoom = Math.min(3, Math.max(0.5, +(current + mode * 0.2).toFixed(2)));
  }
  localStorage.setItem('pdfZoom', String(zoom));
  renderPage(pageNum);
});

/* İlerleme çubuğu */
$('#progress-slider')?.addEventListener('input', (e) => {
  $('#progress-label').textContent = '%' + e.target.value;
});
$('#progress-slider')?.addEventListener('change', (e) => {
  goTo(Math.max(1, Math.round((Number(e.target.value) / 100) * pageCount)));
});

/* Sayfa notları: PDF'te konum "page:N" olarak saklanır */
$('#pdf-note')?.addEventListener('click', () => {
  openNoteModal({ cfi: `page:${pageNum}`, text: `Sayfa ${pageNum}` });
});

window.addEventListener('goto-annotation', (e) => {
  const match = /^page:(\d+)$/.exec(e.detail.cfi_range || '');
  closeDrawers();
  if (match) goTo(Number(match[1]));
});

/* Tema değişince tuval arka planı da güncellenmeli */
bindSettings(() => {
  canvas.style.filter = settings.theme === 'dark' ? 'invert(1) hue-rotate(180deg) brightness(.92)' : 'none';
});

/* Yeniden boyutlanmada genişliğe sığdır */
let resizeTimer;
window.addEventListener('resize', () => {
  if (zoom > 0) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderPage(pageNum), 200);
});

/* ---------- Başlat ---------- */
(async function init() {
  try {
    pdf = await pdfjsLib.getDocument({ url: STATE.fileUrl, withCredentials: true }).promise;
    pageCount = pdf.numPages;
    $('#pdf-total').textContent = pageCount;
    $('#pdf-page-input').max = pageCount;

    const saved = await api(`/api/progress/${STATE.bookId}`);
    const start = saved.found ? Number.parseInt(saved.progress_value, 10) || 1 : 1;
    await renderPage(Math.min(Math.max(1, start), pageCount));

    loader.classList.add('hide');
    setTimeout(() => (loader.style.display = 'none'), 450);
  } catch (err) {
    console.error(err);
    loader.innerHTML = `<div class="inner" style="max-width:340px;text-align:center">
      <strong>PDF açılamadı</strong>
      <span style="opacity:.75">${escapeHtml(err.message || 'Bilinmeyen hata')}</span>
      <a class="btn btn-outline btn-sm" href="/">Kütüphaneye dön</a>
    </div>`;
  }
})();
