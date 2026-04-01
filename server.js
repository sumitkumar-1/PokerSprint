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
const JIRA_MOCK_MODE = String(process.env.JIRA_MOCK_MODE || "").toLowerCase() === "true";
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const JIRA_DEFAULT_STORY_POINTS_FIELD =
  process.env.JIRA_DEFAULT_STORY_POINTS_FIELD || "customfield_10166";

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
    currentIssueKey: null,
    lastJiraActionStatus: null,
    settings: {
      votingOptions: VOTING_OPTIONS
    },
    jira: {
      enabled: false,
      token: null,
      storyPointsFieldId: JIRA_DEFAULT_STORY_POINTS_FIELD,
      issues: [],
      currentIssueIndex: 0,
      lastValidation: null
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
  const queueCounts = room.jira.enabled
    ? room.jira.issues.reduce(
        (counts, issue) => {
          counts.total += 1;
          counts[issue.status] = (counts[issue.status] || 0) + 1;
          return counts;
        },
        { total: 0, pending: 0, estimating: 0, updated: 0, failed: 0 }
      )
    : { total: 0, pending: 0, estimating: 0, updated: 0, failed: 0 };
  const currentIssue =
    room.jira.enabled && room.jira.issues[room.jira.currentIssueIndex]
      ? {
          ...sanitizeIssue(room.jira.issues[room.jira.currentIssueIndex]),
          position: room.jira.currentIssueIndex + 1,
          total: room.jira.issues.length
        }
      : null;
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
    history: room.history,
    jira: {
      jiraConfigured: room.jira.enabled,
      storyPointsFieldId: room.jira.storyPointsFieldId,
      queue: room.jira.issues.map(sanitizeIssue),
      queueCounts,
      currentIssue,
      lastValidation: room.jira.lastValidation,
      lastJiraActionStatus: room.lastJiraActionStatus
    }
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

function sanitizeIssue(issue) {
  return {
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    estimatedValue: issue.estimatedValue,
    updatedAt: issue.updatedAt,
    error: issue.error || null
  };
}

function createMockIssue(issueKey) {
  return {
    key: issueKey,
    summary: `Mock summary for ${issueKey}`,
    status: "pending",
    estimatedValue: null,
    updatedAt: null,
    error: null
  };
}

function ensureJiraConfigured() {
  if (JIRA_MOCK_MODE) {
    return;
  }
  if (!JIRA_BASE_URL) {
    throw new Error("JIRA_BASE_URL is not configured on the server.");
  }
}

function jiraHeaders(token) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`
  };
}

async function jiraFetch(pathname, token, options = {}) {
  ensureJiraConfigured();
  return fetch(`${JIRA_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      ...jiraHeaders(token),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
}

async function parseJiraError(response) {
  try {
    const payload = await response.json();
    if (Array.isArray(payload?.errorMessages) && payload.errorMessages.length) {
      return payload.errorMessages.join(", ");
    }
    if (payload?.errors && Object.keys(payload.errors).length) {
      return Object.entries(payload.errors)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
    }
  } catch (_error) {
    return `${response.status} ${response.statusText}`;
  }
  return `${response.status} ${response.statusText}`;
}

function parseIssueKeys(rawIssues) {
  const issueKeys = String(rawIssues || "")
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter(Boolean);
  const uniqueKeys = [];
  const seen = new Set();
  issueKeys.forEach((key) => {
    if (!seen.has(key)) {
      seen.add(key);
      uniqueKeys.push(key);
    }
  });
  return uniqueKeys;
}

async function validateJiraToken(token) {
  if (JIRA_MOCK_MODE) {
    if (!String(token || "").trim()) {
      throw new Error("Mock Jira token validation failed: token is required.");
    }
    return;
  }
  const response = await jiraFetch("/rest/api/2/myself", token);
  if (!response.ok) {
    throw new Error(`Jira token validation failed: ${await parseJiraError(response)}`);
  }
}

async function validateStoryPointsField(token, fieldId) {
  if (JIRA_MOCK_MODE) {
    if (!String(fieldId || "").trim().startsWith("customfield_")) {
      throw new Error("Mock Jira field validation failed: use a customfield_* id.");
    }
    return;
  }
  const response = await jiraFetch("/rest/api/2/field", token);
  if (!response.ok) {
    throw new Error(
      `Story points field validation failed while loading field metadata: ${await parseJiraError(response)}`
    );
  }
  const payload = await response.json();
  const matchedField = Array.isArray(payload)
    ? payload.find((field) => field?.id === fieldId)
    : null;
  if (!matchedField) {
    throw new Error(
      `Story points field validation failed: ${fieldId} was not found in Jira field metadata.`
    );
  }
}

async function fetchIssueDetails(token, issueKey) {
  if (JIRA_MOCK_MODE) {
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) {
      throw new Error(`Issue ${issueKey} validation failed: invalid mock issue key format.`);
    }
    return createMockIssue(issueKey);
  }
  const response = await jiraFetch(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=summary`,
    token
  );
  if (!response.ok) {
    throw new Error(`Issue ${issueKey} validation failed: ${await parseJiraError(response)}`);
  }
  const payload = await response.json();
  return {
    key: issueKey,
    summary: payload?.fields?.summary || "",
    status: "pending",
    estimatedValue: null,
    updatedAt: null,
    error: null
  };
}

async function updateIssueStoryPoints(token, issueKey, fieldId, storyPoints) {
  if (JIRA_MOCK_MODE) {
    if (!String(token || "").trim()) {
      throw new Error("Failed to update mock Jira issue: token is required.");
    }
    if (!String(fieldId || "").trim()) {
      throw new Error("Failed to update mock Jira issue: field id is required.");
    }
    if (!Number.isFinite(Number(storyPoints))) {
      throw new Error("Failed to update mock Jira issue: invalid story point value.");
    }
    return;
  }
  const response = await jiraFetch(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, token, {
    method: "PUT",
    body: JSON.stringify({
      fields: {
        [fieldId]: storyPoints
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to update ${issueKey}: ${await parseJiraError(response)}`);
  }
}

function currentQueueIssue(room) {
  return room.jira.issues[room.jira.currentIssueIndex] || null;
}

function advanceQueueToNextPending(room) {
  for (let index = room.jira.currentIssueIndex; index < room.jira.issues.length; index += 1) {
    if (room.jira.issues[index].status !== "updated") {
      room.jira.currentIssueIndex = index;
      return room.jira.issues[index];
    }
  }
  return null;
}

function estimateSuggestion(room, average) {
  if (average === null || !Number.isFinite(average)) {
    return null;
  }
  const numericOptions = room.settings.votingOptions
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!numericOptions.length) {
    return null;
  }
  const rounded = Math.ceil(average);
  return numericOptions.find((value) => value >= rounded) || numericOptions[numericOptions.length - 1];
}

function updateCurrentIssueStatus(room, status, patch = {}) {
  const issue = currentQueueIssue(room);
  if (!issue) return null;
  issue.status = status;
  Object.assign(issue, patch);
  room.currentIssueKey = issue.key;
  return issue;
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
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    jiraMode: JIRA_MOCK_MODE ? "mock" : "live"
  });
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

    if (room.jira.enabled) {
      const currentIssue = currentQueueIssue(room);
      if (currentIssue?.status === "updated") {
        room.jira.currentIssueIndex += 1;
      }
      const nextIssue = advanceQueueToNextPending(room);
      if (!nextIssue) {
        ack?.({ ok: false, error: "No pending Jira issues left to estimate." });
        return;
      }
      room.jira.issues.forEach((issue, index) => {
        if (index !== room.jira.currentIssueIndex && issue.status === "estimating") {
          issue.status = "pending";
        }
      });
      updateCurrentIssueStatus(room, "estimating", { error: null });
    }

    room.status = "voting";
    room.roundVotes = {};
    room.lastJiraActionStatus = null;
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

  socket.on("jira:setup", async ({ token, storyPointsFieldId, issues }, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can configure Jira." });
      return;
    }
    try {
      ensureJiraConfigured();
      const normalizedToken = String(token || "").trim();
      const normalizedField =
        String(storyPointsFieldId || "").trim() || JIRA_DEFAULT_STORY_POINTS_FIELD;
      const issueKeys = parseIssueKeys(issues);
      if (!normalizedToken) {
        ack?.({ ok: false, error: "Bearer token is required." });
        return;
      }
      if (!issueKeys.length) {
        ack?.({ ok: false, error: "Add at least one Jira issue key." });
        return;
      }

      await validateJiraToken(normalizedToken);
      await validateStoryPointsField(normalizedToken, normalizedField);
      const validatedIssues = [];
      for (const issueKey of issueKeys) {
        validatedIssues.push(await fetchIssueDetails(normalizedToken, issueKey));
      }

      room.jira.enabled = true;
      room.jira.token = normalizedToken;
      room.jira.storyPointsFieldId = normalizedField;
      room.jira.issues = validatedIssues;
      room.jira.currentIssueIndex = 0;
      room.jira.lastValidation = {
        success: true,
        validatedAt: new Date().toISOString()
      };
      room.currentIssueKey = validatedIssues[0]?.key || null;
      room.lastJiraActionStatus = {
        type: "setup",
        success: true,
        message: "Jira setup saved."
      };
      ack?.({ ok: true });
      emitRoomState(roomId);
    } catch (error) {
      console.error(`[jira:setup] room=${roomId} field=${storyPointsFieldId || ""} error=${error.message}`);
      room.lastJiraActionStatus = {
        type: "setup",
        success: false,
        message: error.message
      };
      ack?.({ ok: false, error: error.message });
      emitRoomState(roomId);
    }
  });

  socket.on("jira:update-config", async ({ token, storyPointsFieldId }, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can update Jira settings." });
      return;
    }
    if (room.status === "voting") {
      ack?.({ ok: false, error: "Cannot update Jira settings during an active vote." });
      return;
    }
    try {
      ensureJiraConfigured();
      const normalizedToken = String(token || "").trim();
      const normalizedField =
        String(storyPointsFieldId || "").trim() || JIRA_DEFAULT_STORY_POINTS_FIELD;
      if (!normalizedToken) {
        ack?.({ ok: false, error: "Bearer token is required." });
        return;
      }
      await validateJiraToken(normalizedToken);
      await validateStoryPointsField(normalizedToken, normalizedField);
      room.jira.enabled = true;
      room.jira.token = normalizedToken;
      room.jira.storyPointsFieldId = normalizedField;
      room.jira.lastValidation = {
        success: true,
        validatedAt: new Date().toISOString()
      };
      room.lastJiraActionStatus = {
        type: "config",
        success: true,
        message: "Jira settings updated."
      };
      ack?.({ ok: true });
      emitRoomState(roomId);
    } catch (error) {
      console.error(
        `[jira:update-config] room=${roomId} field=${storyPointsFieldId || ""} error=${error.message}`
      );
      room.lastJiraActionStatus = {
        type: "config",
        success: false,
        message: error.message
      };
      ack?.({ ok: false, error: error.message });
      emitRoomState(roomId);
    }
  });

  socket.on("jira:append-issues", async ({ issues }, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can append Jira issues." });
      return;
    }
    if (!room.jira.enabled || !room.jira.token) {
      ack?.({ ok: false, error: "Configure Jira before appending issues." });
      return;
    }
    try {
      const newKeys = parseIssueKeys(issues);
      if (!newKeys.length) {
        ack?.({ ok: false, error: "Add at least one Jira issue key to append." });
        return;
      }
      const existingKeys = new Set(room.jira.issues.map((issue) => issue.key));
      const appendableKeys = newKeys.filter((key) => !existingKeys.has(key));
      if (!appendableKeys.length) {
        ack?.({ ok: false, error: "All provided Jira issues are already in the queue." });
        return;
      }
      const appendedIssues = [];
      for (const issueKey of appendableKeys) {
        appendedIssues.push(await fetchIssueDetails(room.jira.token, issueKey));
      }
      room.jira.issues.push(...appendedIssues);
      room.lastJiraActionStatus = {
        type: "append",
        success: true,
        message: `${appendedIssues.length} Jira issue(s) appended.`
      };
      ack?.({ ok: true });
      emitRoomState(roomId);
    } catch (error) {
      console.error(`[jira:append-issues] room=${roomId} error=${error.message}`);
      room.lastJiraActionStatus = {
        type: "append",
        success: false,
        message: error.message
      };
      ack?.({ ok: false, error: error.message });
      emitRoomState(roomId);
    }
  });

  socket.on("jira:confirm-estimate", async ({ value }, ack) => {
    const { roomId, clientId } = socket.data;
    const room = rooms[roomId];
    if (!room || !clientId) {
      ack?.({ ok: false, error: "Room context missing." });
      return;
    }
    if (!isAdmin(room, clientId)) {
      ack?.({ ok: false, error: "Only admin can confirm Jira estimates." });
      return;
    }
    if (!room.jira.enabled || !room.jira.token) {
      ack?.({ ok: false, error: "Configure Jira before updating story points." });
      return;
    }
    if (room.status !== "revealed") {
      ack?.({ ok: false, error: "Reveal the round before confirming Jira estimate." });
      return;
    }
    const currentIssue = currentQueueIssue(room);
    if (!currentIssue) {
      ack?.({ ok: false, error: "No active Jira issue selected." });
      return;
    }
    const normalizedValue = Number(value);
    const numericOptions = room.settings.votingOptions
      .map((option) => Number(option))
      .filter((option) => Number.isFinite(option));
    if (!numericOptions.includes(normalizedValue)) {
      ack?.({ ok: false, error: "Choose a valid numeric story point value." });
      return;
    }
    try {
      await updateIssueStoryPoints(
        room.jira.token,
        currentIssue.key,
        room.jira.storyPointsFieldId,
        normalizedValue
      );
      updateCurrentIssueStatus(room, "updated", {
        estimatedValue: normalizedValue,
        updatedAt: new Date().toISOString(),
        error: null
      });
      room.lastJiraActionStatus = {
        type: "confirm",
        success: true,
        message: `${currentIssue.key} updated to ${normalizedValue} story points.`
      };
      ack?.({ ok: true });
      emitRoomState(roomId);
    } catch (error) {
      console.error(
        `[jira:confirm-estimate] room=${roomId} issue=${currentIssue.key} value=${value} error=${error.message}`
      );
      updateCurrentIssueStatus(room, "failed", { error: error.message });
      room.lastJiraActionStatus = {
        type: "confirm",
        success: false,
        message: error.message
      };
      ack?.({ ok: false, error: error.message });
      emitRoomState(roomId);
    }
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
