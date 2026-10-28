/* WE-SCRAPPER frontend — hash-route SPA.
 * Route:
 *   #/                     → welcome page (landing)
 *   #/browse               → grid manga (latest)
 *   #/browse?order=popular → grid urutan
 *   #/manga/:slug          → detail + daftar chapter
 *   #/c/:chapterSlug       → reader
 *   #/s/:query(/:page)     → hasil pencarian
 *   #/about                → tentang aplikasi & developer
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
  const setTitle = (t) => { document.title = t ? t + ' — ScarletMSD' : 'ScarletMSD — Manga Reader'; };

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
  function showTabs(show) {
    $tabs.classList.toggle('hide', !show);
  }

  function viewWelcome() {
    hideMsg(); setTitle('');
    showTabs(false);
    $view.innerHTML = `
      <div class="hero">
        <div class="hero-logo">Scarlet<span>—</span>MSD</div>
        <h1>Baca Manga <em>Bebas Blokir</em>,<br>Langsung dari Sumbernya.</h1>
        <p class="lead">
          Scraper manga & doujinshi dari doujinku.org dengan <b>bypass DNS hijack ISP</b>,
          proxy gambar built-in, dan unduhan PDF per chapter — tanpa ribet.
        </p>
        <div class="hero-actions">
          <a class="btn primary" href="#/browse">🔍 Mulai Menjelajah</a>
          <a class="btn ghost" href="#/about">ℹ️ Tentang App & Dev</a>
        </div>
        <div class="hero-stats">
          <div><b>DoH</b><span>Bypass blokir</span></div>
          <div><b>Proxy</b><span>Aman mixed-content</span></div>
          <div><b>PDF</b><span>Unduh chapter</span></div>
          <div><b>Cache</b><span>Hemat request</span></div>
        </div>
      </div>
      <div class="features">
        <div class="feature">
          <div class="ic">🛡️</div>
          <h3>Anti DNS Hijack</h3>
          <p>Resolusi lewat DNS-over-HTTPS Cloudflare & koneksi TLS langsung ke IP asli, jadi halaman blokir ISP tidak lagi mengganggu.</p>
        </div>
        <div class="feature">
          <div class="ic">🖼️</div>
          <h3>Proxy Gambar</h3>
          <p>Semua gambar dialamatkan via /api/img dengan whitelist host + referer, mengatasi CDN http-only dan mixed-content.</p>
        </div>
        <div class="feature">
          <div class="ic">📄</div>
          <h3>Unduh PDF</h3>
          <p>Setiap chapter bisa diunduh sebagai PDF utuh, siap dibaca offline di mana saja.</p>
        </div>
        <div class="feature">
          <div class="ic">⚡</div>
          <h3>Cache Memori</h3>
          <p>Hasil scraping & detail manga di-cache sementara agar tidak memicu rate-limit Cloudflare.</p>
        </div>
      </div>
      <div class="hero-cta">
        <p>Sudah siap? Jelajahi katalog terbaru & populer sekarang.</p>
        <a class="btn primary" href="#/browse">Buka Katalog →</a>
      </div>`;
  }

  async function viewHome(params) {
    hideMsg(); setTitle('Jelajah');
    showTabs(true);
    updateTabs(params.order || 'update');
    $view.innerHTML = skeletons(18);
    try {
      const { items, page, hasNext } = await api(`/api/latest?page=${params.page || 1}&order=${params.order || 'update'}`);
      if (!items.length) return showMsg('Tidak ada manga ditemukan.');
      $view.innerHTML = `
        <h2 class="view-title">${params.order === 'popular' ? 'Populer' : params.order === 'rating' ? 'Rating Terbaik' : 'Terbaru'}</h2>
        <div class="grid">${items.map(cardHTML).join('')}</div>
        ${pagerHTML(page, hasNext, params.order || 'update')}`;
      setTitle('Jelajah hal. ' + page);
    } catch (e) {
      showMsg('Gagal memuat: ' + e.message, 'error');
    }
  }

  async function viewSearch(parts) {
    const q = decodeURIComponent(parts[1] || '');
    const page = Number(parts[2]) || 1;
    hideMsg(); setTitle('Cari: ' + q);
    showTabs(true);
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
    showTabs(false);
    $view.innerHTML = skeletons(3);
    try {
      const { data: m } = await api('/api/manga/' + encodeURIComponent(slug));
      setTitle(m.title);
      const infoEntries = Object.entries(m.info || {});
      $view.innerHTML = `
        <a class="backlink" href="#/browse">← Kembali</a>
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
                  <div class="ch-row">
                    <a class="ch-link" href="#/c/${esc(c.slug)}">
                      <span>${esc(c.name)}</span>
                      <span class="date">${esc(c.date)}</span>
                    </a>
                    <a class="ch-dl" href="/api/download/pdf/${encodeURIComponent(c.slug)}" title="Download ${esc(c.name)} sebagai PDF" download>
                      📥 PDF
                    </a>
                  </div>`).join('')}
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
    showTabs(false);
    $view.innerHTML = '<div class="msg">Memuat halaman…</div>';
    try {
      const { data: c } = await api('/api/chapter/' + encodeURIComponent(slug));
      setTitle(c.title);
      $view.innerHTML = `
        <a class="backlink" href="#/manga/${esc(c.seriesSlug || '')}">← Kembali ke manga</a>
        <div class="reader">
          <div class="head">
            <h2>${esc(c.title)}</h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <a class="nav-btn dl-btn" href="/api/download/pdf/${encodeURIComponent(c.slug)}" title="Download PDF" download>📥 Unduh PDF</a>
              <button class="nav-btn ghost" id="prevCh" ${c.prevSlug ? '' : 'disabled'}>← Prev</button>
              <button class="nav-btn ghost" id="nextCh" ${c.nextSlug ? '' : 'disabled'}>Next →</button>
            </div>
          </div>
          <div class="pages" id="pages">
            ${c.images.map((u, i) => `
              <img src="${proxy(u)}" alt="hal ${i + 1}" loading="lazy">
              <div class="pagenum">halaman ${i + 1} / ${c.images.length}</div>`).join('')}
          </div>
          <div class="head" style="justify-content:center;gap:12px;margin-top:20px">
            <button class="nav-btn" id="prevCh2" ${c.prevSlug ? '' : 'disabled'}>← Prev Chapter</button>
            <a class="nav-btn dl-btn" href="/api/download/pdf/${encodeURIComponent(c.slug)}" title="Download PDF" download>📥 Unduh PDF</a>
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

  function viewAbout() {
    hideMsg(); setTitle('Tentang');
    showTabs(false);
    $view.innerHTML = `
      <a class="backlink" href="#/">← Beranda</a>
      <div class="about">
        <section class="about-sec">
          <h2>🔄 Tentang Aplikasi</h2>
          <p>
            <b>ScarletMSD</b> adalah web scraper & pembaca manga/doujinshi dari
            <a href="https://doujinku.org/" target="_blank" rel="noopener">doujinku.org</a>.
            Dibuat untuk mengatasi <b>blokir DNS hijack ISP</b> ("Internet Positif") yang
            mengarahkan domain sumber ke halaman blokir Telkomsel.
          </p>
          <ul class="about-list">
            <li>🛡️ <b>Bypass DNS hijack</b> — resolusi DNS-over-HTTPS (Cloudflare 1.1.1.1, fallback Google) + koneksi TLS langsung ke IP asli Cloudflare dengan SNI yang benar.</li>
            <li>🔎 <b>Pencarian via REST API WordPress</b> — menghindari Cloudflare challenge pada pencarian <code>?s=</code>.</li>
            <li>🖼️ <b>Proxy gambar</b> (<code>/api/img</code>) — whitelist host statis + dinamis, cache, dan referer yang benar untuk CDN http-only.</li>
            <li>📄 <b>Unduh PDF</b> — seluruh halaman chapter dibundel jadi satu file PDF utuh.</li>
            <li>⚡ <b>Cache memori</b> — latest 2 mnt, detail 5 mnt, chapter 10 mnt, supaya tidak memicu rate-limit Cloudflare.</li>
          </ul>
          <p class="note">
            ⚠️ Hanya untuk keperluan pribadi. Hormati DMCA doujinku.org dan pastikan
            konten dewasa sesuai hukum setempat. Tidak ada data yang disimpan permanen.
          </p>
        </section>

        <section class="about-sec dev">
          <h2>👨‍💻 Tentang Developer</h2>
          <div class="devcard">
            <div class="ava">PC</div>
            <div>
              <h3>Prof-Claret</h3>
              <p>Developer di balik ScarletMSD — membangun scraper, bypass anti-blokir,
              dan frontend ringan tanpa framework berat.</p>
              <a class="btn gh" href="https://github.com/Prof-Claret" target="_blank" rel="noopener">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                github.com/Prof-Claret
              </a>
            </div>
          </div>
        </section>

        <section class="about-sec">
          <h2>🧰 Teknologi</h2>
          <div class="techs">
            <span>Node.js</span><span>Express</span><span>Cheerio</span>
            <span>DNS-over-HTTPS</span><span>Sharp</span><span>Archiver</span>
            <span>Vanilla JS SPA</span><span>Dark Theme</span>
          </div>
        </section>
      </div>`;
  }

  function pagerHTML(page, hasNext, order) {
    const mk = (p) => `#/browse?page=${p}&order=${order}`;
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
      a.href = '#/browse?order=' + a.dataset.order;
    });
  }

  // ---------- router ----------
  function router() {
    const { parts, params } = parseHash();
    window.scrollTo(0, 0);
    if (parts[0] === 'browse') return viewHome(params);
    if (parts[0] === 'about') return viewAbout();
    if (parts[0] === 'manga' && parts[1]) return viewManga(parts[1]);
    if (parts[0] === 'c' && parts[1]) return viewChapter(parts[1]);
    if (parts[0] === 's') return viewSearch(parts);
    return viewWelcome();
  }

  // hashchange event di-fire pada window (BOM), BUKAN document —
  // di sinilah "harus refresh dulu" terjadi kalau listener nya salah target
  window.addEventListener('hashchange', router);
  window.addEventListener('popstate', router);
  $searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $searchInput.value.trim();
    if (q) navigate('#/s/' + encodeURIComponent(q) + '/1');
  });

  router();
})();
