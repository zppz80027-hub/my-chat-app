// JWT helpers + Express auth middleware.
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserById } = require('../db');

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiry });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret); // throws on invalid/expired
}

/** Extract a Bearer token from the Authorization header (or null). */
function bearerFromHeader(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Express middleware: requires a valid JWT. Attaches the full user row
 * (minus password hash) as req.user. Responds 401 when missing/invalid.
 * Accepts the token via `Authorization: Bearer <token>` header, or via the
 * `?token=` query parameter (used for <img> tags and direct download links,
 * which can't set headers).
 */
function requireAuth(req, res, next) {
  const token = bearerFromHeader(req) || (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
  let payload;
  try {
    payload = verifyToken(token);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = getUserById(payload.sub);
  if (!user) return res.status(401).json({ error: 'User no longer exists' });
  const { password_hash, ...safe } = user;
  req.user = safe;
  next();
}

/** Wrap an async route handler so rejected promises hit the error middleware. */
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { signToken, verifyToken, bearerFromHeader, requireAuth, ah };
