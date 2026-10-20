// scripts/smoke-test.js
// Run while the system is up:   npm run smoke
// Calls every important endpoint and prints PASS / FAIL, so you can check
// that all features work before your presentation.

const BASE = process.env.BASE_URL || "http://localhost:5000";
let pass = 0, fail = 0;

async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  return { status: r.status, data, headers: r.headers };
}
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("\n== FA-1: booking, chat, status ==");
  let r = await api("GET", "/api/nodes");
  check("all 7 nodes are up", r.data.nodes.filter((n) => n.status === "up").length === 7, JSON.stringify(r.data.nodes.map((n) => n.deptCode + ":" + n.status)));
  check("a leader is elected", Boolean(r.data.leader));
  r = await api("POST", "/api/rpc", { deptCode: "entc", method: "bookResource", params: { resourceId: "entc-r2", slotId: "s4", studentName: "Smoke", requesterDept: "comp" } });
  check("cross-department booking works", r.data.ok && r.data.result.crossDept === true, JSON.stringify(r.data));
  r = await api("POST", "/api/rpc", { deptCode: "entc", method: "bookResource", params: { resourceId: "entc-r2", slotId: "s4", studentName: "Other", requesterDept: "it" } });
  check("double booking is rejected", r.data.ok === false);
  r = await api("POST", "/api/rpc", { deptCode: "entc", method: "bookResource", params: { resourceId: "entc-r2", slotId: "s1", studentName: "Other", requesterDept: "it" } });
  check("a different slot of the same resource can be booked", r.data.ok === true);
  r = await api("GET", "/api/chat/history?dept=comp&withDept=entc");
  const c1 = r.data.result.messages;
  r = await api("GET", "/api/chat/history?dept=entc&withDept=comp");
  const c2 = r.data.result.messages;
  check("chat copy exists on BOTH nodes", c1.length >= 2 && c2.length >= 2 && c1.length === c2.length);
  check("chat messages carry vector clocks", c1[0] && c1[0].vector && typeof c1[0].vector.comp === "number");

  console.log("\n== Unit 3: synchronization ==");
  await sleep(3500);
  r = await api("GET", "/api/beacons");
  check("beacons received from all nodes", r.data.beacons.filter((b) => b.state === "alive").length === 7, JSON.stringify(r.data.beacons.map((b) => b.deptCode + ":" + b.state)));
  r = await api("POST", "/api/clock/reset");
  r = await api("GET", "/api/clock/status");
  const big = r.data.nodes.filter((n) => Math.abs(n.estimatedOffsetMs) > 400).length;
  check("node clocks start visibly skewed", big >= 4, "nodes with >400ms skew: " + big);
  r = await api("POST", "/api/clock/cristian");
  check("Cristian brings every clock within 150 ms of the gateway", r.data.after.every((n) => Math.abs(n.estimatedOffsetMs) < 150), JSON.stringify(r.data.after.map((n) => n.estimatedOffsetMs)));
  await api("POST", "/api/clock/reset");
  r = await api("POST", "/api/clock/berkeley", {});
  const spread = Math.max(...r.data.after.map((n) => n.estimatedOffsetMs)) - Math.min(...r.data.after.map((n) => n.estimatedOffsetMs));
  check("Berkeley makes all clocks agree with each other (spread < 150 ms)", spread < 150, "spread=" + spread);
  r = await api("POST", "/api/vector/demo");
  check("vector clocks: independent events are CONCURRENT", r.data.steps[0].verdict === "concurrent", r.data.steps[0].verdict);
  check("vector clocks: after a message, event happened-before", r.data.steps[1].verdict === "a-happened-before-b", r.data.steps[1].verdict);
  r = await api("POST", "/api/snapshot", { injectInFlight: true });
  check("snapshot completes with in-flight message captured", r.data.ok && r.data.inFlightMessages.length >= 1, JSON.stringify(r.data).slice(0, 300));
  check("snapshot is consistent on every channel", r.data.allConsistent === true, JSON.stringify(r.data.channels));
  r = await api("POST", "/api/election/bully", { initiator: "comp" });
  check("Bully election picks the strongest live node", r.data.coordinator === "central", r.data.coordinator);
  r = await api("POST", "/api/election/ring", { initiator: "mech" });
  check("Ring election picks the strongest live node", r.data.coordinator === "central", r.data.coordinator);
  r = await api("POST", "/api/mutex/contend", { requesters: ["comp", "it", "mech"] });
  const outcomes = r.data.enteredCriticalSectionInOrder.map((x) => x.outcome);
  check("mutex: exactly one of 3 simultaneous requests booked the slot", outcomes.filter((o) => o.startsWith("BOOKED")).length === 1, JSON.stringify(outcomes));
  r = await api("GET", "/api/mutex/log");
  check("lock manager log has GRANTED entries", r.data.log.some((l) => l.text.includes("GRANTED")));
  r = await api("POST", "/api/mutex/ricart-agrawala", {});
  check("Ricart-Agrawala serves requests in timestamp order", r.data.order.join() === "it,mech,comp", r.data.order.join());
  // ---- waiting list (deadlock detection works on REAL bookings) ----
  r = await api("POST", "/api/rpc", { deptCode: "civil", method: "bookResource", params: { resourceId: "civil-r3", slotId: "s2", studentName: "Holder", requesterDept: "civil" } });
  r = await api("POST", "/api/waitlist/join", { dept: "it", name: "Waiter", targetDept: "civil", resourceId: "civil-r3", slotId: "s2" });
  check("waiting list: joining a booked slot works (position 1)", r.data.ok && r.data.position === 1 && r.data.deadlock === false, JSON.stringify(r.data));
  r = await api("POST", "/api/waitlist/join", { dept: "civil", name: "Holder", targetDept: "civil", resourceId: "civil-r3", slotId: "s2" });
  check("waiting list: a department cannot wait for its own slot", r.data.ok === false);
  r = await api("POST", "/api/rpc", { deptCode: "civil", method: "cancelBooking", params: { resourceId: "civil-r3", slotId: "s2", requesterDept: "civil" } });
  check("waiting list: cancelling hands the slot to the first waiter", r.data.ok && r.data.promoted && r.data.promoted.dept === "it", JSON.stringify(r.data.promoted));
  r = await api("POST", "/api/rpc", { deptCode: "civil", method: "listResources", params: {} });
  const sl = r.data.result.resources.find((x) => x.id === "civil-r3").slots.s2;
  check("waiting list: the slot is now booked by the waiting department", sl.booked && sl.bookedByDept === "it", JSON.stringify(sl));
  await api("POST", "/api/rpc", { deptCode: "civil", method: "cancelBooking", params: { resourceId: "civil-r3", slotId: "s2", requesterDept: "it" } });

  // a REAL booking in the slots the demos like best must survive the demos
  await api("POST", "/api/rpc", { deptCode: "comp", method: "bookResource", params: { resourceId: "comp-r1", slotId: "s5", studentName: "RealUser", requesterDept: "comp" } });
  await api("POST", "/api/rpc", { deptCode: "central", method: "bookResource", params: { resourceId: "central-r2", slotId: "s5", studentName: "RealUser2", requesterDept: "central" } });
  r = await api("POST", "/api/deadlock/demo");
  const heldByComp = r.data.held && r.data.held[0];
  check("sample circular wait built from real bookings is a deadlock", r.data.ok && r.data.deadlock === true && r.data.cycle.length === 2, JSON.stringify(r.data));
  r = await api("POST", "/api/deadlock/detect");
  check("wait-for graph finds the cycle", r.data.deadlock === true);
  r = await api("POST", "/api/deadlock/probe", { initiator: "comp" });
  check("edge-chasing probe returns to its initiator", r.data.deadlock === true);
  r = await api("POST", "/api/waitlist/join", { dept: "it", name: "Bystander", targetDept: "comp", resourceId: heldByComp.resourceId, slotId: heldByComp.slotId });
  check("a department that only waits (it) is NOT reported as deadlocked", r.data.ok && r.data.deadlock === false, JSON.stringify(r.data));
  r = await api("POST", "/api/deadlock/resolve");
  check("resolving cancels the victim's wait and breaks the cycle", r.data.resolved === true && r.data.stillDeadlocked === false, JSON.stringify(r.data));
  r = await api("POST", "/api/deadlock/reset");
  r = await api("POST", "/api/deadlock/detect");
  check("after clearing the sample there is no deadlock", r.data.deadlock === false);
  r = await api("POST", "/api/mutex/contend", { requesters: ["comp", "it", "mech"] });
  check("lock contention demo works even when favourite slots are taken", r.data.ok && r.data.enteredCriticalSectionInOrder.filter((x) => x.outcome.startsWith("BOOKED")).length === 1, JSON.stringify(r.data).slice(0, 200));
  let rc = await api("POST", "/api/rpc", { deptCode: "comp", method: "listResources", params: {} });
  let rcen = await api("POST", "/api/rpc", { deptCode: "central", method: "listResources", params: {} });
  check("demos never cancel a real booking (comp s5 and central s5 still booked)",
    rc.data.result.resources.find((x) => x.id === "comp-r1").slots.s5.bookedBy === "RealUser" && rcen.data.result.resources.find((x) => x.id === "central-r2").slots.s5.bookedBy === "RealUser2");

  console.log("\n== Unit 4: emerging paradigms ==");
  r = await api("GET", "/api/objects");
  check("remote object references listed", r.data.objects.length >= 21 && r.data.objects[0].ref.startsWith("obj://"));
  r = await api("POST", "/api/objects/invoke", { ref: "obj://mech-node/mech-r2", method: "describe" });
  check("remote method call on obj://mech-node/mech-r2", r.data.ok && r.data.response.returnValue.name === "3D Printing Lab", JSON.stringify(r.data));
  r = await api("POST", "/api/objects/invoke", { ref: "obj://elec-node/elec-r1", method: "book", args: { slotId: "s5", studentName: "ObjTest", requesterDept: "comp" } });
  check("booking through a remote object reference works", r.data.ok && r.data.response.returnValue.booked === true, JSON.stringify(r.data));
  r = await api("POST", "/api/objects/invoke", { ref: "obj://elec-node/elec-r1", method: "cancel", args: { slotId: "s5", requesterDept: "comp" } });
  check("cancelling through a remote object reference works", r.data.ok && r.data.response.returnValue.cancelled === true, JSON.stringify(r.data));
  await api("POST", "/api/cache/clear");
  r = await api("GET", "/api/v1/departments/mech/resources?edge=mumbai");
  const h1 = r.headers.get("x-cache");
  r = await api("GET", "/api/v1/departments/mech/resources?edge=mumbai");
  const h2 = r.headers.get("x-cache");
  check("web cache: first request MISS, second HIT", h1 === "MISS" && h2 === "HIT", h1 + "," + h2);
  await api("POST", "/api/rpc", { deptCode: "mech", method: "bookResource", params: { resourceId: "mech-r1", slotId: "s2", studentName: "CacheTest", requesterDept: "mech" } });
  r = await api("GET", "/api/v1/departments/mech/resources?edge=mumbai");
  check("booking purges the cache (MISS again)", r.headers.get("x-cache") === "MISS", r.headers.get("x-cache"));
  await api("POST", "/api/rpc", { deptCode: "mech", method: "cancelBooking", params: { resourceId: "mech-r1", slotId: "s2" } });

  const text = "the campus has many labs and the labs are shared between the departments so that every student can use the labs when the labs are free and the library is open for every student of the campus";
  r = await api("POST", "/api/dfs/upload", { filename: "notes.txt", content: text, uploadedBy: "smoke" });
  check("DFS upload splits into blocks with 3 replicas each", r.data.ok && r.data.file.blocks.length >= 2 && r.data.file.blocks.every((b) => b.replicas.length === 3), JSON.stringify(r.data).slice(0, 200));
  const fileId = r.data.file.id;
  r = await api("GET", "/api/dfs/files/" + fileId);
  check("DFS read reassembles the exact file", r.data.ok && r.data.content === text);
  r = await api("POST", "/api/mapreduce/wordcount", { fileId, reducers: 3, top: 5 });
  const expected = {};
  text.toLowerCase().match(/[a-z0-9']+/g).forEach((w) => (expected[w] = (expected[w] || 0) + 1));
  const topWord = Object.entries(expected).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  check("MapReduce top word and count match a direct count", r.data.ok && r.data.top[0].word === topWord[0] && r.data.top[0].count === topWord[1], JSON.stringify(r.data.top && r.data.top[0]) + " vs " + topWord);
  check("MapReduce total words correct", r.data.totalWords === text.match(/[a-z0-9']+/g).length, r.data.totalWords);
  r = await api("GET", "/api/faas/functions");
  check("serverless functions listed", r.data.functions.length === 4);
  r = await api("POST", "/api/faas/invoke/utilizationReport", {});
  check("serverless: first call is a COLD start", r.data.cold === true && r.data.ok, JSON.stringify(r.data).slice(0, 200));
  r = await api("POST", "/api/faas/invoke/utilizationReport", {});
  check("serverless: second call is WARM and faster", r.data.cold === false);
  r = await api("POST", "/api/faas/invoke/peakSlotFinder", {});
  check("serverless peakSlotFinder returns a result", r.data.ok && r.data.result && "ranking" in r.data.result);
  r = await api("GET", "/api/faas/metrics");
  check("bookingAudit event function was triggered by bookings", r.data.metrics.bookingAudit && r.data.metrics.bookingAudit.invocations >= 1);
  r = await api("GET", "/api/ledger");
  check("ledger: all nodes agree (OK) and have blocks", r.data.verdicts.every((v) => v.verdict === "OK") && r.data.consensus.length > 3, JSON.stringify(r.data.verdicts.map((v) => v.deptCode + ":" + v.verdict)));
  await api("POST", "/api/ledger/tamper", { deptCode: "civil", index: 1 });
  r = await api("GET", "/api/ledger");
  const civil = r.data.verdicts.find((v) => v.deptCode === "civil");
  check("ledger: tampering on one node is detected", civil.verdict === "TAMPERED", JSON.stringify(civil));
  check("ledger: the other 6 nodes still agree", r.data.consensus.agreeingNodes.length === 6);
  r = await api("POST", "/api/ledger/heal");
  check("ledger: heal restores the tampered node", r.data.healed.includes("civil"));
  r = await api("GET", "/api/ledger");
  check("ledger: all OK again after heal", r.data.verdicts.every((v) => v.verdict === "OK"));
  r = await api("POST", "/api/kv/put", { key: "exam-notice", value: "Viva on Friday", W: 3 });
  check("quorum KV: write with W=3 succeeds when all replicas are up", r.data.ok && r.data.acks === 3, JSON.stringify(r.data));
  r = await api("GET", "/api/kv/get?key=exam-notice&R=1");
  check("quorum KV: read returns the written value", r.data.ok && r.data.value === "Viva on Friday");

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("Smoke test crashed:", e); process.exit(2); });
