// Profile: GET/PATCH /api/profile, POST /api/profile/avatar (multer upload).
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const { userSummary, avatarUrlFor } = require('../lib/serializers');
const config = require('../config');

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
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Avatar must be at most 5MB' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: "Missing 'avatar' file field" });

    // Remove any previous avatar file with a different extension.
    const prev = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id)?.avatar_path;
    if (prev && prev !== req.file.path && fs.existsSync(prev)) {
      try {
        fs.unlinkSync(prev);
      } catch (_) {
        /* best effort */
      }
    }
    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(req.file.path, req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ avatarUrl: avatarUrlFor(user), user: userSummary(user) });
  });
});

module.exports = router;
