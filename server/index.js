// Chat app backend entry point.
// Express REST API + Socket.IO realtime + SQLite (better-sqlite3).
// Serves the built frontend from ../client/dist when present (SPA fallback).
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./src/config');
const { db } = require('./src/db'); // opens DB + creates schema on require
const { attachSocketIO } = require('./src/socket');
const { seedIfEmpty } = require('./src/seed');
const { cleanupStaleUploads, router: uploadsRouter } = require('./src/routes/uploads');

const app = express();
const server = http.createServer(app);
const io = attachSocketIO(server, {
  origin: corsOrigins(),
  credentials: true,
});

function corsOrigins() {
  const allowed = (config.clientUrl || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.length > 0 ? allowed : true;
}

// ---- CORS ------------------------------------------------------------------
app.use(cors({ origin: corsOrigins(), credentials: true }));

// ---- middleware --------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- health ------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- API routes (all before the SPA fallback and the /api 404 handler) --------
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/contacts', require('./src/routes/contacts'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/uploads', uploadsRouter);
app.use('/api/files', require('./src/routes/files'));
// These two broadcast over Socket.IO, so they are factories receiving `io`.
app.use('/api/conversations', require('./src/routes/conversations')(io));
app.use('/api/messages', require('./src/routes/messages')(io));

// ---- static frontend (optional) -------------------------------------------------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: anything that isn't /api/* or /socket.io/* serves index.html.
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log('[static] serving frontend from', clientDist);
}

// ---- 404 + error handling --------------------------------------------------------
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ---- boot --------------------------------------------------------------------------
async function boot() {
  await seedIfEmpty();
  cleanupStaleUploads();

  server.listen(config.port, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : config.port;
    console.log(`[ready] chatapp listening on port ${port}`);
  });
}

// ---- graceful shutdown ---------------------------------------------------------------
function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing…`);
  io.close(() => {
    server.close(() => {
      try {
        db.close();
      } catch (_) {
        /* already closed */
      }
      console.log('[shutdown] done');
      process.exit(0);
    });
  });
  // Failsafe: force exit if something hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

boot().catch((err) => {
  console.error('[fatal] failed to boot:', err);
  process.exit(1);
});
