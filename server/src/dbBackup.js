// SQLite DB ka Cloudinary par automatic backup.
// Har deploy/restart par Render ki disk saaf ho jati hai — isliye DB ki copy
// Cloudinary par rakho. Boot par agar local DB khaali ho to wahan se wapas lao.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const config = require('./config');

const CLOUD_NAME = 'tzfbjslf';
const API_KEY = '659554747298259';
// API secret Render env var se aata hai (kabhi git me nahi).
const BACKUP_PUBLIC_ID = 'cloude/cloude-chat-db-backup';
const BACKUP_URL = `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${BACKUP_PUBLIC_ID}`;

function log(...args) {
  console.log('[db-backup]', ...args);
}

/** Cloudinary signed upload ke liye signature banao. */
function signParams(params, apiSecret) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(sorted + apiSecret).digest('hex');
}

/** DB file ko Cloudinary par upload karo (signed, overwrite=true). */
function backupToCloudinary() {
  return new Promise((resolve) => {
    try {
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!apiSecret) {
        log('CLOUDINARY_API_SECRET env var nahi hai, backup skip');
        return resolve(false);
      }
      const dbPath = config.dbPath;
      if (!fs.existsSync(dbPath)) return resolve(false);

      // WAL mode: pehle checkpoint karo taaki -wal ka data main file me aa jaye.
      try {
        const Database = require('better-sqlite3');
        const tmpDb = new Database(dbPath, { readonly: false, timeout: 5000 });
        tmpDb.pragma('wal_checkpoint(TRUNCATE)');
        tmpDb.close();
      } catch (e) {
        log('Checkpoint skip:', e.message);
      }

      const stat = fs.statSync(dbPath);
      if (stat.size === 0) return resolve(false);

      const fileData = fs.readFileSync(dbPath);
      const timestamp = Math.floor(Date.now() / 1000);
      const params = {
        overwrite: 'true',
        public_id: BACKUP_PUBLIC_ID,
        timestamp: String(timestamp),
      };
      const signature = signParams(params, apiSecret);

      const boundary = `----dbbackup${Date.now()}`;
      const fields = {
        ...params,
        api_key: API_KEY,
        signature,
      };
      let part1 = '';
      for (const [k, v] of Object.entries(fields)) {
        part1 += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
      }
      part1 +=
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="cloude-backup.db"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`;
      const part1Buf = Buffer.from(part1);
      const part2Buf = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([part1Buf, fileData, part2Buf]);

      const req = https.request(
        {
          hostname: 'api.cloudinary.com',
          path: `/v1_1/${CLOUD_NAME}/raw/upload`,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
          timeout: 60000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              log(`Backup OK (${stat.size} bytes)`);
              resolve(true);
            } else {
              log(`Backup failed (${res.statusCode}): ${data.slice(0, 200)}`);
              resolve(false);
            }
          });
        }
      );
      req.on('error', (e) => {
        log('Backup error:', e.message);
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        log('Backup timeout');
        resolve(false);
      });
      req.write(body);
      req.end();
    } catch (e) {
      log('Backup exception:', e.message);
      resolve(false);
    }
  });
}

/** Cloudinary se DB wapas lao (sirf tab jab local DB khaali/gayab ho). */
function restoreFromCloudinary() {
  return new Promise((resolve) => {
    try {
      const dbPath = config.dbPath;
      // Agar local DB me data hai to restore mat karo.
      if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
        return resolve(false);
      }
      log('Local DB khaali hai, Cloudinary se restore kar raha hu...');
      const file = fs.createWriteStream(dbPath);
      const req = https.get(BACKUP_URL, { timeout: 60000 }, (res) => {
        if (res.statusCode !== 200) {
          log(`Restore: backup nahi mila (${res.statusCode})`);
          try { fs.unlinkSync(dbPath); } catch {}
          return resolve(false);
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          const size = fs.statSync(dbPath).size;
          log(`Restore OK (${size} bytes)`);
          resolve(true);
        });
      });
      req.on('error', (e) => {
        log('Restore error:', e.message);
        try { fs.unlinkSync(dbPath); } catch {}
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        try { fs.unlinkSync(dbPath); } catch {}
        resolve(false);
      });
    } catch (e) {
      log('Restore exception:', e.message);
      resolve(false);
    }
  });
}

/** Har 5 minute me backup + SIGTERM par bhi. */
function startAutoBackup() {
  // Pehla backup 30 second baad, phir har 5 minute.
  setTimeout(() => backupToCloudinary(), 30000);
  setInterval(() => backupToCloudinary(), 5 * 60 * 1000);
  const onShutdown = () => {
    log('Shutdown par backup...');
    backupToCloudinary().finally(() => process.exit(0));
  };
  process.on('SIGTERM', onShutdown);
  // Manual trigger ke liye export bhi karo.
}

module.exports = { backupToCloudinary, restoreFromCloudinary, startAutoBackup, BACKUP_URL };
