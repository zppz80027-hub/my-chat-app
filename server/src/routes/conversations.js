// Conversation management + message listing/creation/read receipts/search.
// Exported as a factory taking the Socket.IO server so REST writes can also
// broadcast realtime events.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, isMember, getConversation } = require('../db');
const { requireAuth, ah } = require('../middleware/auth');
const { userSummary, messagePreview, getMessages, serializeMessage } = require('../lib/serializers');
const { createMessage, createSystemMessage, httpError } = require('../lib/messages');

module.exports = function conversationsRouter(io) {
  const router = express.Router();
  router.use(requireAuth);

  const emitToConversation = (conversationId, event, payload) =>
    io.to(`conversation:${conversationId}`).emit(event, payload);

  /** Serialize a conversation row for the list view. */
  function serializeConversation(conv, viewerId) {
    const members = db
      .prepare(
        `SELECT u.* FROM conversation_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.conversation_id = ?
         ORDER BY m.joined_at ASC`
      )
      .all(conv.id)
      .map(userSummary);

    const lastRow = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(conv.id);

    const unreadCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages m
         WHERE m.conversation_id = ?
           AND m.sender_id != ?
           AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM message_deletes d WHERE d.message_id = m.id AND d.user_id = ?)`
      )
      .get(conv.id, viewerId, viewerId, viewerId).n;

    const updatedAt = lastRow ? lastRow.created_at : conv.created_at;
    return {
      id: conv.id,
      type: conv.type,
      name: conv.name,
      members,
      lastMessage: messagePreview(lastRow),
      unreadCount,
      updatedAt: new Date(updatedAt).toISOString(),
    };
  }

  // GET /api/conversations -> all conversations of the user, newest activity first
  router.get(
    '/',
    ah(async (req, res) => {
      const convs = db
        .prepare(
          `SELECT c.* FROM conversations c
           JOIN conversation_members m ON m.conversation_id = c.id
           WHERE m.user_id = ?
           ORDER BY COALESCE(
             (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id),
             c.created_at
           ) DESC`
        )
        .all(req.user.id);
      res.json(convs.map((c) => serializeConversation(c, req.user.id)));
    })
  );

  // POST /api/conversations {type:'dm', memberId} | {type:'group', name, memberIds[]}
  router.post(
    '/',
    ah(async (req, res) => {
      // Sirf common "chat" group hai — naye DM ya group banane band hain.
      // Sab log common "chat" me hi baat karte hain.
      return res.status(403).json({ error: 'Sirf common "chat" me baat hoti hai' });

      if (type === 'dm') {
        if (typeof memberId !== 'string' || !memberId) {
          return res.status(400).json({ error: 'memberId is required for dm conversations' });
        }
        if (memberId === req.user.id) {
          return res.status(400).json({ error: 'Cannot start a dm with yourself' });
        }
        const other = db.prepare('SELECT id FROM users WHERE id = ?').get(memberId);
        if (!other) return res.status(404).json({ error: 'User not found' });

        // Return the existing dm with that member if one exists.
        const existing = db
          .prepare(
            `SELECT c.* FROM conversations c
             WHERE c.type = 'dm'
               AND EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = ?)
               AND EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = ?)
               AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2`
          )
          .get(req.user.id, memberId);
        if (existing) return res.json(serializeConversation(existing, req.user.id));

        const id = uuidv4();
        const tx = db.transaction(() => {
          db.prepare('INSERT INTO conversations (id, type, created_by, created_at) VALUES (?, ?, ?, ?)').run(
            id,
            'dm',
            req.user.id,
            now
          );
          const add = db.prepare(
            'INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)'
          );
          add.run(id, req.user.id, now);
          add.run(id, memberId, now);
        });
        tx();
        const conv = getConversation(id);
        const out = serializeConversation(conv, req.user.id);
        // Notify the other member so their conversation list updates live.
        io.to(`user:${memberId}`).emit('conversation:new', out);
        return res.status(201).json(out);
      }

      if (type === 'group') {
        const cleanName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
        if (!cleanName) return res.status(400).json({ error: 'Group name is required' });
        const ids = Array.isArray(memberIds) ? [...new Set(memberIds.filter((x) => typeof x === 'string'))] : [];
        const others = ids.filter((x) => x !== req.user.id);
        if (others.length > 0) {
          const found = db
            .prepare(`SELECT id FROM users WHERE id IN (${others.map(() => '?').join(',')})`)
            .all(...others)
            .map((r) => r.id);
          const missing = others.filter((x) => !found.includes(x));
          if (missing.length) return res.status(404).json({ error: `Users not found: ${missing.join(', ')}` });
        }
        const id = uuidv4();
        const tx = db.transaction(() => {
          db.prepare('INSERT INTO conversations (id, type, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
            id,
            'group',
            cleanName,
            req.user.id,
            now
          );
          const add = db.prepare(
            'INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)'
          );
          add.run(id, req.user.id, now);
          for (const uid of others) add.run(id, uid, now);
        });
        tx();
        createSystemMessage(id, `${req.user.display_name || req.user.username} created the group`);
        const conv = getConversation(id);
        const out = serializeConversation(conv, req.user.id);
        for (const uid of others) io.to(`user:${uid}`).emit('conversation:new', out);
        return res.status(201).json(out);
      }

      return res.status(400).json({ error: "type must be 'dm' or 'group'" });
    })
  );

  // Helper: load conversation + enforce membership.
  function mustBeMember(req, res) {
    const conv = getConversation(req.params.id);
    if (!conv) {
      const e = httpError(404, 'Conversation not found');
      throw e;
    }
    if (!isMember(conv.id, req.user.id)) throw httpError(403, 'Not a member of this conversation');
    return conv;
  }

  // GET /api/conversations/:id -> single conversation detail
  router.get(
    '/:id',
    ah(async (req, res) => {
      const conv = mustBeMember(req, res);
      res.json(serializeConversation(conv, req.user.id));
    })
  );

  // PATCH /api/conversations/:id {name} -> rename group (any member may rename)
  router.patch(
    '/:id',
    ah(async (req, res) => {
      const conv = mustBeMember(req, res);
      if (conv.type !== 'group') return res.status(400).json({ error: 'Only group conversations can be renamed' });
      const cleanName = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
      if (!cleanName) return res.status(400).json({ error: 'name is required' });
      db.prepare('UPDATE conversations SET name = ? WHERE id = ?').run(cleanName, conv.id);
      const out = serializeConversation(getConversation(conv.id), req.user.id);
      emitToConversation(conv.id, 'conversation:updated', out);
      res.json(out);
    })
  );

  // POST /api/conversations/:id/members {userId} -> add a member (groups only)
  router.post(
    '/:id/members',
    ah(async (req, res) => {
      const conv = mustBeMember(req, res);
      if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups support adding members' });
      const { userId } = req.body || {};
      const target = typeof userId === 'string' && db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (isMember(conv.id, userId)) return res.status(409).json({ error: 'User is already a member' });

      const now = Date.now();
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').run(
        conv.id,
        userId,
        now
      );
      const sys = createSystemMessage(conv.id, `${req.user.display_name || req.user.username} added ${target.display_name || target.username}`);
      // Let the new member join the realtime room and see the conversation.
      io.to(`user:${userId}`).emit('conversation:new', serializeConversation(getConversation(conv.id), userId));
      emitToConversation(conv.id, 'message:new', serializeMessage(sys, req.user.id));
      emitToConversation(conv.id, 'conversation:updated', serializeConversation(getConversation(conv.id), req.user.id));
      res.status(201).json(userSummary(target));
    })
  );

  // DELETE /api/conversations/:id/members/:userId -> remove a member (groups only)
  router.delete(
    '/:id/members/:userId',
    ah(async (req, res) => {
      const conv = mustBeMember(req, res);
      if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups support removing members' });
      const targetId = req.params.userId;
      if (!isMember(conv.id, targetId)) return res.status(404).json({ error: 'User is not a member' });

      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conv.id, targetId);
      const sys = createSystemMessage(
        conv.id,
        targetId === req.user.id
          ? `${req.user.display_name || req.user.username} left the group`
          : `${req.user.display_name || req.user.username} removed ${target.display_name || target.username}`
      );
      io.to(`user:${targetId}`).emit('conversation:removed', { conversationId: conv.id });
      emitToConversation(conv.id, 'message:new', serializeMessage(sys, req.user.id));
      emitToConversation(conv.id, 'conversation:updated', serializeConversation(getConversation(conv.id), req.user.id));
      res.json({ ok: true });
    })
  );

  // DELETE /api/conversations/:id -> the requester leaves; conversation is
  // deleted once it has no members left.
  router.delete(
    '/:id',
    ah(async (req, res) => {
      const conv = mustBeMember(req, res);
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conv.id, req.user.id);
      const remaining = db
        .prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?')
        .get(conv.id).n;
      if (remaining === 0) {
        db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
        emitToConversation(conv.id, 'conversation:deleted', { conversationId: conv.id });
      } else if (conv.type === 'group') {
        const sys = createSystemMessage(conv.id, `${req.user.display_name || req.user.username} left the group`);
        emitToConversation(conv.id, 'message:new', serializeMessage(sys, req.user.id));
        emitToConversation(conv.id, 'conversation:updated', serializeConversation(getConversation(conv.id), req.user.id));
      }
      res.json({ ok: true });
    })
  );

  // GET /api/conversations/:id/messages?limit=50&before=<messageId>
  router.get(
    '/:id/messages',
    ah(async (req, res) => {
      mustBeMember(req, res);
      const messages = getMessages(req.params.id, req.user.id, req.query.limit, req.query.before || null);
      res.json(messages);
    })
  );

  // POST /api/conversations/:id/messages {kind:'text'|'image'|'file', text?, replyTo?, fileId?}
  router.post(
    '/:id/messages',
    ah(async (req, res) => {
      const conv = mustBeMember(req, res);
      const { kind, text, replyTo, fileId } = req.body || {};
      const row = createMessage({
        conversationId: conv.id,
        senderId: req.user.id,
        kind,
        text,
        replyTo,
        fileId,
      });
      const out = serializeMessage(row, req.user.id);
      emitToConversation(conv.id, 'message:new', out);
      res.status(201).json(out);
    })
  );

  // POST /api/conversations/:id/read {messageId} -> mark everything up to
  // (and including) that message as read by the requester.
  router.post(
    '/:id/read',
    ah(async (req, res) => {
      const conv = mustBeMember(req, res);
      const { messageId } = req.body || {};
      const target = db
        .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
        .get(messageId, conv.id);
      if (!target) return res.status(404).json({ error: 'Message not found in this conversation' });

      const now = Date.now();
      const mark = db.prepare(
        `INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at)
         SELECT id, ?, ? FROM messages
         WHERE conversation_id = ? AND (created_at < ? OR (created_at = ? AND id <= ?))`
      );
      mark.run(req.user.id, now, conv.id, target.created_at, target.created_at, target.id);

      emitToConversation(conv.id, 'message:read', {
        conversationId: conv.id,
        userId: req.user.id,
        messageId: target.id,
      });
      res.json({ ok: true });
    })
  );

  // GET /api/conversations/:id/search?q= -> text messages matching %q% (limit 50)
  router.get(
    '/:id/search',
    ah(async (req, res) => {
      mustBeMember(req, res);
      const q = (req.query.q || '').toString().trim();
      if (!q) return res.json([]);
      const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      const rows = db
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ? AND kind = 'text' AND text LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC, id DESC
           LIMIT 50`
        )
        .all(req.params.id, like);
      res.json(rows.map((r) => serializeMessage(r, req.user.id)));
    })
  );

  return router;
};
