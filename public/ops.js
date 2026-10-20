// ops.js - CLUSTER OPERATIONS console
// Unit 3 (synchronization) concepts, shown as administrator tools that act on
// the same real containers the rest of the system uses.

["elect-initiator", "dl-initiator"].forEach((id) => fillDeptSelect(id, false));

// ---------------- Node health: beacon protocol ----------------
async function loadBeacons() {
  const r = await api("GET", "/api/beacons");
  if (!r.data) return;
  const rows = r.data.beacons.map((b) => [
    esc(DEPT_LABELS[b.deptCode]),
    stateTag(b.state),
    b.ageMs !== undefined ? (b.ageMs / 1000).toFixed(1) + " s ago" : "-",
    b.count !== undefined ? b.count : "-",
    b.bookedSlots !== undefined ? b.bookedSlots : "-",
    b.storedBlocks !== undefined ? b.storedBlocks : "-",
  ]);
  setHtml("beacon-out", tbl(["Department", "State", "Last beacon", "Beacons received", "Booked slots (reported)", "File blocks (reported)"], rows));
}
wire("beacon-refresh", loadBeacons);
setInterval(() => { if (isOpen("ops-health") && document.getElementById("tab-ops").classList.contains("active")) loadBeacons(); }, 3000);
document.querySelector('[data-bs-target="#tab-ops"]').addEventListener("shown.bs.tab", loadBeacons);

// ---------------- Clock synchronization ----------------
function clockTable(nodes) {
  return tbl(
    ["Department", "Estimated clock error vs gateway", "Round-trip time", "Real skew that was injected"],
    nodes.map((n) => [esc(DEPT_LABELS[n.deptCode]), `<b>${n.estimatedOffsetMs > 0 ? "+" : ""}${n.estimatedOffsetMs} ms</b>`, ms(n.rttMs), `${n.actualSkewMs > 0 ? "+" : ""}${n.actualSkewMs} ms`])
  );
}
wire("clock-status", async () => {
  const r = await api("GET", "/api/clock/status");
  document.getElementById("clock-steps").classList.add("d-none");
  setHtml("clock-out", "<h6>Current clock error of every node</h6>" + clockTable(r.data.nodes) +
    '<p class="hint mt-1">A positive number means the node\'s clock is ahead of the gateway. The estimate uses Cristian\'s method: node time minus (request time + half the round trip).</p>');
});
async function runSync(kind) {
  const r = await api("POST", "/api/clock/" + kind);
  setHtml("clock-out", "<h6>Before</h6>" + clockTable(r.data.before) + "<h6>After " + r.data.algorithm + "</h6>" + clockTable(r.data.after) +
    (r.data.averageMs !== undefined ? `<p class="hint mt-1">All clocks were moved to the average (${r.data.averageMs} ms from the gateway), not to the gateway's own time.</p>` : '<p class="hint mt-1">All clocks were moved to the time server (gateway). The small leftover error is at most about half the round-trip time.</p>'));
  setOut("clock-steps", r.data.steps.join("\n"));
}
wire("clock-cristian", () => runSync("cristian"));
wire("clock-berkeley", () => runSync("berkeley"));
wire("clock-reset", async () => {
  await api("POST", "/api/clock/reset");
  document.getElementById("clock-steps").classList.add("d-none");
  setHtml("clock-out", verdictBox("warn", "Clocks were set wrong again. Press &ldquo;1. Show clock errors&rdquo;."));
});

// ---------------- Lamport & vector clocks ----------------
const VERDICT_TEXT = {
  concurrent: ["warn", "CONCURRENT - neither event could have influenced the other"],
  "a-happened-before-b": ["good", "Event A HAPPENED-BEFORE event B - A could have influenced B"],
  "b-happened-before-a": ["good", "Event B happened-before event A"],
  equal: ["good", "Identical clocks"],
};
wire("vc-demo", async () => {
  const r = await api("POST", "/api/vector/demo");
  if (!r.data.ok) return setHtml("vc-out", verdictBox("bad", esc(r.data.error)));
  let html = "";
  r.data.steps.forEach((s, i) => {
    const [kind, text] = VERDICT_TEXT[s.verdict] || ["good", s.verdict];
    html += `<h6>Step ${i + 1}</h6><p class="mb-1">${esc(s.text)}</p>` +
      tbl(["", ...r.data.order], [["<b>vector of A</b>", ...r.data.order.map((d) => s.a[d] || 0)], ["<b>vector of B</b>", ...r.data.order.map((d) => s.b[d] || 0)]]) +
      verdictBox(kind, "<b>Verdict:</b> " + text);
  });
  html += '<p class="hint">Rule: A happened-before B if every entry of A is &le; the same entry of B (and at least one is smaller). If some entries are bigger and some smaller, the events are concurrent.</p>';
  setHtml("vc-out", html);
});
wire("vc-show", async () => {
  const r = await api("GET", "/api/vector");
  setHtml("vc-out", "<h6>Vector clock held by every node right now</h6>" +
    tbl(["Node", ...r.data.order], r.data.vectors.map((v) => [`<b>${v.deptCode}</b>`, ...r.data.order.map((d) => v.vector[d])])));
});

// ---------------- Global snapshot ----------------
wire("snap-run", async () => {
  const r = await api("POST", "/api/snapshot", { injectInFlight: document.getElementById("snap-inject").checked });
  if (!r.data.ok) return setHtml("snap-out", verdictBox("bad", esc(r.data.error)));
  const d = r.data;
  let html = `<h6>What happened (initiator: ${esc(d.initiator)})</h6>` + stepsList(d.steps);
  html += "<h6>Recorded local state of every node</h6>" +
    tbl(["Node", "Booked slots", "Vector clock"], d.nodes.map((n) => [`<b>${n.deptCode}</b>`, n.bookedSlots, esc(vcText(n.vector))])) +
    `<p class="hint mt-1">Total booked slots in the whole campus at the snapshot: <b>${d.totalBookedSlots}</b></p>`;
  if (d.inFlightMessages.length) {
    html += "<h6>Messages that were IN FLIGHT (captured as channel state)</h6>" +
      tbl(["Channel", "Message"], d.inFlightMessages.map((m) => [esc(m.channel), esc(m.messages.map((x) => x.text).join(" | "))]));
  }
  html += "<h6>Consistency check for every channel that carried messages</h6>" +
    tbl(["Channel", "Sent by first node", "Received by second node (at its snapshot)", "In flight", "sent - received = in flight ?"],
      d.channels.map((c) => [esc(c.channel), c.sentByA, c.receivedByB, c.inFlight, c.consistent ? stateTag("OK") : stateTag("TAMPERED")]));
  html += verdictBox(d.allConsistent ? "good" : "bad", d.allConsistent
    ? "<b>The snapshot is consistent:</b> for every channel, messages sent minus messages received equals the messages recorded in flight. Nothing was lost or counted twice."
    : "<b>Inconsistent snapshot</b> (normal chat traffic happened during the snapshot - try again).");
  setHtml("snap-out", html);
});

// ---------------- Election ----------------
async function runElection(kind) {
  const r = await api("POST", "/api/election/" + kind, { initiator: document.getElementById("elect-initiator").value });
  if (!r.data.ok) return setHtml("elect-out", verdictBox("bad", esc(r.data.error)));
  setHtml("elect-out", `<h6>${esc(r.data.algorithm)} election</h6>` + stepsList(r.data.steps) +
    verdictBox("good", `<b>Coordinator elected:</b> ${esc(DEPT_LABELS[r.data.coordinator])}`));
}
wire("elect-bully", () => runElection("bully"));
wire("elect-ring", () => runElection("ring"));

// ---------------- Mutual exclusion ----------------
wire("mutex-contend", async () => {
  const r = await api("POST", "/api/mutex/contend", { requesters: ["comp", "it", "mech"] });
  if (!r.data.ok) return setHtml("mutex-out", verdictBox("bad", esc(r.data.error)));
  setHtml("mutex-out", `<h6>Lock manager: ${esc(r.data.lockManager)} &middot; contested slot: <span class="mono">${esc(r.data.slot)}</span></h6>` +
    tbl(["Order of entering the critical section", "Department", "Outcome"], r.data.enteredCriticalSectionInOrder.map((x, i) => [i + 1, esc(x.dept), esc(x.outcome)])) +
    verdictBox("good", esc(r.data.explanation)));
});
wire("mutex-ra", async () => {
  const r = await api("POST", "/api/mutex/ricart-agrawala", {});
  setHtml("mutex-out", "<h6>Ricart-Agrawala (comp has Lamport clock 3, it and mech have clock 1)</h6>" + stepsList(r.data.log) +
    verdictBox("good", `<b>Order of entering the critical section:</b> ${r.data.order.join(" &rarr; ")} &nbsp;|&nbsp; messages per entry: 2(N-1) = ${r.data.messagesPerEntry}`) +
    `<p class="hint">${esc(r.data.note)}</p>`);
});
wire("mutex-log", async () => {
  const r = await api("GET", "/api/mutex/log");
  setHtml("mutex-out", `<h6>Lock log (the current lock manager is the elected leader: ${esc(r.data.leader)})</h6>` +
    (r.data.log.length ? tbl(["LC", "Time", "Event"], r.data.log.map((l) => [l.lamportClock, l.time, `<span class="mono">${esc(l.text)}</span>`])) : '<p class="hint">Nothing yet - book a slot in Booking &amp; Collaboration first.</p>'));
});

// ---------------- Deadlock monitor (works on the real waiting lists) ----------------
function renderWaits(edges, extraHtml) {
  const html = "<h6>Who is waiting for whom (wait-for graph)</h6>" + (edges.length
    ? tbl(["Waiting department", "Waiting for slot", "Held by"], edges.map((e) => [`<b>${esc(DEPT_LABELS[e.from])}</b> <span class="hint">(${esc(e.waiter)})</span>`, esc(e.resource), `<b>${esc(DEPT_LABELS[e.to])}</b> <span class="hint">(${esc(e.holderName)})</span>`]))
    : '<p class="hint">No department is waiting for a slot. Join a waiting list in Booking &amp; Collaboration, or press &ldquo;Create sample deadlock&rdquo;.</p>');
  setHtml("dl-out", html + (extraHtml || ""));
}
async function showWaits(extra) {
  const r = await api("GET", "/api/deadlock/graph");
  renderWaits(r.data.edges, extra);
}
wire("dl-demo", async () => {
  const r = await api("POST", "/api/deadlock/demo");
  if (!r.data.ok) return setHtml("dl-out", verdictBox("bad", esc(r.data.error)));
  await showWaits("<h6>What the sample did</h6>" + stepsList(r.data.steps));
});
wire("dl-refresh", () => showWaits());
wire("dl-detect", async () => {
  const r = await api("POST", "/api/deadlock/detect");
  renderWaits(r.data.edges, verdictBox(r.data.deadlock ? "bad" : "good", `<b>${esc(r.data.method)}</b><br>${esc(r.data.explanation)}`));
});
wire("dl-probe", async () => {
  const init = document.getElementById("dl-initiator").value;
  const r = await api("POST", "/api/deadlock/probe", { initiator: init });
  renderWaits(r.data.edges, "<h6>Probe messages (edge chasing)</h6>" + stepsList(r.data.log) +
    verdictBox(r.data.deadlock ? "bad" : "good", r.data.deadlock ? `<b>${esc(DEPT_LABELS[init])} is in a deadlock.</b>` : `<b>${esc(DEPT_LABELS[init])} is not deadlocked</b> (its probes never came back).`));
});
wire("dl-resolve", async () => {
  const r = await api("POST", "/api/deadlock/resolve");
  await showWaits(verdictBox(r.data.resolved ? "good" : "warn", esc(r.data.message) + (r.data.resolved ? (r.data.stillDeadlocked ? " Another cycle still exists." : " No cycle is left.") : "")));
});
wire("dl-reset", async () => {
  const r = await api("POST", "/api/deadlock/reset");
  await showWaits(verdictBox("good", esc(r.data.message)));
});

// ---------------- Edge cache statistics ----------------
wire("cache-stats", async () => {
  const r = await api("GET", "/api/cache/stats");
  setHtml("cache-stat-out", `<h6>Cache servers (entries expire after ${r.data.ttlMs / 1000} s)</h6>` +
    tbl(["Cache server", "HIT", "MISS", "304 revalidated", "Purged by bookings", "Departments cached now"],
      r.data.edges.map((e) => [`<b>${e.edge}</b>`, e.hits, e.misses, e.notModified, e.purges, esc(e.cachedDepartments.join(", ") || "-")])));
});
wire("cache-clear", async () => {
  await api("POST", "/api/cache/clear");
  setHtml("cache-stat-out", verdictBox("good", "All cache servers were emptied and their counters reset."));
});
