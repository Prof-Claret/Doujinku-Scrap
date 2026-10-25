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
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

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

// ---------- PROXY GAMBAR ----------
// GET /api/img?u=<url-encoded> — whitelist host untuk mencegah open proxy
const ALLOWED_HOST_SUFFIX = ['.wp.com', 'doujinku.org', 'cdnasu.xyz', 'bandsif.xyz', 'gsmenu.xyz'];
function hostAllowed(hostname) {
  const h = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIX.some((s) => h === s || h.endsWith(s));
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

app.listen(PORT, () => {
  console.log(`✅ WE-SCRAPPER berjalan di http://localhost:${PORT}`);
});
