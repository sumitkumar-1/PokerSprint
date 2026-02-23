(function roomPage() {
  const socket = io();
  const roomId = window.location.pathname.split("/").pop().toUpperCase();
  const storageKey = `planning-poker:${roomId}`;

  const ui = {
    roomLabel: document.getElementById("room-label"),
    roomId: document.getElementById("room-id"),
    joinPanel: document.getElementById("join-panel"),
    roomPanel: document.getElementById("room-panel"),
    joinForm: document.getElementById("join-form"),
    joinError: document.getElementById("join-error"),
    nameInput: document.getElementById("name-input"),
    roundNumber: document.getElementById("round-number"),
    statusLabel: document.getElementById("status-label"),
    participants: document.getElementById("participants"),
    voteOptions: document.getElementById("vote-options"),
    voteFeedback: document.getElementById("vote-feedback"),
    resultGrid: document.getElementById("result-grid"),
    resultSummary: document.getElementById("result-summary"),
    historyEmpty: document.getElementById("history-empty"),
    historyTable: document.getElementById("history-table"),
    historyBody: document.getElementById("history-body"),
    startBtn: document.getElementById("start-btn"),
    revealBtn: document.getElementById("reveal-btn"),
    resetBtn: document.getElementById("reset-btn"),
    copyLink: document.getElementById("copy-link"),
    votingHint: document.getElementById("voting-hint")
  };

  const state = {
    clientId: getOrCreateClientId(),
    name: "",
    isAdmin: false,
    currentVote: null,
    room: null
  };

  ui.roomLabel.textContent = roomId;
  ui.roomId.textContent = roomId;

  const saved = loadJoinData();
  if (saved?.name) {
    ui.nameInput.value = saved.name;
    joinRoom(saved.name);
  }

  ui.joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = ui.nameInput.value.trim();
    joinRoom(name);
  });

  ui.startBtn.addEventListener("click", () => {
    socket.emit("round:start", {}, handleActionAck);
  });

  ui.revealBtn.addEventListener("click", () => {
    socket.emit("round:reveal", {}, handleActionAck);
  });

  ui.resetBtn.addEventListener("click", () => {
    state.currentVote = null;
    socket.emit("round:reset", {}, handleActionAck);
  });

  ui.copyLink.addEventListener("click", async () => {
    const shareUrl = `${window.location.origin}/room/${roomId}`;
    try {
      await copyText(shareUrl);
      if (isLocalhost()) {
        ui.voteFeedback.textContent =
          "Room link copied. localhost links only work on this same machine.";
      } else {
        ui.voteFeedback.textContent = "Room link copied.";
      }
    } catch (_error) {
      ui.voteFeedback.textContent = "Failed to copy link.";
    }
  });

  socket.on("room:state", (roomState) => {
    const previousRoom = state.room;
    if (
      previousRoom &&
      (roomState.currentRound !== previousRoom.currentRound ||
        (previousRoom.status !== "waiting" && roomState.status === "waiting"))
    ) {
      state.currentVote = null;
    }

    state.room = roomState;
    state.isAdmin = roomState.adminClientId === state.clientId;
    renderRoom();
  });

  socket.on("disconnect", () => {
    ui.voteFeedback.textContent = "Disconnected. Reconnecting...";
  });

  socket.on("connect", () => {
    if (state.name) {
      joinRoom(state.name);
    }
  });

  function joinRoom(name) {
    if (!name) {
      ui.joinError.textContent = "Enter your name to join.";
      return;
    }
    socket.emit("room:join", { roomId, name, clientId: state.clientId }, (response) => {
      if (!response?.ok) {
        const errorText = response?.error || "Unable to join room.";
        if (errorText === "Room not found.") {
          ui.joinError.textContent = roomNotFoundHelp();
        } else {
          ui.joinError.textContent = errorText;
        }
        ui.joinPanel.classList.remove("hidden");
        ui.roomPanel.classList.add("hidden");
        return;
      }
      state.name = name;
      saveJoinData({ name });
      ui.joinError.textContent = "";
      ui.joinPanel.classList.add("hidden");
      ui.roomPanel.classList.remove("hidden");
      ui.voteFeedback.textContent = response.isAdmin ? "You are the room admin." : "";
    });
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;

    ui.roundNumber.textContent = String(room.currentRound);
    ui.statusLabel.textContent = room.status.toUpperCase();
    ui.statusLabel.dataset.status = room.status;
    ui.votingHint.textContent = statusHint(room.status);

    ui.participants.innerHTML = "";
    room.participants.forEach((participant) => {
      const li = document.createElement("li");
      li.className = "chip";
      const labels = [];
      if (participant.clientId === room.adminClientId) labels.push("Admin");
      if (participant.clientId === state.clientId) labels.push("You");
      li.textContent = labels.length
        ? `${participant.name} (${labels.join(", ")})`
        : participant.name;
      ui.participants.appendChild(li);
    });

    renderVoteOptions(room.settings.votingOptions, room.status === "voting");
    renderResultCards(room);
    renderHistory(room.history);
    renderAdminControls(room.status);
  }

  function renderVoteOptions(options, enabled) {
    ui.voteOptions.innerHTML = "";
    options.forEach((option) => {
      const btn = document.createElement("button");
      btn.className = "btn vote-btn";
      if (state.currentVote === option) {
        btn.classList.add("active");
      }
      btn.textContent = option;
      btn.disabled = !enabled;
      btn.addEventListener("click", () => {
        socket.emit("vote:submit", { vote: option }, (response) => {
          if (!response?.ok) {
            ui.voteFeedback.textContent = response?.error || "Failed to submit vote.";
            return;
          }
          state.currentVote = option;
          ui.voteFeedback.textContent = `Vote submitted: ${option}`;
          renderRoom();
        });
      });
      ui.voteOptions.appendChild(btn);
    });
  }

  function renderResultCards(room) {
    ui.resultGrid.innerHTML = "";
    room.participants.forEach((participant, index) => {
      const card = document.createElement("article");
      card.className = "result-card";
      if (room.status === "revealed") {
        card.classList.add("revealed");
      }
      card.style.setProperty("--delay", `${index * 60}ms`);

      const name = document.createElement("div");
      name.className = "result-name";
      name.textContent = participant.name;

      const face = document.createElement("div");
      face.className = "result-face";

      const value = document.createElement("div");
      value.className = "result-value";
      value.textContent = room.status === "revealed" ? participant.vote || "-" : "?";

      const status = document.createElement("div");
      status.className = "result-status";
      if (room.status === "revealed") {
        status.textContent = "Revealed";
      } else if (room.status === "voting" && participant.hasVoted) {
        status.textContent = "Voted";
      } else if (room.status === "voting") {
        status.textContent = "Waiting";
      } else {
        status.textContent = "Not Started";
      }

      face.appendChild(value);
      face.appendChild(status);
      card.appendChild(name);
      card.appendChild(face);
      ui.resultGrid.appendChild(card);
    });

    const latestRound = room.history[room.history.length - 1];
    const avgText = latestRound?.average === null ? "N/A" : String(latestRound.average);
    if (room.status === "revealed") {
      ui.resultSummary.innerHTML = `
        <h2 class="result-average-title">Average</h2>
        <div class="average-card">${avgText}</div>
        <p class="muted average-note">Non-numeric votes are excluded from average.</p>
      `;
    } else if (room.status === "voting") {
      ui.resultSummary.innerHTML =
        '<p class="muted">Cards will reveal together when reveal is triggered.</p>';
    } else {
      ui.resultSummary.innerHTML =
        '<p class="muted">Start estimation to begin collecting votes.</p>';
    }
  }

  function renderHistory(history) {
    if (!history.length) {
      ui.historyEmpty.classList.remove("hidden");
      ui.historyTable.classList.add("hidden");
      ui.historyBody.innerHTML = "";
      return;
    }

    ui.historyEmpty.classList.add("hidden");
    ui.historyTable.classList.remove("hidden");
    ui.historyBody.innerHTML = "";

    history.forEach((entry) => {
      const tr = document.createElement("tr");
      const roundCell = document.createElement("td");
      const votesCell = document.createElement("td");
      const averageCell = document.createElement("td");
      const typeCell = document.createElement("td");

      roundCell.textContent = String(entry.round);
      const voteItems = Array.isArray(entry.voteDetails)
        ? entry.voteDetails.map((item) => `${item.name}: ${item.vote}`)
        : Object.entries(entry.votes).map(([clientId, vote]) => `${clientId}: ${vote}`);
      votesCell.textContent = voteItems.join(" | ");
      averageCell.textContent = entry.average === null ? "N/A" : String(entry.average);
      typeCell.textContent = entry.autoRevealed ? "Auto" : "Manual";

      tr.appendChild(roundCell);
      tr.appendChild(votesCell);
      tr.appendChild(averageCell);
      tr.appendChild(typeCell);
      ui.historyBody.appendChild(tr);
    });
  }

  function renderAdminControls(status) {
    const adminControls = document.querySelectorAll(".admin-only");
    adminControls.forEach((el) => {
      el.classList.toggle("hidden", !state.isAdmin);
    });

    ui.startBtn.disabled = status !== "waiting";
    ui.revealBtn.disabled = status !== "voting";
    ui.resetBtn.disabled = status !== "revealed";
  }

  function handleActionAck(response) {
    if (!response?.ok) {
      ui.voteFeedback.textContent = response?.error || "Action failed.";
      return;
    }
    ui.voteFeedback.textContent = "";
  }

  function statusHint(status) {
    if (status === "waiting") return "Waiting for estimation to start.";
    if (status === "voting") return "Select a vote. Votes remain hidden.";
    if (status === "revealed") return "Votes revealed. Admin can reset for next round.";
    return "";
  }

  function getOrCreateClientId() {
    const key = "planning-poker:client-id";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(key, generated);
    return generated;
  }

  function saveJoinData(payload) {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }

  function loadJoinData() {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function isLocalhost() {
    return (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  }

  function roomNotFoundHelp() {
    if (isLocalhost()) {
      return (
        "Room not found on this server instance. If shared from another machine, " +
        "localhost will not work. Use that machine's IP/domain in the URL."
      );
    }
    return "Room not found. Ask the host to recreate/share the latest room link.";
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!successful) {
      throw new Error("Fallback copy failed");
    }
  }
})();
