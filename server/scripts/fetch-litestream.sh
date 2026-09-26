#!/usr/bin/env bash
# Render build step: litestream binary download karo -> server/bin/litestream
# (buildCommand me `bash server/scripts/fetch-litestream.sh` jodo).
# Pinned version taaki build reproducible rahe.
set -euo pipefail
VERSION="${LITESTREAM_VERSION:-0.5.17}"
DEST="server/bin/litestream"

if [ -x "$DEST" ]; then
  echo "[build] litestream already present at $DEST"
  exit 0
fi

mkdir -p server/bin
URL="https://github.com/benbjohnson/litestream/releases/download/v${VERSION}/litestream-${VERSION}-linux-x86_64.tar.gz"
echo "[build] downloading litestream v${VERSION}..."
curl -fsSL "$URL" | tar -xz -C server/bin litestream
chmod +x "$DEST"
"$DEST" version
echo "[build] litestream ready at $DEST"
