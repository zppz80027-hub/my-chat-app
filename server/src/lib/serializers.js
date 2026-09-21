// JSON serializers: convert DB rows into the API's public shapes.
const { db } = require('../db');
const { isOnline } = require('./presence');

/** Public URL for a user's avatar image (served by GET /api/users/:id/avatar). */
function avatarUrlFor(user) {
  return user && user.avatar_path ? `/api/users/${user.id}/avatar` : null;
}

/** Public summary of a user row: {id, username, displayName, avatarUrl, about, isOnline}. */
function userSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: avatarUrlFor(row),
    about: row.about || '',
    isOnline: isOnline(row.id),
    lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
  };
}

/** Minimal message preview used for replyTo and lastMessage fields. */
function messagePreview(row) {
  if (!row) return null;
  return {
    id: row.id,
    senderId: row.sender_id,
    kind: row.kind,
    text: row.deleted_for_everyone ? null : row.text,
    createdAt: new Date(row.created_at).toISOString(),
    deletedForEveryone: !!row.deleted_for_everyone,
  };
}

/**
 * Full message shape for GET /messages and socket broadcasts:
 * {id, conversationId, senderId, kind, text, replyTo, file, createdAt,
 *  editedAt, deletedForEveryone, deletedForMe, reactions, readBy, deliveredTo}
 */
function serializeMessage(row, viewerId) {
  const deletedForEveryone = !!row.deleted_for_everyone;
  const deletedForMe = !!db
    .prepare('SELECT 1 FROM message_deletes WHERE message_id = ? AND user_id = ?')
    .get(row.id, viewerId);

  // Reactions as a flat list: [{emoji, userId, username}]
  const reactions = db
    .prepare(
      `SELECT r.emoji, r.user_id AS userId, u.username
       FROM reactions r JOIN users u ON u.id = r.user_id
       WHERE r.message_id = ?`
    )
    .all(row.id);

  const readBy = db
    .prepare('SELECT user_id FROM message_reads WHERE message_id = ?')
    .all(row.id)
    .map((r) => r.user_id);

  const deliveredTo = db
    .prepare('SELECT user_id FROM message_delivered WHERE message_id = ?')
    .all(row.id)
    .map((r) => r.user_id);

  let replyTo = null;
  if (row.reply_to) {
    const parent = db.prepare('SELECT * FROM messages WHERE id = ?').get(row.reply_to);
    replyTo = messagePreview(parent);
  }

  let file = null;
  if (row.file_id && !deletedForEveryone) {
    const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(row.file_id);
    if (up && up.status === 'complete') {
      file = {
        id: up.id,
        filename: up.filename,
        mimeType: up.mime_type,
        size: up.size,
        url: `/api/files/${up.id}`,
      };
    }
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    text: deletedForEveryone ? null : row.text,
    replyTo,
    file,
    createdAt: new Date(row.created_at).toISOString(),
    editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null,
    deletedForEveryone,
    deletedForMe,
    reactions,
    readBy,
    deliveredTo,
  };
}

/**
 * Fetch + serialize a page of messages for a conversation, ascending by
 * created_at (oldest first) for easy rendering.
 * `beforeId` (optional) paginates: returns messages older than that message.
 */
function getMessages(conversationId, viewerId, limit = 50, beforeId = null) {
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let beforeClause = '';
  const params = [conversationId];
  if (beforeId) {
    const anchor = db
      .prepare('SELECT created_at, id FROM messages WHERE id = ? AND conversation_id = ?')
      .get(beforeId, conversationId);
    if (!anchor) {
      const e = new Error('Pagination anchor message not found');
      e.status = 404;
      throw e;
    }
    // Keyset pagination on (created_at, id) to handle identical timestamps.
    beforeClause = 'AND (created_at < ? OR (created_at = ? AND id < ?))';
    params.push(anchor.created_at, anchor.created_at, anchor.id);
  }
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ? ${beforeClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(...params, limit)
    .reverse();
  return rows.map((r) => serializeMessage(r, viewerId));
}

module.exports = { avatarUrlFor, userSummary, messagePreview, serializeMessage, getMessages };
