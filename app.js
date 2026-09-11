let currentRoom = null;
let stopPublicWatch = null;
let stopRoomWatch = null;
let lastRows = [];
let lastRoomData = { seats: [] };
let busy = false;

const appEl = document.getElementById("app");
const errorEl = document.getElementById("error");
const authEl = document.getElementById("auth");

function showError(err) {
  const message =
    (err && err.message) ||
    (err && err.error) ||
    (typeof err === "string" ? err : "Something went wrong.");
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function stopWatches() {
  if (stopPublicWatch) {
    stopPublicWatch();
    stopPublicWatch = null;
  }
  if (stopRoomWatch) {
    stopRoomWatch();
    stopRoomWatch = null;
  }
}

async function runAction(input) {
  const result = await mystack.run(input);
  if (result == null || (typeof result === "object" && !Object.keys(result).length)) {
    throw new Error("Create/join did not reach the server. Redeploy the MyStack app host.");
  }
  const body = result.ok != null || result.room ? result : result.data;
  if (body && body.ok === false) {
    throw new Error(body.error || "Request failed.");
  }
  if ((input.action === "create" || input.action === "join") && !(body && body.room)) {
    throw new Error("No room code came back from the server.");
  }
  return body || result;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playerLabel(row) {
  const seat = row.data && typeof row.data.seat === "number" ? row.data.seat + 1 : "?";
  const name = row.name || "Anonymous";
  if (name === "Anonymous") return `Player ${seat}`;
  return `${name} (P${seat})`;
}

function renderLobby() {
  appEl.innerHTML = `
    <p class="muted">Create a room or join with a 6-digit code.</p>
    <div class="row">
      <button type="button" id="create">Create room</button>
    </div>
    <form id="join-form">
      <input
        id="code"
        name="code"
        inputmode="numeric"
        maxlength="6"
        pattern="[0-9]{6}"
        placeholder="000000"
        required
      />
      <button type="submit">Join</button>
    </form>
  `;

  document.getElementById("create").onclick = async () => {
    if (busy) return;
    busy = true;
    clearError();
    try {
      const result = await runAction({ action: "create" });
      enterRoom(result.room);
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  };

  document.getElementById("join-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const code = document.getElementById("code").value.trim();
    busy = true;
    clearError();
    try {
      const result = await runAction({ action: "join", room: code });
      enterRoom(result.room);
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  };
}

function renderRoom() {
  const seats = Array.isArray(lastRoomData.seats) ? lastRoomData.seats : [];
  const items = seats
    .map((seat, index) => {
      const row = lastRows.find((item) => item.data && item.data.seat === index);
      const presses = Number(seat && seat.presses) || 0;
      const label = row
        ? playerLabel(row)
        : `Player ${index + 1}`;
      return `<li>${escapeHtml(label)}: ${presses}</li>`;
    })
    .join("");

  appEl.innerHTML = `
    <h2>Room ${escapeHtml(currentRoom)}</h2>
    <div class="row">
      <button type="button" id="press">Press</button>
      <button type="button" id="leave">Leave</button>
    </div>
    <p class="muted">Presses in this room</p>
    <ul>${items || "<li class='muted'>Waiting for players.</li>"}</ul>
  `;

  document.getElementById("press").onclick = async () => {
    if (busy) return;
    busy = true;
    clearError();
    try {
      await runAction({ action: "press", room: currentRoom });
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  };

  document.getElementById("leave").onclick = async () => {
    if (busy) return;
    busy = true;
    clearError();
    try {
      await runAction({ action: "leave", room: currentRoom });
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
      leaveRoom();
    }
  };
}

function paintRoom() {
  if (!currentRoom) return;
  renderRoom();
}

function enterRoom(room) {
  stopWatches();
  currentRoom = room;
  lastRows = [];
  lastRoomData = { seats: [] };
  paintRoom();

  if (mystack.room.watch) {
    stopRoomWatch = mystack.room.watch(room, ({ data }) => {
      lastRoomData = data || { seats: [] };
      paintRoom();
    });
  } else {
    const pollRoom = async () => {
      try {
        const snapshot = await mystack.room.get(room);
        lastRoomData = (snapshot && snapshot.data) || { seats: [] };
        paintRoom();
      } catch (err) {
        showError(err);
      }
    };
    pollRoom();
    const roomId = setInterval(pollRoom, 3000);
    stopRoomWatch = () => clearInterval(roomId);
  }

  if (mystack.public.watch) {
    stopPublicWatch = mystack.public.watch(
      ({ rows }) => {
        lastRows = rows || [];
        paintRoom();
      },
      { order: "updated_at", limit: 50, match: { room } }
    );
    return;
  }

  const poll = async () => {
    try {
      const { rows } = await mystack.public.list({
        order: "updated_at",
        limit: 50,
        match: { room },
      });
      lastRows = rows || [];
      paintRoom();
    } catch (err) {
      showError(err);
    }
  };
  poll();
  const id = setInterval(poll, 3000);
  stopPublicWatch = () => clearInterval(id);
}

function leaveRoom() {
  stopWatches();
  currentRoom = null;
  renderLobby();
}

async function renderAuth() {
  const { signedIn } = await mystack.auth.session();
  authEl.innerHTML = "";

  if (!signedIn && mystack.auth.login) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Sign in";
    btn.onclick = () => mystack.auth.login();
    authEl.appendChild(btn);
  }

  if (signedIn && mystack.auth.logout) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Sign out";
    btn.onclick = () => mystack.auth.logout();
    authEl.appendChild(btn);
  }
}

async function main() {
  if (typeof mystack === "undefined") {
    document.body.textContent = "Open this app on its MyStack URL.";
    return;
  }

  try {
    await renderAuth();
    const priv = await mystack.db.get();
    if (priv && priv.room) {
      enterRoom(priv.room);
    } else {
      renderLobby();
    }
  } catch (err) {
    showError(err);
    renderLobby();
  }
}

main();
