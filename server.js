/**
 * WE-SCRAPPER — server API + UI statis.
 *
 * Jalankan: npm install && npm start  → http://localhost:3000
 */
const express = require('express');
const path = require('path');
const { URL } = require('url');
const { getLatest, search, getManga, getChapter, BASE, dohAgent } = require('./src/scraper');
const { dohResolve, fetchAsset } = dohAgent;

const PORT = process.env.PORT || 3000;
const app = express();

app.disable('x-powered-by');

// ---------- HALAMAN UTAMA ----------
// "/" → welcome page statis (SCARLET-MSD), "/app" → SPA katalog.
// Route eksplisit ditempatkan SEBELUM express.static agar index.html
// tidak pernah di-serve di "/" dan pengunjung selalu disambut welcome page dulu.
const sendFirst = (res, file, title) =>
  res.sendFile(path.join(__dirname, 'public', file));
app.get('/', (_req, res) => sendFirst(res, 'welcome.html'));
app.get('/app', (_req, res) => sendFirst(res, 'index.html'));

// no-cache untuk frontend agar perubahan app.js/styles.css langsung terpakai
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0, index: false, setHeaders(res) { res.set('cache-control', 'no-cache'); } }));

// helper: api wrapper dErr -> res.error
const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, err, status = 502) =>
  res.status(status).json({ ok: false, error: err.message || String(err) });

// ---------- API ----------
// GET /api/latest?page=1&order=update|popular|rating
app.get('/api/latest', async (req, res) => {
  try {
    ok(res, await getLatest(req.query.page, req.query.order));
  } catch (e) {
    fail(res, e);
  }
});

// GET /api/search?q=...&page=1
app.get('/api/search', async (req, res) => {
  try {
    ok(res, await search(req.query.q, req.query.page));
  } catch (e) {
    fail(res, e);
  }
});

// GET /api/manga/:slug
app.get('/api/manga/:slug', async (req, res) => {
  try {
    ok(res, { data: await getManga(req.params.slug) });
  } catch (e) {
    fail(res, e);
  }
});

// GET /api/chapter/:slug
app.get('/api/chapter/:slug', async (req, res) => {
  try {
    ok(res, { data: await getChapter(req.params.slug) });
  } catch (e) {
    fail(res, e);
  }
});

// GET /api/download/pdf/:slug
const { streamChapterPdf } = require('./src/pdf-generator');
app.get('/api/download/pdf/:slug', async (req, res) => {
  try {
    await streamChapterPdf(req.params.slug, req, res);
  } catch (e) {
    if (!res.headersSent) {
      fail(res, e, 500);
    } else {
      console.error('Error saat streaming PDF:', e);
    }
  }
});

// ---------- PROXY GAMBAR ----------
// GET /api/img?u=<url-encoded> — whitelist host (statis + hasil scraping dinamis)
const { isKnownImageHost } = require('./src/scraper');
function hostAllowed(hostname) {
  return isKnownImageHost(hostname);
}

app.get('/api/img', async (req, res) => {
  const src = req.query.u;
  if (!src) return res.status(400).end('missing u');
  let url;
  try {
    url = new URL(src);
  } catch {
    return res.status(400).end('bad url');
  }
  if (!/^https?:$/.test(url.protocol)) return res.status(400).end('bad protocol');
  if (!hostAllowed(url.hostname)) return res.status(403).end('host tidak diizinkan');

  try {
    const { status, body, contentType } = await fetchAsset(url.href);
    if (status !== 200 || !body.length) return res.status(status === 404 ? 404 : 502).end();
    res.set('content-type', contentType || 'image/jpeg');
    res.set('cache-control', 'public, max-age=86400');
    res.end(body);
  } catch (e) {
    res.status(502).end(e.message);
  }
});

// ---------- health ----------
app.get('/api/health', async (req, res) => {
  try {
    const ips = await dohResolve('doujinku.org');
    ok(res, { dns: ips, base: BASE });
  } catch (e) {
    fail(res, e);
  }
});

// Penanganan ramah saat port sudah dipakai (mis. server lama masih jalan)
const server = app.listen(PORT, () => {
  console.log(`✅ ScarletMSD berjalan di http://localhost:${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} sudah dipakai (kemungkinan server lama masih berjalan).`);
    console.error(`   Matikan dulu:  kill $(lsof -t -i:${PORT})   atau:  fuser -k ${PORT}/tcp`);
    console.error(`   Atau jalankan di port lain:  PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});
