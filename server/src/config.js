// Central configuration, loaded from environment variables (see .env.example).
require('dotenv').config();
const path = require('path');

/**
 * Parse a byte size from env: accepts a plain number (bytes) or a value
 * with a unit suffix like "20MB", "2GB".
 */
function parseBytes(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(s);
  if (!m) return fallback;
  const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] || 'b').toLowerCase()];
  return Math.floor(parseFloat(m[1]) * mult);
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set — using insecure dev fallback "dev-secret-change-me". Set JWT_SECRET in production!');
}

const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: JWT_SECRET,
  jwtExpiry: '3650d',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'chat.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  // Max size for a single uploaded file. Default is 20 GiB (20 * 1024^3 bytes),
  // per the app spec. Override with MAX_FILE_SIZE env (bytes or "20GB").
  // NOTE: actually moving 20GB files requires server disk space + bandwidth;
  // most free hosting tiers can't handle that — see README "Honest limits".
  maxFileSize: parseBytes(process.env.MAX_FILE_SIZE, 20 * 1024 ** 3),
  chunkSize: 4 * 1024 * 1024, // 4 MiB per upload chunk
  maxAvatarSize: 5 * 1024 * 1024, // 5 MiB
  clientUrl: process.env.CLIENT_URL || '',
  // Cloudflare R2 object storage (files/avatars/wallpapers ko deploy ke paar
  // bachane ke liye). Sab env vars se — yahan kuch hardcode nahi.
  // Koi bhi missing ho to r2.enabled() false aur app local disk par chalti hai.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || '',
    // Optional, future use: R2 bucket ka public/custom-domain URL.
    publicUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
  },
};

module.exports = config;
