// Presence tracking: in-memory map of userId -> Set<socketId> plus the
// users.last_seen column for "last seen at" timestamps.
//
// A user counts as online while at least one socket is connected. The map
// lives here (shared between the Socket.IO layer and REST serializers) so
// both agree on who is online.
const { db } = require('../db');

/** Map<string, Set<string>> userId -> connected socket ids */
const onlineSockets = new Map();

function markOnline(userId, socketId) {
  let set = onlineSockets.get(userId);
  if (!set) {
    set = new Set();
    onlineSockets.set(userId, set);
  }
  const wasOffline = set.size === 0;
  set.add(socketId);
  return wasOffline; // true when the user just came online
}

function markOffline(userId, socketId) {
  const set = onlineSockets.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    onlineSockets.delete(userId);
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), userId);
    return true; // user just went fully offline
  }
  return false;
}

function isOnline(userId) {
  const set = onlineSockets.get(userId);
  return !!set && set.size > 0;
}

function socketCount(userId) {
  return onlineSockets.get(userId)?.size || 0;
}

module.exports = { markOnline, markOffline, isOnline, socketCount };
