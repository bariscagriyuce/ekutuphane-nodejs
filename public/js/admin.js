/* admin.js — Yönetici paneli etkileşimleri */
import { api, toast } from './app.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CSRF = document.querySelector('meta[name="csrf-token"]').content;

/* ---------- Sekmeler (adres çubuğunda #hash ile kalıcı) ---------- */
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
}
$$('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    showTab(tab.dataset.tab);
    history.replaceState(null, '', '#' + tab.dataset.tab);
  })
);
if (location.hash) showTab(location.hash.slice(1));

/* ---------- Kitap silme ---------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-book]');
  if (!btn) return;
  const id = btn.dataset.deleteBook;
  if (!confirm(`“${btn.dataset.title}” kitabı ve dosyaları kalıcı olarak silinecek. Emin misiniz?`)) return;
  btn.disabled = true;
  const r = await api(`/admin/books/${id}/delete`, { method: 'POST' });
  if (r.success) {
    $(`[data-row-book="${id}"]`)?.remove();
    toast('Kitap silindi.');
  } else {
    btn.disabled = false;
    toast(r.message || 'Silme başarısız.', 'error');
  }
});

/* ---------- Yükleme alanı ---------- */
const dropzone = $('#dropzone');
const fileInput = $('#book-file');
if (dropzone && fileInput) {
  const showName = () => {
    const f = fileInput.files?.[0];
    $('#dropzone-name').textContent = f ? f.name : 'Dosyayı buraya sürükleyin veya seçmek için tıklayın';
  };
  fileInput.addEventListener('change', showName);
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('over');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) {
      fileInput.files = e.dataTransfer.files;
      showName();
    }
  });
}

/* ---------- Toplu içe aktarma ---------- */
const scanBtn = $('#scan-btn');
const importBtn = $('#import-btn');
const list = $('#import-list');
const summary = $('#import-summary');
const bar = $('#import-progress');
let queue = [];

const fmtSize = (bytes) => (bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB');
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

scanBtn?.addEventListener('click', async () => {
  scanBtn.disabled = true;
  summary.textContent = 'Klasör taranıyor…';
  const r = await api('/admin/import/scan');
  scanBtn.disabled = false;
  if (!r.success) return toast(r.message || 'Tarama başarısız.', 'error');

  queue = r.files;
  summary.textContent = queue.length
    ? `${queue.length} dosya bulundu · ${r.dir}`
    : `İçe aktarılacak dosya yok. Kitapları ${r.dir} klasörüne kopyalayın.`;
  importBtn.disabled = queue.length === 0;
  list.hidden = queue.length === 0;
  list.innerHTML = queue
    .map(
      (f, i) => `<div class="import-row" data-i="${i}">
        <span class="name" title="${escapeHtml(f.relativePath)}">${escapeHtml(f.relativePath)}</span>
        <span class="tag">${f.format}</span>
        <span class="state">${fmtSize(f.size)}</span>
      </div>`
    )
    .join('');
});

importBtn?.addEventListener('click', async () => {
  if (!queue.length) return;
  importBtn.disabled = true;
  scanBtn.disabled = true;
  bar.hidden = false;

  let done = 0;
  let failed = 0;
  for (const [i, file] of queue.entries()) {
    const row = list.querySelector(`[data-i="${i}"]`);
    const state = row?.querySelector('.state');
    if (state) state.textContent = 'aktarılıyor…';

    const r = await api('/admin/import/file', { method: 'POST', body: { file: file.relativePath } });
    if (r.success) {
      done += 1;
      row?.classList.add('done');
      if (state) state.textContent = '✓ eklendi';
    } else {
      failed += 1;
      row?.classList.add('failed');
      if (state) state.textContent = r.message || 'hata';
    }
    bar.firstElementChild.style.width = `${Math.round(((i + 1) / queue.length) * 100)}%`;
    summary.textContent = `${i + 1} / ${queue.length} işlendi · ${done} eklendi · ${failed} hata`;
  }

  scanBtn.disabled = false;
  toast(`İçe aktarma tamamlandı: ${done} kitap eklendi${failed ? `, ${failed} hata` : ''}.`, failed ? 'error' : 'success');
  queue = [];
});

/* ---------- Kullanıcı şifresi sıfırlama ---------- */
const passwordModal = $('#password-modal');

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-reset-user]');
  if (!btn) return;
  $('#reset-user-id').value = btn.dataset.resetUser;
  $('#reset-username').textContent = btn.dataset.username;
  $('#reset-password').value = '';
  passwordModal.classList.add('open');
  passwordModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#reset-password').focus(), 60);
});

$('#reset-generate')?.addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  $('#reset-password').value = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
});

$('#password-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#reset-user-id').value;
  const password = $('#reset-password').value;
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled = true;
  const r = await api(`/admin/users/${id}/password`, { method: 'POST', body: { password } });
  btn.disabled = false;
  toast(r.message || (r.success ? 'Güncellendi.' : 'Güncellenemedi.'), r.success ? 'success' : 'error');
  if (r.success) {
    passwordModal.classList.remove('open');
    passwordModal.setAttribute('aria-hidden', 'true');
  }
});

/* ---------- SMTP testi ---------- */
$('#test-smtp-btn')?.addEventListener('click', async (e) => {
  const email = $('#test-email').value.trim();
  if (!email) return toast('Bir e-posta adresi girin.', 'error');
  e.currentTarget.disabled = true;
  const r = await api('/admin/smtp/test', { method: 'POST', body: { test_email: email } });
  e.currentTarget.disabled = false;
  toast(r.message || (r.success ? 'Gönderildi.' : 'Gönderilemedi.'), r.success ? 'success' : 'error');
});

/* ---------- Onay isteyen formlar (satır içi onsubmit yerine; CSP) ---------- */
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form instanceof HTMLFormElement && form.dataset.confirm && !confirm(form.dataset.confirm)) {
    e.preventDefault();
  }
});

/* ---------- Yükleme sırasında geri bildirim ---------- */
$('#upload-form')?.addEventListener('submit', (e) => {
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="margin:0"></span> Yükleniyor…';
});
