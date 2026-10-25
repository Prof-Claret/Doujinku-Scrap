/**
 * Scraper doujinku.org — parsing HTML ke JSON terstruktur.
 * Sumber halaman:
 *  - Latest  : /manga/?page=N&order=update
 *  - Cari    : /wp-json/wp/v2/search?search=Q&per_page=20&page=N (bypass CF challenge ?s=)
 *  - Detail  : /manga/<slug>/
 *  - Chapter : /<chapter-slug>/ (gambar ada di blob JS ts_reader.run({...}))
 */
const { fetchSite, TARGET_HOST } = require('./doh-agent');
const cheerio = require('cheerio');

const BASE = `https://${TARGET_HOST}`;

// ---------- registry host gambar yang sah (dipupuk dari hasil scraping) ----------
const seenImageHosts = new Set(['doujinku.org', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com', 'i3.wp.com', 'cdnasu.xyz']);
function registerImageUrls(urls) {
  for (const u of urls || []) {
    try {
      seenImageHosts.add(new URL(u).hostname.toLowerCase());
    } catch { /* abaikan */ }
  }
}
function isKnownImageHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (seenImageHosts.has(h)) return true;
  // sufiks umum CDN WordPress image proxy (i*.wp.com)
  return h.endsWith('.wp.com');
}

// ---------- cache sederhana (TTL) ----------
const cache = new Map(); // key -> { data, expireAt }
function withCache(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && hit.expireAt > Date.now()) return Promise.resolve(hit.data);
  return producer().then((data) => {
    cache.set(key, { data, expireAt: Date.now() + ttlMs });
    return data;
  });
}

// ---------- util ----------
async function getPage(path) {
  const { status, body } = await fetchSite(path);
  if (status !== 200) {
    const html = body.toString('utf8', 0, 4096);
    if ((status === 403 || status === 503) && /Just a moment|challenges\.cloudflare\.com|cf-chl/i.test(html)) {
      throw new Error(
        `Diblokir Cloudflare (HTTP ${status}) saat mengambil ${path}. ` +
          'doujinku.org menantang IP server/datacenter (mis. Vercel). Jalankan WE-SCRAPPER secara lokal (npm start) dari koneksi rumah/seluler.'
      );
    }
    throw new Error(`HTTP ${status} saat mengambil ${path}`);
  }
  return body.toString('utf8');
}

function text(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** "12 Oktober 2026" dsb */
function normalizeDate(s) {
  return text(s);
}

// ---------- LATEST ----------
function parseLatest(html, page = 1) {
  const $ = cheerio.load(html);
  const items = [];
  $('.bs').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('.bsx > a').first();
    if (!$a.length) return;
    const href = $a.attr('href') || '';
    const slug = extractSlug(href, '/manga/');
    if (!slug) return;
    items.push({
      slug,
      title: text($a.attr('title') || $el.find('.tt').first().text()),
      cover: cleanCover($el.find('img').first().attr('src')),
      status: text($el.find('.status').first().text()) || null,
      type: text($el.find('.typename').first().text()) || null,
      latestChapter: text($el.find('.epxs').first().text()) || null,
      rating: parseFloat(text($el.find('.numscore').first().text())) || null,
      pageUrl: `${BASE}/manga/${slug}/`,
    });
  });
  // hasNext: angka halaman terbesar di pagination > halaman sekarang
  const pageNumbers = $('.pagination .page-numbers, .pagination a')
    .map((_, e) => text($(e).text()))
    .get()
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
  const hasNext = pageNumbers.filter((n) => n > page).length > 0;
  return { items, page, hasNext };
}

function extractSlug(href, prefix) {
  if (!href) return null;
  const m = new RegExp(`${prefix}([^/?#]+)`).exec(href);
  return m ? m[1].replace(/\/$/, '') : null;
}

/** cover sering proxied via i{0-3}.wp.com dgn resize; pertahankan tapi embed proxy di server */
function cleanCover(src) {
  return src || null;
}

async function getLatest(page = 1, order = 'update') {
  page = Math.max(1, Number(page) || 1);
  const allowedOrder = { update: 'update', popular: 'popular', rating: 'rating' };
  const ord = allowedOrder[order] || 'update';
  return withCache(`latest:${ord}:${page}`, 2 * 60 * 1000, async () => {
    const qs = ord === 'update' ? `?page=${page}` : `?page=${page}&order=${ord}`;
    const html = await getPage(`/manga/${qs}`);
    const data = parseLatest(html, page);
    registerImageUrls(data.items.map((i) => i.cover));
    return data;
  });
}

// ---------- SEARCH ----------
async function search(q = '', page = 1) {
  q = (q || '').trim();
  page = Math.max(1, Number(page) || 1);
  if (!q) return { items: [], page, hasNext: false, total: 0 };
  const per = 20;
  return withCache(`search:${q}:${page}`, 3 * 60 * 1000, async () => {
    const path = `/wp-json/wp/v2/search?search=${encodeURIComponent(q)}&per_page=${per}&page=${page}`;
    const { status, body } = await fetchSite(path);
    if (status === 400 && String(page) === '2') return { items: [], page, hasNext: false };
    if (status !== 200) throw new Error(`HTTP ${status} pencarian`);
    const json = JSON.parse(body.toString('utf8'));
    const items = (Array.isArray(json) ? json : []).map((r) => ({
      slug: extractSlug(r.url, '/manga/'),
      title: text(r.title),
      url: r.url,
    }));
    // hasNext: try pageNum+1 via headers? muat berat; pakai data test lewat jumlah == per
    return { items, page, hasNext: items.length === per };
  });
}

// ---------- MANGA DETAIL ----------
/** Ambil slug terakhir dari href absolut maupun relative, tanpa query/hash */
function slugFromHref(href) {
  if (!href) return null;
  try {
    const u = new URL(href, BASE);
    if (u.hostname && u.hostname !== 'doujinku.org') return null; // situs luar
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    return parts[parts.length - 1].replace(/\.html?$/i, '');
  } catch {
    return null;
  }
}
function parseManga(html, slug) {
  const $ = cheerio.load(html);
  const $cont = $('.seriestucontl').first();

  const cover =
    cleanCover($('.seriestucontl .thumb img').first().attr('src')) ||
    cleanCover($('.bigcover img').first().attr('src'));

  const rating = parseFloat($('.seriestucontl .num[itemprop="ratingValue"]').attr('content') || '') ||
    parseFloat(text($('.seriestucontl .num').first().text())) || null;
  const followers = parseInt(text($('.bmc').first().text()).replace(/\D/g, ''), 10) || 0;

  const description = text($('.seriestucontentr .entry-content').first().text());

  // genres: laman detail menarok <div class="seriestugenre"><a>…</a></div> dsb
  const genres = [];
  $('.seriestugenre a, .genre-name a').each((_, el) => {
    const g = text($(el).text());
    if (g && !genres.includes(g)) genres.push(g);
  });

  // info tambahan: status/type muncul di list item .infotable (fallback .adds)
  const info = {};
  $('.imptdt, .infotable tr').each((_, el) => {
    const t = text($(el).text());
    if (!t) return;
    const m = /^([a-zA-Z ]+):(.*)$/.exec(t);
    if (m) info[m[1].trim().toLowerCase()] = text(m[2]);
  });

  // chapters
  const chapters = [];
  $('#chapterlist li, .eplister li').each((_, el) => {
    const $li = $(el);
    const $a = $li.find('a').first();
    if (!$a.length) return;
    const href = $a.attr('href') || '';
    const chapSlug = slugFromHref(href);
    if (!chapSlug) return;
    const num = parseFloat($li.attr('data-num')) ||
      parseFloat((text($li.find('.chapternum').text()).match(/[\d.]+$/)) || ['NaN'][0]);
    chapters.push({
      slug: chapSlug,
      url: href,
      num: Number.isNaN(num) ? null : num,
      name: text($li.find('.chapternum').text()) || text($a.text()),
      date: normalizeDate($li.find('.chapterdate').text()),
    });
  });

  // reverse order (terbaru → terlama) dari server biasanya sudah cukup
  return {
    slug,
    title: text($('.entry-title, h1.entry-title').first().text()) ||
      text($('h1').first().text()) || slug,
    cover,
    rating,
    followers,
    description,
    genres,
    info,
    chapters,
    chaptersCount: chapters.length,
    pageUrl: `${BASE}/manga/${slug}/`,
  };
}

/** Normalisasi slug: dekode %xx, rapikan spasi → dash.
 * Karakter berbahaya aman karena path akan di-encode penuh (encodeURIComponent),
 * jadi unicode seperti "○" tetap terjaga seperti permalink asli. */
function normalizeSlug(raw) {
  let s = String(raw || '').trim();
  try { s = decodeURIComponent(s); } catch { /* tetap pakai asli */ }
  return s.replace(/\s+/g, '-');
}

async function getManga(slugRaw) {
  const slug = normalizeSlug(slugRaw);
  if (!slug) throw new Error('Slug manga tidak valid');
  return withCache(`manga:${slug}`, 5 * 60 * 1000, async () => {
    const html = await getPage(`/manga/${encodeURIComponent(slug)}/`);
    if (/<title>.*404/i.test(html) && !chaptersHtmlHas(html)) throw new Error('Manga tidak ditemukan: ' + slug);
    const data = parseManga(html, slug);
    registerImageUrls([data.cover]);
    return data;
  });
}

function chaptersHtmlHas(html) {
  return html.includes('eph-num') || html.includes('ts_reader');
}

// ---------- CHAPTER ----------
function parseTsReaderJson(html) {
  // blob JS: ts_reader.run({...}) — JSON-nya berisi !1/!0 (JS style) → normalisasi
  const start = html.indexOf('ts_reader.run(');
  if (start === -1) return null;
  const open = html.indexOf('{', start);
  if (open === -1) return null;
  // brace-balanced scan
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;
  const raw = html
    .slice(open, end)
    .replace(/"([a-zA-Z_]+)":!([01])/g, (_, key, val) => `"${key}":${val === '1'}`);
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function parseChapter(html, chapterSlug) {
  const $ = cheerio.load(html);
  const data = parseTsReaderJson(html);
  const title = text($('h1').first().text()).replace(/^- /, '') ||
    text($('title').first().text());

  // series index url: link "Index"/breadcrumb ke /manga/<slug>/
  let seriesSlug = null;
  $('a[href*="/manga/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const s = extractSlug(href, '/manga/');
    if (s && !seriesSlug) seriesSlug = s;
  });

  const sources = data && Array.isArray(data.sources)
    ? data.sources.map((s) => ({ name: s.source, images: s.images || [] }))
    : [];
  const nonEmpty = sources.find((s) => s.images.length);
  const prev = slugFromUrl(data && data.prevUrl);
  const next = slugFromUrl(data && data.nextUrl);

  return {
    slug: chapterSlug,
    title,
    seriesSlug,
    images: nonEmpty ? nonEmpty.images : [],
    sources,
    lazyload: data ? !!data.lazyload : false,
    prevSlug: prev,
    nextSlug: next,
  };
}

function slugFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

async function getChapter(chapterSlugRaw) {
  const chapterSlug = normalizeSlug(chapterSlugRaw);
  if (!chapterSlug) throw new Error('Slug chapter tidak valid');
  return withCache(`chapter:${chapterSlug}`, 10 * 60 * 1000, async () => {
    const html = await getPage(`/${encodeURIComponent(chapterSlug)}/`);
    const parsed = parseChapter(html, chapterSlug);
    if (!parsed.images.length) throw new Error('Tidak ada gambar pada chapter: ' + chapterSlug);
    for (const s of parsed.sources) registerImageUrls(s.images);
    return parsed;
  });
}

module.exports = { getLatest, search, getManga, getChapter, BASE, isKnownImageHost };
module.exports.dohAgent = require('./doh-agent');
