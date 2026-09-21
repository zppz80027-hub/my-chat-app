// First-boot seed: when the users table is empty, create two demo users,
// make them contacts of each other, create a dm + a demo group, and drop in
// a few starter messages. Documented for testing only.
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./db');
const { createMessage, createSystemMessage } = require('./lib/messages');

async function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return false;

  console.log('[seed] empty database — creating demo data…');
  const now = Date.now();
  const mkUser = async (username, displayName, about) => {
    const id = uuidv4();
    const password_hash = await bcrypt.hash('demo1234', 10);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, display_name, about, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, username, password_hash, displayName, about, now);
    return id;
  };

  const demo1 = await mkUser('demo1', 'Demo One', 'Just here to demo the chat app 👋');
  const demo2 = await mkUser('demo2', 'Demo Two', 'Also here to demo the chat app ✨');

  const addContact = db.prepare('INSERT INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)');
  addContact.run(demo1, demo2, now);
  addContact.run(demo2, demo1, now);

  // DM between the two demos.
  const dmId = uuidv4();
  db.prepare('INSERT INTO conversations (id, type, created_by, created_at) VALUES (?, ?, ?, ?)').run(
    dmId,
    'dm',
    demo1,
    now
  );
  const addMember = db.prepare(
    'INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)'
  );
  addMember.run(dmId, demo1, now);
  addMember.run(dmId, demo2, now);

  // Demo group with both members.
  const groupId = uuidv4();
  db.prepare('INSERT INTO conversations (id, type, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
    groupId,
    'group',
    'Demo Group',
    demo1,
    now
  );
  addMember.run(groupId, demo1, now);
  addMember.run(groupId, demo2, now);
  createSystemMessage(groupId, 'Demo One created the group');

  // A few starter messages in the dm.
  createMessage({ conversationId: dmId, senderId: demo1, kind: 'text', text: 'Hey! Welcome to the demo chat 👋' });
  createMessage({ conversationId: dmId, senderId: demo2, kind: 'text', text: 'Hey Demo One! This looks slick ✨' });
  createMessage({
    conversationId: dmId,
    senderId: demo1,
    kind: 'text',
    text: 'Try sending messages, reactions, files — even voice/video calls.',
  });
  createMessage({ conversationId: groupId, senderId: demo2, kind: 'text', text: 'Group chat works too 🎉' });

  console.log('[seed] demo users created:');
  console.log('[seed]   username: demo1  password: demo1234');
  console.log('[seed]   username: demo2  password: demo1234');
  return true;
}

module.exports = { seedIfEmpty };
