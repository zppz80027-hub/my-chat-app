# ChatApp — Real-Time Chat Web App

A WhatsApp-style real-time chat web app: 1:1 and group messaging, big file
sharing with resumable chunked uploads, and 1:1 voice/video calls (WebRTC).
Mobile-first dark UI, built to run as **one service** — the Node server also
serves the built React frontend.

## Features

- **Auth** — register / login / logout with username + password (bcrypt hashing,
  JWT, 7-day sessions).
- **Contacts** — search users by username, add/remove contacts, online dots.
- **1:1 chat + group chat** — create groups, rename, add/remove members, leave.
- **Real-time messaging** (Socket.IO) — text, native emoji picker, images, file
  attachments.
- **Presence & receipts** — online/offline status, typing indicators, sent /
  delivered / read ticks, timestamps, date dividers.
- **Message actions** — reply, emoji reactions, edit (own), delete for me,
  delete for everyone (own).
- **Big file sharing** — chunked, resumable uploads (4 MiB chunks) with a
  progress bar + cancel in the UI; downloads support HTTP Range requests.
  Default max file size: **20 GB** (`MAX_FILE_SIZE`).
- **Voice + video calls (1:1)** — WebRTC with Socket.IO signaling, Google public
  STUN servers, incoming-call screen with accept/reject, WebAudio ringtone
  (no audio files), in-call mute / camera toggle / end. Group calls are out
  of scope (call buttons are hidden in groups).
- **Profile** — display name, about/status text, avatar upload.
- **Extras** — in-chat message search, unread badges (+ `document.title`
  counter), in-app toast notifications, empty states, loading skeletons.

## Quick start

Requires **Node.js 20+**.

```bash
cd chatapp
npm run install:all   # installs server + client dependencies
npm run build         # builds the React frontend into client/dist
npm start             # runs the server (serves API + frontend) on port 3000
```

Open http://localhost:3000 in your phone or desktop browser.

**Development mode** (two terminals):

```bash
npm run dev:server   # backend on :3000 (auto-reloads? no — restart on change)
npm run dev:client   # Vite dev server; proxies /api + /socket.io to :3000
```

**Run the test suite** (socket round-trip, typing, 10 MB chunked upload with
hash-verified download, reactions/edit/read receipts):

```bash
npm test
```

**Demo accounts** (created automatically on first boot, for testing only):

| Username | Password   |
|----------|------------|
| demo1    | demo1234   |
| demo2    | demo1234   |

They start as contacts with a DM and a "Demo Group" between them.

## Environment variables

| Variable        | Default                          | Description                                    |
|----------------|----------------------------------|------------------------------------------------|
| `PORT`         | `3000`                           | HTTP port                                      |
| `JWT_SECRET`   | `dev-secret-change-me`           | **Set this in production!** A warning is printed when the fallback is used |
| `DB_PATH`      | `server/data/chat.db`            | SQLite database file                           |
| `UPLOAD_DIR`   | `server/uploads`                 | Where uploaded files + avatars are stored      |
| `MAX_FILE_SIZE`| `20 * 1024^3` (20 GiB)           | Max single file size; bytes or `500MB` / `2GB` |
| `CLIENT_URL`   | _(empty)_                         | Optional CORS origin for the frontend          |

Copy `server/.env.example` to `server/.env` to configure.

## Project layout

```
chatapp/
├── package.json          # root scripts (start / build / test)
├── README.md
├── server/               # Express + Socket.IO + SQLite backend
│   ├── index.js          # entry point (also serves client/dist)
│   ├── src/              # config, db, routes, socket handlers, seed
│   ├── test/smoke.test.mjs
│   ├── data/             # SQLite file (gitignored)
│   └── uploads/          # uploaded files + avatars (gitignored)
└── client/               # React 18 + Vite + Tailwind frontend
    └── src/              # pages, components, contexts, utils
```

## Deploy notes (Render / Railway / VPS)

- Deploy as **one web service**: build command `npm run install:all && npm run build`,
  start command `npm start`. The server must support **WebSockets** (Socket.IO)
  — Render, Railway, and any VPS do; make sure no proxy strips the `Upgrade`
  header.
- **Uploads need persistent disk.** On Render add a persistent disk mounted at
  `/opt/render/project/src/server/uploads` (and set `UPLOAD_DIR` + `DB_PATH` to
  live on it, otherwise files and the database vanish on redeploy). On Railway
  add a volume. On a VPS, just use the filesystem.
- Set `JWT_SECRET` to a long random string in the host's env dashboard.
- If the frontend is served from a different origin than the API, set
  `CLIENT_URL` to the frontend origin for CORS.
- better-sqlite3 ships prebuilt binaries for common platforms (no build tools
  needed on most hosts).

## Honest limits — please read

- **20 GB files are technically supported** (chunked, resumable upload; the
  server streams chunks to disk and never holds a whole file in RAM), but
  actually moving 20 GB needs **20 GB of free server disk + the bandwidth to
  transfer it**. Free hosting tiers (Render free, Railway trial, etc.) will
  not handle that — uploads will fail or time out there. Lower `MAX_FILE_SIZE`
  (e.g. `500MB`) on small hosts. A VPS with enough disk is the realistic
  option for multi-GB transfers.
- **Calls behind strict NATs/firewalls:** voice/video uses peer-to-peer WebRTC
  with free Google STUN servers, which works for most home/mobile networks.
  On symmetric NATs or corporate firewalls calls may fail to connect — that
  needs a **TURN server** (relays media). Free options: Cloudflare Calls (free
  tier), Metered TURN (free tier), or self-host coturn on a VPS. Add your TURN
  credentials to the `RTCPeerConnection` config in
  `client/src/context/CallContext.jsx`.
- Group voice/video calls are not implemented (1:1 only, by design).
- This is a self-hosted starter app, not a hardened production system: no
  rate limiting, no E2E encryption (use HTTPS via your host), JWTs live in
  localStorage.

## Reset demo data

Delete the database and uploads, then restart — the seed data is recreated on
the next boot:

```bash
rm -rf server/data/chat.db server/uploads
npm start
# demo1 / demo2 (password: demo1234) are recreated automatically
```

To remove the demo accounts entirely in production, delete them via the DB or
register real users and delete the demo rows; seeding only runs when the users
table is empty.
