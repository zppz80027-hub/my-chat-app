// Cloudflare R2 object storage (S3-compatible) via @aws-sdk/client-s3.
//
// Saari credentials env vars se aati hain (config.r2) — is file me kuch bhi
// hardcode nahi hai. Jab koi required env var missing ho, enabled() false
// hota hai aur callers local-disk fallback par chalte hain (purana behavior).
const fs = require('fs');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

function enabled() {
  const c = config.r2 || {};
  return !!(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket);
}

let _client = null;
function client() {
  if (_client) return _client;
  const c = config.r2;
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
  return _client;
}

function bucket() {
  return config.r2.bucket;
}

/**
 * Local file ko R2 par stream-upload karo (badi files ke liye bhi memory-safe —
 * poori file RAM me nahi aati). Resolves with the object key.
 */
async function uploadFile(key, localPath, contentType) {
  if (!enabled()) throw new Error('R2 is not configured');
  const { size } = fs.statSync(localPath);
  const stream = fs.createReadStream(localPath);
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: stream,
        ContentType: contentType || 'application/octet-stream',
        ContentLength: size,
      })
    );
  } catch (e) {
    try { stream.destroy(); } catch (_) { /* ignore */ }
    throw e;
  }
  return key;
}

/**
 * Short-lived presigned GET URL. Server pehle auth check karta hai, phir is
 * URL par 302 redirect deta hai — isliye har request par naya URL banta hai
 * aur purana expire ho jata hai. Range requests bhi chalti hain (har range
 * request dobara isi endpoint par aati hai).
 */
async function presignedGetUrl(key, { expiresIn = 3600, contentDisposition } = {}) {
  if (!enabled()) throw new Error('R2 is not configured');
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ...(contentDisposition ? { ResponseContentDisposition: contentDisposition } : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

/** Best-effort delete (missing key par throw nahi hona chahiye caller me). */
async function deleteKey(key) {
  if (!enabled()) return;
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// ---- Direct-to-R2 multipart upload (phone -> Cloudflare edge, server bypass) ----
// Badi files (movie) ke liye: client seedha R2 par parts bhejta hai, server
// sirf presigned URLs deta hai. Server ka slow US link beech me nahi aata.

/** Multipart upload shuru karo. Resolves with the R2 uploadId. */
async function createMultipart(key, contentType) {
  if (!enabled()) throw new Error('R2 is not configured');
  const out = await client().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  if (!out.UploadId) throw new Error('R2 did not return an uploadId');
  return out.UploadId;
}

/** Ek part ke liye presigned PUT URL (1h valid). partNumber 1-based hai. */
async function presignedPartUrl(key, uploadId, partNumber, expiresIn = 3600) {
  if (!enabled()) throw new Error('R2 is not configured');
  const cmd = new UploadPartCommand({
    Bucket: bucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

/**
 * Multipart complete karo. parts: [{PartNumber, ETag}, ...] — PartNumber ke
 * hisaab se sorted hone chahiye (S3/R2 ki requirement).
 */
async function completeMultipart(key, uploadId, parts) {
  if (!enabled()) throw new Error('R2 is not configured');
  await client().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );
}

/** Adhoora multipart hatao (best-effort — fail ho to ignore). */
async function abortMultipart(key, uploadId) {
  if (!enabled()) return;
  try {
    await client().send(
      new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId })
    );
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  enabled,
  uploadFile,
  presignedGetUrl,
  deleteKey,
  createMultipart,
  presignedPartUrl,
  completeMultipart,
  abortMultipart,
};
