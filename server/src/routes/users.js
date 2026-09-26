// User discovery + public avatar serving.
const express = require('express');
const fs = require('fs');
const { db } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const { userSummary } = require('../lib/serializers');
const r2 = require('../lib/r2');

const router = express.Router();

// GET /api/users/search?q= -> [{id,username,displayName,avatarUrl,about,isOnline}]
// Excludes the requesting user, limited to 20 results.
router.get(
  '/search',
  requireAuth,
  ah(async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    // Escape LIKE wildcards so the query is treated literally.
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = db
      .prepare(
        `SELECT * FROM users
         WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
         ORDER BY username ASC
         LIMIT 20`
      )
      .all(req.user.id, like, like);
    res.json(rows.map(userSummary));
  })
);

// GET /api/users -> sab log (requester ko chhod ke). Bina search ke tap-to-chat ke liye.
router.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const rows = db
      .prepare('SELECT * FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user.id);
    res.json(rows.map(userSummary));
  })
);

// GET /api/users/:id/avatar -> the user's avatar image file (public, so it can
// be embedded directly in <img> tags without an auth header).
// R2-backed avatars ('r2:<key>'): 302 redirect to presigned URL.
router.get(
  '/:id/avatar',
  ah(async (req, res) => {
    const user = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.params.id);
    if (!user || !user.avatar_path) {
      return res.status(404).json({ error: 'Avatar not found' });
    }
    if (user.avatar_path.startsWith('r2:')) {
      if (!r2.enabled()) return res.status(404).json({ error: 'Avatar not available' });
      const url = await r2.presignedGetUrl(user.avatar_path.slice(3), { expiresIn: 3600 });
      return res.redirect(302, url);
    }
    if (!fs.existsSync(user.avatar_path)) {
      return res.status(404).json({ error: 'Avatar not found' });
    }
    res.sendFile(user.avatar_path);
  })
);

module.exports = router;
