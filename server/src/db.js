// SQLite database setup via better-sqlite3.
// Opens the DB file (creating parent dirs), enables WAL mode for safe
// concurrent read/write from REST + Socket.IO handlers, and creates the
// schema on boot if it does not exist yet.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  about         TEXT NOT NULL DEFAULT '',
  avatar_path   TEXT,
  last_seen     INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, contact_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  name       TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  wallpaper TEXT
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                   TEXT PRIMARY KEY,
  conversation_id      TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('text', 'image', 'file', 'system')),
  text                 TEXT,
  reply_to             TEXT REFERENCES messages(id) ON DELETE SET NULL,
  file_id              TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  created_at           INTEGER NOT NULL,
  edited_at            INTEGER,
  deleted_for_everyone INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_delivered (
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_deletes (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS uploads (
  id              TEXT PRIMARY KEY,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
  size            INTEGER NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  uploader_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_chunks (
  upload_id   TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (upload_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members (user_id);
CREATE INDEX IF NOT EXISTS idx_reads_user ON message_reads (user_id);
`;

db.exec(SCHEMA);

// --- Common "chat" group: sab log ek hi chat me --------------------------------
// Ek hi group hota hai jisme sab members hain. Chat pe tap karte hi sab usi me
// baat karte hain — alag-alag DM banane ki zaroorat nahi.
// Wallpaper column — purane DB ke liye migration.
{
  const cols = db.prepare('PRAGMA table_info(conversations)').all().map((r) => r.name);
  if (!cols.includes('wallpaper')) db.exec('ALTER TABLE conversations ADD COLUMN wallpaper TEXT');
}

const COMMON_CHAT_ID = 'common-chat';
db.prepare(
  "INSERT OR IGNORE INTO conversations (id, type, name, created_by, created_at) VALUES (?, 'group', 'chat', NULL, ?)"
).run(COMMON_CHAT_ID, Date.now());
// "Demo" jaise test/demo users hatao — sirf asli log rahenge.
db.prepare("DELETE FROM users WHERE LOWER(display_name) LIKE '%demo%' OR LOWER(username) LIKE '%demo%'").run();
// Purani DMs hatao — sirf common "chat" group rahega ("bas chat hi").
db.prepare("DELETE FROM conversations WHERE type = 'dm'").run();
db.prepare("DELETE FROM conversations WHERE type = 'group' AND id != 'common-chat'").run(); // sirf "chat" group rahegi
// Sabka display naam "chat" — purane Mehmaan-XXXX / custom naam ek jaise karo.
db.prepare("UPDATE users SET display_name = 'chat' WHERE display_name != 'chat'").run();
// Sab existing users ko common chat ka member banao.
{
  const addMember = db.prepare(
    'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)'
  );
  const now = Date.now();
  for (const u of db.prepare('SELECT id FROM users').all()) {
    addMember.run(COMMON_CHAT_ID, u.id, now);
  }
}

// --- Small shared data-access helpers ---------------------------------------

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function isMember(conversationId, userId) {
  return !!db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
}

function getConversation(id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

// Har user common "chat" group ka member rahe — chahe wo kabhi bhi join hua ho
// (purana session, beech me bana user, fresh DB). INSERT OR IGNORE hai,
// isliye ise har authenticated request pe chalana sasta aur surakshit hai.
let _chatStmts = null;
function ensureCommonChatMembership(userId) {
  try {
    if (!_chatStmts) {
      _chatStmts = {
        mkGroup: db.prepare(
          "INSERT OR IGNORE INTO conversations (id, type, name, created_by, created_at) VALUES (?, 'group', 'chat', NULL, ?)"
        ),
        mkMember: db.prepare(
          'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)'
        ),
      };
    }
    const now = Date.now();
    _chatStmts.mkGroup.run(COMMON_CHAT_ID, now);
    _chatStmts.mkMember.run(COMMON_CHAT_ID, userId, now);
  } catch (_) {
    /* best effort — caller ko kabhi rokna nahi */
  }
}

module.exports = { db, getUserById, getUserByUsername, isMember, getConversation, COMMON_CHAT_ID, ensureCommonChatMembership };
