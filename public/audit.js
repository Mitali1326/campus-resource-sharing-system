// audit.js - AUDIT TRAIL  (Unit 4 self study: blockchain / distributed ledger)
//
// Every booking and cancellation becomes a hash-chained block. Each department
// keeps its own copy and checks it independently; the majority decides.

fillDeptSelect("led-dept", true);

async function loadLedger(extra) {
  const r = await api("GET", "/api/ledger");
  const d = r.data;
  let html = (extra || "") + "<h6>Each department's own copy of the audit trail</h6>" +
    tbl(["Department", "Verdict", "Blocks", "Detail"], d.verdicts.map((v) => [`<b>${esc(DEPT_LABELS[v.deptCode])}</b>`, stateTag(v.verdict), v.length || "-", esc(v.detail || "")]));
  if (d.consensus) {
    html += verdictBox(d.verdicts.every((v) => v.verdict === "OK") ? "good" : "warn",
      `<b>Agreement:</b> ${d.consensus.agreeingNodes.length} department(s) hold the same chain of ${d.consensus.length} blocks (head ${esc(d.consensus.headHash.slice(0, 16))}…)`);
    html += "<h6>Most recent blocks of the agreed chain</h6>" + tbl(["#", "Mined by", "What happened", "Hash", "Previous hash", "Nonce"],
      d.recentBlocks.map((b) => [b.index, esc(b.miner), b.tx.type === "GENESIS" ? "genesis block" : esc(`${b.tx.type}  ${b.tx.resource} (${b.tx.slot}) by ${b.tx.by} / ${b.tx.byDept}`), `<span class="mono">${b.hash}</span>`, `<span class="mono">${b.prevHash}</span>`, b.nonce]));
  }
  setHtml("led-out", html);
}
wire("led-refresh", () => loadLedger());
wire("led-tamper", async () => {
  const r = await api("POST", "/api/ledger/tamper", { deptCode: document.getElementById("led-dept").value, index: Number(document.getElementById("led-index").value) });
  await loadLedger(verdictBox(r.data.ok ? "warn" : "bad", esc(r.data.message || r.data.error)));
});
wire("led-heal", async () => {
  const r = await api("POST", "/api/ledger/heal");
  await loadLedger(verdictBox(r.data.ok ? "good" : "bad", esc(r.data.message || r.data.error)));
});
document.querySelector('[data-bs-target="#tab-audit"]').addEventListener("shown.bs.tab", () => loadLedger());
