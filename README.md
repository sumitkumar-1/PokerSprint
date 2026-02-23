# Planning Poker (Standalone Web App)

Lightweight, real-time planning poker tool for Agile teams with in-memory session state.

## Tech Stack

- Node.js + Express
- Socket.IO for real-time events
- Vanilla JS frontend (served by Express as static files)
- In-memory room/session state (no database)
- Docker + docker-compose

## Why this stack

- Single deployment unit: frontend and backend are hosted by the same Node process.
- No separate frontend hosting required.
- Minimal infra footprint while still supporting true multi-user real-time rooms.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.
- Room monitor: `http://localhost:3000/rooms`

## Run with Docker

```bash
docker-compose up --build
```

Open `http://localhost:3000`.
- Room monitor: `http://localhost:3000/rooms`

## Features Implemented

- Room creation with unique room ID
- Shareable room URL (`/room/{roomId}`)
- Monitoring dashboard (`/rooms`) with active rooms, participant counts, status, and links
- Join room with unique participant names
- Admin controls:
  - Start estimation
  - Reveal votes
  - Reset round
- Hidden voting until reveal
- Average calculation (ignoring `?` and `☕`)
- Auto-reveal when all participants vote
- Session history (round, votes, average, reveal type)
- Multi-room support
- Empty-room cleanup
- Admin failover when admin disconnects
- Rejoin behavior using persistent client ID in local storage

## API / App Notes

- State is held in `server.js` in-memory only.
- History is lost when the server restarts by design.
- Health endpoint: `GET /health`
- Room list endpoint: `GET /api/rooms/list`
