// Shared message business logic used by both the REST routes and the
// Socket.IO handlers, so validation rules stay identical on both paths.
const { v4: uuidv4 } = require('uuid');
const { db, isMember } = require('../db');

const KINDS = ['text', 'image', 'file', 'system'];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Persist a new message. Throws httpError(4xx) on invalid input.
 * Returns the raw DB row of the created message.
 */
function createMessage({ conversationId, senderId, kind, text, replyTo, fileId }) {
  if (!isMember(conversationId, senderId)) {
    throw httpError(403, 'Not a member of this conversation');
  }
  if (!KINDS.includes(kind)) throw httpError(400, `Invalid kind (expected one of ${KINDS.join(', ')})`);

  if (kind === 'text') {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw httpError(400, 'Text message requires non-empty text');
    }
    if (text.length > 20000) throw httpError(400, 'Message text too long (max 20000 chars)');
    text = text.trim();
  } else if (kind === 'image' || kind === 'file') {
    if (!fileId) throw httpError(400, 'fileId is required for image/file messages');
    const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(fileId);
    if (!up || up.status !== 'complete') throw httpError(400, 'Upload not found or not complete');
    if (up.conversation_id !== conversationId) throw httpError(400, 'Upload belongs to a different conversation');
    if (up.uploader_id !== senderId) throw httpError(403, 'Upload was not created by you');
    text = typeof text === 'string' && text.length <= 20000 ? text : null; // optional caption
  } else {
    // 'system' messages are server-generated; clients may not send them.
    throw httpError(400, 'System messages cannot be sent by clients');
  }

  let replyToId = null;
  if (replyTo) {
    const parent = db
      .prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?')
      .get(replyTo, conversationId);
    if (!parent) throw httpError(400, 'replyTo message not found in this conversation');
    replyToId = parent.id;
  }

  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_id, kind, text, reply_to, file_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, senderId, kind, text, replyToId, fileId || null, now);

  // The sender trivially "has" the message: mark delivered+read for them.
  db.prepare('INSERT OR IGNORE INTO message_delivered (message_id, user_id, delivered_at) VALUES (?, ?, ?)').run(id, senderId, now);
  db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)').run(id, senderId, now);

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

/** Create a server-generated system message (e.g. "X joined the group"). */
function createSystemMessage(conversationId, text) {
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_id, kind, text, created_at)
     VALUES (?, ?, NULL, 'system', ?, ?)`
  ).run(id, conversationId, text, now);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

module.exports = { KINDS, httpError, createMessage, createSystemMessage };
