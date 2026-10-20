// services/unit4.js  -  UNIT 4: EMERGING DISTRIBUTED PARADIGMS
//
// Topic in the syllabus                      Where it is implemented below
// ----------------------------------------   --------------------------------
// Distributed object-based systems           section 1  (remote objects, RMI-style)
// Distributed web-based systems              section 2  (REST + edge caches / CDN)
// Distributed file system                    section 3  (HDFS-style NameNode)
// Apache Hadoop (case study)                 section 4  (MapReduce word count)
// Serverless architectures                   section 5  (Function-as-a-Service)
// Blockchain / distributed ledger (self)     section 6  (hash-chained booking ledger)
// Trade-offs of distributed databases (self) section 7  (quorum key-value store, CAP)
// Kubernetes / AWS / Cloudflare / Megaport   see k8s/ folder and README case studies

const vm = require("vm");
const FUNCTIONS = require("./functions");
const { sha256, mineBlock, validateChain } = require("../shared/ledgerUtil");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = function unit4(ctx) {
  const { app, callNode, tick, refreshLive, liveDepts, getLeader, relayChat, DEPT_ORDER, DEPT_NAMES } = ctx;

  // =====================================================================
  // 1. DISTRIBUTED OBJECTS (Java-RMI / CORBA style)
  // Every resource is a remote object with a global reference such as
  //   obj://comp-node/comp-r1
  // The gateway acts as the client-side proxy: it parses the reference, finds
  // the hosting node and forwards the method call.
  // =====================================================================
  app.get("/api/objects", async (req, res) => {
    await refreshLive();
    const lists = await Promise.all(liveDepts().map((d) => callNode(d, "listObjects", {}).catch(() => [])));
    res.json({ ok: true, objects: lists.flat() });
  });

  app.post("/api/objects/invoke", async (req, res) => {
    const { ref, method, args } = req.body || {};
    const m = /^obj:\/\/([a-z]+)-node\/([\w-]+)$/.exec(ref || "");
    if (!m) return res.status(400).json({ ok: false, error: "Reference must look like obj://comp-node/comp-r1" });
    const [, dept, objectId] = m;
    try {
      const request = { ref, method, args: args || {} };
      let out;
      const a = args || {};
      if (method === "book" || method === "cancel") {
        // Same path as the booking screen: lock, notification, ledger, cache purge.
        if (method === "book") {
          const r = await ctx.bookSlot(dept, { resourceId: objectId, slotId: a.slotId, studentName: a.studentName || "remote-caller", requesterDept: a.requesterDept });
          out = { ref, method, returnValue: { booked: true, slot: r.slotLabel } };
        } else {
          const r = await ctx.cancelSlot(dept, { resourceId: objectId, slotId: a.slotId, studentName: a.studentName || "remote-caller", requesterDept: a.requesterDept });
          out = { ref, method, returnValue: { cancelled: true, slot: r.result.slotLabel, passedToWaitingDepartment: r.promoted ? r.promoted.dept : null } };
        }
      } else {
        out = await callNode(dept, "invokeObject", { objectId, method, args });
      }
      res.json({ ok: true, marshalledRequest: request, hostedOn: `${dept}-node`, response: out });
    } catch (e) {
      res.status(409).json({ ok: false, error: e.message });
    }
  });

  // =====================================================================
  // 2. DISTRIBUTED WEB-BASED SYSTEM: REST API + EDGE CACHES (CDN idea)
  // GET /api/v1/departments/:dept/resources?edge=mumbai
  // Each "edge" is a separate cache sitting between users and the origin
  // (the department node). The first request from an edge is a MISS and goes
  // to the origin; later ones are served from the edge until the TTL expires or
  // a booking purges the entry. ETag / If-None-Match gives 304 revalidation.
  // =====================================================================
  const TTL_MS = 15000;
  const EDGES = ["pune", "mumbai", "delhi"];
  const caches = {};
  const stats = {};
  EDGES.forEach((e) => { caches[e] = new Map(); stats[e] = { hits: 0, misses: 0, notModified: 0, purges: 0 }; });

  ctx.invalidateCache = (dept) => {
    for (const e of EDGES) if (caches[e].delete(dept)) stats[e].purges += 1;
  };

  app.get("/api/v1/departments", (req, res) => {
    res.json({ ok: true, departments: DEPT_ORDER.map((d) => ({ code: d, name: DEPT_NAMES[d], href: `/api/v1/departments/${d}/resources` })) });
  });

  app.get("/api/v1/departments/:dept/resources", async (req, res) => {
    const t0 = Date.now();
    const dept = req.params.dept;
    const edge = String(req.query.edge || "origin").toLowerCase();
    if (!DEPT_ORDER.includes(dept)) return res.status(404).json({ ok: false, error: "Unknown department" });

    let entry = null;
    let cacheStatus = "BYPASS";
    if (EDGES.includes(edge)) {
      entry = caches[edge].get(dept);
      if (entry && Date.now() - entry.storedAt < TTL_MS) {
        cacheStatus = "HIT";
        stats[edge].hits += 1;
      } else {
        entry = null;
        cacheStatus = "MISS";
        stats[edge].misses += 1;
      }
    }
    if (!entry) {
      try {
        const r = await callNode(dept, "listResources", {});
        const body = { ok: true, dept, resources: r.resources };
        entry = { body, etag: '"' + sha256(JSON.stringify(body)).slice(0, 16) + '"', storedAt: Date.now() };
        if (EDGES.includes(edge)) caches[edge].set(dept, entry);
      } catch (e) {
        return res.status(502).json({ ok: false, error: `Origin (${dept} node) is unreachable: ${e.message}` });
      }
    }

    res.set({
      "Cache-Control": `public, max-age=${TTL_MS / 1000}`,
      ETag: entry.etag,
      "X-Cache": cacheStatus,
      "X-Edge": edge,
      Age: String(Math.floor((Date.now() - entry.storedAt) / 1000)),
      "X-Response-Time": `${Date.now() - t0}ms`,
      "Access-Control-Expose-Headers": "X-Cache, X-Edge, Age, X-Response-Time, ETag",
    });
    if (req.headers["if-none-match"] === entry.etag) {
      if (EDGES.includes(edge)) stats[edge].notModified += 1;
      return res.status(304).end();
    }
    res.json(entry.body);
  });

  app.get("/api/cache/stats", (req, res) => {
    res.json({
      ok: true, ttlMs: TTL_MS,
      edges: EDGES.map((e) => ({ edge: e, ...stats[e], cachedDepartments: [...caches[e].keys()] })),
    });
  });

  app.post("/api/cache/clear", (req, res) => {
    EDGES.forEach((e) => { caches[e].clear(); stats[e] = { hits: 0, misses: 0, notModified: 0, purges: 0 }; });
    res.json({ ok: true });
  });

  // =====================================================================
  // 3. DISTRIBUTED FILE SYSTEM (HDFS style)
  // The gateway is the NameNode: it stores only METADATA (file -> blocks ->
  // which nodes hold each block). The department nodes are DataNodes that
  // store the real block contents. Every block is replicated on 3 nodes.
  // =====================================================================
  const BLOCK_SIZE = 160; // characters; deliberately tiny so even short files become several blocks
  const REPLICATION = 3;
  const files = new Map();
  let fileCounter = 0;

  function splitText(text, size) {
    const parts = [];
    let i = 0;
    while (i < text.length) {
      let end = Math.min(i + size, text.length);
      if (end < text.length) {
        const cut = Math.max(text.lastIndexOf(" ", end), text.lastIndexOf("\n", end));
        if (cut > i) end = cut + 1; // never cut a word in half
      }
      parts.push(text.slice(i, end));
      i = end;
    }
    return parts;
  }

  function blockLoad() {
    const load = {};
    DEPT_ORDER.forEach((d) => (load[d] = 0));
    for (const f of files.values()) for (const b of f.blocks) for (const r of b.replicas) load[r] = (load[r] || 0) + 1;
    return load;
  }

  function pickNodes(count, exclude = []) {
    const load = blockLoad();
    return liveDepts()
      .filter((d) => !exclude.includes(d))
      .sort((a, b) => load[a] - load[b] || DEPT_ORDER.indexOf(a) - DEPT_ORDER.indexOf(b))
      .slice(0, count);
  }

  app.post("/api/dfs/upload", async (req, res) => {
    const { filename, content, uploadedBy } = req.body || {};
    if (!filename || !content || !String(content).trim()) {
      return res.status(400).json({ ok: false, error: "filename and content are required" });
    }
    if (String(content).length > 100000) return res.status(413).json({ ok: false, error: "File too large for this demo (100 KB max)" });
    await refreshLive();
    if (!liveDepts().length) return res.status(503).json({ ok: false, error: "No DataNodes are alive" });

    const id = `file-${++fileCounter}`;
    const parts = splitText(String(content), BLOCK_SIZE);
    const blocks = [];
    for (let i = 0; i < parts.length; i++) {
      const blockId = `${id}-blk${i + 1}`;
      const targets = pickNodes(REPLICATION);
      const stored = [];
      await Promise.all(targets.map(async (d) => {
        try {
          await callNode(d, "storeBlock", { blockId, data: parts[i] });
          stored.push(d);
        } catch { /* node died mid-upload; block simply has fewer replicas */ }
      }));
      blocks.push({ id: blockId, size: Buffer.byteLength(parts[i]), replicas: targets.filter((d) => stored.includes(d)) });
    }
    const meta = { id, name: filename, size: Buffer.byteLength(String(content)), uploadedBy: uploadedBy || "-", createdAt: Date.now(), blocks };
    files.set(id, meta);
    res.json({ ok: true, file: meta, blockSize: BLOCK_SIZE, replicationFactor: REPLICATION });
  });

  function describeFile(f) {
    const live = new Set(liveDepts());
    const blocks = f.blocks.map((b) => ({
      ...b,
      liveReplicas: b.replicas.filter((r) => live.has(r)),
    }));
    return {
      id: f.id, name: f.name, size: f.size, uploadedBy: f.uploadedBy, blocks,
      readable: blocks.every((b) => b.liveReplicas.length > 0),
      underReplicated: blocks.some((b) => b.liveReplicas.length < REPLICATION),
    };
  }

  app.get("/api/dfs/files", async (req, res) => {
    await refreshLive();
    res.json({ ok: true, blockSize: BLOCK_SIZE, replicationFactor: REPLICATION, files: [...files.values()].map(describeFile) });
  });

  app.get("/api/dfs/files/:id", async (req, res) => {
    const f = files.get(req.params.id);
    if (!f) return res.status(404).json({ ok: false, error: "No such file" });
    await refreshLive();
    const live = new Set(liveDepts());
    const trace = [];
    let content = "";
    for (const b of f.blocks) {
      let got = null;
      const order = [...b.replicas.filter((r) => live.has(r)), ...b.replicas.filter((r) => !live.has(r))];
      for (const r of order) {
        try {
          const out = await callNode(r, "getBlock", { blockId: b.id });
          got = out.data;
          trace.push({ block: b.id, servedBy: r, skipped: order.slice(0, order.indexOf(r)) });
          break;
        } catch { /* try the next replica */ }
      }
      if (got === null) {
        return res.status(503).json({ ok: false, error: `Block ${b.id} cannot be read: every node holding it (${b.replicas.join(", ")}) is down`, trace });
      }
      content += got;
    }
    res.json({ ok: true, name: f.name, content, trace });
  });

  app.delete("/api/dfs/files/:id", async (req, res) => {
    const f = files.get(req.params.id);
    if (!f) return res.status(404).json({ ok: false, error: "No such file" });
    for (const b of f.blocks) for (const r of b.replicas) await callNode(r, "deleteBlock", { blockId: b.id }).catch(() => {});
    files.delete(f.id);
    res.json({ ok: true });
  });

  // When a DataNode dies, HDFS copies its blocks to other nodes so every block
  // is back to 3 replicas. This is the same idea.
  app.post("/api/dfs/rereplicate", async (req, res) => {
    await refreshLive();
    const live = new Set(liveDepts());
    const log = [];
    for (const f of files.values()) {
      for (const b of f.blocks) {
        const alive = b.replicas.filter((r) => live.has(r));
        const dead = b.replicas.filter((r) => !live.has(r));
        if (!alive.length) {
          log.push(`${b.id}: ALL replicas are down - data cannot be recovered right now`);
          continue;
        }
        dead.forEach((d) => log.push(`${b.id}: replica on ${d} is lost (node down)`));
        const need = REPLICATION - alive.length;
        if (need <= 0) { b.replicas = alive; continue; }
        const targets = pickNodes(need, alive);
        const src = await callNode(alive[0], "getBlock", { blockId: b.id });
        const done = [];
        for (const t of targets) {
          try {
            await callNode(t, "storeBlock", { blockId: b.id, data: src.data });
            done.push(t);
            log.push(`${b.id}: copied from ${alive[0]} to ${t}`);
          } catch { /* ignore */ }
        }
        b.replicas = [...alive, ...done];
      }
    }
    if (!log.length) log.push("Every block already has the full number of live replicas - nothing to do.");
    res.json({ ok: true, log });
  });

  app.get("/api/dfs/datanodes", async (req, res) => {
    await refreshLive();
    const live = new Set(liveDepts());
    const rows = await Promise.all(DEPT_ORDER.map(async (d) => {
      if (!live.has(d)) return { deptCode: d, status: "down", blocks: [] };
      try {
        const r = await callNode(d, "listBlocks", {});
        return { deptCode: d, status: "up", blocks: r.blocks };
      } catch {
        return { deptCode: d, status: "down", blocks: [] };
      }
    }));
    res.json({ ok: true, datanodes: rows });
  });

  // =====================================================================
  // 4. MAPREDUCE (Apache Hadoop case study) - word count over a DFS file
  // MAP runs on a node that already holds the block (data locality).
  // SHUFFLE sends every word to the reducer chosen by hash(word) % R.
  // REDUCE adds up the counts. This is the Lab Assignment 5 algorithm.
  // =====================================================================
  app.post("/api/mapreduce/wordcount", async (req, res) => {
    try {
      const { fileId, reducers = 3, top = 10 } = req.body || {};
      const f = files.get(fileId);
      if (!f) return res.status(404).json({ ok: false, error: "Upload a file to the distributed file system first" });
      await refreshLive();
      const live = new Set(liveDepts());
      const R = Math.min(Math.max(1, Number(reducers) || 3), 7);

      // ---- MAP phase ----
      const assigned = {};
      const mapTasks = [];
      for (const b of f.blocks) {
        const candidates = b.replicas.filter((r) => live.has(r)).sort((a, c) => (assigned[a] || 0) - (assigned[c] || 0));
        if (!candidates.length) return res.status(503).json({ ok: false, error: `Block ${b.id} has no live replica, so it cannot be mapped` });
        assigned[candidates[0]] = (assigned[candidates[0]] || 0) + 1;
        mapTasks.push({ blockId: b.id, node: candidates[0] });
      }
      const t0 = Date.now();
      const mapped = await Promise.all(mapTasks.map((t) => callNode(t.node, "mapWordCount", { blockId: t.blockId, reducers: R })));
      const mapMs = Date.now() - t0;

      // ---- SHUFFLE phase ----
      const partials = Array.from({ length: R }, () => []);
      let pairs = 0;
      mapped.forEach((m) => m.partitions.forEach((part, r) => { partials[r].push(part); pairs += Object.keys(part).length; }));

      // ---- REDUCE phase ----
      const liveList = liveDepts();
      const t1 = Date.now();
      const reduceTasks = await Promise.all(partials.map((p, r) => {
        const node = liveList[r % liveList.length];
        return callNode(node, "reduceMerge", { partials: p }).then((out) => ({ partition: r, node, out }));
      }));
      const reduceMs = Date.now() - t1;

      const total = {};
      reduceTasks.forEach((t) => Object.entries(t.out.counts).forEach(([w, c]) => (total[w] = c)));
      const ranked = Object.entries(total).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      res.json({
        ok: true, file: f.name, reducers: R,
        map: mapped.map((m, i) => ({ block: mapTasks[i].blockId, ranOn: mapTasks[i].node, wordsSeen: m.wordsSeen })),
        shuffle: { keyValuePairsMoved: pairs, rule: "partition = hash(word) mod " + R },
        reduce: reduceTasks.map((t) => ({ partition: t.partition, ranOn: t.node, distinctWords: t.out.distinctWords })),
        totalWords: mapped.reduce((s, m) => s + m.wordsSeen, 0),
        distinctWords: ranked.length,
        top: ranked.slice(0, Number(top) || 10).map(([word, count]) => ({ word, count })),
        timingMs: { map: mapMs, reduce: reduceMs },
      });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // =====================================================================
  // 5. SERVERLESS: a tiny Function-as-a-Service runtime
  // - functions are stateless and run only when invoked (by HTTP or by an event)
  // - the first call after an idle period is a COLD START (extra start-up time)
  // - billing is by execution time, rounded up to 100 ms (like AWS Lambda)
  // =====================================================================
  const COLD_START_MS = 300;
  const WARM_WINDOW_MS = 30000;
  const warmUntil = {};
  const metrics = {};
  const invocationLog = [];

  async function invokeFunction(name, event, trigger) {
    const def = FUNCTIONS[name];
    if (!def) throw new Error(`No such function: ${name}`);
    const t0 = Date.now();
    const cold = !warmUntil[name] || Date.now() > warmUntil[name];
    if (cold) await sleep(COLD_START_MS); // simulated container start-up
    warmUntil[name] = Date.now() + WARM_WINDOW_MS;

    const api = {
      depts: DEPT_ORDER,
      names: DEPT_NAMES,
      now: () => new Date().toISOString(),
      rpc: async (dept, method, params) => {
        if (method !== "listResources") throw new Error("serverless functions may only call listResources");
        return callNode(dept, method, params);
      },
      chat: (from, to, text) => relayChat(from, to, text, "system"),
    };

    let result = null;
    let error = null;
    try {
      const sandbox = vm.createContext({});
      const fn = vm.runInContext("(" + def.source + ")", sandbox, { timeout: 1000 });
      result = await Promise.race([
        fn(event || {}, api),
        new Promise((_, rej) => setTimeout(() => rej(new Error("function timed out after 5 s")), 5000)),
      ]);
    } catch (e) {
      error = e.message;
    }
    const ms = Date.now() - t0;
    const billedMs = Math.max(100, Math.ceil(ms / 100) * 100);
    const m = (metrics[name] = metrics[name] || { invocations: 0, coldStarts: 0, errors: 0, totalMs: 0, billedMs: 0 });
    m.invocations += 1;
    m.totalMs += ms;
    m.billedMs += billedMs;
    if (cold) m.coldStarts += 1;
    if (error) m.errors += 1;
    const entry = { time: new Date().toLocaleTimeString(), name, trigger, cold, ms, billedMs, error };
    invocationLog.unshift({ ...entry, result: JSON.parse(JSON.stringify(result === undefined ? null : result)) });
    if (invocationLog.length > 40) invocationLog.pop();
    return { ...entry, result: JSON.parse(JSON.stringify(result === undefined ? null : result)) };
  }

  app.get("/api/faas/functions", (req, res) => {
    res.json({
      ok: true,
      functions: Object.entries(FUNCTIONS).map(([name, d]) => ({ name, description: d.description, triggers: d.triggers, source: d.source })),
    });
  });

  app.post("/api/faas/invoke/:name", async (req, res) => {
    try {
      res.json({ ok: true, ...(await invokeFunction(req.params.name, req.body, "http")) });
    } catch (e) {
      res.status(404).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/faas/metrics", (req, res) => {
    res.json({ ok: true, coldStartMs: COLD_START_MS, warmWindowMs: WARM_WINDOW_MS, metrics, log: invocationLog });
  });

  // =====================================================================
  // 6. BLOCKCHAIN / DISTRIBUTED LEDGER (self-study topic)
  // Every booking / cancellation becomes a transaction in a block. The leader
  // mines the block (proof of work) and sends it to all nodes; each node
  // validates it independently and keeps its own copy of the chain.
  // =====================================================================
  async function ledgerRecord(tx) {
    const live = liveDepts();
    const tips = (await Promise.all(live.map((d) => callNode(d, "ledgerTip", {}).then((t) => ({ d, ...t })).catch(() => null)))).filter(Boolean);
    if (!tips.length) return null;
    const best = tips.reduce((a, b) => (b.index > a.index ? b : a));
    const miner = getLeader() || live[0];
    const block = mineBlock(best.index + 1, { ...tx, at: new Date().toISOString() }, best.hash, miner);
    const results = await Promise.all(
      live.map((d) => callNode(d, "ledgerAppend", { block }).then(() => ({ dept: d, accepted: true })).catch((e) => ({ dept: d, accepted: false, reason: e.message })))
    );
    return { block, results };
  }

  async function inspectLedger() {
    await refreshLive();
    const live = new Set(liveDepts());
    const rows = await Promise.all(DEPT_ORDER.map(async (d) => {
      if (!live.has(d)) return { deptCode: d, status: "DOWN" };
      try {
        const g = await callNode(d, "ledgerGet", {});
        const last = g.chain[g.chain.length - 1];
        return { deptCode: d, status: "UP", length: g.chain.length, headHash: last.hash, valid: g.valid, brokenAt: g.brokenAt, reason: g.reason, chain: g.chain };
      } catch {
        return { deptCode: d, status: "DOWN" };
      }
    }));
    // Consensus: among nodes whose own chain is valid, the biggest group with the same head wins.
    const groups = {};
    rows.filter((r) => r.status === "UP" && r.valid).forEach((r) => {
      const k = `${r.length}:${r.headHash}`;
      (groups[k] = groups[k] || []).push(r);
    });
    const winner = Object.values(groups).sort((a, b) => b.length - a.length || b[0].length - a[0].length)[0] || null;
    const majority = winner ? { length: winner[0].length, headHash: winner[0].headHash, nodes: winner.map((r) => r.deptCode), chain: winner[0].chain } : null;
    const verdicts = rows.map((r) => {
      if (r.status === "DOWN") return { deptCode: r.deptCode, verdict: "DOWN", detail: "node is not running" };
      if (!r.valid) return { deptCode: r.deptCode, verdict: "TAMPERED", detail: `block #${r.brokenAt}: ${r.reason}`, length: r.length };
      if (!majority) return { deptCode: r.deptCode, verdict: "OK", length: r.length };
      if (r.headHash === majority.headHash && r.length === majority.length) return { deptCode: r.deptCode, verdict: "OK", detail: "matches the majority", length: r.length };
      if (r.length < majority.length) return { deptCode: r.deptCode, verdict: "BEHIND", detail: `missing ${majority.length - r.length} block(s) (was down or rejected them)`, length: r.length };
      return { deptCode: r.deptCode, verdict: "DIVERGED", detail: "valid chain but different from the majority", length: r.length };
    });
    return { rows, majority, verdicts };
  }

  app.get("/api/ledger", async (req, res) => {
    const { majority, verdicts } = await inspectLedger();
    res.json({
      ok: true,
      verdicts,
      consensus: majority ? { length: majority.length, headHash: majority.headHash, agreeingNodes: majority.nodes } : null,
      recentBlocks: majority ? majority.chain.slice(-8).map((b) => ({ index: b.index, miner: b.miner, hash: b.hash.slice(0, 16) + "…", prevHash: b.prevHash.slice(0, 16) + "…", nonce: b.nonce, tx: b.tx })) : [],
    });
  });

  app.post("/api/ledger/tamper", async (req, res) => {
    try {
      const { deptCode, index } = req.body || {};
      await callNode(deptCode, "ledgerTamper", { index });
      res.json({ ok: true, message: `${deptCode} secretly edited block #${index} in its own copy of the ledger (without redoing the hashes).` });
    } catch (e) {
      res.status(409).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ledger/heal", async (req, res) => {
    const { majority, verdicts } = await inspectLedger();
    if (!majority) return res.status(409).json({ ok: false, error: "No valid chain to copy from" });
    const healed = [];
    for (const v of verdicts) {
      if (["TAMPERED", "BEHIND", "DIVERGED"].includes(v.verdict)) {
        await callNode(v.deptCode, "ledgerReplace", { chain: majority.chain });
        healed.push(v.deptCode);
      }
    }
    res.json({ ok: true, healed, message: healed.length ? `Replaced the chain on ${healed.join(", ")} with the majority chain.` : "Every live node already agrees." });
  });

  // =====================================================================
  // 7. QUORUM KEY-VALUE STORE: trade-offs in distributed databases (CAP)
  // Every key lives on N=3 replicas. A write is successful after W replicas
  // acknowledge; a read asks R replicas and returns the newest version.
  //   W + R > N  -> reads always see the latest write (strong consistency)
  //   W + R <= N -> faster / more available, but a read may return stale data
  // When nodes are down, a strict quorum REFUSES to answer (consistency over
  // availability); a tiny quorum keeps answering (availability over consistency).
  // =====================================================================
  const N = 3;
  const knownKeys = new Set();
  const replicasFor = (key) => [...DEPT_ORDER].sort((a, b) => sha256(key + a).localeCompare(sha256(key + b))).slice(0, N);

  app.post("/api/kv/put", async (req, res) => {
    const { key, value } = req.body || {};
    const W = Math.min(Math.max(1, Number(req.body.W) || 2), N);
    if (!key || value === undefined) return res.status(400).json({ ok: false, error: "key and value are required" });
    await refreshLive();
    const live = new Set(liveDepts());
    const version = tick();
    const prefs = replicasFor(key);
    const replicas = await Promise.all(prefs.map(async (d) => {
      if (!live.has(d)) return { dept: d, status: "down" };
      try {
        await callNode(d, "kvPut", { key, value, version, writer: "gateway" });
        return { dept: d, status: "ack" };
      } catch {
        return { dept: d, status: "down" };
      }
    }));
    const acks = replicas.filter((r) => r.status === "ack").length;
    const success = acks >= W;
    knownKeys.add(key);
    res.status(success ? 200 : 503).json({
      ok: success, key, version, W, N, acks, replicas,
      message: success
        ? `Write accepted: ${acks} of ${N} replicas acknowledged (needed ${W}).`
        : `Write REFUSED: only ${acks} replica(s) acknowledged but W=${W} were required. (Replicas that did acknowledge still hold the new value - like Dynamo, there is no rollback.)`,
    });
  });

  app.get("/api/kv/get", async (req, res) => {
    const key = req.query.key;
    const R = Math.min(Math.max(1, Number(req.query.R) || 2), N);
    if (!key) return res.status(400).json({ ok: false, error: "key is required" });
    await refreshLive();
    const live = new Set(liveDepts());
    const prefs = replicasFor(key);
    const asked = prefs.filter((d) => live.has(d)).slice(0, R);
    const answers = await Promise.all(asked.map((d) => callNode(d, "kvGet", { key }).catch(() => null)));
    const got = answers.filter(Boolean);
    if (got.length < R) {
      return res.status(503).json({ ok: false, error: `Read REFUSED: only ${got.length} live replica(s) but R=${R} were required.`, replicas: prefs.map((d) => ({ dept: d, status: live.has(d) ? "up" : "down" })) });
    }
    const newest = got.filter((a) => a.found).sort((a, b) => b.version - a.version)[0] || null;
    const repaired = [];
    if (newest) {
      // read repair: bring every live replica that is behind up to date
      for (const d of prefs.filter((x) => live.has(x))) {
        const cur = await callNode(d, "kvGet", { key }).catch(() => null);
        if (cur && (!cur.found || cur.version < newest.version)) {
          await callNode(d, "kvPut", { key, value: newest.value, version: newest.version, writer: "read-repair" }).catch(() => {});
          repaired.push(d);
        }
      }
    }
    res.json({
      ok: true, key, R, N,
      found: Boolean(newest), value: newest ? newest.value : null, version: newest ? newest.version : null,
      contacted: got.map((a) => ({ dept: a.deptCode, found: a.found, version: a.version || null, value: a.value === undefined ? null : a.value })),
      replicaPreferenceList: prefs.map((d) => ({ dept: d, status: live.has(d) ? "up" : "down" })),
      readRepairedReplicas: repaired,
      note: !newest ? "None of the contacted replicas has this key (they may not have received the write)." : undefined,
    });
  });

  app.get("/api/kv/keys", (req, res) => res.json({ ok: true, keys: [...knownKeys] }));

  // =====================================================================
  // Hook called by the gateway after every successful booking / cancellation
  // =====================================================================
  async function afterBooking({ method, deptCode, params, result }) {
    ctx.invalidateCache(deptCode); // purge edge caches (like a CDN purge API)
    const action = method === "bookResource" ? "BOOK" : "CANCEL";
    try {
      await ledgerRecord({
        type: action, dept: deptCode, resourceId: result.resource.id, resource: result.resource.name,
        slot: result.slotLabel, by: (params && params.studentName) || "-", byDept: (params && params.requesterDept) || "-",
      });
    } catch (e) {
      console.warn("ledger record failed:", e.message);
    }
    // Event-driven serverless function (runs in the background, never blocks the booking)
    invokeFunction("bookingAudit", { action, resource: result.resource.name, slot: result.slotLabel, dept: deptCode }, "event: booking").catch(() => {});
  }

  return { afterBooking };
};
