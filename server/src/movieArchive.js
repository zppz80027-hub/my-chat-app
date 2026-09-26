// Badi movie files ko PERMANENT rakho (Cloudinary par tukdon me).
//
// Masla: Cloudinary free plan me ek file max ~100MB jaati hai, aur Render ki
// disk har restart par saaf ho jati hai. Isliye 80MB se badi local movie ko
// 80MB ke tukdon (parts) me tod ke Cloudinary par "raw" upload karte hain.
// Har restart par tukde wapas jod ke local file bana lete hain — movie kabhi
// nahi hategi. Mapping (kaunsi file ke kitne tukde) SQLite me hai, jiska
// backup pehle se Cloudinary par jata hai.
//
// Flow:
//   1. /api/uploads/complete par (badi local file) -> archiveMovieInBackground
//   2. Boot par -> restoreAllMoviesInBackground (gum local files wapas jodo)
//   3. /api/files/:id par file gum mile -> 503 "taiyaar ho rahi hai"
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const config = require('./config');

const CLOUD_NAME = 'tzfbjslf';
const API_KEY = '659554747298259';
// API secret Render env var CLOUDINARY_API_SECRET se (kabhi git me nahi).
const PART_SIZE = 80 * 1024 * 1024; // 80MB — Cloudinary free limit se safe
const ARCHIVE_MIN_SIZE = 80 * 1024 * 1024; // isse badi local file archive hogi
const PARTS_PREFIX = 'cloude/movie-parts';

function log(...args) {
  console.log('[movie-archive]', ...args);
}

function getDb() {
  return require('./db').db;
}

function filesRoot() {
  return path.join(config.uploadDir, 'files');
}

function localPathFor(uploadId, filename) {
  const p = path.resolve(filesRoot(), `${uploadId}-${filename}`);
  if (!p.startsWith(path.resolve(filesRoot()) + path.sep)) return null;
  return p;
}

/** Signed raw upload (dbBackup jaisa, par bade parts ke liye lamba timeout). */
function uploadPart(publicId, filePath) {
  return new Promise((resolve) => {
    try {
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!apiSecret) {
        log('CLOUDINARY_API_SECRET nahi hai, archive skip');
        return resolve(false);
      }
      const stat = fs.statSync(filePath);
      const timestamp = Math.floor(Date.now() / 1000);
      const params = { overwrite: 'true', public_id: publicId, timestamp: String(timestamp) };
      const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
      const signature = crypto.createHash('sha1').update(sorted + apiSecret).digest('hex');
      const boundary = `----moviepart${Date.now()}`;
      let part1 = '';
      for (const [k, v] of Object.entries({ ...params, api_key: API_KEY, signature })) {
        part1 += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
      }
      const filename = `${publicId.split('/').pop()}.bin`;
      part1 +=
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`;
      const head = Buffer.from(part1);
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const req = https.request(
        {
          hostname: 'api.cloudinary.com',
          path: `/v1_1/${CLOUD_NAME}/raw/upload`,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': head.length + stat.size + tail.length,
          },
          timeout: 600000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              log(`Part OK [${publicId}] (${stat.size} bytes)`);
              resolve(true);
            } else {
              log(`Part fail [${publicId}] (${res.statusCode}): ${data.slice(0, 160)}`);
              resolve(false);
            }
          });
        }
      );
      req.on('error', (e) => { log('Part error:', e.message); resolve(false); });
      req.on('timeout', () => { req.destroy(); log('Part timeout'); resolve(false); });
      req.write(head);
      fs.createReadStream(filePath).on('error', (e) => {
        log('Part read error:', e.message);
        req.destroy();
        resolve(false);
      }).pipe(req, { end: false }).on('finish', () => req.end(tail));
    } catch (e) {
      log('Part exception:', e.message);
      resolve(false);
    }
  });
}

/** Ek part download karo. */
function downloadPart(publicId, destPath) {
  return new Promise((resolve) => {
    const giveUp = () => { try { fs.unlinkSync(destPath); } catch {} resolve(false); };
    try {
      const url = `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${publicId}.bin`;
      const file = fs.createWriteStream(destPath);
      const req = https.get(url, { timeout: 300000 }, (res) => {
        if (res.statusCode !== 200) return giveUp();
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(true); });
      });
      req.on('error', giveUp);
      req.on('timeout', () => { req.destroy(); giveUp(); });
    } catch { giveUp(); }
  });
}

function partPublicId(fileId, index) {
  return `${PARTS_PREFIX}/${fileId}/part-${index}`;
}

/**
 * Badi local movie ko tukdon me tod ke Cloudinary par archive karo.
 * Background me chalao — /complete iska wait nahi karta.
 */
async function archiveMovieInBackground(fileId) {
  try {
    const db = getDb();
    const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(fileId);
    if (!up || up.status !== 'complete' || up.storage !== 'local') return;
    if (up.size < ARCHIVE_MIN_SIZE) return;
    const already = db.prepare('SELECT * FROM movie_archives WHERE file_id = ?').get(fileId);
    if (already && (already.status === 'complete' || already.status === 'archiving')) {
      log(`${fileId} pehle se ${already.status}, skip`);
      return;
    }
    const src = localPathFor(up.id, up.filename);
    if (!src || !fs.existsSync(src)) {
      log(`${fileId} local file nahi mili, archive nahi ho sakta`);
      return;
    }
    const totalSize = fs.statSync(src).size;
    const parts = Math.ceil(totalSize / PART_SIZE);
    log(`${fileId} archive shuru: ${totalSize} bytes, ${parts} parts`);
    db.prepare(
      `INSERT OR REPLACE INTO movie_archives
       (file_id, filename, mime_type, total_size, part_size, parts, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'archiving', ?)`
    ).run(fileId, up.filename, up.mime_type, totalSize, PART_SIZE, parts, Date.now());

    const tmpDir = path.join('/tmp', `movie-split-${fileId}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      for (let i = 0; i < parts; i++) {
        const partPath = path.join(tmpDir, `part-${i}.bin`);
        const start = i * PART_SIZE;
        const end = Math.min(start + PART_SIZE, totalSize);
        // Tukda nikalo (stream se, poori file memory me nahi).
        await new Promise((resolve, reject) => {
          const rs = fs.createReadStream(src, { start, end: end - 1 });
          const ws = fs.createWriteStream(partPath);
          rs.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', resolve);
          rs.pipe(ws);
        });
        const ok = await uploadPart(partPublicId(fileId, i), partPath);
        try { fs.unlinkSync(partPath); } catch {}
        if (!ok) throw new Error(`part ${i} upload fail`);
      }
      db.prepare(`UPDATE movie_archives SET status = 'complete' WHERE file_id = ?`).run(fileId);
      log(`${fileId} archive COMPLETE (${parts} parts)`);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  } catch (e) {
    log(`archive fail [${fileId}]:`, e.message);
    try {
      getDb().prepare(`UPDATE movie_archives SET status = 'failed' WHERE file_id = ?`).run(fileId);
    } catch {}
  }
}

/**
 * Local file gum ho to tukde jod ke wapas banao.
 * Returns: 'ready' | 'restoring' | 'missing' | 'no-archive'
 */
async function ensureMovieLocal(fileId) {
  const db = getDb();
  const arch = db.prepare('SELECT * FROM movie_archives WHERE file_id = ?').get(fileId);
  if (!arch || arch.status !== 'complete') return arch ? arch.status : 'no-archive';
  const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(fileId);
  if (!up) return 'missing';
  const dest = localPathFor(up.id, up.filename);
  if (!dest) return 'missing';
  if (fs.existsSync(dest) && fs.statSync(dest).size === arch.total_size) return 'ready';

  log(`${fileId} local gum — ${arch.parts} parts jod raha hu...`);
  db.prepare(`UPDATE movie_archives SET status = 'restoring' WHERE file_id = ?`).run(fileId);
  const tmpDir = path.join('/tmp', `movie-join-${fileId}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const out = fs.createWriteStream(dest);
    for (let i = 0; i < arch.parts; i++) {
      const partPath = path.join(tmpDir, `part-${i}.bin`);
      const ok = await downloadPart(partPublicId(fileId, i), partPath);
      if (!ok) throw new Error(`part ${i} download fail`);
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(partPath);
        rs.on('error', reject);
        rs.on('end', resolve);
        rs.pipe(out, { end: false });
      });
      try { fs.unlinkSync(partPath); } catch {}
    }
    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });
    if (fs.statSync(dest).size !== arch.total_size) throw new Error('size mismatch');
    db.prepare(`UPDATE movie_archives SET status = 'complete' WHERE file_id = ?`).run(fileId);
    log(`${fileId} restore OK (${arch.total_size} bytes)`);
    return 'ready';
  } catch (e) {
    log(`restore fail [${fileId}]:`, e.message);
    try { fs.unlinkSync(dest); } catch {}
    try {
      db.prepare(`UPDATE movie_archives SET status = 'complete' WHERE file_id = ?`).run(fileId);
    } catch {}
    return 'restoring';
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/** Boot par: sab complete archives ki gum local files background me wapas jodo. */
function restoreAllMoviesInBackground() {
  setTimeout(async () => {
    try {
      const db = getDb();
      const rows = db.prepare(`SELECT file_id FROM movie_archives WHERE status = 'complete'`).all();
      for (const r of rows) {
        try {
          const st = await ensureMovieLocal(r.file_id);
          log(`boot restore [${r.file_id}]: ${st}`);
        } catch (e) {
          log(`boot restore fail [${r.file_id}]:`, e.message);
        }
      }
    } catch (e) {
      log('boot restore exception:', e.message);
    }
  }, 15000);
}

/**
 * File gum mile to jodne ka kaam background me shuru karo, turant status do.
 * Returns: 'ready' | 'restoring' | 'archiving' | 'failed' | 'no-archive'
 * (request ko block nahi karta — jodna pichhe chalta rehta hai).
 */
function triggerMovieRestore(fileId) {
  try {
    const db = getDb();
    const arch = db.prepare('SELECT * FROM movie_archives WHERE file_id = ?').get(fileId);
    if (!arch) return 'no-archive';
    if (arch.status === 'archiving') return 'archiving';
    if (arch.status !== 'complete' && arch.status !== 'failed') return arch.status;
    const up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(fileId);
    const dest = up && localPathFor(up.id, up.filename);
    if (dest && fs.existsSync(dest) && fs.statSync(dest).size === arch.total_size) return 'ready';
    // Background me jodna shuru — iska wait mat karo.
    ensureMovieLocal(fileId).catch((e) => log(`bg restore fail [${fileId}]:`, e.message));
    return 'restoring';
  } catch (e) {
    log('trigger restore fail:', e.message);
    return 'no-archive';
  }
}

module.exports = {
  archiveMovieInBackground,
  ensureMovieLocal,
  triggerMovieRestore,
  restoreAllMoviesInBackground,
  ARCHIVE_MIN_SIZE,
  PART_SIZE,
};
