/* reader-common.js — Okuyucu kabuğu: ayarlar, paneller, notlar, ilerleme */

export const STATE = JSON.parse(document.getElementById('reader-state').textContent);
export const CSRF = document.querySelector('meta[name="csrf-token"]').content;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const COLORS = {
  yellow: '#ffd54a',
  green: '#7ee0a5',
  pink: '#ff9db4',
  blue: '#85c4ff',
};

/* ---------- Ağ ---------- */
export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'X-CSRF-Token': CSRF, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    return await res.json();
  } catch {
    return { success: false, message: 'Sunucu yanıtı okunamadı.' };
  }
}

export function toast(message, type = 'success', ms = 3500) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/* ---------- Görünüm ayarları ---------- */
const DEFAULTS = {
  fontSize: 18,
  lineHeight: 1.6,
  maxWidth: 900,
  fontFamily: "'Literata', Georgia, serif",
  theme: 'dark',
  direction: 'auto', // auto | ltr | rtl
};

export const settings = {
  ...DEFAULTS,
  ...(() => {
    try {
      return JSON.parse(localStorage.getItem('readerSettings') || '{}');
    } catch {
      return {};
    }
  })(),
};
settings.theme = localStorage.getItem('readerTheme') || settings.theme || 'dark';

export function saveSettings() {
  try {
    localStorage.setItem('readerSettings', JSON.stringify(settings));
    localStorage.setItem('readerTheme', settings.theme);
  } catch {}
}

/** Ayar değiştiğinde motorun yeniden çizmesi için kaydedilen geri çağırım. */
let onSettingsChange = () => {};
export function bindSettings(fn) {
  onSettingsChange = fn;
  renderSettingsUI();
  fn();
}

function renderSettingsUI() {
  document.documentElement.setAttribute('data-reader-theme', settings.theme);
  document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');
  $$('[data-rtheme]').forEach((b) => b.classList.toggle('active', b.dataset.rtheme === settings.theme));
  $$('[data-width]').forEach((b) => b.classList.toggle('active', Number(b.dataset.width) === settings.maxWidth));
  $$('[data-font]').forEach((b) => b.classList.toggle('active', b.dataset.font === settings.fontFamily));
  $$('[data-direction]').forEach((b) => b.classList.toggle('active', b.dataset.direction === settings.direction));
  const f = $('#val-font');
  if (f) f.textContent = settings.fontSize + 'px';
  const l = $('#val-line');
  if (l) l.textContent = settings.lineHeight.toFixed(1).replace('.', ',');
  const w = $('#val-width');
  if (w) w.textContent = settings.maxWidth === 0 ? 'Tam' : settings.maxWidth <= 720 ? 'Dar' : 'Orta';
}

function applyChange(patch) {
  Object.assign(settings, patch);
  saveSettings();
  renderSettingsUI();
  onSettingsChange();
}
export { applyChange as updateSettings };

document.addEventListener('click', (e) => {
  const theme = e.target.closest('[data-rtheme]');
  if (theme) return applyChange({ theme: theme.dataset.rtheme });

  const set = e.target.closest('[data-set]');
  if (set) {
    const d = Number(set.dataset.delta);
    if (set.dataset.set === 'font') {
      return applyChange({ fontSize: Math.min(34, Math.max(12, settings.fontSize + d * 2)) });
    }
    return applyChange({ lineHeight: Math.min(2.4, Math.max(1.2, +(settings.lineHeight + d * 0.1).toFixed(2))) });
  }

  const width = e.target.closest('[data-width]');
  if (width) return applyChange({ maxWidth: Number(width.dataset.width) });

  const font = e.target.closest('[data-font]');
  if (font) return applyChange({ fontFamily: font.dataset.font });

  const direction = e.target.closest('[data-direction]');
  if (direction) return applyChange({ direction: direction.dataset.direction });
});

/* ---------- Paneller & açılır kutu ---------- */
export function closeDrawers() {
  $$('.drawer.open').forEach((d) => {
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
  });
}
function toggleDrawer(id, btn) {
  const drawer = document.getElementById(id);
  const willOpen = !drawer.classList.contains('open');
  closeDrawers();
  drawer.classList.toggle('open', willOpen);
  drawer.setAttribute('aria-hidden', String(!willOpen));
  btn?.classList.toggle('on', willOpen);
}

$('#btn-toc')?.addEventListener('click', (e) => toggleDrawer('toc-drawer', e.currentTarget));
$('#btn-notes')?.addEventListener('click', (e) => toggleDrawer('notes-drawer', e.currentTarget));
document.addEventListener('click', (e) => {
  const close = e.target.closest('[data-drawer-close]');
  if (close) {
    closeDrawers();
    $$('.rheader .btn.on').forEach((b) => b.classList.remove('on'));
  }
});

const pop = $('#settings-pop');
$('#btn-settings')?.addEventListener('click', (e) => {
  e.stopPropagation();
  pop.classList.toggle('open');
  e.currentTarget.classList.toggle('on', pop.classList.contains('open'));
});
document.addEventListener('click', (e) => {
  if (pop.classList.contains('open') && !e.target.closest('#settings-pop') && !e.target.closest('#btn-settings')) {
    pop.classList.remove('open');
    $('#btn-settings').classList.remove('on');
  }
});

/* ---------- Odak modu ---------- */
export function toggleFocus(force) {
  const on = force ?? !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', on);
  if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (!on && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}
$('#btn-focus')?.addEventListener('click', () => toggleFocus());
$('#btn-focus-exit')?.addEventListener('click', () => toggleFocus(false));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('focus-mode');
});

/* ---------- İlerleme ---------- */
let saveTimer;
export function saveProgress(value, percentage) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/progress', {
      method: 'POST',
      body: { book_id: STATE.bookId, progress_value: String(value), percentage },
    });
  }, 900);
}

export function setProgressUI(percentage, chapterLabel) {
  const slider = $('#progress-slider');
  const label = $('#progress-label');
  if (slider && document.activeElement !== slider) slider.value = percentage;
  if (label) label.textContent = '%' + percentage;
  if (chapterLabel != null) $('#chapter-label').textContent = chapterLabel;
}

/* ---------- Notlar ---------- */
export const notes = {
  items: STATE.annotations || [],
  onChange: () => {},

  render() {
    const list = $('#notes-list');
    if (!list) return;
    if (!this.items.length) {
      list.innerHTML =
        '<p style="padding:1.25rem;text-align:center;opacity:.6;font-size:.8125rem">' +
        'Henüz not yok. Metinde bir cümle seçip renk veya not ekleyin.</p>';
      return;
    }
    list.innerHTML = this.items
      .map(
        (a) => `
      <div class="note-card" data-note="${a.id}" style="--hl:${COLORS[a.color] || COLORS.yellow}">
        <div class="note-quote">${escapeHtml(a.selected_text)}</div>
        ${a.note_text ? `<div class="note-text">${escapeHtml(a.note_text)}</div>` : ''}
        <div class="note-foot">
          <span>${new Date(a.created_at + 'Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <button data-note-delete="${a.id}" title="Sil" aria-label="Notu sil">Sil</button>
        </div>
      </div>`
      )
      .join('');
  },

  async save({ id = 0, cfi, text, note, color }) {
    const r = await api('/api/annotations', {
      method: 'POST',
      body: { id, book_id: STATE.bookId, cfi_range: cfi, selected_text: text, note_text: note, color },
    });
    if (!r.success) {
      toast(r.message || 'Not kaydedilemedi.', 'error');
      return null;
    }
    if (id > 0) {
      const existing = this.items.find((a) => a.id === id);
      if (existing) Object.assign(existing, { note_text: note, color });
    } else {
      this.items.push({
        id: r.id,
        cfi_range: cfi,
        selected_text: text,
        note_text: note,
        color,
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
    }
    this.render();
    this.onChange();
    toast(r.message || 'Kaydedildi.');
    return r.id;
  },

  async remove(id) {
    const r = await api(`/api/annotations/${id}`, { method: 'DELETE' });
    if (!r.success) return toast(r.message || 'Silinemedi.', 'error');
    this.items = this.items.filter((a) => a.id !== id);
    this.render();
    this.onChange();
    toast('Not silindi.');
  },
};

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Not düzenleme kutusu ---------- */
const noteModal = $('#note-modal');
let noteColor = 'yellow';

export function openNoteModal({ id = 0, cfi = '', text = '', note = '', color = 'yellow' }) {
  noteColor = color;
  $('#note-id').value = id;
  $('#note-cfi').value = cfi;
  $('#note-selected').value = text;
  $('#note-quote').textContent = text;
  $('#note-text').value = note || '';
  $('#note-modal-title').textContent = id ? 'Notu Düzenle' : 'Not Ekle';
  $('#note-delete').hidden = !id;
  $$('#note-colors .pop-btn').forEach((b) => b.classList.toggle('active', b.dataset.color === color));
  noteModal.classList.add('open');
  noteModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#note-text').focus(), 60);
}
function closeNoteModal() {
  noteModal.classList.remove('open');
  noteModal.setAttribute('aria-hidden', 'true');
}

$('#note-colors')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-color]');
  if (!btn) return;
  noteColor = btn.dataset.color;
  $$('#note-colors .pop-btn').forEach((b) => b.classList.toggle('active', b === btn));
});

$('#note-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  await notes.save({
    id: Number($('#note-id').value) || 0,
    cfi: $('#note-cfi').value,
    text: $('#note-selected').value,
    note: $('#note-text').value.trim(),
    color: noteColor,
  });
  closeNoteModal();
});

$('#note-delete')?.addEventListener('click', async () => {
  await notes.remove(Number($('#note-id').value));
  closeNoteModal();
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-modal-close]')) return closeNoteModal();
  if (e.target.classList.contains('modal')) return closeNoteModal();

  const del = e.target.closest('[data-note-delete]');
  if (del) {
    e.stopPropagation();
    return notes.remove(Number(del.dataset.noteDelete));
  }
  const card = e.target.closest('[data-note]');
  if (card) {
    const ann = notes.items.find((a) => a.id === Number(card.dataset.note));
    if (ann) window.dispatchEvent(new CustomEvent('goto-annotation', { detail: ann }));
  }
});

/* ---------- Seçim balonu ---------- */
const tip = $('#sel-tip');
export function hideTip() {
  tip.classList.remove('open');
}
export function showTip(rect, { cfi, text }) {
  tip.dataset.cfi = cfi;
  tip.dataset.text = text;
  tip.classList.add('open');
  const w = tip.offsetWidth || 200;
  const h = tip.offsetHeight || 40;
  let top = rect.bottom + 10;
  if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 10);
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.min(Math.max(10, left), window.innerWidth - w - 10);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

tip?.addEventListener('click', async (e) => {
  const cfi = tip.dataset.cfi;
  const text = tip.dataset.text;
  const dot = e.target.closest('.dot');
  if (dot) {
    hideTip();
    window.dispatchEvent(new CustomEvent('clear-selection'));
    return notes.save({ cfi, text, note: null, color: dot.dataset.color });
  }
  if (e.target.closest('#tip-note')) {
    hideTip();
    window.dispatchEvent(new CustomEvent('clear-selection'));
    openNoteModal({ cfi, text });
  }
});

/* ---------- Klavye ---------- */
export function bindKeys({ next, prev }) {
  const handler = (e) => {
    if (/input|textarea/i.test(e.target?.tagName || '')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
    else if (e.key === 'f' || e.key === 'F') toggleFocus();
    else if (e.key === 'Escape') {
      hideTip();
      closeDrawers();
      closeNoteModal();
      pop.classList.remove('open');
    }
  };
  document.addEventListener('keydown', handler);
  return handler;
}

$('#zone-next')?.addEventListener('click', () => window.dispatchEvent(new Event('page-next')));
$('#zone-prev')?.addEventListener('click', () => window.dispatchEvent(new Event('page-prev')));

notes.render();
