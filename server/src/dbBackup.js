// SQLite DB ka Cloudinary par automatic backup.
// Har deploy/restart par Render ki disk saaf ho jati hai — isliye DB ki copy
// Cloudinary par rakho. Boot par agar local DB khaali ho to wahan se wapas lao.
//
// SURAKSHA (2026-09-26 ka sabak): ek baar khaali local DB ne overwrite=true se
// achchha backup mita diya tha. Ab:
//   1. Do slot hain — main + prev (pichhli peedhi). Har backup se pehle purana
//      main prev me copy hota hai, taaki ek kharab upload sab kuch na mitaye.
//   2. Guard: agar Cloudinary wala backup local DB se "bhara" hai (zyada
//      messages), to upload SKIP hota hai — khaali DB kabhi achchha backup
//      nahi mitayega.
//   3. Restore dono slot try karta hai aur zyada messages wali copy chunta hai.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const config = require('./config');

const CLOUD_NAME = 'tzfbjslf';
const API_KEY = '659554747298259';
// API secret Render env var se aata hai (kabhi git me nahi).
const SLOT_MAIN = 'cloude/cloude-chat-db-backup';
const SLOT_PREV = 'cloude/cloude-chat-db-backup-prev';
// Note: Cloudinary upload me filename ka .db extension public_id me jud jata hai.
const slotUrl = (publicId) =>
  `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${publicId}.db`;
const BACKUP_URL = slotUrl(SLOT_MAIN);

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

/**
 * Kisi slot ka backup download karo.
 * Returns: 'ok' | 'not_found' (slot maujood hi nahi) | 'error' (network/
 * timeout/kharaab jawab — remote ki haalat PATA NAHI).
 * 'not_found' aur 'error' me farq zaroori hai: fail-closed guard ke liye.
 */
function downloadSlot(publicId, destPath) {
  return new Promise((resolve) => {
    const giveUp = (status) => {
      try { fs.unlinkSync(destPath); } catch {}
      resolve(status);
    };
    try {
      const file = fs.createWriteStream(destPath);
      const req = https.get(slotUrl(publicId), { timeout: 60000 }, (res) => {
        if (res.statusCode === 404) return giveUp('not_found');
        if (res.statusCode !== 200) return giveUp('error');
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve('ok');
        });
      });
      req.on('error', () => giveUp('error'));
      req.on('timeout', () => {
        req.destroy();
        giveUp('error');
      });
    } catch {
      resolve('error');
    }
  });
}

/** DB file me kitne messages/users hain. Khaarab file par null. */
function countDb(dbPath) {
  try {
    if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return null;
    const Database = require('better-sqlite3');
    const d = new Database(dbPath, { readonly: true, timeout: 5000 });
    const tables = d
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((r) => r.name);
    if (!tables.includes('messages') || !tables.includes('users')) {
      d.close();
      return null;
    }
    const messages = d.prepare('select count(*) as n from messages').get().n;
    const users = d.prepare('select count(*) as n from users').get().n;
    d.close();
    return { messages, users };
  } catch {
    return null;
  }
}

/**
 * Guard: kya upload skip karna chahiye? (FAIL-CLOSED)
 * - local khaali/kharaab ho to KABHI upload mat karo.
 * - remote ka download fail ho ('error') to bhi SKIP — pata nahi ke aadhar par
 *   achchha backup kabhi mat mitao. Yahi pichhli baar ki chook thi.
 * - remote maujood hi na ho ('not_found') to pehla backup banne do.
 * - remote me local se zyada messages hon to skip (local purana/khaali hai).
 */
function shouldSkipBackup(localCounts, remoteStatus, remoteCounts) {
  if (!localCounts || localCounts.messages === 0) return true;
  if (remoteStatus === 'error') return true;
  if (remoteStatus === 'not_found' || !remoteCounts) return false;
  return remoteCounts.messages > localCounts.messages;
}

/** Local DB file ko kisi slot par signed upload karo (overwrite=true). */
function uploadSlot(publicId, dbPath) {
  return new Promise((resolve) => {
    try {
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!apiSecret) {
        log('CLOUDINARY_API_SECRET env var nahi hai, backup skip');
        return resolve(false);
      }
      const stat = fs.statSync(dbPath);
      if (stat.size === 0) return resolve(false);
      const fileData = fs.readFileSync(dbPath);
      const timestamp = Math.floor(Date.now() / 1000);
      const params = {
        overwrite: 'true',
        public_id: publicId,
        timestamp: String(timestamp),
      };
      const signature = signParams(params, apiSecret);
      const boundary = `----dbbackup${Date.now()}`;
      const fields = { ...params, api_key: API_KEY, signature };
      let part1 = '';
      for (const [k, v] of Object.entries(fields)) {
        part1 += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
      }
      part1 +=
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="cloude-backup.db"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`;
      const body = Buffer.concat([
        Buffer.from(part1),
        fileData,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const req = https.request(
        {
          hostname: 'api.cloudinary.com',
          path: `/v1_1/${CLOUD_NAME}/raw/upload`,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
          timeout: 90000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              log(`Backup OK [${publicId}] (${stat.size} bytes)`);
              resolve(true);
            } else {
              log(`Backup failed [${publicId}] (${res.statusCode}): ${data.slice(0, 200)}`);
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

/** DB ko Cloudinary par backup karo — guard + rotation ke saath. */
async function backupToCloudinary() {
  try {
    const dbPath = config.dbPath;
    if (!fs.existsSync(dbPath)) return false;

    // WAL mode: pehle checkpoint karo taaki -wal ka data main file me aa jaye.
    try {
      const Database = require('better-sqlite3');
      const tmpDb = new Database(dbPath, { readonly: false, timeout: 5000 });
      tmpDb.pragma('wal_checkpoint(TRUNCATE)');
      tmpDb.close();
    } catch (e) {
      log('Checkpoint skip:', e.message);
    }
    if (fs.statSync(dbPath).size === 0) return false;

    const localCounts = countDb(dbPath);

    // Pehle current remote backup dekho — kahin khaali DB achchhi copy na mitaye.
    // FAIL-CLOSED: download fail ho to upload bilkul mat karo.
    const tmpMain = path.join('/tmp', `cloude-remote-main-${Date.now()}.db`);
    const remoteStatus = await downloadSlot(SLOT_MAIN, tmpMain);
    const remoteCounts = remoteStatus === 'ok' ? countDb(tmpMain) : null;

    if (shouldSkipBackup(localCounts, remoteStatus, remoteCounts)) {
      log(
        `SKIP: local=${localCounts ? localCounts.messages : 0} msg, ` +
          `remote=[${remoteStatus}]${remoteCounts ? remoteCounts.messages : '?'} msg — remote mehfooz rakha`
      );
      try { fs.unlinkSync(tmpMain); } catch {}
      return false;
    }

    // Rotation: purana main -> prev (pichhli peedhi mehfooz). Sirf tab jab
    // remote sahi-salaamat download hua ho.
    if (remoteStatus === 'ok' && remoteCounts) {
      const okPrev = await uploadSlot(SLOT_PREV, tmpMain);
      if (!okPrev) log('Prev slot rotation fail — main phir bhi upload hoga');
    }
    try { fs.unlinkSync(tmpMain); } catch {}

    return await uploadSlot(SLOT_MAIN, dbPath);
  } catch (e) {
    log('Backup exception:', e.message);
    return false;
  }
}

/** Cloudinary se DB wapas lao — dono slot me se behtar copy chuno. */
async function restoreFromCloudinary() {
  try {
    const dbPath = config.dbPath;
    // Agar local DB me data hai to restore mat karo.
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
      return false;
    }
    log('Local DB khaali hai, Cloudinary se restore kar raha hu...');
    const stamp = Date.now();
    const tmpMain = path.join('/tmp', `cloude-restore-main-${stamp}.db`);
    const tmpPrev = path.join('/tmp', `cloude-restore-prev-${stamp}.db`);

    const [stMain, stPrev] = await Promise.all([
      downloadSlot(SLOT_MAIN, tmpMain),
      downloadSlot(SLOT_PREV, tmpPrev),
    ]);
    const cMain = stMain === 'ok' ? countDb(tmpMain) : null;
    const cPrev = stPrev === 'ok' ? countDb(tmpPrev) : null;

    // Zyada messages wali copy chuno (barabar ho to main).
    let best = null;
    let bestCounts = null;
    let bestSlot = '';
    if (cMain && (!bestCounts || cMain.messages >= bestCounts.messages)) {
      best = tmpMain; bestCounts = cMain; bestSlot = 'main';
    }
    if (cPrev && (!bestCounts || cPrev.messages > bestCounts.messages)) {
      best = tmpPrev; bestCounts = cPrev; bestSlot = 'prev';
    }
    try { if (tmpMain !== best) fs.unlinkSync(tmpMain); } catch {}
    try { if (tmpPrev !== best) fs.unlinkSync(tmpPrev); } catch {}

    if (!best) {
      log('Restore: dono slot me koi sahi backup nahi mila');
      try { fs.unlinkSync(dbPath); } catch {}
      return false;
    }
    fs.copyFileSync(best, dbPath);
    try { fs.unlinkSync(best); } catch {}
    const size = fs.statSync(dbPath).size;
    log(`Restore OK [slot:${bestSlot}] (${size} bytes, ${bestCounts.messages} msg, ${bestCounts.users} users)`);
    return true;
  } catch (e) {
    log('Restore exception:', e.message);
    return false;
  }
}

/** Har 5 minute me backup + SIGTERM par bhi (exit index.js sambhalta hai). */
function startAutoBackup() {
  // Pehla backup 30 second baad, phir har 5 minute.
  setTimeout(() => backupToCloudinary(), 30000);
  setInterval(() => backupToCloudinary(), 5 * 60 * 1000);
  process.on('SIGTERM', () => {
    log('Shutdown par backup...');
    backupToCloudinary().catch(() => {});
  });
}

module.exports = {
  backupToCloudinary,
  restoreFromCloudinary,
  startAutoBackup,
  BACKUP_URL,
  // test ke liye:
  shouldSkipBackup,
  countDb,
};
