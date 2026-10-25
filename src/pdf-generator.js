/**
 * WE-SCRAPPER — PDF Generator.
 * Mengonversi seluruh halaman chapter manga menjadi dokumen PDF terstruktur.
 *
 * Fitur:
 *  - Aspect-ratio preservation (ukuran halaman PDF menyesuaikan dimensi asli gambar).
 *  - Dukungan multi-format (JPEG, PNG, WebP, AVIF) via Sharp.
 *  - Batch streaming concurrency (ringan memori & respons cepat).
 *  - Penanganan pemutusan koneksi client (abort stream).
 */
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { getChapter, dohAgent } = require('./scraper');
const { fetchAsset } = dohAgent;

/**
 * Sanitasi string untuk nama berkas yang aman di semua OS.
 */
function sanitizeFilename(str) {
  return String(str || 'chapter')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * Ambil gambar dari CDN via DoH dan konversi ke buffer JPEG yang siap di-embed ke PDF.
 */
async function processImage(url, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { status, body } = await fetchAsset(url);
      if (status !== 200 || !body || !body.length) {
        throw new Error(`HTTP ${status}`);
      }

      const img = sharp(body);
      const meta = await img.metadata();
      const isJpeg = meta.format === 'jpeg' || meta.format === 'jpg';

      const jpegBuffer = isJpeg
        ? body
        : await img.jpeg({ quality: 85 }).toBuffer();

      return {
        buffer: jpegBuffer,
        width: meta.width || 800,
        height: meta.height || 1200,
      };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

/**
 * Streaming dokumen PDF untuk chapter ke Express Response (`res`).
 */
async function streamChapterPdf(chapterSlug, req, res) {
  const chapter = await getChapter(chapterSlug);
  if (!chapter || !chapter.images || !chapter.images.length) {
    res.status(404).json({ ok: false, error: 'Chapter atau gambar tidak ditemukan' });
    return;
  }

  const rawTitle = chapter.title || chapter.slug;
  const safeTitle = sanitizeFilename(rawTitle);
  const asciiFilename = safeTitle.replace(/[^\x20-\x7E]/g, '_') || 'chapter';
  const utf8Filename = encodeURIComponent(safeTitle);

  // Set HTTP headers untuk file download
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFilename}.pdf"; filename*=UTF-8''${utf8Filename}.pdf`
  );

  if (req.method === 'HEAD') {
    return res.end();
  }

  let isAborted = false;
  req.on('close', () => {
    isAborted = true;
  });

  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: false });
  doc.pipe(res);

  const BATCH_SIZE = 4;
  const totalImages = chapter.images.length;

  for (let i = 0; i < totalImages; i += BATCH_SIZE) {
    if (isAborted) break;

    const chunk = chapter.images.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      chunk.map(async (url, idx) => {
        try {
          return await processImage(url);
        } catch (err) {
          return { error: err.message, pageNum: i + idx + 1 };
        }
      })
    );

    if (isAborted) break;

    for (let j = 0; j < batchResults.length; j++) {
      const item = batchResults[j];
      const pageNum = i + j + 1;

      if (item.error) {
        // Fallback: halaman placeholder jika 1 gambar gagal diunduh
        doc.addPage({ size: [800, 1200], margin: 40 });
        doc.fontSize(14).text(`[Halaman ${pageNum} gagal dimuat: ${item.error}]`, 50, 100);
      } else {
        doc.addPage({ size: [item.width, item.height], margin: 0 });
        doc.image(item.buffer, 0, 0, { width: item.width, height: item.height });
      }
    }
  }

  if (!isAborted) {
    doc.end();
  }
}

module.exports = { streamChapterPdf };
