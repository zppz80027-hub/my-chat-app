// Socket.IO realtime layer.
// - Auth via socket.handshake.auth.token (JWT).
// - On connect: mark online, join personal room user:<id> and
//   conversation:<id> rooms, broadcast presence to contacts + members.
// - Events: message:send, typing:start/stop, message:delivered,
//   conversation:join, WebRTC signaling passthrough (call:*).
// - On disconnect: mark offline when no sockets remain, broadcast presence.
const { Server } = require('socket.io');
const { db, isMember, ensureCommonChatMembership } = require('./db');
const { verifyToken } = require('./middleware/auth');
const { markOnline, markOffline } = require('./lib/presence');
const { createMessage } = require('./lib/messages');
const { serializeMessage } = require('./lib/serializers');

/** userIds that should hear about this user's presence changes. */
function presenceAudience(userId) {
  const ids = new Set();
  for (const r of db.prepare('SELECT contact_id AS id FROM contacts WHERE user_id = ?').all(userId)) {
    ids.add(r.id);
  }
  for (const r of db
    .prepare(
      `SELECT DISTINCT m2.user_id AS id FROM conversation_members m1
       JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id
       WHERE m1.user_id = ?`
    )
    .all(userId)) {
    ids.add(r.id);
  }
  ids.delete(userId);
  return [...ids];
}

function attachSocketIO(httpServer, corsOptions) {
  const io = new Server(httpServer, { cors: corsOptions });

  // ---- auth ---------------------------------------------------------------
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Missing auth token'));
    try {
      const payload = verifyToken(token);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      if (!user) return next(new Error('User not found'));
      socket.userId = user.id;
      socket.username = user.username;
      ensureCommonChatMembership(user.id); // sab "chat" group me rahen
      next();
    } catch (e) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Join personal room + one room per conversation.
    socket.join(`user:${userId}`);
    const convIds = db
      .prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?')
      .all(userId)
      .map((r) => r.conversation_id);
    for (const cid of convIds) socket.join(`conversation:${cid}`);

    // Presence: broadcast "online" only on the first socket for this user.
    if (markOnline(userId, socket.id)) {
      const payload = { userId, isOnline: true, lastSeen: null };
      for (const other of presenceAudience(userId)) io.to(`user:${other}`).emit('presence:update', payload);
    }

    // ---- messaging --------------------------------------------------------
    socket.on('message:send', (data, ack) => {
      try {
        const { conversationId, kind, text, replyTo, fileId } = data || {};
        const row = createMessage({ conversationId, senderId: userId, kind, text, replyTo, fileId });
        const out = serializeMessage(row, userId);
        io.to(`conversation:${conversationId}`).emit('message:new', out);
        if (typeof ack === 'function') ack({ ok: true, message: out });
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e.message });
      }
    });

    // ---- typing indicators ------------------------------------------------
    const typing = (isTyping, data) => {
      const conversationId = data && data.conversationId;
      if (typeof conversationId !== 'string' || !isMember(conversationId, userId)) return;
      socket.to(`conversation:${conversationId}`).emit('typing:update', {
        conversationId,
        userId,
        username: socket.username,
        isTyping: !!isTyping,
      });
    };
    socket.on('typing:start', (data) => typing(true, data));
    socket.on('typing:stop', (data) => typing(false, data));

    // ---- delivery receipts -------------------------------------------------
    socket.on('message:delivered', (data) => {
      const ids = data && Array.isArray(data.messageIds) ? data.messageIds.filter((x) => typeof x === 'string') : [];
      if (ids.length === 0) return;
      const now = Date.now();
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO message_delivered (message_id, user_id, delivered_at) VALUES (?, ?, ?)'
      );
      const affected = [];
      for (const mid of ids.slice(0, 200)) {
        const msg = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(mid);
        if (!msg || !isMember(msg.conversation_id, userId)) continue;
        stmt.run(mid, userId, now);
        affected.push({ messageId: mid, conversationId: msg.conversation_id });
      }
      for (const { messageId, conversationId } of affected) {
        io.to(`conversation:${conversationId}`).emit('message:status', {
          messageId,
          userId,
          status: 'delivered',
          deliveredAt: new Date(now).toISOString(),
        });
      }
    });

    // ---- join a conversation room explicitly (e.g. after being added) -----
    socket.on('conversation:join', (data, ack) => {
      const conversationId = data && data.conversationId;
      if (typeof conversationId !== 'string' || !isMember(conversationId, userId)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Not a member' });
        return;
      }
      socket.join(`conversation:${conversationId}`);
      if (typeof ack === 'function') ack({ ok: true });
    });

    // ---- WebRTC signaling passthrough --------------------------------------
    // Relays call events to the target user's personal room, attaching
    // fromUserId so the callee knows who is calling.
    const relayCall = (event, data) => {
      const toUserId = data && data.toUserId;
      if (typeof toUserId !== 'string') return;
      const { toUserId: _drop, ...rest } = data || {};
      io.to(`user:${toUserId}`).emit(event, { ...rest, fromUserId: userId });
    };
    for (const ev of ['call:offer', 'call:answer', 'call:ice', 'call:reject', 'call:end', 'call:ringing']) {
      socket.on(ev, (data) => relayCall(ev, data));
    }

    // ---- disconnect ---------------------------------------------------------
    socket.on('disconnect', () => {
      if (markOffline(userId, socket.id)) {
        const lastSeen = db.prepare('SELECT last_seen FROM users WHERE id = ?').get(userId)?.last_seen || Date.now();
        const payload = { userId, isOnline: false, lastSeen: new Date(lastSeen).toISOString() };
        for (const other of presenceAudience(userId)) io.to(`user:${other}`).emit('presence:update', payload);
      }
    });
  });

  return io;
}

module.exports = { attachSocketIO };
