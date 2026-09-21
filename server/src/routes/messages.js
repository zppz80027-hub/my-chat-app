// Message mutations: PATCH /api/messages/:id (edit), DELETE /api/messages/:id
// (delete for me / for everyone), POST /api/messages/:id/reactions (toggle).
// Exported as a factory so REST writes can also broadcast realtime events.
const express = require('express');
const { db, isMember } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const { serializeMessage } = require('../lib/serializers');
const { httpError } = require('../lib/messages');

module.exports = function messagesRouter(io) {
  const router = express.Router();
  router.use(requireAuth);

  const emitToConversation = (conversationId, event, payload) =>
    io.to(`conversation:${conversationId}`).emit(event, payload);

  /** Load a message and ensure the requester is a member of its conversation. */
  function mustAccess(req) {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!msg) throw httpError(404, 'Message not found');
    if (!isMember(msg.conversation_id, req.user.id)) throw httpError(403, 'Not a member of this conversation');
    return msg;
  }

  // PATCH /api/messages/:id {text} -> edit own message (sender only)
  router.patch(
    '/:id',
    ah(async (req, res) => {
      const msg = mustAccess(req);
      if (msg.sender_id !== req.user.id) throw httpError(403, 'Only the sender can edit this message');
      if (msg.deleted_for_everyone) throw httpError(400, 'Cannot edit a deleted message');
      if (msg.kind !== 'text') throw httpError(400, 'Only text messages can be edited');

      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) return res.status(400).json({ error: 'text is required' });
      if (text.length > 20000) return res.status(400).json({ error: 'Message text too long (max 20000 chars)' });

      const now = Date.now();
      db.prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?').run(text, now, msg.id);
      const out = serializeMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id), req.user.id);
      emitToConversation(msg.conversation_id, 'message:updated', out);
      res.json(out);
    })
  );

  // DELETE /api/messages/:id?scope=me|everyone
  // - scope=me (default): delete for the requester only (any member)
  // - scope=everyone: sender only, marks deleted for everyone
  router.delete(
    '/:id',
    ah(async (req, res) => {
      const msg = mustAccess(req);
      const scope = (req.query.scope || 'me').toString();

      if (scope === 'everyone') {
        if (msg.sender_id !== req.user.id) throw httpError(403, 'Only the sender can delete for everyone');
        db.prepare('UPDATE messages SET deleted_for_everyone = 1 WHERE id = ?').run(msg.id);
        const out = serializeMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id), req.user.id);
        emitToConversation(msg.conversation_id, 'message:deleted', {
          messageId: msg.id,
          conversationId: msg.conversation_id,
          scope: 'everyone',
          message: out,
        });
        return res.json({ ok: true, scope: 'everyone' });
      }

      if (scope !== 'me') return res.status(400).json({ error: "scope must be 'me' or 'everyone'" });
      db.prepare('INSERT OR IGNORE INTO message_deletes (message_id, user_id) VALUES (?, ?)').run(msg.id, req.user.id);
      // delete-for-me only affects the requester, so notify just them.
      io.to(`user:${req.user.id}`).emit('message:deleted', {
        messageId: msg.id,
        conversationId: msg.conversation_id,
        scope: 'me',
      });
      res.json({ ok: true, scope: 'me' });
    })
  );

  // POST /api/messages/:id/reactions {emoji} -> toggle a reaction
  router.post(
    '/:id/reactions',
    ah(async (req, res) => {
      const msg = mustAccess(req);
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';
      if (!emoji || [...emoji].length > 8) {
        return res.status(400).json({ error: 'A single emoji is required' });
      }

      const existing = db
        .prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
        .get(msg.id, req.user.id, emoji);
      let added;
      if (existing) {
        db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(
          msg.id,
          req.user.id,
          emoji
        );
        added = false;
      } else {
        db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(
          msg.id,
          req.user.id,
          emoji
        );
        added = true;
      }

      const payload = {
        messageId: msg.id,
        conversationId: msg.conversation_id,
        emoji,
        userId: req.user.id,
        username: req.user.username,
        added,
      };
      emitToConversation(msg.conversation_id, 'message:reaction', payload);
      res.json(payload);
    })
  );

  return router;
};
