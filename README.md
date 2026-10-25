# WE-SCRAPPER 🔄

Website untuk scraping & membaca manga/doujinshi dari [doujinku.org](https://doujinku.org/) — dengan **bypass DNS hijack ISP** dan proxy gambar.

## Masalah yang diselesaikan

Jaringan Telkomsel ("Internet Positif") melakukan DNS hijack terhadap `doujinku.org`:

```
doujinku.org → internetbaik.telkomsel.com (202.3.218.139)   ← halaman blokir
doujinku.org → 104.21.75.106 / 172.67.221.88 (Cloudflare)   ← IP asli
```

WE-SCRAPPER menyelesaikannya dengan:

1. **DNS-over-HTTPS (DoH)** via Cloudflare (`1.1.1.1`, anycast, langsung ke IP statis dengan SNI + Host header benar), fallback `dns.google`.
2. **Koneksi TLS langsung ke IP asli** (SNI tetap `doujinku.org` → sertifikat valid) lewat custom `https.Agent`.
3. **Search via REST API WordPress** (`/wp-json/wp/v2/search`) untuk menghindari Cloudflare challenge di pencarian `?s=`.
4. **Proxy gambar** (`/api/img`) dengan whitelist host, cache, dan referer doujinku.org — mengatasi http-only CDN (`cdnasu.xyz`) dan mixed-content.
5. **Cache memori** (latest 2 mnt, detail 5 mnt, chapter 10 mnt) agar tidak memicu rate-limit Cloudflare.

⚠️ Jika Cloudflare sempat memblokir IP sementara (HTTP 403 "Sorry, you have been blocked"), bungakan: tunggu 1–3 menit, cache kesamping otomatis meredam request.

## Menjalankan

```bash
npm install
npm start        # → http://localhost:3000
```

## API

| Endpoint | Keterangan |
|---|---|
| `GET /api/health` | Status + IP return DNS |
| `GET /api/latest?page=N&order=update\|popular\|rating` | Daftar terbaru/populer/rating |
| `GET /api/search?q=...&page=N` | Pencarian (REST WordPress) |
| `GET /api/manga/:slug` | Detail manga + daftar chapter (rating, genre, info, etc.) |
| `GET /api/chapter/:slug` | Gambar chapter (`ts_reader.run` blob) + prev/next |
| `GET /api/img?u=<encoded>` | Proxy gambar (whitelist host) |

## UI (Frontend)

SPA hash-route di `public/`:

- `#/` — grid terbaru + tab Populer/Rating + pagination
- `#/manga/:slug` — detail (cover, rating, pengikut, genre, genre list, deskripsi, chapter list)
- `#/c/:chapterSlug` — pembaca gambar dengan tombol Prev/Next chapter
- `#/s/:query/:page` — hasil pencarian

Dark theme, responsive, lazy-load gambar.

## Struktur

```
we-scrapper/
├── server.js             # Express API + static + proxy
├── src/
│   ├── doh-agent.js     # DoH resolver + HTTPS agent bypass DNS hijack
│   └── scraper.js       # Fetch + parser HTML → JSON (cheerio)
└── public/              # Frontend SPA vanilla JS
    ├── index.html
    ├── styles.css
    └── app.js
```

## Catatan

- Penggunaan pribadi; hormati DMCA doujinku.org (laman `/dmca/`).
- Data ny fetch langsung dari situs sumber; tidak ada data disimpan permanen.
- Content dewasa — pastikan sesuai hukum setempat.
