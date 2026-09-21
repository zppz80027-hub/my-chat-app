// Contact list management: GET/POST /api/contacts, DELETE /api/contacts/:userId
const express = require('express');
const { db } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const { userSummary } = require('../lib/serializers');

const router = express.Router();
router.use(requireAuth);

// GET /api/contacts -> contacts of the requesting user
router.get(
  '/',
  ah(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.* FROM contacts c
         JOIN users u ON u.id = c.contact_id
         WHERE c.user_id = ?
         ORDER BY u.display_name ASC`
      )
      .all(req.user.id);
    res.json(rows.map(userSummary));
  })
);

// POST /api/contacts {userId} -> add a contact
router.post(
  '/',
  ah(async (req, res) => {
    const { userId } = req.body || {};
    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot add yourself as a contact' });
    }
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)').run(
      req.user.id,
      userId,
      Date.now()
    );
    res.status(201).json(userSummary(target));
  })
);

// DELETE /api/contacts/:userId -> remove a contact
router.delete(
  '/:userId',
  ah(async (req, res) => {
    const info = db
      .prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?')
      .run(req.user.id, req.params.userId);
    if (info.changes === 0) return res.status(404).json({ error: 'Contact not found' });
    res.json({ ok: true });
  })
);

module.exports = router;
