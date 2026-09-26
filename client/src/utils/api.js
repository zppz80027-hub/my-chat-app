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

/** Raw chunk upload used by the chunked uploader (octet-stream body). */
export async function uploadChunk(uploadId, index, blob, signal) {
  const token = getToken();
  const res = await fetch(
    `${API_BASE}/api/uploads/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
      signal,
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
  const init = await api.post('/api/uploads/init', {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    conversationId,
  });
  const { uploadId, chunkSize } = init;
  if (!uploadId || !chunkSize) throw new Error('Upload init failed');

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
    let failed = null;

    const worker = async () => {
      for (;;) {
        if (failed || controller.signal.aborted) return;
        const i = nextIndex++;
        if (i >= total) return;
        const chunk = file.slice(i * chunkSize, (i + 1) * chunkSize);
        try {
          await uploadChunkWithRetry(uploadId, i, chunk, controller.signal);
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
    const done = await api.post('/api/uploads/complete', { uploadId });
    return done; // { fileId, url, filename, mimeType, size }
  } finally {
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}
