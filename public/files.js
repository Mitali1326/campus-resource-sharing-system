// files.js - SHARED FILES  (Unit 4: distributed file system + MapReduce / Hadoop)
//
// The gateway is the NameNode: it keeps only metadata (file -> blocks -> nodes).
// The department nodes are DataNodes that hold the real blocks, 3 copies each.
// "Analyze keywords" runs a MapReduce word-count job on the nodes that hold the blocks.

const SAMPLE_TEXT =
  "Distributed systems share resources across many computers. A distributed file system splits every file into blocks and keeps copies of each block on several machines. " +
  "When one machine fails the data is still available from another machine, so the users of the campus network never notice the failure. " +
  "The name node keeps the map of blocks and the data nodes keep the blocks. Computation can then move to the machines that already hold the data, " +
  "which is the main idea of MapReduce and of Hadoop. Shared labs, shared files and shared services make the whole campus work like one system.";
document.getElementById("dfs-sample").addEventListener("click", () => { document.getElementById("dfs-text").value = SAMPLE_TEXT; });

document.getElementById("dfs-file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById("dfs-text").value = String(reader.result).slice(0, 100000);
    document.getElementById("dfs-name").value = f.name;
  };
  reader.readAsText(f);
});

async function loadFiles() {
  const r = await api("GET", "/api/dfs/files");
  if (!r.data) return;
  const files = r.data.files;
  if (!files.length) return setHtml("dfs-files", '<p class="hint mt-2">No files yet. Press &ldquo;Fill sample text&rdquo; and then &ldquo;Upload &amp; replicate&rdquo;.</p>');
  let html = tbl(["File", "Size", "Blocks", "Health", "Actions"], files.map((f) => [
    `<b>${esc(f.name)}</b><br><span class="mono">${f.id}</span> <span class="hint">by ${esc(f.uploadedBy)}</span>`,
    f.size + " bytes",
    f.blocks.length,
    !f.readable ? stateTag("DOWN") + " cannot be read right now" : f.underReplicated ? stateTag("BEHIND") + " fewer than " + r.data.replicationFactor + " live copies" : stateTag("OK") + " every block has " + r.data.replicationFactor + " live copies",
    `<button class="btn btn-sm btn-outline-primary" data-act="read" data-id="${f.id}">Read</button> ` +
    `<button class="btn btn-sm btn-primary" data-act="analyze" data-id="${f.id}">Analyze keywords</button> ` +
    `<button class="btn btn-sm btn-outline-secondary" data-act="del" data-id="${f.id}">Delete</button>`,
  ]));
  files.forEach((f) => {
    html += `<details class="mt-2"><summary class="small"><b>Where are the blocks of ${esc(f.name)}?</b></summary>` +
      tbl(["Block", "Size", "Stored on (green = server alive, red = server down)"], f.blocks.map((b) => [
        `<span class="mono">${b.id}</span>`, b.size + " B",
        b.replicas.map((d) => `<span class="state ${b.liveReplicas.includes(d) ? "state-OK" : "state-DOWN"}">${d}</span>`).join(" "),
      ])) + "</details>";
  });
  setHtml("dfs-files", html);
}

async function analyzeFile(fileId) {
  setHtml("mr-out", '<p class="hint">Running MapReduce job...</p>');
  const r = await api("POST", "/api/mapreduce/wordcount", { fileId, reducers: Number(document.getElementById("mr-red").value), top: 10 });
  if (!r.data.ok) return setHtml("mr-out", verdictBox("bad", esc(r.data.error)));
  const d = r.data;
  setHtml("mr-out",
    `<h6>MapReduce word count of "${esc(d.file)}": ${d.totalWords} words, ${d.distinctWords} different</h6>` +
    `<div class="row g-3"><div class="col-lg-6"><b class="small">Top keywords</b>` + tbl(["Word", "Count"], d.top.map((t) => [esc(t.word), t.count])) + "</div>" +
    `<div class="col-lg-6"><b class="small">1. MAP - ran on nodes that already hold the blocks (${d.timingMs.map} ms)</b>` +
    tbl(["Block", "Ran on node", "Words read"], d.map.map((m) => [`<span class="mono">${m.block}</span>`, `<b>${m.ranOn}</b>`, m.wordsSeen])) +
    `<p class="small mb-1"><b>2. SHUFFLE</b> - ${d.shuffle.keyValuePairsMoved} (word, count) pairs sent to reducers. Rule: <span class="mono">${esc(d.shuffle.rule)}</span></p>` +
    `<b class="small">3. REDUCE (${d.timingMs.reduce} ms)</b>` +
    tbl(["Partition", "Ran on node", "Distinct words"], d.reduce.map((x) => [x.partition, `<b>${x.ranOn}</b>`, x.distinctWords])) + "</div></div>");
}

document.getElementById("dfs-files").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  btn.disabled = true;
  try {
    if (btn.dataset.act === "read") {
      const r = await api("GET", "/api/dfs/files/" + btn.dataset.id);
      setOut("dfs-out", r.data.ok
        ? `READ OK - block by block, the gateway asked a live replica:\n` + r.data.trace.map((t) => `  ${t.block}  served by ${t.servedBy}${t.skipped.length ? "  (skipped " + t.skipped.join(", ") + ")" : ""}`).join("\n") + `\n\nFile content:\n${r.data.content}`
        : "READ FAILED: " + r.data.error);
    } else if (btn.dataset.act === "analyze") {
      await analyzeFile(btn.dataset.id);
    } else {
      await api("DELETE", "/api/dfs/files/" + btn.dataset.id);
      document.getElementById("dfs-out").classList.add("d-none");
      setHtml("mr-out", "");
      await loadFiles();
    }
  } finally { btn.disabled = false; }
});

wire("dfs-upload", async () => {
  const content = document.getElementById("dfs-text").value;
  const r = await api("POST", "/api/dfs/upload", { filename: document.getElementById("dfs-name").value || "file.txt", content, uploadedBy: currentUser ? currentUser.name : "-" });
  if (!r.data.ok) return alert(r.data.error);
  setOut("dfs-out", `Uploaded "${r.data.file.name}" (${r.data.file.size} bytes) as ${r.data.file.blocks.length} blocks of up to ${r.data.blockSize} characters.\nEvery block was written to ${r.data.replicationFactor} different department servers.`);
  await loadFiles();
});
wire("dfs-refresh", loadFiles);
wire("dfs-rerep", async () => {
  const r = await api("POST", "/api/dfs/rereplicate");
  setOut("dfs-out", "REPAIR (re-replication)\n" + r.data.log.join("\n"));
  await loadFiles();
});
wire("dfs-nodes", async () => {
  const r = await api("GET", "/api/dfs/datanodes");
  setHtml("dfs-nodes-out", "<h6>Blocks stored on each department server</h6>" + tbl(["Server", "Status", "Blocks stored"],
    r.data.datanodes.map((d) => [`<b>${d.deptCode}</b>`, stateTag(d.status === "up" ? "UP" : "DOWN"), d.blocks.length ? esc(d.blocks.map((b) => b.blockId).join(", ")) : "-"])));
});
document.querySelector('[data-bs-target="#tab-files"]').addEventListener("shown.bs.tab", loadFiles);
loadFiles();
