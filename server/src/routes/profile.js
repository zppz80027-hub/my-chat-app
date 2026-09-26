// Profile: GET/PATCH /api/profile, POST /api/profile/avatar (multer upload).
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const { userSummary, avatarUrlFor } = require('../lib/serializers');
const config = require('../config');
const r2 = require('../lib/r2');

const router = express.Router();
router.use(requireAuth);

const avatarsDir = path.join(config.uploadDir, 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });

// Keep the avatar filename tied to the user id so replacing it is trivial.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${req.user.id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxAvatarSize },
  fileFilter: (_req, file, cb) => {
    // Accept images only: check the mimetype and the extension.
    const okMime = /^image\//.test(file.mimetype || '');
    const okExt = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.originalname || '');
    if (okMime && okExt) return cb(null, true);
    cb(new Error('Only image files are allowed as avatars'));
  },
});

// GET /api/profile -> own profile
router.get(
  '/',
  ah(async (req, res) => {
    res.json(userSummary(req.user));
  })
);

// PATCH /api/profile {displayName, about}
router.patch(
  '/',
  ah(async (req, res) => {
    const { displayName, about } = req.body || {};
    const updates = [];
    const params = [];
    if (displayName !== undefined) {
      // Sabka naam "chat" hi rehta hai — badla nahi ja sakta.
      updates.push('display_name = ?');
      params.push('chat');
    }
    if (about !== undefined) {
      updates.push('about = ?');
      params.push(String(about).slice(0, 200));
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json(userSummary(user));
  })
);

// POST /api/profile/avatar (multipart field 'avatar', max 5MB, images only)
router.post('/avatar', (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    try {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Avatar must be at most 5MB' : err.message;
        return res.status(400).json({ error: msg });
      }
      if (!req.file) return res.status(400).json({ error: "Missing 'avatar' file field" });

      const ext = path.extname(req.file.filename).toLowerCase() || '.png';
      let avatarPath = req.file.path;

      // R2 configured ho to avatar R2 par rakho (deploy-proof). Fail ho to local.
      if (r2.enabled()) {
        try {
          const key = `avatars/${req.user.id}${ext}`;
          await r2.uploadFile(key, req.file.path, req.file.mimetype);
          fs.unlinkSync(req.file.path);
          avatarPath = 'r2:' + key;
        } catch (e) {
          console.error('[avatar] R2 upload failed, keeping local file:', e.message);
        }
      }

      // Purana avatar hatao — local file ho ya R2 key ('r2:...' prefix).
      const prev = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id)?.avatar_path;
      if (prev && prev !== avatarPath) {
        if (prev.startsWith('r2:')) {
          try {
            await r2.deleteKey(prev.slice(3));
          } catch (_) {
            /* best effort */
          }
        } else if (fs.existsSync(prev)) {
          try {
            fs.unlinkSync(prev);
          } catch (_) {
            /* best effort */
          }
        }
      }
      db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(avatarPath, req.user.id);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      res.json({ avatarUrl: avatarUrlFor(user), user: userSummary(user) });
    } catch (e) {
      console.error('[avatar] unexpected error:', e.message);
      res.status(500).json({ error: 'Avatar upload failed' });
    }
  });
});

module.exports = router;
