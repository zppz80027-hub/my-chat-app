# Cloude persistence migration plan (R2 + Litestream)

Goal: redeploys must not wipe chat, users, or uploaded files. All free-tier.

## What the code does (already drafted in this tree, NOT committed)

- `server/src/lib/r2.js` (new): Cloudflare R2 via `@aws-sdk/client-s3`.
  Reads R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
  from env. `enabled()` false when any missing -> local-disk fallback.
- `POST /api/uploads/complete`: after chunks assemble locally, streams the
  file to R2 (`files/<uploadId>-<name>`), deletes the local copy, marks
  `uploads.storage='r2'`, `r2_key`. R2 failure -> keeps local file, never
  breaks the upload.
- `GET /api/files/:fileId`: R2 files -> 302 to short-lived (1h) presigned URL
  after the existing auth+membership check. Range streaming keeps working:
  every range request re-hits this endpoint and gets a fresh URL.
  Client needs NO changes (same `/api/files/<id>?token=...` URLs).
- Avatars (`POST /api/profile/avatar`, `GET /api/users/:id/avatar`) and group
  wallpapers (PATCH/GET `/api/conversations/:id/wallpaper`) use the same
  pattern: R2 keys `avatars/<userId><ext>`, `wallpapers/<convId><ext>`,
  DB markers `r2:<key>` / `r2upload:<ext>`, 302 presigned on serve.
- `server/src/db.js`: boot migration adds `uploads.storage` (default 'local')
  and `uploads.r2_key`.
- Litestream (zero code change): `server/scripts/fetch-litestream.sh` downloads
  litestream v0.5.17 in build; `server/scripts/boot.sh` (new startCommand)
  restores the DB from R2 on boot, then `litestream replicate -exec
  "node server/index.js"`. Config in `server/scripts/litestream.yml`
  (no secrets inside; $VAR interpolation).
- `render.yaml`: build/start commands + R2_* env var declarations.

## Migration checklist (do at migration time, in order)

1. Movie upload on the LIVE server must be COMPLETE first (else it's lost).
2. Bucket check: `cloude-files` exists in the user's R2 (they created the
   account; verify bucket presence via API before deploy).
3. Render dashboard > chatapp service > Environment: set
   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET=cloude-files
   (values with the parent agent — do NOT put them in git. If the service was
   created from render.yaml Blueprint, also update the dashboard — dashboard
   values win.)
   ALSO change the service's Start Command to `bash server/scripts/boot.sh`
   (dashboard > Settings), unless redeploying from an updated Blueprint.
4. Commit + push this tree. Verify build log shows litestream download.
5. After deploy: check `/api/health`, check boot logs for
   "[boot] starting: litestream replicate". First boot = fresh DB (no replica
   yet) — expected.
6. Movie rescue: re-upload the 1.11GB movie from a fast machine via the public
   chunked API (init/chunk/complete), then POST the message. /complete will
   push it straight to R2.
7. Test: upload a small file, confirm `storage='r2'`; restart the service from
   the dashboard; confirm chat + files survive.

## Notes / risks

- First deploy wipes the CURRENT ephemeral DB+files (that's the point — they
  move to R2 going forward). Current chat is near-empty; the only valuable
  item is the in-progress movie -> rescue it per step 6.
- Old local files (`storage='local'`) keep serving from disk until a redeploy;
  after that they're gone. Acceptable: pre-migration files ~none.
- Litestream sync-interval 10s keeps R2 ops inside the free tier (1M Class A/mo).
- R2 free tier: 10GB storage, zero egress — movie streaming costs nothing extra.
- If R2 env vars are ever removed, app falls back to ephemeral mode (boot.sh
  handles it); R2-backed files then 404 until env restored.
