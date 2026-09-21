// User discovery + public avatar serving.
const express = require('express');
const fs = require('fs');
const { db } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const { userSummary } = require('../lib/serializers');

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

// GET /api/users/:id/avatar -> the user's avatar image file (public, so it can
// be embedded directly in <img> tags without an auth header).
router.get('/:id/avatar', (req, res) => {
  const user = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.params.id);
  if (!user || !user.avatar_path || !fs.existsSync(user.avatar_path)) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  res.sendFile(user.avatar_path);
});

module.exports = router;
