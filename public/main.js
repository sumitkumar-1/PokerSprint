(function homePage() {
  const createButton = document.getElementById("create-room");
  const quickJoinForm = document.getElementById("quick-join-form");
  const roomInput = document.getElementById("room-id-input");
  if (!createButton || !quickJoinForm || !roomInput) return;

  const socket = io();
  const clientId = getOrCreateClientId();

  createButton.addEventListener("click", () => {
    createButton.disabled = true;
    socket.emit("room:create", { clientId }, (response) => {
      createButton.disabled = false;
      if (!response?.ok) return;
      window.location.href = response.url;
    });
  });

  quickJoinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const roomId = roomInput.value.trim().toUpperCase();
    if (!roomId) return;
    window.location.href = `/room/${roomId}`;
  });

  function getOrCreateClientId() {
    const key = "planning-poker:client-id";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(key, generated);
    return generated;
  }
})();
