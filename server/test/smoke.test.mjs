// Smoke test for the chat backend. Plain node, no test framework.
// Starts the server on an ephemeral port with a temp DB + upload dir, then:
//  - registers two users and logs in
//  - creates a dm, sends a message via REST, reads it back
//  - connects two socket.io clients, sends a message over the socket and
//    asserts the other client receives 'message:new'
//  - asserts typing events propagate
//  - chunked-uploads a ~10MB file in 4MB chunks, completes it, downloads it
//    back and asserts the bytes are identical (sha256)
//
// Run from server/:  node test/smoke.test.mjs
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { io as ioClient } from 'socket.io-client';

const SERVER_DIR = path.resolve(import.meta.dirname, '..');

// --- temp sandbox ------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatapp-smoke-'));
const dbPath = path.join(tmp, 'chat.db');
const uploadDir = path.join(tmp, 'uploads');

let child;
let base;

async function startServer() {
  child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: '0',
      DB_PATH: dbPath,
      UPLOAD_DIR: uploadDir,
      JWT_SECRET: 'smoke-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not become ready in time. Output:\n' + out)), 20000);
    child.stdout.on('data', (d) => {
      out += d.toString();
      const m = /\[ready\] chatapp listening on port (\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });
    child.on('exit', (code) => reject(new Error(`server exited early with code ${code}. Output:\n${out}`)));
  });
  base = `http://127.0.0.1:${port}`;
  console.log('  server up at', base);
}

function stopServer() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve();
    }, 5000).unref();
  });
}

// --- tiny REST helper ---------------------------------------------------------
async function api(method, p, token, body) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof Buffer ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  console.log('[1/7] starting server…');
  await startServer();

  console.log('[2/7] register + login two users…');
  const users = [];
  for (const [username, displayName] of [
    ['smoke_alice', 'Smoke Alice'],
    ['smoke_bob', 'Smoke Bob'],
  ]) {
    const reg = await api('POST', '/api/auth/register', null, { username, password: 'password123', displayName });
    assert.equal(reg.status, 201, `register ${username}: ${reg.text}`);
    assert.ok(reg.json.token, 'register returns token');
    assert.equal(reg.json.user.username, username);
    users.push({ ...reg.json.user, token: reg.json.token });
    // login round-trip
    const login = await api('POST', '/api/auth/login', null, { username, password: 'password123' });
    assert.equal(login.status, 200, `login ${username}: ${login.text}`);
    assert.ok(login.json.token, 'login returns token');
  }
  const [alice, bob] = users;
  const me = await api('GET', '/api/auth/me', alice.token);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, 'smoke_alice');

  // bad input validation
  const bad = await api('POST', '/api/auth/register', null, { username: 'ab', password: '123' });
  assert.equal(bad.status, 400, 'short username/password rejected');

  console.log('[3/7] create dm + send message via REST…');
  const dm = await api('POST', '/api/conversations', alice.token, { type: 'dm', memberId: bob.id });
  assert.equal(dm.status, 201, `create dm: ${dm.text}`);
  assert.equal(dm.json.type, 'dm');
  const convId = dm.json.id;
  // creating the same dm again returns the existing one (200, same id)
  const dm2 = await api('POST', '/api/conversations', bob.token, { type: 'dm', memberId: alice.id });
  assert.equal(dm2.json.id, convId, 'dm is idempotent');

  const sent = await api('POST', `/api/conversations/${convId}/messages`, alice.token, {
    kind: 'text',
    text: 'Hello from REST 👋',
  });
  assert.equal(sent.status, 201, `send message: ${sent.text}`);
  assert.equal(sent.json.text, 'Hello from REST 👋');

  const list = await api('GET', `/api/conversations/${convId}/messages?limit=50`, bob.token);
  assert.equal(list.status, 200);
  assert.ok(list.json.some((m) => m.text === 'Hello from REST 👋'), 'REST message visible in history');

  console.log('[4/7] socket.io: connect both users, send + receive message…');
  const sockOpts = (token) => ({
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  const aliceSock = ioClient(base, sockOpts(alice.token));
  const bobSock = ioClient(base, sockOpts(bob.token));
  await Promise.all([
    new Promise((res, rej) => {
      aliceSock.on('connect', res);
      aliceSock.on('connect_error', rej);
    }),
    new Promise((res, rej) => {
      bobSock.on('connect', res);
      bobSock.on('connect_error', rej);
    }),
  ]);

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("bob did not receive 'message:new'")), 8000);
    bobSock.once('message:new', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
  const ack = await new Promise((resolve) => {
    aliceSock.emit(
      'message:send',
      { conversationId: convId, kind: 'text', text: 'Hello from socket ⚡' },
      (resp) => resolve(resp)
    );
  });
  assert.ok(ack.ok, `socket send ack ok: ${JSON.stringify(ack)}`);
  const got = await received;
  assert.equal(got.text, 'Hello from socket ⚡');
  assert.equal(got.conversationId, convId);
  assert.equal(got.senderId, alice.id);

  console.log('[5/7] typing indicator…');
  const typingEvt = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("bob did not receive 'typing:update'")), 8000);
    bobSock.once('typing:update', (evt) => {
      clearTimeout(timer);
      resolve(evt);
    });
  });
  aliceSock.emit('typing:start', { conversationId: convId });
  const tev = await typingEvt;
  assert.equal(tev.conversationId, convId);
  assert.equal(tev.userId, alice.id);
  assert.equal(tev.isTyping, true);
  aliceSock.emit('typing:stop', { conversationId: convId });

  console.log('[6/7] chunked upload of ~10MB file in 4MB chunks…');
  const fileBytes = crypto.randomBytes(10 * 1024 * 1024);
  const fileHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
  const init = await api('POST', '/api/uploads/init', alice.token, {
    filename: 'big-blob.bin',
    mimeType: 'application/octet-stream',
    size: fileBytes.length,
    conversationId: convId,
  });
  assert.equal(init.status, 201, `upload init: ${init.text}`);
  const { uploadId, chunkSize } = init.json;
  assert.equal(chunkSize, 4 * 1024 * 1024);
  const nChunks = Math.ceil(fileBytes.length / chunkSize);
  assert.ok(nChunks >= 3, `expected >=3 chunks, got ${nChunks}`);
  for (let i = 0; i < nChunks; i++) {
    const chunk = fileBytes.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, fileBytes.length));
    const res = await fetch(
      `${base}/api/uploads/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/octet-stream' },
        body: chunk,
      }
    );
    const jr = await res.json();
    assert.equal(res.status, 200, `chunk ${i}: ${JSON.stringify(jr)}`);
    assert.equal(jr.received, true);
  }
  const done = await api('POST', '/api/uploads/complete', alice.token, { uploadId });
  assert.equal(done.status, 200, `upload complete: ${done.text}`);
  const fileId = done.json.fileId;
  assert.ok(fileId, 'complete returns fileId');

  // reference the upload in a chat message
  const fileMsg = await api('POST', `/api/conversations/${convId}/messages`, alice.token, {
    kind: 'file',
    fileId,
    text: 'the big blob',
  });
  assert.equal(fileMsg.status, 201, `file message: ${fileMsg.text}`);
  assert.equal(fileMsg.json.file.id, fileId);

  // download and compare bytes
  const dl = await fetch(`${base}/api/files/${fileId}`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  assert.equal(dl.status, 200, `file download status ${dl.status}`);
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  const dlHash = crypto.createHash('sha256').update(dlBytes).digest('hex');
  assert.equal(dlBytes.length, fileBytes.length, 'downloaded size matches');
  assert.equal(dlHash, fileHash, 'downloaded bytes identical (sha256)');

  // Range request returns 206
  const rg = await fetch(`${base}/api/files/${fileId}`, {
    headers: { Authorization: `Bearer ${bob.token}`, Range: 'bytes=0-99' },
  });
  assert.equal(rg.status, 206, 'range request returns 206');
  assert.equal(rg.headers.get('content-range'), `bytes 0-99/${fileBytes.length}`);
  const rgBytes = Buffer.from(await rg.arrayBuffer());
  assert.ok(rgBytes.equals(fileBytes.subarray(0, 100)), 'range bytes match');

  // unauthorized download is rejected
  const noAuth = await fetch(`${base}/api/files/${fileId}`);
  assert.equal(noAuth.status, 401, 'file download requires auth');

  console.log('[7/7] reactions, edit, read receipts…');
  const react = await api('POST', `/api/messages/${sent.json.id}/reactions`, bob.token, { emoji: '👍' });
  assert.equal(react.status, 200);
  assert.equal(react.json.added, true);
  const edit = await api('PATCH', `/api/messages/${sent.json.id}`, alice.token, { text: 'Hello from REST (edited)' });
  assert.equal(edit.status, 200);
  assert.equal(edit.json.text, 'Hello from REST (edited)');
  assert.ok(edit.json.editedAt, 'editedAt set');
  const read = await api('POST', `/api/conversations/${convId}/read`, bob.token, { messageId: sent.json.id });
  assert.equal(read.status, 200);
  const after = await api('GET', `/api/conversations/${convId}/messages?limit=50`, bob.token);
  const edited = after.json.find((m) => m.id === sent.json.id);
  assert.ok(edited.readBy.includes(bob.id), 'bob marked message as read');
  assert.equal(edited.reactions.length, 1);
  assert.equal(edited.reactions[0].emoji, '👍');

  aliceSock.close();
  bobSock.close();
  console.log('\nAll smoke tests passed ✅');
}

try {
  await main();
} catch (e) {
  console.error('\nSmoke test FAILED:', e);
  process.exitCode = 1;
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}
