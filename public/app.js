// app.js — runs in the browser (the "client" side)

// ---------------- Fail loudly, not silently ----------------
// If anything throws anywhere in this file - a blocked script, a
// server that isn't reachable, a bug - show it as a visible red
// banner instead of leaving a blank page with no explanation. This
// matters most exactly when you can least afford it: mid-demo.
function showFatalError(message) {
  let banner = document.getElementById("fatal-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "fatal-error-banner";
    banner.style.cssText =
      "position:sticky;top:0;z-index:9999;background:#c8402e;color:#fff;" +
      "padding:10px 16px;font-family:sans-serif;font-size:14px;font-weight:600;";
    document.body.prepend(banner);
  }
  banner.textContent = "⚠ " + message;
}

window.addEventListener("error", (e) => {
  showFatalError(
    `Script error: ${e.message}. Open DevTools (F12) → Console for details.`
  );
});

if (typeof io === "undefined") {
  showFatalError(
    "socket.io library did not load. Check that public/vendor/socket.io.min.js exists and was copied into the Docker image, and that no browser extension is blocking it."
  );
  throw new Error("io is not defined — aborting app.js init");
}

const socket = io();
socket.on("connect_error", () => {
  showFatalError(
    "Could not open a live connection to the gateway. Confirm 'docker compose up' is still running and you're using http:// (not https://) on localhost:5000."
  );
});

const DEPARTMENTS = [
  { code: "comp", name: "Computer Engineering" },
  { code: "it", name: "Information Technology" },
  { code: "mech", name: "Mechanical Engineering" },
  { code: "elec", name: "Electrical Engineering" },
  { code: "civil", name: "Civil Engineering" },
  { code: "entc", name: "Electronics & Telecommunication" },
  { code: "central", name: "Central Library" },
];

const DEPT_COLORS = {
  comp: "#2f6fed", it: "#0891b2", mech: "#c2660a", elec: "#a08300",
  civil: "#7a4a1e", entc: "#7c3aed", central: "#1f9d64",
};

function deptName(code) {
  return DEPARTMENTS.find((d) => d.code === code)?.name || code;
}

// ---------------- Demo login ----------------
// This is a classroom-demo login, not real security: passcodes are
// fixed and listed in the README. The point is to tie every booking
// and chat message to a real department identity instead of letting
// anyone claim to be any department, which is what "proper
// authentication" means at the scope of this mini project.
const DEPT_PASSCODES = {
  comp: "comp123", it: "it123", mech: "mech123", elec: "elec123",
  civil: "civil123", entc: "entc123", central: "central123",
};

let currentUser = null; // { name, dept }
try {
  currentUser = JSON.parse(localStorage.getItem("campusUser") || "null");
} catch {
  currentUser = null;
}

let loginModal = null;
let bookingModal = null;
let activeDept = "comp";
let chatWithDept = null;
let pendingBooking = null; // { resourceId, resourceName, slotId, slotLabel }

function getLoginModal() {
  if (!loginModal) loginModal = new bootstrap.Modal(document.getElementById("loginModal"));
  return loginModal;
}

function refreshSessionUI() {
  const badge = document.getElementById("session-badge");
  const logoutBtn = document.getElementById("logout-btn");
  if (currentUser) {
    badge.textContent = `${currentUser.name} — ${deptName(currentUser.dept)}`;
    logoutBtn.classList.remove("d-none");
  } else {
    badge.textContent = "Not logged in (guest)";
    logoutBtn.classList.add("d-none");
  }
}

function requireLogin() {
  if (currentUser) return true;
  getLoginModal().show();
  return false;
}

document.getElementById("login-submit").addEventListener("click", () => {
  const name = document.getElementById("login-name").value.trim();
  const dept = document.getElementById("login-dept").value;
  const passcode = document.getElementById("login-passcode").value;
  const errorEl = document.getElementById("login-error");

  if (!name) {
    errorEl.textContent = "Please enter your name.";
    errorEl.classList.remove("d-none");
    return;
  }
  if (passcode !== DEPT_PASSCODES[dept]) {
    errorEl.textContent = "Incorrect passcode for that department. Check the README.";
    errorEl.classList.remove("d-none");
    return;
  }

  currentUser = { name, dept };
  localStorage.setItem("campusUser", JSON.stringify(currentUser));
  errorEl.classList.add("d-none");
  getLoginModal().hide();
  refreshSessionUI();
  activeDept = dept;
  renderTabs();
  loadResources();
  renderChatDeptOptions();
});

document.getElementById("login-guest").addEventListener("click", () => {
  getLoginModal().hide();
});

document.getElementById("logout-btn").addEventListener("click", () => {
  currentUser = null;
  localStorage.removeItem("campusUser");
  refreshSessionUI();
  getLoginModal().show();
});

// ---------------- RPC helper ----------------
// Every call here is a Remote Procedure Call: the browser calls
// "bookResource" as if it were a local function, but the gateway
// forwards it to a completely different process (a different
// department's node, possibly a different container/machine).
async function rpc(deptCode, method, params) {
  logRpc(`> POST /api/rpc   { deptCode: "${deptCode}", method: "${method}" }`);
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deptCode, method, params }),
  });
  const data = await res.json();
  const lc = typeof data.lamportClock === "number" ? `LC=${data.lamportClock}` : "";
  logRpc(
    data.ok
      ? `< 200 OK  [${lc}]  ${JSON.stringify(data.result).slice(0, 100)}`
      : `< ERROR   [${lc}]  ${data.error}`
  );
  if (!data.ok) throw new Error(data.error || "RPC call failed");
  return data.result;
}

function logRpc(line) {
  const el = document.getElementById("rpc-log");
  el.textContent += line + "\n";
  el.scrollTop = el.scrollHeight;
}

// ---------------- Node status strip ----------------
// Also drives the leader-election display: the node with the crown
// is the current coordinator under a simplified Bully algorithm,
// recomputed by the gateway on every poll from whichever nodes are
// actually reachable right now.
async function refreshNodeStrip() {
  const res = await fetch("/api/nodes");
  const payload = await res.json();
  const nodes = payload.nodes || payload; // tolerate either shape
  const strip = document.getElementById("node-strip");
  strip.innerHTML = nodes
    .map((n) => {
      const up = n.status === "up";
      const leader = n.isLeader ? ' <span class="leader-tag" title="Elected coordinator (Bully algorithm), priority ' + n.priority + '">LEADER</span>' : "";
      return `<span class="node-pill ${up ? "node-up" : "node-down"}"><span class="node-dot"></span>${deptName(n.deptCode)}${up ? "" : " (offline)"}${leader}</span>`;
    })
    .join("");

  const clockEl = document.getElementById("lamport-clock");
  if (clockEl && typeof payload.lamportClock === "number") {
    clockEl.textContent = `Lamport clock: ${payload.lamportClock}`;
  }
}

// ---------------- Department tabs ----------------
function renderTabs() {
  const nav = document.getElementById("dept-tabs");
  nav.innerHTML = DEPARTMENTS.map(
    (d) => `<li class="nav-item">
      <button class="nav-link ${d.code === activeDept ? "active" : ""}" data-dept="${d.code}">${d.name}</button>
    </li>`
  ).join("");

  nav.querySelectorAll("[data-dept]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeDept = btn.dataset.dept;
      renderTabs();
      loadResources();
      renderChatDeptOptions();
    });
  });
}

// ---------------- Resource grid (slot-based) ----------------
async function loadResources() {
  const grid = document.getElementById("resource-grid");
  grid.innerHTML = `<p class="text-muted">Loading resources from the ${activeDept} department node...</p>`;
  try {
    const result = await rpc(activeDept, "listResources", {});
    await loadWaitlist();
    renderResources(result.resources);
  } catch (err) {
    grid.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

// ---------------- Waiting list (Unit 3: deadlock detection) ----------------
// waitMap: "dept:resourceId:slotId" -> [waiting entries]
let waitMap = {};
async function loadWaitlist() {
  const r = await api("GET", "/api/waitlist");
  waitMap = {};
  ((r.data && r.data.entries) || []).forEach((w) => {
    const k = `${w.targetDept}:${w.resourceId}:${w.slotId}`;
    (waitMap[k] = waitMap[k] || []).push(w);
  });
}
socket.on("waitlist-updated", () => loadResources());

async function joinWaitlist(resourceId, slotId) {
  if (!requireLogin()) return;
  const r = await api("POST", "/api/waitlist/join", { dept: currentUser.dept, name: currentUser.name, targetDept: activeDept, resourceId, slotId });
  if (!r.data.ok) return alert(r.data.error);
  logRpc(`> POST /api/waitlist/join  -> position ${r.data.position}; deadlock check (edge-chasing probes): ${r.data.deadlock ? "DEADLOCK" : "none"}`);
  if (r.data.deadlock) showDeadlockAlert(r.data.cycle);
  await loadResources();
}
async function leaveWaitlist(id) {
  await api("POST", "/api/waitlist/leave", { id });
  await loadResources();
}
function showDeadlockAlert(cycle) {
  const box = document.getElementById("deadlock-alert");
  document.getElementById("deadlock-text").textContent =
    "Deadlock detected: " + cycle.map(deptName).join(" waits for ") + " waits for " + deptName(cycle[0]) +
    ". Nobody in this circle can ever get the slot they want.";
  box.classList.remove("d-none");
}
document.getElementById("deadlock-resolve").addEventListener("click", async () => {
  const r = await api("POST", "/api/deadlock/resolve");
  document.getElementById("deadlock-alert").classList.add("d-none");
  alert(r.data.message);
  await loadResources();
});
document.getElementById("deadlock-close").addEventListener("click", () => document.getElementById("deadlock-alert").classList.add("d-none"));

function renderResources(resources) {
  const grid = document.getElementById("resource-grid");
  grid.innerHTML = resources.map((r) => renderResourceCard(r)).join("");

  grid.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { action, id, slotId, slotLabel, name, wid } = btn.dataset;
      if (action === "wait") joinWaitlist(id, slotId);
      if (action === "unwait") leaveWaitlist(wid);
      if (action === "details") openDetails(id, name);
      if (action === "book") openBookingModal(id, name, slotId, slotLabel);
      if (action === "cancel") cancelBooking(id, slotId);
      if (action === "collab") openCollabRoom(id, slotId, name);
    });
  });
}

function renderResourceCard(r) {
  const slotRows = Object.entries(r.slots)
    .map(([slotId, slot]) => renderSlotRow(r, slotId, slot))
    .join("");

  return `
    <div class="card resource-card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <div class="resource-id">${r.id}</div>
            <div class="card-title mb-0">${r.name}</div>
            <div class="text-muted small">Capacity: ${r.capacity}</div>
          </div>
          <button class="btn btn-sm btn-outline-secondary" data-action="details" data-id="${r.id}" data-name="${r.name}" title="Calls methods on the remote object obj://${activeDept}-node/${r.id}">Details</button>
        </div>
        <div class="slot-table mt-3">
          ${slotRows}
        </div>
      </div>
    </div>`;
}

function renderSlotRow(r, slotId, slot) {
  if (!slot.booked) {
    return `
      <div class="slot-row">
        <span class="slot-time">${slot.label}</span>
        <span class="tag tag-free">Available</span>
        <button class="btn btn-sm btn-primary ms-auto" data-action="book" data-id="${r.id}" data-slot-id="${slotId}" data-slot-label="${slot.label}" data-name="${r.name}">Book</button>
      </div>`;
  }

  const crossBadge =
    slot.bookedByDept && slot.bookedByDept !== activeDept
      ? `<span class="tag tag-cross ms-1">inter-dept: ${deptName(slot.bookedByDept)}</span>`
      : "";

  const waiting = waitMap[`${activeDept}:${r.id}:${slotId}`] || [];
  const mine = currentUser ? waiting.find((w) => w.dept === currentUser.dept) : null;
  const waitTag = waiting.length ? `<span class="tag tag-wait ms-1" title="${esc(waiting.map((w) => deptName(w.dept)).join(", "))}">${waiting.length} waiting</span>` : "";
  let waitBtn = "";
  if (mine) waitBtn = `<button class="btn btn-sm btn-outline-secondary" data-action="unwait" data-wid="${mine.id}">Leave waiting list</button>`;
  else if (currentUser && slot.bookedByDept !== currentUser.dept) waitBtn = `<button class="btn btn-sm btn-outline-secondary" data-action="wait" data-id="${r.id}" data-slot-id="${slotId}">Join waiting list</button>`;

  return `
    <div class="slot-row">
      <span class="slot-time">${slot.label}</span>
      <span class="tag tag-booked">Booked</span>
      ${crossBadge}${waitTag}
      <span class="slot-who">by ${esc(slot.bookedBy)} (${deptName(slot.bookedByDept)})</span>
      <div class="ms-auto d-flex gap-2 flex-wrap">
        ${waitBtn}
        <button class="btn btn-sm btn-outline-primary" data-action="collab" data-id="${r.id}" data-slot-id="${slotId}" data-name="${r.name}">Start / Join Call</button>
        <button class="btn btn-sm btn-outline-secondary" data-action="cancel" data-id="${r.id}" data-slot-id="${slotId}">Cancel</button>
      </div>
    </div>`;
}

// ---------------- Booking modal ----------------
function openBookingModal(resourceId, resourceName, slotId, slotLabel) {
  if (!requireLogin()) return;

  pendingBooking = { resourceId, resourceName, slotId, slotLabel };
  document.getElementById("modal-title").textContent = "Book: " + resourceName;
  document.getElementById("modal-slot-label").textContent = "Time slot: " + slotLabel;
  document.getElementById("modal-name").value = currentUser.name;
  document.getElementById("modal-dept").value = currentUser.dept;
  document.getElementById("modal-error").classList.add("d-none");

  if (!bookingModal) {
    bookingModal = new bootstrap.Modal(document.getElementById("bookingModal"));
  }
  bookingModal.show();
}

async function confirmBooking() {
  const name = document.getElementById("modal-name").value.trim();
  const requesterDept = document.getElementById("modal-dept").value;
  const errorEl = document.getElementById("modal-error");

  if (!name) {
    errorEl.textContent = "Please enter your name.";
    errorEl.classList.remove("d-none");
    return;
  }

  try {
    await rpc(activeDept, "bookResource", {
      resourceId: pendingBooking.resourceId,
      slotId: pendingBooking.slotId,
      studentName: name,
      requesterDept,
    });
    bookingModal.hide();
    loadResources();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("d-none");
  }
}

async function cancelBooking(resourceId, slotId) {
  try {
    await rpc(activeDept, "cancelBooking", { resourceId, slotId, studentName: currentUser ? currentUser.name : "-", requesterDept: currentUser ? currentUser.dept : undefined });
    loadResources();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------- Live notifications (pub/sub) ----------------
socket.on("resource-updated", (event) => {
  const feed = document.getElementById("message-feed");
  const empty = feed.querySelector(".text-muted");
  if (empty && feed.children.length === 1) feed.innerHTML = "";

  const verb = event.method === "bookResource" ? "booked" : "cancelled";
  const deptLabel = deptName(event.deptCode);
  const crossTag = event.crossDept
    ? `<span class="tag tag-cross ms-1">inter-dept</span>`
    : "";

  const li = document.createElement("li");
  li.className = "list-group-item";
  const lcTag = typeof event.lamportClock === "number"
    ? `<span class="lc-tag">LC=${event.lamportClock}</span>`
    : "";
  const slotText = (event.result.slotLabel ? ` (${event.result.slotLabel})` : "") + (event.fromWaitingList ? ' <span class="tag tag-wait">from waiting list</span>' : "");
  li.innerHTML = `${lcTag}<strong>${event.result.resource.name}</strong>${slotText} ${verb} on the <strong>${deptLabel}</strong> node ${crossTag}`;
  feed.prepend(li);
  while (feed.children.length > 12) feed.removeChild(feed.lastChild);

  if (event.deptCode === activeDept) loadResources();
});

// ================= Inter-department chat =================
function renderChatDeptOptions() {
  const select = document.getElementById("chat-with-select");
  const options = DEPARTMENTS.filter((d) => d.code !== activeDept);
  select.innerHTML = options.map((d) => `<option value="${d.code}">${d.name}</option>`).join("");
  chatWithDept = options[0]?.code || null;
  loadChatThread();
}

document.getElementById("chat-with-select").addEventListener("change", (e) => {
  chatWithDept = e.target.value;
  loadChatThread();
});

async function loadChatThread() {
  const thread = document.getElementById("chat-thread");
  if (!chatWithDept) return;
  thread.innerHTML = `<p class="text-muted small p-3 mb-0">Loading conversation...</p>`;
  try {
    const res = await fetch(`/api/chat/history?dept=${activeDept}&withDept=${chatWithDept}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderChatMessages(data.result.messages);
  } catch (err) {
    thread.innerHTML = `<p class="text-danger small p-3 mb-0">${err.message}</p>`;
  }
}

function renderChatMessages(messages) {
  const thread = document.getElementById("chat-thread");
  if (!messages.length) {
    thread.innerHTML = `<p class="text-muted small p-3 mb-0">No messages yet. Book a cross-department resource or say hello below.</p>`;
    return;
  }
  thread.innerHTML = messages
    .map((m) => {
      const bubbleClass = m.kind === "system" ? "chat-bubble-system" : (m.direction === "sent" ? "chat-bubble-sent" : "chat-bubble-received");
      const vc = m.vector ? `<div class="chat-vc" title="Vector clock after this message">VC ${vcText(m.vector)}</div>` : "";
      return `<div class="chat-bubble ${bubbleClass}">${esc(m.text)}${vc}</div>`;
    })
    .join("");
  thread.scrollTop = thread.scrollHeight;
}

document.getElementById("chat-send").addEventListener("click", sendChatMessage);
document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

async function sendChatMessage() {
  if (!requireLogin()) return;
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !chatWithDept) return;

  try {
    await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromDept: activeDept, toDept: chatWithDept, text }),
    });
    input.value = "";
  } catch (err) {
    alert("Could not send message: " + err.message);
  }
}

socket.on("chat-message", (event) => {
  const involvesCurrentThread =
    (event.fromDept === activeDept && event.toDept === chatWithDept) ||
    (event.toDept === activeDept && event.fromDept === chatWithDept);
  if (involvesCurrentThread) loadChatThread();
});

// ================= WebRTC collaboration room =================
let pc = null;
let localStream = null;
let currentRoom = null;

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function openCollabRoom(resourceId, slotId, resourceName) {
  currentRoom = `room-${resourceId}-${slotId}`;
  document.getElementById("collab").classList.remove("d-none");
  document.getElementById("collab-sub").textContent =
    `Session for "${resourceName}" — peer-to-peer once connected`;
  document.getElementById("remote-label").textContent = "Waiting for peer...";
  document.getElementById("collab").scrollIntoView({ behavior: "smooth" });

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById("local-video").srcObject = localStream;

  pc = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    document.getElementById("remote-video").srcObject = event.streams[0];
    document.getElementById("remote-label").textContent = "Peer (P2P stream)";
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { roomId: currentRoom, data: { candidate: event.candidate } });
    }
  };

  socket.emit("join-room", currentRoom);
}

socket.on("peer-joined", async () => {
  if (!pc) return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { roomId: currentRoom, data: { sdp: offer } });
});

socket.on("signal", async ({ data }) => {
  if (!pc) return;
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { roomId: currentRoom, data: { sdp: answer } });
    }
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.warn("ICE candidate error", e);
    }
  }
});

socket.on("peer-left", () => {
  document.getElementById("remote-video").srcObject = null;
  document.getElementById("remote-label").textContent = "Peer left the room";
});

function leaveCollabRoom() {
  if (currentRoom) socket.emit("leave-room", currentRoom);
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  document.getElementById("collab").classList.add("d-none");
  currentRoom = null;
}

document.getElementById("collab-close").addEventListener("click", leaveCollabRoom);
document.getElementById("leave-call").addEventListener("click", leaveCollabRoom);

document.getElementById("toggle-mic").addEventListener("click", (e) => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? "Mute mic" : "Unmute mic";
});

document.getElementById("toggle-cam").addEventListener("click", (e) => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? "Turn off camera" : "Turn on camera";
});

// ---------------- Modal confirm wiring ----------------
document.getElementById("modal-confirm").addEventListener("click", confirmBooking);

// ---------------- Init ----------------
refreshSessionUI();
if (currentUser) {
  activeDept = currentUser.dept;
} else {
  getLoginModal().show();
}
renderTabs();
loadResources();
renderChatDeptOptions();
refreshNodeStrip();
setInterval(refreshNodeStrip, 5000);


// ---------------- Resource details = calls on a REMOTE OBJECT (Unit 4) ----------------
// Every resource is a remote object with a global reference. This panel calls
// three methods of its interface and shows what came back.
let detailsModal = null;
async function openDetails(resourceId, name) {
  const ref = `obj://${activeDept}-node/${resourceId}`;
  document.getElementById("details-title").textContent = name;
  document.getElementById("details-body").innerHTML = '<p class="text-muted">Calling the remote object...</p>';
  if (!detailsModal) detailsModal = new bootstrap.Modal(document.getElementById("detailsModal"));
  detailsModal.show();
  const call = (method) => api("POST", "/api/objects/invoke", { ref, method, args: {} });
  const [d, u, a] = await Promise.all([call("describe"), call("utilization"), call("availability")]);
  if (!d.data.ok) { document.getElementById("details-body").innerHTML = `<p class="text-danger">${esc(d.data.error)}</p>`; return; }
  const desc = d.data.response.returnValue, util = u.data.response.returnValue, avail = a.data.response.returnValue;
  const pct = Math.round((100 * util.bookedSlots) / util.totalSlots);
  document.getElementById("details-body").innerHTML =
    `<p class="mb-2">Remote object reference: <code>${esc(ref)}</code><br><span class="hint">hosted on container <b>${esc(desc.hostedOn)}</b> &middot; class ${esc(desc.class)} &middot; capacity ${desc.capacity}</span></p>` +
    `<div class="mb-2"><div class="small mb-1">utilization() &rarr; ${util.bookedSlots} of ${util.totalSlots} slots booked (${pct}%)</div><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>` +
    `<div class="small mb-1">availability() &rarr;</div>` +
    `<table class="table table-sm table-bordered small mb-2"><tbody>${Object.entries(avail).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v === "free" ? '<span class="tag tag-free">free</span>' : '<span class="tag tag-booked">booked</span>'}</td></tr>`).join("")}</tbody></table>` +
    `<p class="hint mb-0">The gateway acts as the client-side proxy (stub): it turned these three method calls into messages, found the hosting container from the reference, and returned the results.</p>`;
}
