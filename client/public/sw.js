/* Ping Chat service worker — makes the app installable and resilient offline. */
const CACHE = 'ping-chat-v2';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add('/').catch(() => {})).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
const isApi = (url) => url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io');

// ---------------------------------------------------------------------------
// MOVIE DIRECT STREAMING (Render bandwidth saver).
//
// Badi movie ke bytes Render server se NAHI jate — warna free tier ki
// 5GB/month outbound limit khatam ho ke service suspend ho jati hai.
// Movie ke 80MB tukde Cloudinary par hain (CORS + Range supported). Ye SW
// /api/files/<movieId> ko pakad ke browser ki Range request ko tukdon me
// baant deta hai aur seedha Cloudinary se laake jod deta hai. <video> ko
// lagta hai ek hi file aa rahi hai — server ka ek byte kharch nahi hota.
// ---------------------------------------------------------------------------
const MOVIE_FILE_RE = /^\/api\/files\/([^/]+)$/;
const movieManifestCache = new Map(); // fileId -> manifest | null (null = direct movie nahi)

/** "Range: bytes=A-B" parse karo. Returns {start, end} (inclusive) ya null. */
function parseRangeHeader(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {
    // Suffix range: aakhri N bytes.
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = n >= total ? 0 : total - n;
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? total - 1 : Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start >= total || start > end) return null;
    if (end >= total) end = total - 1;
  }
  return { start, end };
}

async function serveMovie(request, fileId, url) {
  let manifest = movieManifestCache.get(fileId);
  if (manifest === undefined) {
    try {
      // ?token= query aage badhao — <video> header nahi bhej sakta, isliye
      // backend token query param se leta hai.
      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/manifest${url.search}`);
      if (res.ok) {
        const j = await res.json();
        manifest =
          j && j.storage === 'cloudinary-parts' && Array.isArray(j.urls) && j.urls.length > 0 ? j : null;
      } else {
        manifest = null;
      }
    } catch {
      manifest = null;
    }
    movieManifestCache.set(fileId, manifest);
  }
  // Direct movie nahi (chhoti file / purana upload) — server jaise pehle
  // deta tha waise hi aane do.
  if (!manifest) return fetch(request);

  const total = manifest.totalSize;
  const partSize = manifest.partSize;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(partSize) || partSize <= 0) {
    return fetch(request);
  }

  const rangeHeader = request.headers.get('range');
  let start = 0;
  let end = total - 1;
  let partial = false;
  if (rangeHeader) {
    const r = parseRangeHeader(rangeHeader, total);
    if (!r) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    start = r.start;
    end = r.end;
    partial = true;
  }

  const firstPart = Math.floor(start / partSize);
  const lastPart = Math.floor(end / partSize);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let p = firstPart; p <= lastPart; p++) {
          const pStart = p * partSize;
          const pLen = Math.min(partSize, total - pStart);
          const s = Math.max(start - pStart, 0);
          const e = Math.min(end - pStart, pLen - 1);
          const res = await fetch(manifest.urls[p], { headers: { Range: `bytes=${s}-${e}` } });
          if (res.status !== 206 && res.status !== 200) throw new Error(`part ${p} HTTP ${res.status}`);
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const headers = {
    'Content-Type': manifest.mimeType || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'private, max-age=3600',
  };
  if (partial) {
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    return new Response(stream, { status: 206, headers });
  }
  return new Response(stream, { status: 200, headers });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Movie file: seedha Cloudinary se stream karo (Render bandwidth = 0).
  const movieMatch = MOVIE_FILE_RE.exec(url.pathname);
  if (movieMatch) {
    event.respondWith(serveMovie(request, movieMatch[1], url));
    return;
  }
  if (isApi(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }
  const dest = request.destination;
  const isStatic = dest === 'script' || dest === 'style' || dest === 'image' || dest === 'font' || /\.(js|css|png|jpg|jpeg|svg|webp|woff2?|webmanifest)$/i.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
