/**
 * DNS-over-HTTPS resolver + HTTPS agent untuk membypass DNS hijack ISP.
 *
 * Masalah: ISP Telkomsel ("Internet Positif") membajak DNS doujinku.org →
 * internetbaik.telkomsel.com, sehingga request biasa mendapat halaman blokir.
 *
 * Solusi: resolve domain via DoH (Cloudflare, diakses lewat IP statis agar tidak
 * ikut terkena hijack), lalu buka koneksi TLS langsung ke IP asli dengan SNI
 * tetap doujinku.org sehingga sertifikat tetap valid.
 */
const https = require('https');
const tls = require('tls');

const DOH_DOMAIN = 'cloudflare-dns.com';
const DOH_STATIC_IPS = ['1.1.1.1', '162.159.36.1']; // anycast Cloudflare DoH (akses langsung, aman dari hijack)
const FALLBACK_DOHS = ['https://dns.google/resolve'];
const TTL = 5 * 60 * 1000;


const resolveCache = new Map(); // name -> { ips, expireAt }

/** Resolve hostname via DoH (JSON API). Hasil di-cache TTL 5 menit. */
async function dohResolve(name) {
  const cached = resolveCache.get(name);
  if (cached && cached.ips.length && cached.expireAt > Date.now()) return cached.ips;

  let ips = await dohViaCloudflare(name).catch(() => []);
  if (!ips.length) ips = await dohViaGoogleJson(name).catch(() => []);
  if (ips.length) resolveCache.set(name, { ips, expireAt: Date.now() + TTL });
  return ips;
}

function dohViaCloudflare(name) {
  return new Promise((resolve, reject) => {
    const tryEndpoints = async (i) => {
      if (i >= DOH_STATIC_IPS.length) return reject(new Error('semua DoH gagal'));
      try {
        const ips = await new Promise((res2, rej2) => {
          const req = https.request(
            {
              host: DOH_STATIC_IPS[i],
              servername: DOH_DOMAIN,
              path: `/dns-query?name=${encodeURIComponent(name)}&type=A`,
              method: 'GET',
              headers: { host: DOH_DOMAIN, accept: 'application/dns-json' },
              timeout: 6000,
            },
            (res) => {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () => {
                try {
                  const json = JSON.parse(body);
                  const ips = (json.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
                  if (ips.length) res2(ips);
                  else rej2(new Error('DoH tanpa jawaban'));
                } catch (e) {
                  rej2(e);
                }
              });
            }
          );
          req.on('timeout', () => req.destroy(new Error('doh timeout')));
          req.on('error', rej2);
          req.end();
        });
        resolve(ips);
      } catch (e) {
        tryEndpoints(i + 1);
      }
    };
    tryEndpoints(0);
  });
}

async function dohViaGoogleJson(name) {
  for (const base of FALLBACK_DOHS) {
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=A`);
      const json = await res.json();
      const ips = (json.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
      if (ips.length) return ips;
    } catch { /* coba fallback berikutnya */ }
  }
  return [];
}

// pool HTTPS agent per-IP (keepAlive, maxSockets terbatas)
const agentPool = new Map();
function agentFor(ip) {
  if (agentPool.has(ip)) return agentPool.get(ip);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });
  agent.createConnection = (options, cb) => {
    const socket = tls.connect(
      { ...options, host: ip, servername: options.servername, rejectUnauthorized: true },
      () => cb(null, socket)
    );
    socket.on('error', (e) => cb(e));
    return socket;
  };
  agentPool.set(ip, agent);
  return agent;
}

/**
 * Fetch dari https://doujinku.org/<path> dengan bypass DNS hijack.
 * Auto redirect 1x. Returns { status, body: Buffer }.
 */
function fetchSite(path, { timeout = 25000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    dohResolve('doujinku.org').then(async (ips) => {
      if (!ips.length) return reject(new Error('Gagal resolve DNS doujinku.org'));
      const ip = ips[Math.floor(Math.random() * ips.length)];
      const req = https.request(
        {
          host: 'doujinku.org',
          servername: 'doujinku.org',
          port: 443,
          path,
          method: 'GET',
          agent: agentFor(ip),
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'id-ID,id;q=0.9,en;q=0.8',
            referer: 'https://doujinku.org/',
            ...headers,
          },
        },
        (res) => {
          // redirect internal 1x
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const loc = res.headers.location;
            if (!loc.startsWith('http')) {
              return resolve(fetchSite(loc, { timeout }));
            }
            return reject(new Error('Redirect keluar situs: ' + loc));
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: Buffer.concat(chunks) })
          );
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout: ' + path)));
      req.on('error', reject);
      req.end();
    }, reject);
  });
}

/**
 * Fetch gambar/aset dari CDN manapun (i*.wp.com, cdnasu.xyz, dst) dengan
 * bypass DNS via DoH + header referer doujinku.org. Returns { status, body, contentType }.
 */
function fetchAsset(urlStr, { timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      return reject(new Error('URL tidak valid: ' + urlStr));
    }
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);
    dohResolve(url.hostname).then((ips) => {
      if (!ips.length) return reject(new Error('Gagal resolve: ' + url.hostname));
      const ip = ips[Math.floor(Math.random() * ips.length)];
      const lib = url.protocol === 'https:' ? https : require('http');
      const req = lib.request(
        {
          host: url.hostname,
          port,
          path: url.pathname + url.search,
          method: 'GET',
          ...(url.protocol === 'https:'
            ? { servername: url.hostname, agent: agentFor(ip) }
            : {}),
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            referer: 'https://doujinku.org/',
            accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => {
            if (chunks.length > 4096) return res.destroy(new Error('gambar terlalu besar'));
            chunks.push(c);
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks),
              contentType: res.headers['content-type'],
            })
          );
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout asset')));
      req.on('error', reject);
      req.end();
    }, reject);
  });
}

module.exports = { dohResolve, fetchSite, fetchAsset, TARGET_HOST: 'doujinku.org' };
