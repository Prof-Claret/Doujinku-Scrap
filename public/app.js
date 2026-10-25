/* WE-SCRAPPER frontend — hash-route SPA.
 * Route:
 *   #/                     → home (latest)
 *   #/?order=popular       → home urutan
 *   #/manga/:slug          → detail + daftar chapter
 *   #/c/:chapterSlug     → reader
 *   #/s/:query(/:page)     → hasil pencarian
 */
(function () {
  const $view = document.getElementById('view');
  const $msg = document.getElementById('msg');
  const $tabs = document.getElementById('orderTabs');
  const $searchForm = document.getElementById('searchForm');
  const $searchInput = document.getElementById('searchInput');

  // ---------- util ----------
  const proxy = (u) => (u ? '/api/img?u=' + encodeURIComponent(u) : '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parseHash = () => {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, query] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { parts, params, path };
  };
  const navigate = (hash) => { location.hash = hash; };
  const showMsg = (t, cls = '') => { $msg.className = 'msg ' + cls; $msg.textContent = t; };
  const hideMsg = () => { $msg.className = 'msg hide'; };
  const setTitle = (t) => { document.title = t ? t + ' — WE-Scrapper' : 'WE-Scrapper — Manga Doujinku'; };

  async function api(path) {
    const res = await fetch(path);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Terjadi kesalahan');
    return json;
  }

  // ---------- komponen ----------
  const coverHTML = (cover, title) =>
    cover
      ? `<img src="${proxy(cover)}" alt="${esc(title)}" loading="lazy">`
      : `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='285' height='425'%3E%3Crect width='100%25' height='100%25' fill='%23171c26'/%3E%3Ctext x='50%25' y='50%25' fill='%236366f1' font-size='60' text-anchor='middle' dominant-baseline='middle'%3E%E2%9D%93%3C/text%3E%3C/svg%3E" alt="${esc(title)}">`;

  const cardHTML = (m) => `
    <a class="card" href="#/manga/${esc(m.slug)}">
      <div class="thumb">
        ${coverHTML(m.cover, m.title)}
        ${m.latestChapter ? `<span class="badge">${esc(m.latestChapter)}</span>` : ''}
      </div>
      <div class="meta">
        <div class="title">${esc(m.title)}</div>
        <div class="sub">
          <span>${esc(m.rating != null ? '★ ' + m.rating : (m.type || ''))}</span>
          <span>${esc(m.status || '')}</span>
        </div>
      </div>
    </a>`;

  const skeletons = (n) => `<div class="grid">${'<div class="skel"></div>'.repeat(n)}</div>`;

  // ---------- views ----------
  async function viewHome(params) {
    hideMsg(); setTitle('');
    updateTabs(params.order || 'update');
    $view.innerHTML = skeletons(18);
    try {
      const { items, page, hasNext } = await api(`/api/latest?page=${params.page || 1}&order=${params.order || 'update'}`);
      if (!items.length) return showMsg('Tidak ada manga ditemukan.');
      $view.innerHTML = `
        <div class="grid">${items.map(cardHTML).join('')}</div>
        ${pagerHTML(page, hasNext, '#/', params.order || 'update')}`;
      setTitle('Terbaru hal. ' + page);
    } catch (e) {
      showMsg('Gagal memuat: ' + e.message, 'error');
    }
  }

  async function viewSearch(parts) {
    const q = decodeURIComponent(parts[1] || '');
    const page = Number(parts[2]) || 1;
    hideMsg(); setTitle('Cari: ' + q);
    $tabs.style.pointerEvents = 'none'; $tabs.style.opacity = '.4';
    $searchInput.value = q;
    $view.innerHTML = skeletons(8);
    try {
      const { items, page: p, hasNext } = await api(`/api/search?q=${encodeURIComponent(q)}&page=${page}`);
      if (!items.length) return showMsg(`Tidak ada hasil untuk "${q}".`);
      $view.innerHTML = `
        <p class="msg" style="margin-top:0">${items.length} hasil untuk "${esc(q)}"</p>
        <div class="grid">${items.map(cardHTML).join('')}</div>
        ${pagerHTML(p, hasNext, '#/s/' + encodeURIComponent(q) + '/', '')}`;
    } catch (e) {
      showMsg('Gagal memuat: ' + e.message, 'error');
    } finally {
      $tabs.style.pointerEvents = ''; $tabs.style.opacity = '';
    }
  }

  async function viewManga(slug) {
    hideMsg(); setTitle('');
    $view.innerHTML = skeletons(3);
    try {
      const { data: m } = await api('/api/manga/' + encodeURIComponent(slug));
      setTitle(m.title);
      const infoEntries = Object.entries(m.info || {});
      $view.innerHTML = `
        <a class="backlink" href="#/">← Kembali</a>
        <div class="detail">
          <div class="cover">
            ${coverHTML(m.cover, m.title)}
          </div>
          <div>
            <h2>${esc(m.title)}</h2>
            <div class="rating">
              ${m.rating != null ? `<span>⭐ ${m.rating} / 10</span>` : ''}
              <span class="followers">${m.followers} pengikut</span>
            </div>
            ${m.genres && m.genres.length ? `<div class="genres">${m.genres.map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
            ${infoEntries.length ? `<div class="infoTable">${infoEntries.map(([k, v]) => `<div><b>${esc(k)}</b>— ${esc(v)}</div>`).join('')}</div>` : ''}
            <p class="desc">${esc(m.description)}</p>
            <div class="chapters">
              <h3>Daftar Chapter (${m.chaptersCount})</h3>
              <div class="chlist">
                ${m.chapters.map((c) => `
                  <a href="#/c/${esc(c.slug)}">
                    <span>${esc(c.name)}</span>
                    <span class="date">${esc(c.date)}</span>
                  </a>`).join('')}
              </div>
            </div>
          </div>
        </div>`;
    } catch (e) {
      showMsg('Gagal memuat manga: ' + e.message, 'error');
    }
  }

  async function viewChapter(slug) {
    hideMsg(); setTitle('');
    $view.innerHTML = '<div class="msg">Memuat halaman…</div>';
    try {
      const { data: c } = await api('/api/chapter/' + encodeURIComponent(slug));
      setTitle(c.title);
      $view.innerHTML = `
        <a class="backlink" href="#/manga/${esc(c.seriesSlug || '')}">← Kembali ke manga</a>
        <div class="reader">
          <div class="head">
            <h2>${esc(c.title)}</h2>
            <div style="display:flex;gap:8px">
              <button class="nav-btn ghost" id="prevCh" ${c.prevSlug ? '' : 'disabled'}>← Prev</button>
              <button class="nav-btn ghost" id="nextCh" ${c.nextSlug ? '' : 'disabled'}>Next →</button>
            </div>
          </div>
          <div class="pages" id="pages">
            ${c.images.map((u, i) => `
              <img src="${proxy(u)}" alt="hal ${i + 1}" loading="lazy">
              <div class="pagenum">halaman ${i + 1} / ${c.images.length}</div>`).join('')}
          </div>
          <div class="head" style="justify-content:center">
            <button class="nav-btn" id="prevCh2" ${c.prevSlug ? '' : 'disabled'}>← Prev Chapter</button>
            <button class="nav-btn" id="nextCh2" ${c.nextSlug ? '' : 'disabled'}>Next Chapter →</button>
          </div>
        </div>`;

      const goPrev = () => c.prevSlug && navigate('#/c/' + c.prevSlug);
      const goNext = () => c.nextSlug && navigate('#/c/' + c.nextSlug);
      document.getElementById('prevCh').onclick = goPrev;
      document.getElementById('nextCh').onclick = goNext;
      document.getElementById('prevCh2').onclick = goPrev;
      document.getElementById('nextCh2').onclick = goNext;
    } catch (e) {
      showMsg('Gagal memuat chapter: ' + e.message, 'error');
    }
  }

  function pagerHTML(page, hasNext, basePath, order) {
    const mk = (p) => {
      if (basePath === '#/') return order === 'update' && p === 1 ? '#/' : `#/?page=${p}&order=${order}`;
      return basePath + p;
    };
    return `
      <div class="pager">
        <button ${page <= 1 ? 'disabled' : ''} onclick="location.hash='${mk(Math.max(1, page - 1))}'">← Sebelumnya</button>
        <span>Hal. ${page}</span>
        <button ${hasNext ? '' : 'disabled'} onclick="location.hash='${mk(page + 1)}'">Berikutnya →</button>
      </div>`;
  }

  function updateTabs(active) {
    $tabs.querySelectorAll('a').forEach((a) => {
      a.classList.toggle('active', a.dataset.order === active);
      a.href = '#/?order=' + a.dataset.order;
    });
  }

  // ---------- router ----------
  function router() {
    const { parts, params } = parseHash();
    window.scrollTo(0, 0);
    if (parts[0] === 'manga' && parts[1]) return viewManga(parts[1]);
    if (parts[0] === 'c' && parts[1]) return viewChapter(parts[1]);
    if (parts[0] === 's') return viewSearch(parts);
    viewHome(params);
  }

  document.addEventListener('hashchange', router);
  $searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $searchInput.value.trim();
    if (q) navigate('#/s/' + encodeURIComponent(q) + '/1');
  });

  router();
})();
