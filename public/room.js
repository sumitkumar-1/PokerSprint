(function roomPage() {
  const socket = io();
  const roomId = window.location.pathname.split("/").pop().toUpperCase();
  const storageKey = `planning-poker:${roomId}`;
  const numericScale = ["1", "2", "3", "5", "8", "13", "21"];

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
    jiraSetupToggle: document.getElementById("jira-setup-toggle"),
    jiraQueueToggle: document.getElementById("jira-queue-toggle"),
    votingHint: document.getElementById("voting-hint"),
    currentIssueCard: document.getElementById("current-issue-card"),
    currentIssueKey: document.getElementById("current-issue-key"),
    currentIssueSummary: document.getElementById("current-issue-summary"),
    currentIssuePosition: document.getElementById("current-issue-position"),
    jiraSetupForm: document.getElementById("jira-setup-form"),
    jiraTokenInput: document.getElementById("jira-token-input"),
    jiraFieldInput: document.getElementById("jira-field-input"),
    jiraIssuesInput: document.getElementById("jira-issues-input"),
    jiraSaveBtn: document.getElementById("jira-save-btn"),
    jiraUpdateBtn: document.getElementById("jira-update-btn"),
    jiraSetupCancelBtn: document.getElementById("jira-setup-cancel-btn"),
    jiraFormFeedback: document.getElementById("jira-form-feedback"),
    jiraQueue: document.getElementById("jira-queue"),
    jiraQueueSummary: document.getElementById("jira-queue-summary"),
    jiraAppendInput: document.getElementById("jira-append-input"),
    jiraAppendBtn: document.getElementById("jira-append-btn"),
    jiraQueueCloseBtn: document.getElementById("jira-queue-close-btn"),
    jiraSetupModal: document.getElementById("jira-setup-modal"),
    jiraQueueModal: document.getElementById("jira-queue-modal"),
    jiraConfirmModal: document.getElementById("jira-confirm-modal"),
    confirmIssueKey: document.getElementById("confirm-issue-key"),
    confirmIssueSummary: document.getElementById("confirm-issue-summary"),
    jiraEstimateSelect: document.getElementById("jira-estimate-select"),
    jiraConfirmFeedback: document.getElementById("jira-confirm-feedback"),
    jiraConfirmBtn: document.getElementById("jira-confirm-btn"),
    jiraCancelBtn: document.getElementById("jira-cancel-btn")
  };

  const state = {
    clientId: getOrCreateClientId(),
    name: "",
    isAdmin: false,
    currentVote: null,
    room: null,
    jiraTokenDraft: "",
    jiraFieldDraft: ""
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
    joinRoom(ui.nameInput.value.trim());
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
      ui.voteFeedback.textContent = isLocalhost()
        ? "Room link copied. localhost links only work on this same machine."
        : "Room link copied.";
    } catch (_error) {
      ui.voteFeedback.textContent = "Failed to copy link.";
    }
  });

  ui.jiraSetupToggle.addEventListener("click", () => {
    ui.jiraSetupModal.classList.remove("hidden");
  });

  ui.jiraQueueToggle.addEventListener("click", () => {
    if (!state.room?.jira?.jiraConfigured) return;
    ui.jiraQueueModal.classList.remove("hidden");
  });

  ui.jiraSetupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.jiraTokenDraft = ui.jiraTokenInput.value.trim();
    state.jiraFieldDraft = ui.jiraFieldInput.value.trim();
    socket.emit(
      "jira:setup",
      {
        token: state.jiraTokenDraft,
        storyPointsFieldId: state.jiraFieldDraft,
        issues: ui.jiraIssuesInput.value
      },
      (response) => handleJiraAck(response, "Jira setup saved.")
    );
  });

  ui.jiraUpdateBtn.addEventListener("click", () => {
    state.jiraTokenDraft = ui.jiraTokenInput.value.trim();
    state.jiraFieldDraft = ui.jiraFieldInput.value.trim();
    socket.emit(
      "jira:update-config",
      {
        token: state.jiraTokenDraft,
        storyPointsFieldId: state.jiraFieldDraft
      },
      (response) => handleJiraAck(response, "Jira settings updated.")
    );
  });

  ui.jiraAppendBtn.addEventListener("click", () => {
    socket.emit("jira:append-issues", { issues: ui.jiraAppendInput.value }, (response) => {
      if (!response?.ok) {
        ui.jiraFormFeedback.textContent = response?.error || "Failed to append Jira issues.";
        return;
      }
      ui.jiraAppendInput.value = "";
      ui.jiraFormFeedback.textContent = "Jira queue updated.";
    });
  });

  ui.jiraConfirmBtn.addEventListener("click", () => {
    socket.emit("jira:confirm-estimate", { value: ui.jiraEstimateSelect.value }, (response) => {
      if (!response?.ok) {
        ui.jiraConfirmFeedback.textContent = response?.error || "Failed to update Jira.";
        return;
      }
      ui.jiraConfirmFeedback.textContent = "";
      closeConfirmModal();
      ui.voteFeedback.textContent = "Jira issue updated.";
    });
  });

  ui.jiraCancelBtn.addEventListener("click", () => {
    closeConfirmModal();
  });

  ui.jiraSetupCancelBtn.addEventListener("click", () => {
    ui.jiraSetupModal.classList.add("hidden");
  });

  ui.jiraQueueCloseBtn.addEventListener("click", () => {
    ui.jiraQueueModal.classList.add("hidden");
  });

  ui.jiraConfirmModal.querySelector(".modal-backdrop").addEventListener("click", () => {
    closeConfirmModal();
  });

  ui.jiraSetupModal.querySelector(".modal-backdrop").addEventListener("click", () => {
    ui.jiraSetupModal.classList.add("hidden");
  });

  ui.jiraQueueModal.querySelector(".modal-backdrop").addEventListener("click", () => {
    ui.jiraQueueModal.classList.add("hidden");
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
    if (shouldOpenConfirmModal(previousRoom, roomState)) {
      openConfirmModal();
    }
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
        ui.joinError.textContent =
          errorText === "Room not found." ? roomNotFoundHelp() : errorText;
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

    renderParticipants(room);
    renderJiraBanner(room);
    renderJiraQueue(room);
    renderJiraAdminPanel(room);
    renderVoteOptions(room.settings.votingOptions, room.status === "voting");
    renderResultCards(room);
    renderHistory(room.history);
    renderAdminControls(room.status);
  }

  function renderParticipants(room) {
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
  }

  function renderJiraBanner(room) {
    const currentIssue = room.jira?.currentIssue;
    if (!room.jira?.jiraConfigured || !currentIssue) {
      ui.currentIssueCard.classList.add("hidden");
      return;
    }
    ui.currentIssueCard.classList.remove("hidden");
    ui.currentIssueKey.textContent = currentIssue.key;
    ui.currentIssueSummary.textContent = currentIssue.summary || "Summary unavailable";
    ui.currentIssuePosition.textContent = `${currentIssue.position} of ${currentIssue.total}`;
  }

  function renderJiraQueue(room) {
    const jira = room.jira;
    ui.jiraQueue.innerHTML = "";
    if (!jira?.jiraConfigured || !jira.queue.length) {
      ui.jiraQueueSummary.textContent = "No Jira queue configured yet.";
      ui.jiraQueueToggle.classList.add("hidden");
      return;
    }
    ui.jiraQueueToggle.classList.remove("hidden");
    ui.jiraQueueSummary.textContent =
      `${jira.queueCounts.pending} pending, ${jira.queueCounts.updated} updated, ${jira.queueCounts.failed} failed`;

    jira.queue.forEach((issue) => {
      const item = document.createElement("li");
      item.className = "queue-item";
      if (jira.currentIssue?.key === issue.key) {
        item.classList.add("active");
      }
      if (issue.status === "failed") {
        item.classList.add("failed");
      }

      const meta = document.createElement("div");
      meta.className = "queue-meta";

      const key = document.createElement("div");
      key.className = "queue-key";
      key.textContent = issue.key;

      const summary = document.createElement("div");
      summary.className = "queue-summary";
      summary.textContent = issue.summary || "Summary unavailable";

      meta.appendChild(key);
      meta.appendChild(summary);

      if (issue.error) {
        const error = document.createElement("div");
        error.className = "queue-summary";
        error.textContent = issue.error;
        meta.appendChild(error);
      }

      const status = document.createElement("div");
      status.className = `queue-status ${issue.status}`;
      status.textContent = issue.status;

      item.appendChild(meta);
      item.appendChild(status);
      ui.jiraQueue.appendChild(item);
    });
  }

  function renderJiraAdminPanel(room) {
    const jira = room.jira;
    if (!state.jiraFieldDraft) {
      state.jiraFieldDraft = jira?.storyPointsFieldId || "customfield_10166";
    }
    ui.jiraFieldInput.value = state.jiraFieldDraft;
    if (state.jiraTokenDraft) {
      ui.jiraTokenInput.value = state.jiraTokenDraft;
    }
    if (jira?.jiraConfigured && jira?.lastJiraActionStatus?.message) {
      ui.jiraFormFeedback.textContent = jira.lastJiraActionStatus.message;
    } else if (!jira?.jiraConfigured) {
      ui.jiraFormFeedback.textContent = "";
    }
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
    ui.jiraUpdateBtn.disabled = status === "voting";
    if (!state.room?.jira?.jiraConfigured) {
      ui.jiraQueueToggle.classList.add("hidden");
    }
  }

  function openConfirmModal() {
    const room = state.room;
    const currentIssue = room?.jira?.currentIssue;
    if (!currentIssue) return;
    const latestRound = room.history[room.history.length - 1];
    const suggestion = suggestedEstimate(room, latestRound?.average ?? null);
    const options = room.settings.votingOptions.filter((value) => numericScale.includes(String(value)));
    ui.jiraEstimateSelect.innerHTML = "";
    options.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      if (String(suggestion) === String(value)) {
        option.selected = true;
      }
      ui.jiraEstimateSelect.appendChild(option);
    });
    if (!ui.jiraEstimateSelect.value && options.length) {
      ui.jiraEstimateSelect.value = options[0];
    }
    ui.confirmIssueKey.textContent = currentIssue.key;
    ui.confirmIssueSummary.textContent = currentIssue.summary || "Summary unavailable";
    ui.jiraConfirmFeedback.textContent = "";
    ui.jiraConfirmModal.classList.remove("hidden");
  }

  function closeConfirmModal() {
    ui.jiraConfirmModal.classList.add("hidden");
  }

  function shouldOpenConfirmModal(previousRoom, nextRoom) {
    if (!state.isAdmin) return false;
    if (!nextRoom?.jira?.jiraConfigured || !nextRoom?.jira?.currentIssue) return false;
    const nextIssue = nextRoom.jira.currentIssue;
    if (nextRoom.status !== "revealed" || nextIssue.status === "updated") return false;
    return previousRoom?.status !== "revealed";
  }

  function suggestedEstimate(room, average) {
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

  function handleActionAck(response) {
    if (!response?.ok) {
      ui.voteFeedback.textContent = response?.error || "Action failed.";
      return;
    }
    ui.voteFeedback.textContent = "";
  }

  function handleJiraAck(response, successMessage) {
    if (!response?.ok) {
      ui.jiraFormFeedback.textContent = response?.error || "Jira action failed.";
      return;
    }
    ui.jiraFormFeedback.textContent = "";
    ui.voteFeedback.textContent = response?.message || successMessage;
    ui.jiraSetupModal.classList.add("hidden");
  }

  function statusHint(status) {
    if (status === "waiting") return "Waiting for estimation to start.";
    if (status === "voting") return "Select a vote. Votes remain hidden.";
    if (status === "revealed") {
      return state.room?.jira?.jiraConfigured
        ? "Votes revealed. Confirm Jira update or reset the round."
        : "Votes revealed. Reset the round when the team is ready.";
    }
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
    return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
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
