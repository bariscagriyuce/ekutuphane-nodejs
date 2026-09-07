/* app.js — Kütüphane arayüzü etkileşimleri */

const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Ağ yardımcıları ---------- */
export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'X-CSRF-Token': CSRF,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* gövde JSON değilse yoksay */
  }
  if (res.status === 401) {
    toast('Oturumunuz sona ermiş. Giriş sayfasına yönlendiriliyorsunuz…', 'error');
    setTimeout(() => (location.href = '/login'), 1200);
  }
  return { ok: res.ok, ...data };
}

/* ---------- Bildirimler ---------- */
const ICON_OK = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const ICON_ERR = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';

export function toast(message, type = 'success', ms = 4000) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${type === 'error' ? ICON_ERR : ICON_OK}<span></span>`;
  el.querySelector('span').textContent = message;
  host.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/* ---------- Tema ---------- */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-theme-toggle]')) return;
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
});

/* ---------- Modal ---------- */
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('input, textarea, button')?.focus();
}
function closeModal(modal) {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-modal-open]');
  if (opener) return openModal(opener.dataset.modalOpen);
  if (e.target.closest('[data-modal-close]')) return closeModal(e.target.closest('.modal'));
  if (e.target.classList.contains('modal')) closeModal(e.target);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal.open').forEach(closeModal);
});
window.openModal = openModal;

/* ---------- Mobil menü ---------- */
document.addEventListener('click', (e) => {
  const shell = $('#app-shell');
  if (!shell) return;
  if (e.target.closest('[data-toggle-nav]')) shell.classList.toggle('nav-open');
  else if (e.target.closest('[data-close-nav]')) shell.classList.remove('nav-open');
});

/* ---------- Kitap kartı eylemleri ---------- */
document.addEventListener('click', async (e) => {
  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    e.preventDefault();
    favBtn.disabled = true;
    const r = await api('/api/favorites', { method: 'POST', body: { book_id: Number(favBtn.dataset.fav) } });
    favBtn.disabled = false;
    if (!r.success) return toast(r.message || 'İşlem başarısız.', 'error');
    favBtn.classList.toggle('on', r.is_favorite);
    favBtn.setAttribute('aria-label', r.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle');
    // Favoriler rafındaysak, çıkarılan kitabı listeden kaldır
    if (!r.is_favorite && $('#books-grid')?.dataset.shelf === 'favorites') {
      favBtn.closest('.card')?.remove();
    }
    toast(r.message);
    return;
  }

  const sendBtn = e.target.closest('[data-send]');
  if (sendBtn) {
    e.preventDefault();
    const original = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner" style="margin:0"></span>';
    const r = await api('/api/send-to-reader', { method: 'POST', body: { book_id: Number(sendBtn.dataset.send) } });
    sendBtn.disabled = false;
    sendBtn.innerHTML = original;
    toast(r.message || (r.success ? 'Gönderildi.' : 'Gönderim başarısız.'), r.success ? 'success' : 'error');
  }
});

/* ---------- Profil formu ---------- */
$('#profile-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  const r = await api('/api/profile', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
  btn.disabled = false;
  toast(r.message || 'İşlem tamamlandı.', r.success ? 'success' : 'error');
  if (r.success) {
    form.querySelectorAll('input[type="password"]').forEach((i) => (i.value = ''));
    closeModal($('#profile-modal'));
  }
});

/* ---------- Kart şablonu (istemci tarafı) ---------- */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const svg = (d) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  heart: svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'),
  play: svg('<path d="m6 3 14 9-14 9Z"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
  send: svg('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
};

export function cardHTML(book) {
  const pct = book.percentage != null && book.percentage > 0 ? Math.min(100, book.percentage) : 0;
  const readBtn = book.readable ? `<a class="btn btn-primary" href="/read/${book.id}">${I.play} Oku</a>` : '';
  const listRead = book.readable ? `<a class="btn btn-sm btn-primary" href="/read/${book.id}">Oku</a>` : '';
  return `
  <article class="card" data-book-id="${book.id}">
    <div class="cover">
      <span class="badge-format">${esc(book.file_format)}</span>
      <button class="fav ${book.isFavorite ? 'on' : ''}" data-fav="${book.id}" type="button"
              aria-label="${book.isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}">${I.heart}</button>
      <div class="cover-fallback">
        <div class="fb-title">${esc(book.title)}</div>
        <div class="fb-author">${esc(book.author)}</div>
      </div>
      ${book.coverUrl ? `<img src="${esc(book.coverUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
      <div class="cover-actions">
        ${readBtn}
        <a class="btn btn-outline btn-icon" href="/file/${book.id}" title="İndir" download>${I.download}</a>
        <button class="btn btn-outline btn-icon" data-send="${book.id}" title="E-okuyucuya gönder" type="button">${I.send}</button>
      </div>
      ${pct ? `<div class="progress-strip"><span style="width:${pct}%"></span></div>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title" title="${esc(book.title)}">${esc(book.title)}</div>
      <div class="card-author" title="${esc(book.author)}">${esc(book.author)}</div>
      ${pct ? `<div class="card-meta">%${pct} okundu</div>` : ''}
    </div>
    <div class="list-actions">
      ${listRead}
      <a class="btn btn-sm btn-outline btn-icon" href="/file/${book.id}" title="İndir" download>${I.download}</a>
      <button class="btn btn-sm btn-outline btn-icon" data-send="${book.id}" title="E-okuyucuya gönder" type="button">${I.send}</button>
    </div>
  </article>`;
}

/* ---------- Kütüphane: arama, sıralama, sonsuz kaydırma ---------- */
const grid = $('#books-grid');
const stateEl = $('#page-state');

if (grid && stateEl) {
  const state = JSON.parse(stateEl.textContent);
  state.loading = false;
  state.hasMore = state.page * state.pageSize < state.total;

  const searchInput = $('#search-input');
  const loadingRow = $('#loading-row');
  const resultCount = $('#result-count');
  const emptyState = $('#empty-state');
  const moreRow = $('#more-row');

  const params = (page) => {
    const p = new URLSearchParams({ page });
    if (state.shelf !== 'all') p.set('shelf', state.shelf);
    if (state.sort !== 'recent') p.set('sort', state.sort);
    if (state.format) p.set('format', state.format);
    if (state.search) p.set('q', state.search);
    return p;
  };

  function syncUrl() {
    const p = params(1);
    p.delete('page');
    const qs = p.toString();
    history.replaceState(null, '', qs ? `/?${qs}` : '/');
  }

  async function fetchPage(page) {
    if (state.loading) return null;
    state.loading = true;
    loadingRow.hidden = false;
    const r = await api(`/api/books?${params(page)}`);
    state.loading = false;
    loadingRow.hidden = true;
    return r.success ? r : null;
  }

  /** Aramada/filtre değişiminde listeyi baştan kurar. */
  async function reload() {
    const r = await fetchPage(1);
    if (!r) return;
    state.page = 1;
    state.total = r.total;
    state.hasMore = r.hasMore;
    grid.innerHTML = r.books.map(cardHTML).join('');
    if (moreRow) moreRow.hidden = !r.hasMore;
    resultCount.textContent =
      `${r.total.toLocaleString('tr-TR')} kitap` + (state.search ? ` · “${state.search}” için sonuçlar` : '');
    // Arama yapılınca "devam et" rafı anlamsızlaşır
    document.querySelector('.shelf')?.closest('section')?.toggleAttribute('hidden', Boolean(state.search || state.format));
    if (emptyState) {
      emptyState.hidden = r.books.length > 0;
      $('#empty-title').textContent = state.search ? 'Sonuç bulunamadı' : 'Burası henüz boş';
      $('#empty-text').textContent = state.search
        ? `“${state.search}” aramasına uygun kitap yok. Farklı bir kelime deneyin.`
        : 'Bu rafta gösterilecek kitap yok.';
    }
    syncUrl();
  }

  async function loadMore() {
    if (!state.hasMore || state.loading) return;
    const r = await fetchPage(state.page + 1);
    if (!r) return;
    state.page += 1;
    state.hasMore = r.hasMore;
    grid.insertAdjacentHTML('beforeend', r.books.map(cardHTML).join(''));
    if (moreRow) moreRow.hidden = !r.hasMore;
  }

  // Kaydırma gözlemcisinin çalışmadığı durumlar için elle yükleme
  $('#load-more')?.addEventListener('click', loadMore);

  // Anlık arama (300 ms gecikmeli)
  let timer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = searchInput.value.trim();
      reload();
    }, 300);
  });
  $('#search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    state.search = searchInput.value.trim();
    reload();
  });

  $('#sort-select')?.addEventListener('change', (e) => {
    state.sort = e.target.value;
    reload();
  });

  // Sonsuz kaydırma
  const sentinel = $('#sentinel');
  if (sentinel) {
    new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) loadMore();
      },
      { rootMargin: '600px 0px' }
    ).observe(sentinel);
  }
}

/* ---------- Görünüm (ızgara / liste) ---------- */
(function initView() {
  const toggle = $('#view-toggle');
  if (!toggle || !grid) return;
  let view = 'grid';
  try {
    view = localStorage.getItem('libraryView') || 'grid';
  } catch {}
  const apply = (v) => {
    grid.classList.toggle('list', v === 'list');
    $$('button', toggle).forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    try {
      localStorage.setItem('libraryView', v);
    } catch {}
  };
  apply(view);
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) apply(btn.dataset.view);
  });
})();

/* ---------- Klavye kısayolları ---------- */
document.addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('#search-input')?.focus();
  }
});
