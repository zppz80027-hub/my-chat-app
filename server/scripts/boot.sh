#!/usr/bin/env bash
# Render start-command wrapper: bash server/scripts/boot.sh
#
# - R2 env vars maujood hon to:
#     1. Litestream se SQLite ko R2 replica se restore karo (pehli boot par
#        replica nahi hogi — fresh DB se start hoga).
#     2. `litestream replicate -exec` me node chalao: har DB change R2 par
#        continuously replicate hota hai. Deploy/restart par kuch nahi udta.
# - R2 configured na ho to: seedha node (purana ephemeral behavior).
#
# `exec` zaroori hai taaki litestream PID 1 bane aur Render ka SIGTERM
# gracefully handle ho (akhri sync karke band hota hai).
set -u
cd "$(dirname "$0")/../.."   # repo root
LITESTREAM="./server/bin/litestream"
mkdir -p server/data

have_r2=0
if [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] \
   && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_BUCKET:-}" ]; then
  have_r2=1
fi

if [ "$have_r2" -eq 1 ] && [ -x "$LITESTREAM" ]; then
  echo "[boot] R2 configured — restoring SQLite from replica (if any)..."
  "$LITESTREAM" restore -if-replica-exists -config ./server/scripts/litestream.yml ./server/data/chat.db \
    || echo "[boot] restore skipped (no replica yet) — starting with fresh DB"
  echo "[boot] starting: litestream replicate -> node server/index.js"
  exec "$LITESTREAM" replicate -config ./server/scripts/litestream.yml -exec "node server/index.js"
else
  [ "$have_r2" -eq 1 ] || echo "[boot] R2 env vars missing — ephemeral mode (DB/files will wipe on redeploy)"
  [ -x "$LITESTREAM" ] || echo "[boot] litestream binary missing at $LITESTREAM — ephemeral mode"
  echo "[boot] starting: node server/index.js (no replication)"
  exec node server/index.js
fi
