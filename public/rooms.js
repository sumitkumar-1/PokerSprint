(function roomsPage() {
  const socket = io();
  const totalRooms = document.getElementById("total-rooms");
  const lastRefresh = document.getElementById("last-refresh");
  const refreshBtn = document.getElementById("refresh-btn");
  const empty = document.getElementById("monitor-empty");
  const table = document.getElementById("monitor-table");
  const body = document.getElementById("monitor-body");

  if (!totalRooms || !lastRefresh || !refreshBtn || !empty || !table || !body) return;

  refreshBtn.addEventListener("click", () => {
    fetchRooms();
  });

  socket.on("connect", () => {
    fetchRooms();
  });

  socket.on("rooms:state", (payload) => {
    render(payload.rooms || [], payload.generatedAt);
  });

  fetchRooms();

  async function fetchRooms() {
    refreshBtn.disabled = true;
    try {
      const response = await fetch("/api/rooms/list", { cache: "no-store" });
      const payload = await response.json();
      render(payload.rooms || [], payload.generatedAt);
    } catch (_error) {
      lastRefresh.textContent = "Failed to load";
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function render(rooms, generatedAt) {
    totalRooms.textContent = String(rooms.length);
    lastRefresh.textContent = generatedAt ? formatDate(generatedAt) : "-";
    body.innerHTML = "";

    if (!rooms.length) {
      empty.classList.remove("hidden");
      table.classList.add("hidden");
      return;
    }

    empty.classList.add("hidden");
    table.classList.remove("hidden");

    rooms.forEach((room) => {
      const row = document.createElement("tr");

      const roomCell = document.createElement("td");
      roomCell.textContent = room.id;

      const statusCell = document.createElement("td");
      statusCell.textContent = String(room.status || "").toUpperCase();

      const roundCell = document.createElement("td");
      roundCell.textContent = String(room.currentRound || 1);

      const participantsCell = document.createElement("td");
      const names = (room.participants || []).map((participant) => participant.name);
      participantsCell.textContent = `${room.participantCount} (${names.join(", ") || "-"})`;

      const adminCell = document.createElement("td");
      adminCell.textContent = room.adminName || "-";

      const creatorCell = document.createElement("td");
      creatorCell.textContent = room.creatorName || "-";

      const historyCell = document.createElement("td");
      historyCell.textContent = String(room.historyCount || 0);

      const activeCell = document.createElement("td");
      activeCell.textContent = formatDate(room.lastActiveAt);

      const actionCell = document.createElement("td");
      const joinLink = document.createElement("a");
      joinLink.className = "btn";
      joinLink.href = `/room/${room.id}`;
      joinLink.textContent = "Open";

      const copyBtn = document.createElement("button");
      copyBtn.className = "btn";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        const fullUrl = `${window.location.origin}/room/${room.id}`;
        try {
          await copyText(fullUrl);
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1000);
        } catch (_error) {
          copyBtn.textContent = "Failed";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1000);
        }
      });

      actionCell.appendChild(joinLink);
      actionCell.appendChild(copyBtn);
      actionCell.className = "actions";

      row.appendChild(roomCell);
      row.appendChild(statusCell);
      row.appendChild(roundCell);
      row.appendChild(participantsCell);
      row.appendChild(creatorCell);
      row.appendChild(adminCell);
      row.appendChild(historyCell);
      row.appendChild(activeCell);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
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
