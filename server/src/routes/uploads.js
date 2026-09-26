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

    db.prepare('UPDATE uploads SET status = ? WHERE id = ?').run('complete', uploadId);
    db.prepare('DELETE FROM upload_chunks WHERE upload_id = ?').run(uploadId);
    fs.rmSync(tmpDirFor(uploadId), { recursive: true, force: true });

    res.json({
      fileId: uploadId,
      url: `/api/files/${uploadId}`,
      filename: up.filename,
      mimeType: up.mime_type,
      size: up.size,
    });
  })
);

/**
 * Boot-time cleanup: drop incomplete uploads older than 24h (DB rows, chunk
 * tracking, and temp chunk directories).
 */
function cleanupStaleUploads() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = db.prepare("SELECT id FROM uploads WHERE status = 'pending' AND created_at < ?").all(cutoff);
  for (const { id } of stale) {
    fs.rmSync(tmpDirFor(id), { recursive: true, force: true });
    db.prepare('DELETE FROM uploads WHERE id = ?').run(id); // cascades upload_chunks
  }
  if (stale.length > 0) console.log(`[uploads] cleaned up ${stale.length} stale incomplete upload(s)`);
}

module.exports = { router, cleanupStaleUploads };
