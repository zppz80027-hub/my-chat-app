// POST /api/auth/register, /api/auth/login, GET /api/auth/me
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db, getUserByUsername } = require('../db');
const { signToken, requireAuth, ah } = require('../middleware/auth');
const { userSummary } = require('../lib/serializers');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters: letters, numbers and underscores only';
  }
  if (typeof password !== 'string' || password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  return null;
}

function publicUser(user) {
  return userSummary(user);
}

router.post(
  '/register',
  ah(async (req, res) => {
    const { username, password, displayName } = req.body || {};
    const err = validateCredentials(username, password);
    if (err) return res.status(400).json({ error: err });

    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 60) : username;
    if (getUserByUsername(username)) {
      return res.status(409).json({ error: 'Username is already taken' });
    }

    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, username, password_hash, name, now);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ token: signToken(id), user: publicUser(user) });
  })
);

router.post(
  '/login',
  ah(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const user = getUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    res.json({ token: signToken(user.id), user: publicUser(user) });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// POST /api/auth/guest — password-free join: the client sends just a display
// name, the server creates a unique guest identity and returns a JWT, so the
// rest of the app (REST + Socket.IO) works unchanged.
const GUEST_NAME_RE = /^.{1,60}$/;

function randomSecret() {
  return uuidv4() + uuidv4();
}

router.post(
  '/guest',
  ah(async (req, res) => {
    const { name } = req.body || {};
    const displayName = typeof name === 'string' ? name.trim().slice(0, 60) : '';
    if (!displayName || !GUEST_NAME_RE.test(displayName)) {
      return res.status(400).json({ error: 'Please enter your name (1-60 characters).' });
    }

    // Unique, unguessable username; the random password hash means the
    // /login endpoint can never be used to hijack a guest identity.
    let username;
    do {
      username = 'guest_' + uuidv4().replace(/-/g, '').slice(0, 12);
    } while (getUserByUsername(username));

    const id = uuidv4();
    const password_hash = await bcrypt.hash(randomSecret(), 10);
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, username, password_hash, displayName, now);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ token: signToken(id), user: publicUser(user) });
  })
);

module.exports = router;
