let currentRoom = null;
let stopPublicWatch = null;
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
}

async function runAction(input) {
  const result = await mystack.run(input);
  if (result && result.ok === false) {
    throw new Error(result.error || "Request failed.");
  }
  return result;
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

function renderRoom(rows) {
  const items = (rows || [])
    .slice()
    .sort((a, b) => (a.data?.seat ?? 0) - (b.data?.seat ?? 0))
    .map((row) => {
      const presses = (row.data && row.data.presses) || 0;
      return `<li>${escapeHtml(playerLabel(row))}: ${presses}</li>`;
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

function enterRoom(room) {
  stopWatches();
  currentRoom = room;
  renderRoom([]);

  if (mystack.public.watch) {
    stopPublicWatch = mystack.public.watch(
      ({ rows }) => renderRoom(rows),
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
      renderRoom(rows);
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
