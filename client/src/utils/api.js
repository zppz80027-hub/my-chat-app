// Minimal REST client for the chat backend. Token is kept in localStorage and
// attached as a Bearer header on every request.

const API_BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'ping.token';
// build-v2

export const apiBase = API_BASE;

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

// 401 (user delete / token invalid) pe khud-b-khud dobara judne ka handler.
// AuthContext ise set karta hai. Ek saath kayi request fail hon to ek hi
// recovery chalti hai (stampede nahi).
let onAuthFailure = null;
let recoveryPromise = null;

export function setAuthFailureHandler(fn) {
  onAuthFailure = fn;
}

/**
 * Build an authenticated URL for <img> / <a> tags. The backend accepts the
 * JWT as a `token` query param for these (it cannot read headers there).
 */
export function fileUrl(url) {
  if (!url) return '';
  const token = getToken();
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token || '')}`;
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}, _retried = false) {
  const token = getToken();
  const h = { ...headers };
  if (token) h['Authorization'] = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (body instanceof FormData) {
      payload = body;
    } else {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers: h, body: payload, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new Error('Network error — is the server running?');
    err.status = 0;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  let data = null;
  try {
    data = ct.includes('application/json') ? await res.json() : await res.text();
  } catch {
    data = null;
  }
  if (!res.ok) {
    // Session khatam (server update me user ud gaya) to ek baar recovery
    // karke request dobara bhejo — user ko error nahi dikhega.
    if (
      res.status === 401 &&
      !_retried &&
      !path.startsWith('/api/auth/') &&
      typeof onAuthFailure === 'function'
    ) {
      if (!recoveryPromise) {
        recoveryPromise = Promise.resolve()
          .then(() => onAuthFailure())
          .catch(() => false)
          .finally(() => {
            recoveryPromise = null;
          });
      }
      const recovered = await recoveryPromise;
      if (recovered) return request(path, { method, body, headers, signal }, true);
    }
    const msg =
      (data && (data.error || data.message)) || `Request failed (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

// ---- Adhoori uploads: resume support ----
// Phone par upload beech me toot jaye (app band, net gaya) to dobara wahi
// file chunne par upload shuru se nahi, toote hue hisse se aage badhegi.
const PENDING_UPLOADS_KEY = 'ping.pendingUploads';
const PENDING_TTL = 24 * 60 * 60 * 1000; // 24 ghante

function pendingKeyFor(file) {
  return [file.name, file.size, file.lastModified].join('|');
}
function readPendingUploads() {
  try {
    const all = JSON.parse(localStorage.getItem(PENDING_UPLOADS_KEY)) || [];
    return all.filter((p) => Date.now() - (p.ts || 0) < PENDING_TTL);
  } catch {
    return [];
  }
}
function writePendingUploads(all) {
  try {
    localStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(all));
  } catch {}
}
/** Isi file ki koi adhoori upload padi hai kya? */
export function findPendingUpload(file, conversationId) {
  const key = pendingKeyFor(file);
  return (
    readPendingUploads().find((p) => p.key === key && p.conversationId === conversationId) ||
    null
  );
}
function savePendingUpload(file, conversationId, uploadId) {
  const all = readPendingUploads().filter((p) => p.key !== pendingKeyFor(file));
  all.push({ key: pendingKeyFor(file), uploadId, conversationId, ts: Date.now() });
  writePendingUploads(all);
}
function clearPendingUpload(file) {
  writePendingUploads(readPendingUploads().filter((p) => p.key !== pendingKeyFor(file)));
}

// ---- Wake Lock: upload ke time screen on rahe taaki phone lock hokar upload na tode ----
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen');
  } catch {}
  return null;
}

/** Raw chunk upload used by the chunked uploader (octet-stream body). */
export async function uploadChunk(uploadId, index, blob, signal) {
  const token = getToken();
  // Per-request timeout: mobile net kabhi-kabhi hang ho jata hai aur fetch
  // bina timeout ke hamesha atka rehta hai (15% par rukne wali dikkat).
  const timeout = AbortSignal.timeout(120000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(
    `${API_BASE}/api/uploads/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
      signal: combined,
    }
  );
  if (!res.ok) {
    throw new Error(`Chunk ${index} upload failed (${res.status})`);
  }
}

/**
 * Chunked file upload with progress + cancel support.
 * Uses parallel chunk uploads (4 at a time) with per-chunk retries so the
 * connection stays saturated and flaky mobile networks don't kill the upload.
 * onProgress(0..1). Throws on abort (err.name === 'AbortError') or failure.
 */
const UPLOAD_CONCURRENCY = 4;
const CHUNK_MAX_RETRIES = 3;

async function uploadChunkWithRetry(uploadId, index, blob, signal) {
  for (let attempt = 1; attempt <= CHUNK_MAX_RETRIES; attempt++) {
    try {
      await uploadChunk(uploadId, index, blob, signal);
      return;
    } catch (err) {
      if (signal.aborted) throw err;
      if (attempt === CHUNK_MAX_RETRIES) throw err;
      // Brief backoff before retrying a failed chunk.
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
}

export async function uploadFile(file, conversationId, onProgress, externalSignal) {
  let uploadId = null;
  let chunkSize = 0;
  let skip = new Set();
  let resumed = false;

  // 1) Kya isi file ki adhoori upload padi hai? To wahi se aage badho.
  const pending = findPendingUpload(file, conversationId);
  if (pending) {
    try {
      const r = await api.post('/api/uploads/resume', { uploadId: pending.uploadId });
      if (r && r.uploadId && r.chunkSize) {
        uploadId = r.uploadId;
        chunkSize = r.chunkSize;
        skip = new Set(r.existingChunks || []);
        resumed = skip.size > 0;
      }
    } catch {
      // Purani upload server par nahi mili (naya deploy?) — nayi shuru karo.
      clearPendingUpload(file);
    }
  }
  // 2) Nayi upload shuru karo.
  if (!uploadId) {
    const init = await api.post('/api/uploads/init', {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      conversationId,
    });
    uploadId = init.uploadId;
    chunkSize = init.chunkSize;
    if (!uploadId || !chunkSize) throw new Error('Upload init failed');
    savePendingUpload(file, conversationId, uploadId);
  }

  // Upload ke dauran screen on rakho taaki phone lock hokar upload na tode.
  let wakeLock = await acquireWakeLock();
  const reLock = async () => {
    if (document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', reLock);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const total = Math.max(1, Math.ceil(file.size / chunkSize));
    let nextIndex = 0;
    let completed = 0;
    // Pehle se bheje hue chunks gin lo taaki progress sahi dikhe.
    for (const idx of skip) if (idx < total) completed += 1;
    onProgress && onProgress(completed / total);
    let failed = null;

    const worker = async () => {
      for (;;) {
        if (failed || controller.signal.aborted) return;
        const idx = nextIndex++;
        if (idx >= total) return;
        if (skip.has(idx)) continue;
        const chunk = file.slice(idx * chunkSize, (idx + 1) * chunkSize);
        try {
          await uploadChunkWithRetry(uploadId, idx, chunk, controller.signal);
        } catch (err) {
          failed = err;
          controller.abort();
          return;
        }
        completed += 1;
        onProgress && onProgress(completed / total);
      }
    };

    const workers = Math.min(UPLOAD_CONCURRENCY, total);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (failed) throw failed;
    if (controller.signal.aborted) {
      const e = new Error('Upload cancelled');
      e.name = 'AbortError';
      throw e;
    }
    const done = await api.post('/api/uploads/complete', { uploadId });
    clearPendingUpload(file);
    return { ...done, resumed };
  } finally {
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    document.removeEventListener('visibilitychange', reLock);
    try {
      await wakeLock?.release();
    } catch {}
    wakeLock = null;
  }
}

// ---- DIRECT-TO-R2 FAST UPLOAD ----
// Phone seedha Cloudflare ke edge (Mumbai) par file bhejta hai — slow US
// server beech me nahi aata, isliye kayi guna tez. Server sirf presigned
// URLs deta hai. Kuch bhi fail ho to purana relay uploadFile() par gir jao.

const R2_DIRECT_CONCURRENCY = 4;
const R2_PART_MAX_RETRIES = 3;
const R2_PART_URL_BATCH = 50;

/** Ek part R2 par PUT karo (retry + timeout ke saath). Returns the ETag. */
async function putPartWithRetry(url, blob, signal) {
  for (let attempt = 1; attempt <= R2_PART_MAX_RETRIES; attempt++) {
    try {
      const timeout = AbortSignal.timeout(180000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const res = await fetch(url, { method: 'PUT', body: blob, signal: combined });
      if (!res.ok) throw new Error(`Part upload failed (${res.status})`);
      const etag = res.headers.get('etag');
      if (!etag) throw new Error('Part upload missing ETag');
      return etag;
    } catch (err) {
      if (signal && signal.aborted) throw err;
      if (attempt === R2_PART_MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

/**
 * File seedha R2 par upload karo. Returns {fileId, url, filename, mimeType,
 * size} — bilkul uploadFile() jaisa shape, taaki Composer ko farak na pade.
 * R2 na ho / kuch fail ho to throw — caller relay par gir jata hai.
 */
export async function uploadFileDirectToR2(file, conversationId, onProgress, externalSignal) {
  const init = await api.post('/api/uploads/r2-init', {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    conversationId,
  });
  const { fileId, key, uploadId, partSize } = init || {};
  if (!fileId || !key || !uploadId || !partSize) {
    throw new Error('Direct upload init failed');
  }

  // Upload ke dauran screen on rakho (relay jaisa hi).
  let wakeLock = await acquireWakeLock();
  const reLock = async () => {
    if (document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', reLock);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }

  const abortMultipart = async () => {
    try {
      await api.post('/api/uploads/r2-abort', { fileId });
    } catch {
      /* best-effort */
    }
  };

  try {
    const total = Math.max(1, Math.ceil(file.size / partSize));

    // Saare parts ke presigned URLs pehle le lo (batch me) — har part par
    // round-trip nahi. URLs 1h valid hain.
    const partUrls = new Array(total);
    for (let i = 0; i < total; i += R2_PART_URL_BATCH) {
      const batch = [];
      for (let n = i + 1; n <= Math.min(i + R2_PART_URL_BATCH, total); n++) batch.push(n);
      const r = await api.post(
        '/api/uploads/r2-part-urls',
        { fileId, parts: batch },
        { signal: controller.signal }
      );
      for (const u of r.urls || []) partUrls[u.partNumber - 1] = u.url;
    }
    if (partUrls.some((u) => !u)) throw new Error('Part URLs missing');

    let nextPart = 1;
    let completed = 0;
    let failed = null;
    const etags = new Array(total);
    onProgress && onProgress(0);

    const worker = async () => {
      for (;;) {
        if (failed || controller.signal.aborted) return;
        const n = nextPart++;
        if (n > total) return;
        const blob = file.slice((n - 1) * partSize, n * partSize);
        try {
          const etag = await putPartWithRetry(partUrls[n - 1], blob, controller.signal);
          etags[n - 1] = { partNumber: n, etag };
        } catch (err) {
          failed = err;
          controller.abort();
          return;
        }
        completed += 1;
        onProgress && onProgress(completed / total);
      }
    };

    const workers = Math.min(R2_DIRECT_CONCURRENCY, total);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (failed) throw failed;
    if (controller.signal.aborted) {
      const e = new Error('Upload cancelled');
      e.name = 'AbortError';
      throw e;
    }

    const done = await api.post(
      '/api/uploads/r2-complete',
      { fileId, parts: etags },
      { signal: controller.signal }
    );
    if (!done || !done.fileId) throw new Error('Direct upload complete failed');
    return done;
  } catch (err) {
    // Cancel nahi hai to adhoora multipart R2 par saaf karo.
    if (err.name !== 'AbortError') await abortMultipart();
    throw err;
  } finally {
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    document.removeEventListener('visibilitychange', reLock);
    try {
      await wakeLock?.release();
    } catch {}
    wakeLock = null;
  }
}

// ---- DIRECT-TO-CLOUDINARY FAST UPLOAD ----
// Phone seedha Cloudinary ke CDN par file bhejta hai — slow US server beech
// me nahi aata. Bina credit card ke 25GB free, file permanent rehti hai.
// Unsigned preset hai, isliye koi secret client me nahi chahiye.

const CLOUDINARY_CLOUD_NAME = 'tzfbjslf';
const CLOUDINARY_UPLOAD_PRESET = 'cloude-upload';

// ---- Cloudinary resume: band hone par wahi se aage ----
// Har file ke liye uploadId + poore hue chunks localStorage me save rakho.
const CLOUDINARY_RESUME_TTL = 24 * 60 * 60 * 1000; // 24h
function cloudinaryResumeKey(file) {
  return `cloude-cloudinary-resume:${file.name}|${file.size}|${file.lastModified}`;
}
export function findCloudinaryResume(file) {
  try {
    const raw = localStorage.getItem(cloudinaryResumeKey(file));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.uploadId || Date.now() - data.ts > CLOUDINARY_RESUME_TTL) {
      localStorage.removeItem(cloudinaryResumeKey(file));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
function saveCloudinaryResume(file, uploadId, doneChunks, totalChunks) {
  try {
    localStorage.setItem(
      cloudinaryResumeKey(file),
      JSON.stringify({ uploadId, doneChunks, totalChunks, ts: Date.now() })
    );
  } catch {}
}
function clearCloudinaryResume(file) {
  try {
    localStorage.removeItem(cloudinaryResumeKey(file));
  } catch {}
}

/**
 * File seedha Cloudinary par upload karo (XMLHttpRequest taaki progress mile).
 * Badi file tukdon me jati hai; app band ho to dobara chunne par wahi se aage.
 * Returns {fileId, url, filename, mimeType, size} — bilkul uploadFile() jaisa
 * shape, taaki Composer ko farak na pade.
 */
export async function uploadFileToCloudinary(file, conversationId, onProgress, externalSignal) {
  const isVideo = (file.type || '').startsWith('video/');
  const isImage = (file.type || '').startsWith('image/');
  const resourceType = isVideo ? 'video' : isImage ? 'image' : 'raw';
  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  // Wake Lock — upload ke dauran screen on rakho.
  let wakeLock = await acquireWakeLock();
  const reLock = async () => {
    if (document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', reLock);

  // Badi file (>50MB) ko tukdon me bhejo — ek saath 1GB nahi jata.
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
  const useChunks = file.size > 50 * 1024 * 1024;
  const totalChunks = useChunks ? Math.ceil(file.size / CHUNK_SIZE) : 1;

  // Resume: pehle ki adhoori upload ka uploadId + progress nikalo.
  const saved = useChunks ? findCloudinaryResume(file) : null;
  const uploadId = saved?.uploadId || `cloude-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const startChunk = saved && saved.totalChunks === totalChunks ? saved.doneChunks || 0 : 0;
  if (startChunk > 0 && onProgress) onProgress(startChunk / totalChunks);

  /** Ek chunk bhejo (retry ke saath). */
  const sendChunk = (chunkBlob, start, end, isLast, onChunkProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (externalSignal) {
        if (externalSignal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        externalSignal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onChunkProgress) onChunkProgress(e.loaded / e.total);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch {
            reject(new Error('Cloudinary bad response'));
          }
        } else {
          let msg = `Cloudinary upload failed (${xhr.status})`;
          try {
            const d = JSON.parse(xhr.responseText);
            if (d.error?.message) msg = d.error.message;
          } catch {}
          reject(new Error(msg));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Cloudinary network error')));
      xhr.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      const fd = new FormData();
      fd.append('file', chunkBlob, file.name);
      fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      xhr.open('POST', uploadUrl);
      if (useChunks) {
        xhr.setRequestHeader('X-Unique-Upload-Id', uploadId);
        xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      }
      xhr.send(fd);
    });

  try {
    let result = null;
    for (let i = startChunk; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size) - 1;
      const chunk = useChunks ? file.slice(start, end + 1) : file;
      const isLast = i === totalChunks - 1;

      // Har chunk par 3 retry.
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          result = await sendChunk(chunk, start, end, isLast, (chunkPct) => {
            if (onProgress) {
              const overall = (i + chunkPct) / totalChunks;
              onProgress(overall);
            }
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (err.name === 'AbortError') throw err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (lastErr) throw lastErr;
      if (onProgress) onProgress((i + 1) / totalChunks);
      // Har chunk ke baad progress save — app band ho to wahi se aage.
      if (useChunks) saveCloudinaryResume(file, uploadId, i + 1, totalChunks);
    }

    if (!result?.secure_url) {
      throw new Error(result?.error?.message || 'Cloudinary upload failed');
    }

    // Ho gaya — resume data hatao.
    if (useChunks) clearCloudinaryResume(file);

    // Server par register karo taaki chat message ban sake.
    const reg = await api.post('/api/uploads/cloudinary', {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      cloudinaryUrl: result.secure_url,
      publicId: result.public_id,
      conversationId,
    });
    if (onProgress) onProgress(1);
    return reg;
  } finally {
    document.removeEventListener('visibilitychange', reLock);
    try {
      await wakeLock?.release();
    } catch {}
    wakeLock = null;
  }
}

/**
 * Smart upload: pehle direct-to-Cloudinary (tez + permanent), kuch bhi fail
 * ho to R2 phir purane relay uploadFile() par automatically gir jao. Cancel
 * (AbortError) par fallback nahi — user ne khud roka hai.
 */
export async function uploadFileSmart(file, conversationId, onProgress, externalSignal) {
  // User ki pasand (pehle jaisa): Cloudinary bilkul nahi — har file seedha
  // purane relay raste se jayegi (server par 20GB tak, resume ke saath).
  try {
    return await uploadFileDirectToR2(file, conversationId, onProgress, externalSignal);
  } catch (err) {
    if (err.name === 'AbortError' || (externalSignal && externalSignal.aborted)) throw err;
    return uploadFile(file, conversationId, onProgress, externalSignal);
  }
}
