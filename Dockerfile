# Docker build for the Cloude chat app (Back4app / any Docker host).
# Mirrors the Render blueprint: install server+client, build client,
# fetch litestream, boot via server/scripts/boot.sh (R2 replication).
FROM node:20-slim

# better-sqlite3 native compile needs build tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN NPM_CONFIG_PRODUCTION=false npm run install:all && npm run build && bash server/scripts/fetch-litestream.sh

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=192

CMD ["bash", "server/scripts/boot.sh"]
