// services/unit3.js  -  UNIT 3: SYNCHRONIZATION
//
// Topic in the syllabus                     Where it is implemented below
// ---------------------------------------   ---------------------------------
// Beacon protocol (failure detection)       section 1
// Clock synchronization                     section 2  (Cristian, Berkeley)
// Logical clocks / Lamport / Vector clocks  section 3  (Lamport is in gateway.js)
// Global state                              section 4  (Chandy-Lamport snapshot)
// Election algorithms                       section 5  (Bully, Ring)
// Mutual exclusion algorithms               section 6  (coordinator lock, Ricart-Agrawala)
// Deadlock detection (Knapp classification) section 7  (waiting list, wait-for graph, edge chasing)

const { DEFAULT_SKEW_MS } = require("../shared/config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = function unit3(ctx) {
  const { app, callNode, tick, refreshLive, liveDepts, getLeader, relayChat, DEPT_ORDER, DEPT_NAMES, ELECTION_PRIORITY } = ctx;

  // =====================================================================
  // 1. BEACON PROTOCOL
  // Nodes push a heartbeat ("beacon") every 3 s. The gateway never has to
  // ask - it simply notices when the beacons stop.
  // =====================================================================
  const beacons = {};

  app.post("/api/beacon", (req, res) => {
    const b = req.body;
    if (!b || !b.deptCode) return res.status(400).json({ ok: false });
    const prev = beacons[b.deptCode];
    const now = Date.now();
    beacons[b.deptCode] = { ...b, receivedAt: now, count: (prev ? prev.count : 0) + 1, lastGapMs: prev ? now - prev.receivedAt : null };
    res.json({ ok: true });
  });

  app.get("/api/beacons", (req, res) => {
    const now = Date.now();
    const rows = DEPT_ORDER.map((d) => {
      const b = beacons[d];
      if (!b) return { deptCode: d, state: "never heard" };
      const age = now - b.receivedAt;
      const state = age < 7000 ? "alive" : age < 15000 ? "suspected" : "dead";
      return { deptCode: d, state, ageMs: age, count: b.count, seq: b.seq, lastGapMs: b.lastGapMs, bookedSlots: b.bookedSlots, storedBlocks: b.storedBlocks };
    });
    res.json({ ok: true, intervalMs: 3000, suspectAfterMs: 7000, deadAfterMs: 15000, beacons: rows });
  });

  // =====================================================================
  // 2. PHYSICAL CLOCK SYNCHRONIZATION
  // Each node's clock is deliberately wrong (see DEFAULT_SKEW_MS).
  // =====================================================================
  // Cristian's idea: ask the time server, remember how long the round trip
  // took, and assume the reply spent half of that time travelling back.
  async function probeClock(dept) {
    const t0 = Date.now();
    const r = await callNode(dept, "getTime", {});
    const t1 = Date.now();
    const rtt = t1 - t0;
    return {
      deptCode: dept,
      nodeTime: r.nodeTime,
      rttMs: rtt,
      estimatedOffsetMs: Math.round(r.nodeTime - (t0 + rtt / 2)),
      actualSkewMs: r.offsetMs,
    };
  }

  async function probeAll() {
    await refreshLive();
    const rows = await Promise.all(liveDepts().map((d) => probeClock(d).catch(() => null)));
    return rows.filter(Boolean);
  }

  app.get("/api/clock/status", async (req, res) => {
    const nodes = await probeAll();
    res.json({ ok: true, gatewayTime: Date.now(), nodes });
  });

  app.post("/api/clock/skew", async (req, res) => {
    const { deptCode, offsetMs } = req.body;
    try {
      await callNode(deptCode, "setClockOffset", { offsetMs });
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/clock/reset", async (req, res) => {
    const out = await Promise.all(
      liveDepts().map((d) => callNode(d, "setClockOffset", { offsetMs: DEFAULT_SKEW_MS[d] || 0 }).catch(() => null))
    );
    res.json({ ok: true, reset: out.filter(Boolean).length });
  });

  // Cristian: the gateway is the time server; every node sets itself to it.
  app.post("/api/clock/cristian", async (req, res) => {
    const before = await probeAll();
    const steps = [];
    for (const p of before) {
      await callNode(p.deptCode, "adjustClock", { deltaMs: -p.estimatedOffsetMs });
      steps.push(`${p.deptCode}: asked the time server, RTT=${p.rttMs} ms, estimated clock error ${p.estimatedOffsetMs} ms -> adjusted by ${-p.estimatedOffsetMs} ms`);
    }
    const after = await probeAll();
    res.json({ ok: true, algorithm: "Cristian", steps, before, after });
  });

  // Berkeley: no node is trusted as "correct". The master collects every
  // clock, averages the differences (ignoring wild outliers) and tells each
  // node how far to move so that they all agree on the average.
  app.post("/api/clock/berkeley", async (req, res) => {
    const tolerance = Number(req.body && req.body.toleranceMs) || 5000;
    const before = await probeAll();
    const steps = [];
    const used = before.filter((p) => Math.abs(p.estimatedOffsetMs) <= tolerance);
    const ignored = before.filter((p) => Math.abs(p.estimatedOffsetMs) > tolerance);
    ignored.forEach((p) => steps.push(`${p.deptCode}: differs by ${p.estimatedOffsetMs} ms, more than the ${tolerance} ms tolerance -> ignored in the average`));
    // The master (gateway) counts as a participant whose difference is 0.
    const sum = used.reduce((s, p) => s + p.estimatedOffsetMs, 0);
    const avg = Math.round(sum / (used.length + 1));
    steps.push(`Master collected ${used.length} clocks; average difference (master included) = ${avg} ms`);
    for (const p of used) {
      const delta = avg - p.estimatedOffsetMs;
      await callNode(p.deptCode, "adjustClock", { deltaMs: delta });
      steps.push(`${p.deptCode}: difference ${p.estimatedOffsetMs} ms -> told to adjust by ${delta} ms`);
    }
    const after = await probeAll();
    res.json({ ok: true, algorithm: "Berkeley", averageMs: avg, steps, before, after });
  });

  // =====================================================================
  // 3. LOGICAL CLOCKS - vector clocks (Lamport's scalar clock is in gateway.js)
  // A vector clock has one counter per node and can tell us when two events
  // are CONCURRENT, which a single Lamport number cannot.
  // =====================================================================
  function compareVectors(a, b) {
    let less = false;
    let greater = false;
    for (const d of DEPT_ORDER) {
      if ((a[d] || 0) < (b[d] || 0)) less = true;
      if ((a[d] || 0) > (b[d] || 0)) greater = true;
    }
    if (!less && !greater) return "equal";
    if (less && !greater) return "a-happened-before-b";
    if (greater && !less) return "b-happened-before-a";
    return "concurrent";
  }

  app.get("/api/vector", async (req, res) => {
    await refreshLive();
    const rows = await Promise.all(liveDepts().map((d) => callNode(d, "getVector", {}).catch(() => null)));
    res.json({ ok: true, order: DEPT_ORDER, vectors: rows.filter(Boolean) });
  });

  app.post("/api/vector/event", async (req, res) => {
    try {
      res.json({ ok: true, ...(await callNode(req.body.deptCode, "vcLocalEvent", {})) });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/vector/compare", (req, res) => {
    const { a, b } = req.body;
    res.json({ ok: true, verdict: compareVectors(a || {}, b || {}) });
  });

  // Scripted demo: two independent events (concurrent), then a message that
  // links them (now one happened-before the other).
  app.post("/api/vector/demo", async (req, res) => {
    try {
      await refreshLive();
      const live = liveDepts();
      const [A, B] = [live[0], live[1]];
      if (!A || !B) return res.status(400).json({ ok: false, error: "Need at least 2 live nodes" });
      const steps = [];
      const ea = await callNode(A, "vcLocalEvent", {});
      const eb = await callNode(B, "vcLocalEvent", {});
      const v1 = compareVectors(ea.vector, eb.vector);
      steps.push({ text: `${A} does a local event, ${B} does a local event - they have not talked to each other`, a: ea.vector, b: eb.vector, verdict: v1 });
      await relayChat(A, B, "[vector-clock demo] message from " + A, "system");
      const after = await callNode(B, "getVector", {});
      const v2 = compareVectors(ea.vector, after.vector);
      steps.push({ text: `${A} sends a message to ${B}. ${A}'s earlier event is now compared with ${B}'s clock after receiving it`, a: ea.vector, b: after.vector, verdict: v2 });
      res.json({ ok: true, order: DEPT_ORDER, steps });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // =====================================================================
  // 4. GLOBAL STATE - Chandy-Lamport snapshot
  // =====================================================================
  app.post("/api/snapshot", async (req, res) => {
    try {
      await refreshLive();
      const live = liveDepts();
      if (live.length < 2) return res.status(400).json({ ok: false, error: "Need at least 2 live nodes for a snapshot" });
      const X = live.includes(req.body && req.body.initiator) ? req.body.initiator : live[0];
      const inject = !(req.body && req.body.injectInFlight === false) && live.length >= 3;
      const id = "snap-" + Date.now();
      const steps = [];
      const marker = (to, from) =>
        callNode(to, "snapshotMarker", { snapshotId: id, fromDept: from, initiator: X, participants: live });

      await marker(X, null);
      steps.push(`${X} (initiator): records its own local state, starts recording all incoming channels, sends a MARKER on every outgoing channel`);
      const others = live.filter((d) => d !== X);

      if (inject) {
        const Y = others[0];
        const Z = others[1];
        await marker(Y, X);
        steps.push(`MARKER ${X}->${Y} arrives: ${Y} records its local state and starts recording its other incoming channels`);
        await relayChat(Z, Y, `[in-flight demo] sent by ${Z} before ${Z} recorded its state`, "system");
        steps.push(`${Z} (has NOT recorded yet) sends a chat message to ${Y}. It reaches ${Y} while ${Y} is recording channel ${Z}->${Y}, so it is captured as an IN-FLIGHT message`);
        await marker(Z, X);
        steps.push(`MARKER ${X}->${Z} arrives: ${Z} records its state (after the message was sent)`);
        for (const o of others.slice(2)) {
          await marker(o, X);
          steps.push(`MARKER ${X}->${o} arrives: ${o} records its local state`);
        }
      } else {
        for (const o of others) {
          await marker(o, X);
          steps.push(`MARKER ${X}->${o} arrives: ${o} records its local state`);
        }
      }

      // Every recorded node now sends markers on all outgoing channels,
      // which closes the incoming channels of everybody else.
      for (const A of live.filter((d) => d !== X)) {
        for (const B of live.filter((d) => d !== A)) await marker(B, A);
      }
      steps.push("All other nodes have sent MARKERS on all their channels; every channel is now closed");

      const results = {};
      for (const d of live) results[d] = await callNode(d, "snapshotResult", { snapshotId: id });

      const channels = [];
      for (const A of live) {
        for (const B of live) {
          if (A === B) continue;
          const sent = results[A].local.chatSentTo[B] || 0;
          const received = results[B].local.chatReceivedFrom[A] || 0;
          const inFlight = (results[B].channelState[A] || []).length;
          if (sent || received || inFlight) {
            channels.push({ channel: `${A} -> ${B}`, sentByA: sent, receivedByB: received, inFlight, consistent: sent - received === inFlight });
          }
        }
      }
      res.json({
        ok: true, snapshotId: id, initiator: X, steps,
        nodes: live.map((d) => ({
          deptCode: d,
          bookedSlots: results[d].local.bookedSlots,
          vector: results[d].local.vector,
          done: results[d].done,
        })),
        inFlightMessages: channels.filter((c) => c.inFlight).map((c) => ({ channel: c.channel, messages: results[c.channel.split(" -> ")[1]].channelState[c.channel.split(" -> ")[0]] })),
        channels,
        allConsistent: channels.every((c) => c.consistent),
        totalBookedSlots: live.reduce((s, d) => s + results[d].local.bookedSlots, 0),
      });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // =====================================================================
  // 5. ELECTION ALGORITHMS - Bully and Ring
  // The "leader" is the node that acts as lock manager (section 6) and as the
  // miner of the booking ledger (Unit 4).
  // =====================================================================
  app.post("/api/election/bully", async (req, res) => {
    await refreshLive();
    const live = new Set(liveDepts());
    const byPriority = [...DEPT_ORDER].sort((a, b) => ELECTION_PRIORITY[a] - ELECTION_PRIORITY[b]);
    let current = live.has(req.body && req.body.initiator) ? req.body.initiator : byPriority.find((d) => live.has(d));
    if (!current) return res.status(400).json({ ok: false, error: "No live nodes" });
    const steps = [`${current} notices there is no coordinator and starts an election`];
    for (let guard = 0; guard < 10; guard++) {
      const higher = byPriority.filter((d) => ELECTION_PRIORITY[d] > ELECTION_PRIORITY[current]);
      const answered = [];
      for (const h of higher) {
        if (live.has(h)) {
          answered.push(h);
          steps.push(`${current} -> ${h}: ELECTION   |   ${h} -> ${current}: OK (I am stronger, I will take over)`);
        } else {
          steps.push(`${current} -> ${h}: ELECTION   |   no reply (${h} is down)`);
        }
      }
      if (!answered.length) break;
      current = answered[0]; // lowest responder continues; the chain ends at the strongest live node
      steps.push(`${current} starts its own election`);
    }
    steps.push(`${current} received no OK from any stronger node, so it declares itself COORDINATOR`);
    for (const d of live) if (d !== current) steps.push(`${current} -> ${d}: COORDINATOR`);
    res.json({ ok: true, algorithm: "Bully", coordinator: current, steps });
  });

  app.post("/api/election/ring", async (req, res) => {
    await refreshLive();
    const live = new Set(liveDepts());
    const ring = DEPT_ORDER; // fixed logical ring: comp -> it -> mech -> ... -> central -> comp
    let start = live.has(req.body && req.body.initiator) ? req.body.initiator : ring.find((d) => live.has(d));
    if (!start) return res.status(400).json({ ok: false, error: "No live nodes" });
    const steps = [`${start} starts an election: it puts its own id on an ELECTION token and passes it clockwise`];
    const collected = [start];
    let i = ring.indexOf(start);
    for (let hops = 0; hops < ring.length; hops++) {
      i = (i + 1) % ring.length;
      const d = ring[i];
      if (d === start) break;
      if (!live.has(d)) {
        steps.push(`token tries ${d} -> no response, skipped`);
        continue;
      }
      collected.push(d);
      steps.push(`token reaches ${d}: ${d} adds its id. Token now holds [${collected.join(", ")}]`);
    }
    const coordinator = collected.reduce((a, b) => (ELECTION_PRIORITY[b] > ELECTION_PRIORITY[a] ? b : a));
    steps.push(`token is back at ${start}: highest id in the list is ${coordinator}, so ${coordinator} is COORDINATOR`);
    steps.push("a second COORDINATOR token travels around the ring so every node learns the result");
    res.json({ ok: true, algorithm: "Ring", coordinator, steps });
  });

  // =====================================================================
  // 6. MUTUAL EXCLUSION
  // (a) Centralised: the elected leader holds the lock table. Used for REAL on
  //     every booking and cancellation.
  // (b) Ricart-Agrawala: fully distributed, timestamp based. Run as a simulation.
  // =====================================================================
  const mutexLog = [];
  function logMutex(text) {
    mutexLog.unshift({ lamportClock: tick(), time: new Date().toLocaleTimeString(), text });
    if (mutexLog.length > 60) mutexLog.pop();
  }

  async function lockedRun(key, owner, fn, label) {
    const leader = getLeader();
    if (!leader) {
      logMutex(`no lock manager reachable - ${label} runs without a lock`);
      return fn();
    }
    const t0 = Date.now();
    try {
      for (;;) {
        const r = await callNode(leader, "lockAcquire", { key, owner });
        if (r.granted) break;
        if (Date.now() - t0 > 4000) {
          await callNode(leader, "lockCancel", { key, owner }).catch(() => {});
          throw new Error(`LOCK_TIMEOUT: could not get the lock for ${key} within 4 s`);
        }
        await sleep(40);
      }
    } catch (e) {
      if (String(e.message).startsWith("LOCK_TIMEOUT")) throw e;
      logMutex(`lock manager ${leader} unreachable - ${label} runs without a lock`);
      return fn();
    }
    const waited = Date.now() - t0;
    logMutex(`GRANTED  ${key}  to ${owner}  by lock manager ${leader}  (waited ${waited} ms)  [${label}]`);
    try {
      return await fn();
    } finally {
      await callNode(leader, "lockRelease", { key, owner }).catch(() => {});
      logMutex(`RELEASED ${key}  by ${owner}`);
    }
  }

  // Find a slot that is free right now (demos must never touch a real booking).
  async function findFreeSlot(dept, preferredResources) {
    const r = await callNode(dept, "listResources", {});
    const order = [...(preferredResources || []), ...r.resources.map((x) => x.id)];
    const seen = new Set();
    for (const rid of order) {
      if (seen.has(rid)) continue;
      seen.add(rid);
      const res = r.resources.find((x) => x.id === rid);
      if (!res) continue;
      for (const sid of ["s5", "s4", "s3", "s2", "s1"]) {
        if (!res.slots[sid].booked) return { resourceId: rid, slotId: sid };
      }
    }
    return null;
  }

  app.get("/api/mutex/log", (req, res) => res.json({ ok: true, leader: getLeader(), log: mutexLog }));

  // Several departments try to book the SAME slot at the same instant.
  app.post("/api/mutex/contend", async (req, res) => {
    try {
      await refreshLive();
      const deptCode = (req.body && req.body.deptCode) || "central";
      const requesters = (req.body && req.body.requesters) || ["comp", "it", "mech"];
      const free = await findFreeSlot(deptCode, ["central-r2"]);
      if (!free) return res.status(409).json({ ok: false, error: `Every slot of ${deptCode} is booked, so there is nothing to fight over. Cancel one first.` });
      const { resourceId, slotId } = free;
      const key = `${deptCode}:${resourceId}:${slotId}`;
      const order = [];
      const attempts = requesters.map((rq, i) =>
        lockedRun(key, `${rq}#demo${i}`, async () => {
          order.push(rq);
          await sleep(200); // stay inside the critical section a moment so the queue is visible
          try {
            await callNode(deptCode, "bookResource", { resourceId, slotId, studentName: `demo-${rq}`, requesterDept: rq });
            return { dept: rq, outcome: "BOOKED the slot" };
          } catch (e) {
            return { dept: rq, outcome: "rejected: " + e.message };
          }
        }, "contention demo")
      );
      const results = await Promise.all(attempts);
      results.sort((a, b) => order.indexOf(a.dept) - order.indexOf(b.dept));
      // tidy up: only the slot this demo itself chose (it was free before the demo started)
      await callNode(deptCode, "cancelBooking", { resourceId, slotId }).catch(() => {});
      ctx.invalidateCache(deptCode);
      res.json({
        ok: true, lockManager: getLeader(), slot: key,
        explanation: "All requests were sent at the same instant. The lock manager let them into the critical section one at a time, in the order they arrived; only the first could book.",
        enteredCriticalSectionInOrder: results,
      });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // Ricart-Agrawala (simulation): to enter the critical section a process
  // multicasts REQUEST(timestamp, id). Everyone replies immediately unless it
  // has an EARLIER request of its own (lower timestamp, ties broken by id) or is
  // inside the critical section - in that case it defers the reply.
  app.post("/api/mutex/ricart-agrawala", (req, res) => {
    const input = (req.body && req.body.requesters) || [
      { dept: "comp", clock: 3 }, { dept: "it", clock: 1 }, { dept: "mech", clock: 1 },
    ];
    const rank = (d) => DEPT_ORDER.indexOf(d);
    const P = input.map((r) => ({ dept: r.dept, clock: Number(r.clock) || 0, ts: null, replies: new Set(), deferred: [], done: false }));
    const log = [];
    P.forEach((p) => {
      p.clock += 1;
      p.ts = p.clock;
      log.push(`${p.dept} wants the critical section -> multicasts REQUEST(ts=${p.ts}, id=${p.dept}) to ${P.length - 1} other process(es)`);
    });
    const earlier = (a, b) => a.ts < b.ts || (a.ts === b.ts && rank(a.dept) < rank(b.dept));
    for (const s of P) {
      for (const t of P) {
        if (s === t) continue;
        t.clock = Math.max(t.clock, s.ts) + 1;
        if (earlier(t, s)) {
          t.deferred.push(s);
          log.push(`${t.dept} has an earlier request (ts=${t.ts}) than ${s.dept} (ts=${s.ts}) -> DEFERS its reply to ${s.dept}`);
        } else {
          s.replies.add(t.dept);
          log.push(`${t.dept} -> ${s.dept}: REPLY (OK)`);
        }
      }
    }
    const order = [];
    for (let guard = 0; guard < P.length + 1 && order.length < P.length; guard++) {
      const ready = P.find((p) => !p.done && p.replies.size === P.length - 1);
      if (!ready) break;
      log.push(`${ready.dept} has OK from all ${P.length - 1} others -> ENTERS the critical section`);
      order.push(ready.dept);
      ready.done = true;
      log.push(`${ready.dept} leaves the critical section and sends its ${ready.deferred.length} deferred reply(ies)`);
      for (const w of ready.deferred) {
        w.replies.add(ready.dept);
        log.push(`${ready.dept} -> ${w.dept}: REPLY (deferred)`);
      }
    }
    res.json({
      ok: true, algorithm: "Ricart-Agrawala", order, log,
      messagesPerEntry: 2 * (P.length - 1),
      note: "Requests are served in timestamp order (ties broken by id), which makes the algorithm fair. Lodha & Kshemkalyani's fair algorithm (self-study) is another request-ordered, fair algorithm; read the paper for its exact message count before quoting numbers.",
    });
  });

  // =====================================================================
  // 7. DEADLOCK DETECTION  -  used by the WAITING LIST of the booking screen
  //
  // A department that wants a slot another department already holds joins the
  // waiting list for it. "Department A waits for something department B holds"
  // is an edge A -> B of the WAIT-FOR GRAPH. If departments wait for each other
  // in a circle (A wants B's slot while B wants A's slot) nobody will ever
  // release anything: DEADLOCK. Every time somebody joins a waiting list the
  // gateway checks for this automatically.
  //
  // Knapp's classification: path-pushing, EDGE-CHASING, diffusion computation,
  // global state. This project uses a centralised wait-for graph (cycle search)
  // and the Chandy-Misra-Haas EDGE-CHASING probe algorithm.
  // When a slot is cancelled, the first department on its waiting list gets it
  // automatically (see gateway.js, promoteNext).
  // =====================================================================
  const waitlist = []; // { id, dept, name, targetDept, resourceId, resourceName, slotId, slotLabel, since }
  let waitCounter = 0;
  const slotKey = (d, r, s) => `${d}:${r}:${s}`;
  const entryKey = (w) => slotKey(w.targetDept, w.resourceId, w.slotId);

  // Who currently HOLDS what: read straight from the department nodes.
  async function collectHolds() {
    await refreshLive();
    const out = [];
    await Promise.all(liveDepts().map(async (d) => {
      try {
        const r = await callNode(d, "listResources", {});
        for (const res of r.resources) {
          for (const [slotId, s] of Object.entries(res.slots)) {
            if (s.booked) {
              out.push({ key: slotKey(d, res.id, slotId), targetDept: d, resourceId: res.id, resourceName: res.name, slotId, slotLabel: s.label, holder: s.bookedByDept, holderName: s.bookedBy });
            }
          }
        }
      } catch { /* node went away while reading */ }
    }));
    return out;
  }

  async function buildGraph() {
    const holds = await collectHolds();
    const byKey = new Map(holds.map((h) => [h.key, h]));
    const edges = [];
    for (const w of waitlist) {
      const h = byKey.get(entryKey(w));
      if (h && h.holder !== w.dept) {
        edges.push({ from: w.dept, to: h.holder, waiter: w.name, holderName: h.holderName, resource: `${h.resourceName} (${h.slotLabel})`, entryId: w.id });
      }
    }
    return { holds, waits: waitlist.map((w) => ({ ...w })), edges };
  }

  function adjacency(edges) {
    const adj = {};
    edges.forEach((e) => { (adj[e.from] = adj[e.from] || []).push(e.to); });
    return adj;
  }

  function findCycleIn(edges) {
    const adj = adjacency(edges);
    const color = {};
    const stack = [];
    function dfs(p) {
      color[p] = 1;
      stack.push(p);
      for (const q of adj[p] || []) {
        if (color[q] === 1) return stack.slice(stack.indexOf(q));
        if (!color[q]) {
          const c = dfs(q);
          if (c) return c;
        }
      }
      stack.pop();
      color[p] = 2;
      return null;
    }
    for (const p of Object.keys(adj)) if (!color[p]) { const c = dfs(p); if (c) return c; }
    return null;
  }

  // Chandy-Misra-Haas: a blocked department sends PROBE(initiator, from, to)
  // along every wait-for edge; if a probe comes back to its initiator, the
  // initiator is in a deadlock.
  function chase(edges, initiator) {
    const adj = adjacency(edges);
    const log = [];
    const queue = (adj[initiator] || []).map((k) => ({ from: initiator, to: k }));
    queue.forEach((p) => log.push(`${initiator} is blocked -> sends PROBE(${initiator}, ${p.from}, ${p.to})`));
    if (!queue.length) log.push(`${initiator} is not waiting for anybody, so it cannot be deadlocked`);
    const forwarded = new Set();
    let detected = false;
    while (queue.length) {
      const pr = queue.shift();
      if (pr.to === initiator) {
        log.push(`PROBE(${initiator}, ${pr.from}, ${pr.to}) came BACK to its initiator -> DEADLOCK detected`);
        detected = true;
        break;
      }
      const next = adj[pr.to] || [];
      if (!next.length) { log.push(`${pr.to} is not blocked -> PROBE discarded`); continue; }
      if (forwarded.has(pr.to)) { log.push(`${pr.to} already forwarded a probe for ${initiator} -> ignored`); continue; }
      forwarded.add(pr.to);
      for (const k of next) {
        log.push(`${pr.to} is blocked too -> forwards PROBE(${initiator}, ${pr.to}, ${k})`);
        queue.push({ from: pr.to, to: k });
      }
    }
    return { detected, log };
  }

  // ---- waiting list API (used by the booking screen) ----
  app.get("/api/waitlist", (req, res) => res.json({ ok: true, entries: waitlist }));

  app.post("/api/waitlist/join", async (req, res) => {
    try {
      const { dept, name, targetDept, resourceId, slotId } = req.body || {};
      if (!dept || !name || !targetDept || !resourceId || !slotId) return res.status(400).json({ ok: false, error: "dept, name, targetDept, resourceId and slotId are required" });
      const r = await callNode(targetDept, "listResources", {});
      const resource = r.resources.find((x) => x.id === resourceId);
      const slot = resource && resource.slots[slotId];
      if (!slot) return res.status(404).json({ ok: false, error: "No such slot" });
      if (!slot.booked) return res.status(409).json({ ok: false, error: "That slot is free - just book it." });
      if (slot.bookedByDept === dept) return res.status(409).json({ ok: false, error: "Your own department already holds this slot." });
      const key = slotKey(targetDept, resourceId, slotId);
      if (waitlist.some((w) => w.dept === dept && entryKey(w) === key)) return res.status(409).json({ ok: false, error: "Your department is already on the waiting list for this slot." });

      const entry = { id: `w${++waitCounter}`, dept, name, targetDept, resourceId, resourceName: resource.name, slotId, slotLabel: slot.label, since: Date.now() };
      waitlist.push(entry);
      const position = waitlist.filter((w) => entryKey(w) === key).length;
      const graph = await buildGraph();
      const probe = chase(graph.edges, dept);
      const cycle = probe.detected ? findCycleIn(graph.edges) : null;
      ctx.io.emit("waitlist-updated", {});
      res.json({ ok: true, entry, position, heldBy: `${slot.bookedBy} (${slot.bookedByDept})`, deadlock: probe.detected, cycle, probeLog: probe.log });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/waitlist/leave", (req, res) => {
    const i = waitlist.findIndex((w) => w.id === (req.body || {}).id);
    if (i < 0) return res.status(404).json({ ok: false, error: "Not on the waiting list" });
    waitlist.splice(i, 1);
    ctx.io.emit("waitlist-updated", {});
    res.json({ ok: true });
  });

  // Called by the gateway after a slot is cancelled: the first waiter gets it.
  function takeNextWaiter(deptCode, resourceId, slotId) {
    const key = slotKey(deptCode, resourceId, slotId);
    const i = waitlist.findIndex((w) => entryKey(w) === key);
    return i < 0 ? null : waitlist.splice(i, 1)[0];
  }

  // ---- deadlock monitor API (Cluster Operations screen) ----
  app.get("/api/deadlock/graph", async (req, res) => {
    const g = await buildGraph();
    res.json({ ok: true, ...g, cycle: findCycleIn(g.edges) });
  });

  app.post("/api/deadlock/detect", async (req, res) => {
    const g = await buildGraph();
    const cycle = findCycleIn(g.edges);
    res.json({
      ok: true, method: "Centralised wait-for graph + depth-first search",
      deadlock: Boolean(cycle), cycle, edges: g.edges,
      explanation: cycle
        ? `Circular wait found: ${cycle.join(" -> ")} -> ${cycle[0]}. Every department in the cycle is waiting for the next one, so none of them can ever continue.`
        : "No cycle in the wait-for graph, so there is no deadlock.",
    });
  });

  app.post("/api/deadlock/probe", async (req, res) => {
    const initiator = req.body && req.body.initiator;
    if (!initiator) return res.status(400).json({ ok: false, error: "initiator is required" });
    const g = await buildGraph();
    const out = chase(g.edges, initiator);
    res.json({ ok: true, method: "Edge chasing (Chandy-Misra-Haas)", initiator, deadlock: out.detected, log: out.log, edges: g.edges });
  });

  // Recovery: abort the waiting requests of one victim (the weakest department in the cycle).
  app.post("/api/deadlock/resolve", async (req, res) => {
    const g = await buildGraph();
    const cycle = findCycleIn(g.edges);
    if (!cycle) return res.json({ ok: true, resolved: false, message: "There is no deadlock to resolve." });
    const victim = cycle.reduce((a, b) => (ELECTION_PRIORITY[b] < ELECTION_PRIORITY[a] ? b : a));
    const ids = new Set(g.edges.filter((e) => e.from === victim).map((e) => e.entryId));
    for (let i = waitlist.length - 1; i >= 0; i--) if (ids.has(waitlist[i].id)) waitlist.splice(i, 1);
    ctx.io.emit("waitlist-updated", {});
    const after = await buildGraph();
    res.json({
      ok: true, resolved: true, victim,
      message: `${DEPT_NAMES[victim]} was chosen as the victim (lowest priority in the cycle). Its waiting request was cancelled, so the circle is broken and the other departments are no longer stuck.`,
      stillDeadlocked: Boolean(findCycleIn(after.edges)),
    });
  });

  // Sample deadlock built from REAL bookings: comp holds a Computer slot and
  // wants mech's slot, while mech holds that slot and wants comp's.
  // The slots are chosen among FREE ones, and cleanup only touches bookings made
  // by the sample itself (booked by "Demo-Comp" / "Demo-Mech").
  const DEMO_PEOPLE = [
    { dept: "comp", name: "Demo-Comp", prefer: ["comp-r1"] },
    { dept: "mech", name: "Demo-Mech", prefer: ["mech-r2"] },
  ];

  async function clearDemo() {
    for (let i = waitlist.length - 1; i >= 0; i--) if (waitlist[i].name.startsWith("Demo-")) waitlist.splice(i, 1);
    for (const d of DEMO_PEOPLE) {
      try {
        const r = await callNode(d.dept, "listResources", {});
        for (const res of r.resources) {
          for (const [slotId, slot] of Object.entries(res.slots)) {
            if (slot.booked && String(slot.bookedBy).startsWith("Demo-")) {
              await ctx.cancelSlot(d.dept, { resourceId: res.id, slotId, studentName: "Demo", requesterDept: d.dept }, { promote: false });
            }
          }
        }
      } catch { /* node down: nothing to clean */ }
    }
    ctx.io.emit("waitlist-updated", {});
  }

  app.post("/api/deadlock/reset", async (req, res) => {
    await clearDemo();
    res.json({ ok: true, message: "Sample bookings and waiting-list entries were removed." });
  });

  app.post("/api/deadlock/demo", async (req, res) => {
    try {
      await refreshLive();
      const down = DEMO_PEOPLE.filter((p) => !liveDepts().includes(p.dept));
      if (down.length) {
        return res.status(409).json({ ok: false, error: `The sample needs these department servers running: ${down.map((p) => DEPT_NAMES[p.dept]).join(", ")}. Start them (for example docker start ${down[0].dept}-node) and try again.` });
      }
      await clearDemo();
      const steps = [];
      const held = [];
      for (const p of DEMO_PEOPLE) {
        const free = await findFreeSlot(p.dept, p.prefer);
        if (!free) return res.status(409).json({ ok: false, error: `${DEPT_NAMES[p.dept]} has no free slot left for the sample. Cancel a booking and try again.` });
        const r = await ctx.bookSlot(p.dept, { ...free, studentName: p.name, requesterDept: p.dept });
        held.push({ ...p, ...free, resourceName: r.resource.name, slotLabel: r.slotLabel });
        steps.push(`${DEPT_NAMES[p.dept]} books ${r.resource.name} (${r.slotLabel}) and now HOLDS it`);
      }
      const [A, B] = held;
      const mk = (w, t) => ({ id: `w${++waitCounter}`, dept: w.dept, name: w.name, targetDept: t.dept, resourceId: t.resourceId, resourceName: t.resourceName, slotId: t.slotId, slotLabel: t.slotLabel, since: Date.now() });
      waitlist.push(mk(A, B), mk(B, A));
      steps.push(`${DEPT_NAMES[A.dept]} joins the waiting list for ${B.resourceName} (${B.slotLabel}), held by ${DEPT_NAMES[B.dept]}`);
      steps.push(`${DEPT_NAMES[B.dept]} joins the waiting list for ${A.resourceName} (${A.slotLabel}), held by ${DEPT_NAMES[A.dept]}`);
      ctx.io.emit("waitlist-updated", {});
      const g = await buildGraph();
      const cycle = findCycleIn(g.edges);
      res.json({ ok: true, steps, deadlock: Boolean(cycle), cycle, held: held.map((h) => ({ dept: h.dept, resourceId: h.resourceId, slotId: h.slotId })) });
    } catch (e) {
      res.status(409).json({ ok: false, error: `Could not build the sample: ${e.message}. Press "Clear sample" and try again.` });
    }
  });

  return { lockedRun, takeNextWaiter };
};
