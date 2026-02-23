const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;
const ROOM_CLEANUP_INTERVAL_MS = 60 * 1000;
const VOTING_OPTIONS = ["1", "2", "3", "5", "8", "13", "21", "?", "☕"];

const rooms = {};

function roomMonitorState(room) {
  const admin = room.participants.find((p) => p.clientId === room.adminClientId) || null;
  const creator =
    room.participants.find((p) => p.clientId === room.createdByClientId) || null;
  return {
    id: room.id,
    status: room.status,
    currentRound: room.currentRound,
    participantCount: room.participants.length,
    participants: room.participants.map((p) => ({
      clientId: p.clientId,
      name: p.name
    })),
    adminName: admin?.name || null,
    creatorName: creator?.name || null,
    historyCount: room.history.length,
    createdAt: room.createdAt,
    lastActiveAt: room.lastActiveAt
  };
}

function allRoomsMonitorState() {
  return Object.values(rooms)
    .map((room) => roomMonitorState(room))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

function randomRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

function createRoom(createdByClientId = null) {
  let roomId = randomRoomId();
  while (rooms[roomId]) {
    roomId = randomRoomId();
  }
  rooms[roomId] = {
    id: roomId,
    createdByClientId: createdByClientId || null,
    adminClientId: null,
    participants: [],
    participantDirectory: {},
    status: "waiting",
    currentRound: 1,
    roundVotes: {},
    history: [],
    settings: {
      votingOptions: VOTING_OPTIONS
    },
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  };
  return rooms[roomId];
}

function findParticipant(room, clientId) {
  return room.participants.find((p) => p.clientId === clientId) || null;
}

function findParticipantBySocket(room, socketId) {
  return room.participants.find((p) => p.socketId === socketId) || null;
}

function roomPublicState(room) {
  return {
    id: room.id,
    adminClientId: room.adminClientId,
    status: room.status,
    currentRound: room.currentRound,
    settings: room.settings,
    participants: room.participants.map((p) => ({
      clientId: p.clientId,
      socketId: p.socketId,
      name: p.name,
      hasVoted: Boolean(room.roundVotes[p.clientId]),
      vote: room.status === "revealed" ? room.roundVotes[p.clientId] || null : null
    })),
    history: room.history
  };
}

function computeAverage(roundVotes) {
  const numericVotes = Object.values(roundVotes)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (numericVotes.length === 0) return null;
  const average = numericVotes.reduce((sum, val) => sum + val, 0) / numericVotes.length;
  return Number(average.toFixed(2));
}

function emitRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.lastActiveAt = Date.now();
  io.to(roomId).emit("room:state", roomPublicState(room));
  io.emit("rooms:state", {
    rooms: allRoomsMonitorState(),
    totalRooms: Object.keys(rooms).length,
    generatedAt: new Date().toISOString()
  });
}

function ensureAdmin(room) {
  if (room.adminClientId && findParticipant(room, room.adminClientId)) {
    return;
  }
  room.adminClientId = room.participants[0]?.clientId || null;
}

function isAdmin(room, clientId) {
  return room.adminClientId === clientId;
}

function validateVote(room, vote) {
  return room.settings.votingOptions.includes(vote);
}

function voteDetailsFromVotes(room, votes) {
  return Object.entries(votes).map(([clientId, vote]) => ({
    clientId,
    name: room.participantDirectory[clientId] || "Unknown",
    vote
  }));
}

setInterval(() => {
  const now = Date.now();
  let deletedAny = false;
  Object.keys(rooms).forEach((roomId) => {
    const room = rooms[roomId];
    if (room.participants.length === 0 && now - room.lastActiveAt > ROOM_IDLE_TTL_MS) {
      delete rooms[roomId];
      deletedAny = true;
    }
  });
  if (deletedAny) {
    io.emit("rooms:state", {
      rooms: allRoomsMonitorState(),
      totalRooms: Object.keys(rooms).length,
      generatedAt: new Date().toISOString()
    });
  }
}, ROOM_CLEANUP_INTERVAL_MS);

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/rooms", (_req, res) => {
  const room = createRoom();
  res.status(201).json({ roomId: room.id, url: `/room/${room.id}` });
});

app.get("/api/rooms/list", (_req, res) => {
  const roomList = allRoomsMonitorState();
  res.json({
    rooms: roomList,
    totalRooms: roomList.length,
    generatedAt: new Date().toISOString()
  });
});

app.get("/rooms", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "rooms.html"));
});

app.get("/room/:roomId", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "room.html"));
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, name, clientId }, ack) => {
    try {
      const normalizedRoomId = String(roomId || "").toUpperCase().trim();
      const normalizedName = String(name || "").trim();
      const normalizedClientId = String(clientId || "").trim();
      if (!normalizedRoomId || !normalizedName || !normalizedClientId) {
        ack?.({ ok: false, error: "Invalid join payload." });
        return;
      }
      const room = rooms[normalizedRoomId];
      if (!room) {
        ack?.({ ok: false, error: "Room not found." });
        return;
      }
      const duplicateName = room.participants.find(
        (p) =>
          p.name.toLowerCase() === normalizedName.toLowerCase() &&
          p.clientId !== normalizedClientId
      );
      if (duplicateName) {
        ack?.({ ok: false, error: "Name already exists in this room." });
        return;
      }

      const existing = findParticipant(room, normalizedClientId);
      if (existing) {
        existing.socketId = socket.id;
        existing.name = normalizedName;
      } else {
        room.participants.push({
          socketId: socket.id,
          clientId: normalizedClientId,
          name: normalizedName
        });
      }
      room.participantDirectory[normalizedClientId] = normalizedName;

      if (room.createdByClientId && room.createdByClientId === normalizedClientId) {
        room.adminClientId = normalizedClientId;
      } else if (!room.adminClientId) {
        room.adminClientId = normalizedClientId;
      }

      socket.join(normalizedRoomId);
      socket.data.roomId = normalizedRoomId;
      socket.data.clientId = normalizedClientId;

      room.lastActiveAt = Date.now();
      ack?.({
        ok: true,
        roomId: normalizedRoomId,
        isAdmin: isAdmin(room, normalizedClientId),
        votingOptions: room.settings.votingOptions
      });
      emitRoomState(normalizedRoomId);
    } catch (error) {
      ack?.({ ok: false, error: "Failed to join room." });
    }
  });

  socket.on("room:create", (payload, ack) => {
    const createdByClientId = String(payload?.clientId || "").trim() || null;
    const room = createRoom(createdByClientId);
    ack?.({ ok: true, roomId: room.id, url: `/room/${room.id}` });
    io.emit("rooms:state", {
      rooms: allRoomsMonitorState(),
      totalRooms: Object.keys(rooms).length,
      generatedAt: new Date().toISOString()
    });
  });

  socket.on("vote:submit", ({ vote }, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (room.status !== "voting") {
      ack?.({ ok: false, error: "Voting is not active." });
      return;
    }
    if (!validateVote(room, vote)) {
      ack?.({ ok: false, error: "Invalid vote option." });
      return;
    }

    room.roundVotes[clientId] = vote;
    room.lastActiveAt = Date.now();
    ack?.({ ok: true });

    const activeParticipantClientIds = new Set(room.participants.map((p) => p.clientId));
    const allVoted = room.participants.length > 0 &&
      room.participants.every((p) => Boolean(room.roundVotes[p.clientId]));

    if (allVoted) {
      const filteredVotes = Object.fromEntries(
        Object.entries(room.roundVotes).filter(([id]) => activeParticipantClientIds.has(id))
      );
      room.status = "revealed";
      room.history.push({
        round: room.currentRound,
        votes: filteredVotes,
        voteDetails: voteDetailsFromVotes(room, filteredVotes),
        average: computeAverage(filteredVotes),
        revealedAt: new Date().toISOString(),
        autoRevealed: true
      });
    }

    emitRoomState(roomId);
  });

  socket.on("round:start", (_payload, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can start estimation." });
      return;
    }

    room.status = "voting";
    room.roundVotes = {};
    room.lastActiveAt = Date.now();
    ack?.({ ok: true });
    emitRoomState(roomId);
  });

  socket.on("round:reveal", (_payload, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can reveal votes." });
      return;
    }
    if (room.status !== "voting") {
      ack?.({ ok: false, error: "No active voting round." });
      return;
    }

    room.status = "revealed";
    const snapshotVotes = { ...room.roundVotes };
    room.history.push({
      round: room.currentRound,
      votes: snapshotVotes,
      voteDetails: voteDetailsFromVotes(room, snapshotVotes),
      average: computeAverage(snapshotVotes),
      revealedAt: new Date().toISOString(),
      autoRevealed: false
    });
    room.lastActiveAt = Date.now();
    ack?.({ ok: true });
    emitRoomState(roomId);
  });

  socket.on("round:reset", (_payload, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can reset round." });
      return;
    }

    room.currentRound += 1;
    room.status = "waiting";
    room.roundVotes = {};
    room.lastActiveAt = Date.now();
    ack?.({ ok: true });
    emitRoomState(roomId);
  });

  socket.on("room:update-settings", ({ votingOptions }, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can update settings." });
      return;
    }
    if (!Array.isArray(votingOptions) || votingOptions.length === 0) {
      ack?.({ ok: false, error: "Invalid voting scale." });
      return;
    }
    room.settings.votingOptions = votingOptions.map((v) => String(v));
    room.lastActiveAt = Date.now();
    ack?.({ ok: true });
    emitRoomState(roomId);
  });

  socket.on("disconnect", () => {
    const { roomId, clientId } = socket.data;
    if (!roomId || !clientId) return;
    const room = rooms[roomId];
    if (!room) return;

    const participant = findParticipantBySocket(room, socket.id);
    if (participant) {
      room.participants = room.participants.filter((p) => p.socketId !== socket.id);
      delete room.roundVotes[clientId];
      ensureAdmin(room);
      room.lastActiveAt = Date.now();
      emitRoomState(roomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Planning Poker app listening on http://localhost:${PORT}`);
});
