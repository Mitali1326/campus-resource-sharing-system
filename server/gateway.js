// gateway.js
//
// The Gateway is the MIDDLEWARE the browser talks to. It gives clients
// "transparency": a student calling bookResource() has no idea which
// department node (container) really holds the resource - the gateway looks
// the node up (naming), forwards the call (RPC), then tells everybody what
// happened (publish/subscribe).
//
// FA-1 (Unit 1 + 2) lives in this file:
//   RPC forwarding, pub/sub notifications, inter-department chat relay,
//   WebRTC signalling, node status + Bully leader, Lamport clock.
// FA-2 (Unit 3 + 4) is split into two service files so each can be read alone:
//   services/unit3.js  synchronisation
//   services/unit4.js  emerging distributed paradigms

const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { DEPT_ORDER, DEPT_NAMES, ELECTION_PRIORITY, NODE_REGISTRY } = require("./shared/config");

const PORT = process.env.PORT || 5000;

// ---------- Lamport logical clock (Unit 3: logical clocks) ----------
// One counter at the gateway. Every event that crosses a process boundary
// bumps it, which gives every event a "happened-before" order without any
// synchronised wall clock. The LC=n tags in the UI come from here.
let lamportClock = 0;
function tick() {
  lamportClock += 1;
  return lamportClock;
}
const getLamport = () => lamportClock;

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
// This is a demo project, so never let the browser cache an old app.js.
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate"),
  })
);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ---------- Low-level helper: call one remote procedure on one node ----------
async function callNode(deptCode, method, params) {
  const nodeUrl = NODE_REGISTRY[deptCode];
  if (!nodeUrl) throw new Error(`Unknown department code: ${deptCode}`);
  const r = await fetch(`${nodeUrl}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const data = await r.json();
  if (!r.ok || data.ok === false) throw new Error(data.error || `RPC ${method} failed on ${deptCode} node`);
  return data.result;
}

// ---------- Which nodes are alive, and who is the leader? ----------
// Bully rule: the coordinator is the highest-priority node that is reachable.
// Re-computed every 2 s and on every /api/nodes call, so killing the leader's
// container makes the crown move on its own.
let liveCache = { at: 0, nodes: [], leader: null };

async function refreshLive() {
  const checks = await Promise.all(
    Object.entries(NODE_REGISTRY).map(async ([deptCode, url]) => {
      const priority = ELECTION_PRIORITY[deptCode] || 0;
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) });
        const data = await r.json();
        return { deptCode, url, status: "up", nodeId: data.nodeId, deptName: data.deptName, priority };
      } catch {
        return { deptCode, url, status: "down", nodeId: null, deptName: null, priority };
      }
    })
  );
  const up = checks.filter((n) => n.status === "up");
  const leader = up.length ? up.reduce((a, b) => (b.priority > a.priority ? b : a)).deptCode : null;
  liveCache = {
    at: Date.now(),
    leader,
    nodes: checks.map((n) => ({ ...n, isLeader: n.deptCode === leader })),
  };
  return liveCache;
}
const liveDepts = () => liveCache.nodes.filter((n) => n.status === "up").map((n) => n.deptCode);
const getLeader = () => liveCache.leader;
refreshLive();
setInterval(refreshLive, 2000);

// ---------- Inter-department chat relay (FA-1) ----------
// A message from A to B is written into TWO nodes: A's node ("sent") and B's
// node ("received"). Each keeps its own copy - there is no shared chat table.
// Unit 3 addition: the sender's VECTOR CLOCK travels with the message and is
// merged into the receiver's vector clock.
async function relayChat(fromDept, toDept, text, kind = "user") {
  const sent = await callNode(fromDept, "logMessage", { withDept: toDept, text, direction: "sent", kind });
  await callNode(toDept, "logMessage", { withDept: fromDept, text, direction: "received", kind, vector: sent.vector });
  const clock = tick();
  io.emit("chat-message", { fromDept, toDept, text, kind, timestamp: Date.now(), lamportClock: clock, vector: sent.vector });
}

// Everything the service files need from the gateway.
const ctx = {
  app, io, callNode, tick, getLamport, refreshLive, liveDepts, getLeader, relayChat,
  DEPT_ORDER, DEPT_NAMES, ELECTION_PRIORITY, NODE_REGISTRY,
  invalidateCache: () => {},
};
const unit3 = require("./services/unit3")(ctx);
const unit4 = require("./services/unit4")(ctx);

// ---------- Booking helpers ----------
// Every way of booking or cancelling (the booking screen, the remote-object
// "book" method, the waiting list, ...) goes through these two functions, so
// every booking is protected by the lock (mutual exclusion), announced to all
// browsers (pub/sub), written to the audit ledger and purges the caches.
let requestCounter = 0;

async function finishBooking(method, deptCode, params, result, extra) {
  io.emit("resource-updated", {
    deptCode, method, result,
    crossDept: Boolean(result.crossDept),
    timestamp: Date.now(),
    lamportClock: tick(),
    ...(extra || {}),
  });

  // Cross-department booking: the two departments' nodes exchange a request /
  // confirmation message pair automatically.
  if (method === "bookResource" && result.crossDept) {
    const bookerDept = params.requesterDept;
    const bookerName = DEPT_NAMES[bookerDept] || bookerDept;
    const resourceName = DEPT_NAMES[deptCode] || deptCode;
    try {
      await relayChat(bookerDept, deptCode,
        `Hi ${resourceName}, we've booked "${result.resource.name}" for ${result.slotLabel}.`, "system");
      await relayChat(deptCode, bookerDept,
        `Confirmed — "${result.resource.name}" is reserved for ${bookerName} during ${result.slotLabel}.`, "system");
    } catch (chatErr) {
      console.warn("Auto chat message failed:", chatErr.message);
    }
  }

  // Purge caches, add a ledger block, fire the serverless event function.
  await unit4.afterBooking({ method, deptCode, params, result });
}

async function bookSlot(deptCode, params, extra) {
  const owner = `${params.requesterDept || deptCode}#${++requestCounter}`;
  const key = `${deptCode}:${params.resourceId}:${params.slotId}`;
  const result = await unit3.lockedRun(key, owner, () => callNode(deptCode, "bookResource", params), `bookResource ${params.resourceId}/${params.slotId}`);
  await finishBooking("bookResource", deptCode, params, result, extra);
  return result;
}

// When a slot is freed, the first department on its waiting list receives it.
async function promoteNext(deptCode, resourceId, slotId) {
  const w = unit3.takeNextWaiter(deptCode, resourceId, slotId);
  if (!w) return null;
  try {
    const result = await bookSlot(deptCode, { resourceId, slotId, studentName: w.name, requesterDept: w.dept }, { fromWaitingList: true });
    io.emit("waitlist-updated", {});
    return { dept: w.dept, name: w.name, slotLabel: result.slotLabel };
  } catch (e) {
    console.warn("Waiting-list promotion failed:", e.message);
    return null;
  }
}

async function cancelSlot(deptCode, params, opts = {}) {
  const owner = `${params.requesterDept || deptCode}#${++requestCounter}`;
  const key = `${deptCode}:${params.resourceId}:${params.slotId}`;
  const result = await unit3.lockedRun(key, owner, () => callNode(deptCode, "cancelBooking", params), `cancelBooking ${params.resourceId}/${params.slotId}`);
  await finishBooking("cancelBooking", deptCode, params, result);
  const promoted = opts.promote === false ? null : await promoteNext(deptCode, params.resourceId, params.slotId);
  return { result, promoted };
}
ctx.bookSlot = bookSlot;
ctx.cancelSlot = cancelSlot;

// ---------- RPC gateway endpoint (FA-1) ----------
app.post("/api/rpc", async (req, res) => {
  const { deptCode, method, params } = req.body;
  const clock = tick(); // event: RPC request received

  try {
    if (method === "bookResource") {
      const result = await bookSlot(deptCode, params);
      return res.json({ ok: true, result, lamportClock: clock });
    }
    if (method === "cancelBooking") {
      const { result, promoted } = await cancelSlot(deptCode, params);
      return res.json({ ok: true, result, promoted, lamportClock: clock });
    }
    const result = await callNode(deptCode, method, params);
    res.json({ ok: true, result, lamportClock: clock });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message, lamportClock: clock });
  }
});

// ---------- Chat endpoints (FA-1) ----------
app.post("/api/chat/send", async (req, res) => {
  const { fromDept, toDept, text } = req.body;
  if (!fromDept || !toDept || !text || !text.trim()) {
    return res.status(400).json({ ok: false, error: "fromDept, toDept and text are all required" });
  }
  if (!NODE_REGISTRY[fromDept] || !NODE_REGISTRY[toDept]) {
    return res.status(400).json({ ok: false, error: "Unknown department code" });
  }
  try {
    await relayChat(fromDept, toDept, text.trim(), "user");
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get("/api/chat/history", async (req, res) => {
  const { dept, withDept } = req.query;
  if (!NODE_REGISTRY[dept] || !NODE_REGISTRY[withDept]) {
    return res.status(400).json({ ok: false, error: "Unknown department code" });
  }
  try {
    // Asks DEPT's own node for its own copy of the conversation.
    const result = await callNode(dept, "getMessages", { withDept });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------- Node health / leader (FA-1) ----------
app.get("/api/nodes", async (req, res) => {
  const live = await refreshLive();
  res.json({ nodes: live.nodes, lamportClock, leader: live.leader });
});

// ---------- WebRTC signalling relay (FA-1) ----------
// The socket is used ONLY for the offer/answer/ICE handshake. Once connected,
// audio/video flows directly between the two browsers (peer-to-peer).
io.on("connection", (socket) => {
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit("peer-joined", { socketId: socket.id });
  });
  socket.on("signal", ({ roomId, data }) => {
    socket.to(roomId).emit("signal", { from: socket.id, data });
  });
  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit("peer-left", { socketId: socket.id });
  });
  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) socket.to(roomId).emit("peer-left", { socketId: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`[gateway] listening on port ${PORT}`);
  console.log(`[gateway] open http://localhost:${PORT} in your browser`);
});
