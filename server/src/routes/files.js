// GET /api/files/:fileId -> download a completed upload.
// Requires auth + membership in the upload's conversation. Supports HTTP
// Range requests (206 Partial Content) for resumable downloads.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, isMember } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();
router.use(requireAuth);

const filesRoot = path.join(config.uploadDir, 'files');

function filePathFor(uploadId, filename) {
  // Filename comes from our own DB (already sanitized at upload time), and we
  // resolve inside filesRoot to guard against any path trickery.
  const p = path.resolve(filesRoot, `${uploadId}-${filename}`);
  if (!p.startsWith(path.resolve(filesRoot) + path.sep)) return null;
  return p;
}

router.get(
  '/:fileId',
  ah(async (req, res) => {
    const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.fileId);
    if (!up || up.status !== 'complete') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (!up.conversation_id || !isMember(up.conversation_id, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }
    const filePath = filePathFor(up.id, up.filename);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File data missing on server' });
    }

    const stat = fs.statSync(filePath);
    const total = stat.size;
    res.setHeader('Content-Type', up.mime_type || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    // RFC 5987 encoding for non-ASCII filenames.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${up.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(up.filename)}`
    );

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      let start = m[1] === '' ? total - Number(m[2]) : Number(m[1]);
      let end = m[2] === '' ? total - 1 : Number(m[2]);
      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= total || start > end) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', String(total));
      fs.createReadStream(filePath).pipe(res);
    }
  })
);

module.exports = router;
