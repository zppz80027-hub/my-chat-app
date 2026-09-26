// Resumable chunked uploads.
//   POST /api/uploads/init     {filename, mimeType, size, conversationId}
//   POST /api/uploads/chunk?uploadId=&index=   (raw application/octet-stream body)
//   POST /api/uploads/complete {uploadId}
//
// Chunks are received as raw binary (express.raw, 6MB limit) and stored as
// individual files under <UPLOAD_DIR>/tmp/<uploadId>/<index>.chunk so uploads
// can resume: init reports which chunk indexes are already on disk.
// On complete, chunks are concatenated in order into
// <UPLOAD_DIR>/files/<uploadId>-<safeFilename>.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db, isMember } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const config = require('../config');
const r2 = require('../lib/r2');

const router = express.Router();
router.use(requireAuth);

const tmpRoot = path.join(config.uploadDir, 'tmp');
const filesRoot = path.join(config.uploadDir, 'files');
fs.mkdirSync(tmpRoot, { recursive: true });
fs.mkdirSync(filesRoot, { recursive: true });

/** Strip path components and unsafe characters from a client filename. */
function safeFilename(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-()[\] ]+/g, '_');
  return (base || 'file').slice(0, 120);
}

function tmpDirFor(uploadId) {
  return path.join(tmpRoot, uploadId);
}

/** Indexes of chunks already received for this upload (for resume). */
function existingChunks(uploadId) {
  const dir = tmpDirFor(uploadId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => /^(\d+)\.chunk$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

function pendingUploadOr404(uploadId, userId) {
  const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
  if (!up) {
    const e = new Error('Upload not found');
    e.status = 404;
    throw e;
  }
  if (up.status !== 'pending') {
    const e = new Error('Upload is already complete');
    e.status = 400;
    throw e;
  }
  if (up.uploader_id !== userId) {
    const e = new Error('Upload belongs to another user');
    e.status = 403;
    throw e;
  }
  return up;
}

// POST /api/uploads/init {filename, mimeType, size, conversationId}
router.post(
  '/init',
  ah(async (req, res) => {
    const { filename, mimeType, size, conversationId } = req.body || {};
    if (typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ error: 'filename is required' });
    }
    const totalSize = Number(size);
    if (!Number.isInteger(totalSize) || totalSize <= 0) {
      return res.status(400).json({ error: 'size must be a positive integer (bytes)' });
    }
    if (totalSize > config.maxFileSize) {
      return res.status(413).json({ error: `File too large (max ${config.maxFileSize} bytes)` });
    }
    if (typeof conversationId !== 'string' || !isMember(conversationId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const uploadId = uuidv4();
    db.prepare(
      `INSERT INTO uploads (id, filename, mime_type, size, conversation_id, uploader_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      uploadId,
      safeFilename(filename),
      typeof mimeType === 'string' && mimeType ? mimeType.slice(0, 120) : 'application/octet-stream',
      totalSize,
      conversationId,
      req.user.id,
      Date.now()
    );
    fs.mkdirSync(tmpDirFor(uploadId), { recursive: true });

    res.status(201).json({ uploadId, chunkSize: config.chunkSize, existingChunks: [] });
  })
);

// POST /api/uploads/resume {uploadId} — adhoori upload wahi se aage badhao.
// Sirf pending + isi user ki upload par chunk state wapas deta hai.
router.post(
  '/resume',
  ah(async (req, res) => {
    const { uploadId } = req.body || {};
    if (typeof uploadId !== 'string' || !uploadId) {
      return res.status(400).json({ error: 'uploadId is required' });
    }
    let up;
    try {
      up = pendingUploadOr404(uploadId, req.user.id);
    } catch (e) {
      return res.status(e.status || 404).json({ error: e.message || 'Upload not found' });
    }
    res.json({
      uploadId,
      chunkSize: config.chunkSize,
      existingChunks: existingChunks(uploadId),
      filename: up.filename,
      size: up.size,
      conversationId: up.conversation_id,
    });
  })
);

// POST /api/uploads/chunk?uploadId=&index=  with raw binary body
router.post(
  '/chunk',
  express.raw({ type: 'application/octet-stream', limit: '6mb' }),
  ah(async (req, res) => {
    const { uploadId, index } = req.query;
    const chunkIndex = Number(index);
    if (typeof uploadId !== 'string' || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ error: 'uploadId and numeric index query params are required' });
    }
    const up = pendingUploadOr404(uploadId, req.user.id);

    const expectedChunks = Math.ceil(up.size / config.chunkSize);
    if (chunkIndex >= expectedChunks) {
      return res.status(400).json({ error: `index out of range (expected 0..${expectedChunks - 1})` });
    }
    const expectedLen =
      chunkIndex === expectedChunks - 1 ? up.size - chunkIndex * config.chunkSize : config.chunkSize;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'Empty chunk body (send application/octet-stream)' });
    }
    if (body.length > expectedLen) {
      return res.status(400).json({ error: `Chunk too large (max ${expectedLen} bytes for index ${chunkIndex})` });
    }

    const chunkPath = path.join(tmpDirFor(uploadId), `${chunkIndex}.chunk`);
    fs.writeFileSync(chunkPath, body);
    db.prepare('INSERT OR REPLACE INTO upload_chunks (upload_id, chunk_index, received_at) VALUES (?, ?, ?)').run(
      uploadId,
      chunkIndex,
      Date.now()
    );
    res.json({ index: chunkIndex, received: true });
  })
);

// POST /api/uploads/complete {uploadId}
router.post(
  '/complete',
  ah(async (req, res) => {
    const { uploadId } = req.body || {};
    if (typeof uploadId !== 'string') return res.status(400).json({ error: 'uploadId is required' });
    const up = pendingUploadOr404(uploadId, req.user.id);

    const expectedChunks = Math.ceil(up.size / config.chunkSize);
    const got = existingChunks(uploadId);
    const missing = [];
    for (let i = 0; i < expectedChunks; i++) if (!got.includes(i)) missing.push(i);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'Missing chunks', missing });
    }
    // Verify the total byte count matches the declared size.
    let total = 0;
    for (const i of got) total += fs.statSync(path.join(tmpDirFor(uploadId), `${i}.chunk`)).size;
    if (total !== up.size) {
      return res.status(400).json({ error: `Size mismatch: received ${total} bytes, expected ${up.size}` });
    }

    // Concatenate chunks in order into the final file.
    const destName = `${uploadId}-${safeFilename(up.filename)}`;
    const destPath = path.join(filesRoot, destName);
    const out = fs.createWriteStream(destPath);
    for (let i = 0; i < expectedChunks; i++) {
      const data = fs.readFileSync(path.join(tmpDirFor(uploadId), `${i}.chunk`));
      out.write(data);
    }
    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });

    // R2 configured ho to assembled file ko R2 par stream karo aur local copy
    // hata do (deploy-proof). Fail ho to local fallback — upload kabhi na toote.
    let storage = 'local';
    let r2Key = null;
    if (r2.enabled()) {
      try {
        r2Key = `files/${destName}`;
        await r2.uploadFile(r2Key, destPath, up.mime_type);
        storage = 'r2';
        fs.unlinkSync(destPath);
        console.log(`[uploads] ${uploadId} -> R2 (${r2Key}, ${up.size} bytes)`);
      } catch (e) {
        console.error('[uploads] R2 upload failed, keeping local file:', e.message);
        r2Key = null;
      }
    }

    db.prepare('UPDATE uploads SET status = ?, storage = ?, r2_key = ? WHERE id = ?').run(
      'complete',
      storage,
      r2Key,
      uploadId
    );
    db.prepare('DELETE FROM upload_chunks WHERE upload_id = ?').run(uploadId);
    fs.rmSync(tmpDirFor(uploadId), { recursive: true, force: true });

    res.json({
      fileId: uploadId,
      url: `/api/files/${uploadId}`,
      filename: up.filename,
      mimeType: up.mime_type,
      size: up.size,
    });

    // Badi movie (>80MB, local disk par): tukdon me tod ke Cloudinary par
    // permanent archive karo — background me, jawab ka wait nahi.
    if (storage === 'local' && up.size >= 80 * 1024 * 1024) {
      try {
        require('../movieArchive').archiveMovieInBackground(uploadId);
      } catch (e) {
        console.log('[uploads] archive trigger fail:', e.message);
      }
    }
  })
);

// ---------------------------------------------------------------------------
// CLOUDINARY DIRECT UPLOAD (phone -> Cloudinary CDN, server bypass).
// Client uploads directly to Cloudinary (unsigned preset), then registers
// the result here. No card needed, 25GB free, file is permanent.
//   POST /api/uploads/cloudinary {filename, mimeType, size, cloudinaryUrl, publicId, conversationId}
router.post(
  '/cloudinary',
  ah(async (req, res) => {
    const { filename, mimeType, size, cloudinaryUrl, publicId, conversationId } = req.body || {};
    if (typeof filename !== 'string' || !filename) {
      return res.status(400).json({ error: 'filename is required' });
    }
    if (typeof cloudinaryUrl !== 'string' || !cloudinaryUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'valid cloudinaryUrl is required' });
    }
    if (typeof conversationId !== 'string' || !isMember(conversationId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }
    const totalSize = Number(size);
    if (!Number.isFinite(totalSize) || totalSize <= 0 || totalSize > 10 * 1024 ** 3) {
      return res.status(400).json({ error: 'Invalid size' });
    }

    const fileId = uuidv4();
    db.prepare(
      `INSERT INTO uploads (id, filename, mime_type, size, conversation_id, uploader_id, status, storage, cloudinary_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'complete', 'cloudinary', ?, ?)`
    ).run(
      fileId,
      safeFilename(filename),
      typeof mimeType === 'string' && mimeType ? mimeType.slice(0, 120) : 'application/octet-stream',
      Math.floor(totalSize),
      conversationId,
      req.user.id,
      cloudinaryUrl.slice(0, 500),
      Date.now()
    );
    console.log(`[uploads] cloudinary ${fileId} -> ${cloudinaryUrl.slice(0, 80)}... (${totalSize} bytes)`);

    res.status(201).json({
      fileId,
      url: `/api/files/${fileId}`,
      filename: safeFilename(filename),
      mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'application/octet-stream',
      size: Math.floor(totalSize),
    });
  })
);

// ---------------------------------------------------------------------------
// DIRECT-TO-R2 FAST UPLOAD (phone -> Cloudflare edge, US server bypass).
//   POST /api/uploads/r2-init      {filename, mimeType, size, conversationId}
//   POST /api/uploads/r2-part-urls {fileId, parts:[1,2,...]}
//   POST /api/uploads/r2-complete  {fileId, parts:[{partNumber, etag}]}
//   POST /api/uploads/r2-abort     {fileId}
// Client seedha R2 par parts PUT karta hai (Mumbai edge = tez). Server sirf
// presigned URLs deta hai aur ant me multipart complete karta hai. R2
// configured na ho to 503 — client tab purane relay path par gir jata hai.
// ---------------------------------------------------------------------------
const R2_DIRECT_PART_SIZE = 8 * 1024 * 1024; // 8 MiB per part (R2 min 5 MiB)
const R2_PART_URL_BATCH = 50; // ek call me zyada se zyada itne part URLs

function directUploadOr404(fileId, userId) {
  const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(fileId);
  if (!up || up.storage !== 'r2-direct') {
    const e = new Error('Direct upload not found');
    e.status = 404;
    throw e;
  }
  if (up.status !== 'pending') {
    const e = new Error('Upload is already complete');
    e.status = 400;
    throw e;
  }
  if (up.uploader_id !== userId) {
    const e = new Error('Upload belongs to another user');
    e.status = 403;
    throw e;
  }
  if (!up.r2_key || !up.r2_upload_id) {
    const e = new Error('Direct upload is missing R2 state');
    e.status = 410;
    throw e;
  }
  return up;
}

// POST /api/uploads/r2-init {filename, mimeType, size, conversationId}
router.post(
  '/r2-init',
  ah(async (req, res) => {
    if (!r2.enabled()) {
      return res.status(503).json({ error: 'Direct upload not available' });
    }
    const { filename, mimeType, size, conversationId } = req.body || {};
    if (typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ error: 'filename is required' });
    }
    const totalSize = Number(size);
    if (!Number.isInteger(totalSize) || totalSize <= 0) {
      return res.status(400).json({ error: 'size must be a positive integer (bytes)' });
    }
    if (totalSize > config.maxFileSize) {
      return res.status(413).json({ error: `File too large (max ${config.maxFileSize} bytes)` });
    }
    if (typeof conversationId !== 'string' || !isMember(conversationId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const fileId = uuidv4();
    const key = `files/${fileId}-${safeFilename(filename)}`;
    const ctype =
      typeof mimeType === 'string' && mimeType ? mimeType.slice(0, 120) : 'application/octet-stream';
    let mpUploadId;
    try {
      mpUploadId = await r2.createMultipart(key, ctype);
    } catch (e) {
      console.error('[uploads] r2-init multipart create failed:', e.message);
      return res.status(502).json({ error: 'Could not start direct upload' });
    }
    db.prepare(
      `INSERT INTO uploads (id, filename, mime_type, size, conversation_id, uploader_id,
                            status, storage, r2_key, r2_upload_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'r2-direct', ?, ?, ?)`
    ).run(fileId, safeFilename(filename), ctype, totalSize, conversationId, req.user.id, key, mpUploadId, Date.now());

    res.status(201).json({ fileId, key, uploadId: mpUploadId, partSize: R2_DIRECT_PART_SIZE });
  })
);

// POST /api/uploads/r2-part-urls {fileId, parts:[1,2,...]} — presigned PUT URLs.
router.post(
  '/r2-part-urls',
  ah(async (req, res) => {
    if (!r2.enabled()) {
      return res.status(503).json({ error: 'Direct upload not available' });
    }
    const { fileId, parts } = req.body || {};
    let up;
    try {
      up = directUploadOr404(fileId, req.user.id);
    } catch (e) {
      return res.status(e.status || 404).json({ error: e.message || 'Direct upload not found' });
    }
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > R2_PART_URL_BATCH) {
      return res.status(400).json({ error: `parts must be a non-empty array (max ${R2_PART_URL_BATCH})` });
    }
    const maxParts = Math.ceil(up.size / R2_DIRECT_PART_SIZE);
    for (const n of parts) {
      if (!Number.isInteger(n) || n < 1 || n > maxParts) {
        return res.status(400).json({ error: `Invalid part number ${n} (1..${maxParts})` });
      }
    }
    try {
      const urls = [];
      for (const n of parts) {
        urls.push({ partNumber: n, url: await r2.presignedPartUrl(up.r2_key, up.r2_upload_id, n) });
      }
      res.json({ urls });
    } catch (e) {
      console.error('[uploads] r2-part-urls failed:', e.message);
      res.status(502).json({ error: 'Could not create upload URLs' });
    }
  })
);

// POST /api/uploads/r2-complete {fileId, parts:[{partNumber, etag}]}
router.post(
  '/r2-complete',
  ah(async (req, res) => {
    if (!r2.enabled()) {
      return res.status(503).json({ error: 'Direct upload not available' });
    }
    const { fileId, parts } = req.body || {};
    let up;
    try {
      up = directUploadOr404(fileId, req.user.id);
    } catch (e) {
      return res.status(e.status || 404).json({ error: e.message || 'Direct upload not found' });
    }
    const expected = Math.ceil(up.size / R2_DIRECT_PART_SIZE);
    if (!Array.isArray(parts) || parts.length !== expected) {
      return res.status(400).json({ error: `parts must have exactly ${expected} entries` });
    }
    const sorted = [...parts]
      .map((p) => ({ PartNumber: Number(p.partNumber), ETag: String(p.etag || '') }))
      .sort((a, b) => a.PartNumber - b.PartNumber);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].PartNumber !== i + 1 || !sorted[i].ETag) {
        return res.status(400).json({ error: 'parts must cover 1..N with ETags' });
      }
    }
    try {
      await r2.completeMultipart(up.r2_key, up.r2_upload_id, sorted);
    } catch (e) {
      console.error('[uploads] r2-complete failed:', e.message);
      return res.status(502).json({ error: 'Could not finish direct upload' });
    }
    db.prepare("UPDATE uploads SET status = 'complete', storage = 'r2' WHERE id = ?").run(fileId);
    console.log(`[uploads] direct ${fileId} -> R2 (${up.r2_key}, ${up.size} bytes)`);
    res.json({
      fileId,
      url: `/api/files/${fileId}`,
      filename: up.filename,
      mimeType: up.mime_type,
      size: up.size,
    });
  })
);

// POST /api/uploads/r2-abort {fileId} — adhoora direct upload hatao (best-effort).
router.post(
  '/r2-abort',
  ah(async (req, res) => {
    const { fileId } = req.body || {};
    const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(fileId);
    if (up && up.uploader_id === req.user.id && up.storage === 'r2-direct' && up.status === 'pending') {
      await r2.abortMultipart(up.r2_key, up.r2_upload_id);
      db.prepare('DELETE FROM uploads WHERE id = ?').run(fileId);
    }
    res.json({ ok: true });
  })
);

/**
 * Boot-time cleanup: drop incomplete uploads older than 24h (DB rows, chunk
 * tracking, and temp chunk directories).
 */
function cleanupStaleUploads() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = db
    .prepare("SELECT id, storage, r2_key, r2_upload_id FROM uploads WHERE status = 'pending' AND created_at < ?")
    .all(cutoff);
  for (const { id, storage, r2_key, r2_upload_id } of stale) {
    fs.rmSync(tmpDirFor(id), { recursive: true, force: true });
    // Adhoore direct multipart uploads R2 par bhi hatao (storage ka kharcha).
    if (storage === 'r2-direct' && r2_key && r2_upload_id) {
      r2.abortMultipart(r2_key, r2_upload_id).catch(() => {});
    }
    db.prepare('DELETE FROM uploads WHERE id = ?').run(id); // cascades upload_chunks
  }
  if (stale.length > 0) console.log(`[uploads] cleaned up ${stale.length} stale incomplete upload(s)`);
}

module.exports = { router, cleanupStaleUploads };
