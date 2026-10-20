// reports.js - REPORTS  (Unit 4: serverless architecture / Function-as-a-Service)
//
// Each report is a small stateless function that runs only when called.
// bookingAudit runs by itself (event trigger) every time something is booked.

const FUNCTION_TITLES = {
  utilizationReport: "Utilization report",
  peakSlotFinder: "Busiest time slot",
  broadcastNotice: "Broadcast a notice to all departments",
  bookingAudit: "Booking audit (automatic)",
};

async function loadFunctions() {
  const r = await api("GET", "/api/faas/functions");
  if (!r.data) return;
  setHtml("faas-list", tbl(["Report / task", "What it does", "Trigger", ""], r.data.functions.map((f) => [
    `<b>${esc(FUNCTION_TITLES[f.name] || f.name)}</b><br><span class="mono">${f.name}()</span>`, esc(f.description), esc(f.triggers.join(", ")),
    f.triggers.includes("http") ? `<button class="btn btn-sm btn-primary" data-fn="${f.name}">Run</button>` : '<span class="hint">runs by itself on every booking</span>',
  ])));
}

function renderResult(name, d) {
  const status = `<div class="verdict ${d.cold ? "warn" : "good"}"><b>${d.cold ? "COLD START" : "WARM"}</b> &mdash; ${d.cold ? "a fresh runtime had to be started (+300 ms)" : "the runtime was reused"} &middot; execution ${d.ms} ms &middot; billed ${d.billedMs} ms</div>`;
  if (d.error) return status + verdictBox("bad", esc(d.error));
  let body;
  if (name === "utilizationReport") {
    body = "<h6>Booked slots per department</h6>" + d.result.map((x) => x.error ? `<div class="small">${esc(DEPT_LABELS[x.dept])}: ${esc(x.error)}</div>` :
      `<div class="mb-2"><div class="small">${esc(DEPT_LABELS[x.dept])} &mdash; ${x.booked} of ${x.total} slots (${x.percent}%)</div><div class="bar"><div class="bar-fill" style="width:${x.percent}%"></div></div></div>`).join("");
  } else if (name === "peakSlotFinder") {
    body = d.result.busiestSlot ? `<h6>Busiest slot: ${esc(d.result.busiestSlot.slot)} (${d.result.busiestSlot.bookings} bookings)</h6>` + tbl(["Time slot", "Bookings"], d.result.ranking.map((x) => [esc(x.slot), x.bookings])) : '<p class="hint">Nothing is booked yet.</p>';
  } else if (name === "broadcastNotice") {
    body = `<p class="mb-0">Notice sent from <b>${esc(d.result.from)}</b> to <b>${d.result.deliveredTo}</b> departments. Open the chat panel in Booking &amp; Collaboration to see it.</p>`;
  } else {
    body = `<pre class="out">${esc(JSON.stringify(d.result, null, 2))}</pre>`;
  }
  return status + body;
}

document.getElementById("faas-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-fn]");
  if (!btn) return;
  btn.disabled = true;
  try {
    const r = await api("POST", "/api/faas/invoke/" + btn.dataset.fn, {});
    setHtml("faas-result", renderResult(btn.dataset.fn, r.data));
    await loadFaasMetrics();
  } finally { btn.disabled = false; }
});

async function loadFaasMetrics() {
  const r = await api("GET", "/api/faas/metrics");
  const m = Object.entries(r.data.metrics);
  setHtml("faas-metrics-out",
    "<h6>Usage and billing per function</h6>" + (m.length ? tbl(["Function", "Calls", "Cold starts", "Errors", "Average ms", "Billed ms (total)"],
      m.map(([n, x]) => [`<span class="mono">${n}</span>`, x.invocations, x.coldStarts, x.errors, Math.round(x.totalMs / x.invocations), x.billedMs])) : '<p class="hint">no calls yet</p>') +
    "<h6>Recent calls (newest first)</h6>" + (r.data.log.length ? tbl(["Time", "Function", "Trigger", "Start", "ms", "Result"],
      r.data.log.slice(0, 10).map((l) => [l.time, `<span class="mono">${l.name}</span>`, esc(l.trigger), l.cold ? '<span class="state state-BEHIND">cold</span>' : '<span class="state state-OK">warm</span>', l.ms, `<span class="mono">${esc(JSON.stringify(l.result)).slice(0, 110)}</span>`])) : '<p class="hint">empty</p>'));
}
wire("faas-metrics", loadFaasMetrics);
document.querySelector('[data-bs-target="#tab-reports"]').addEventListener("shown.bs.tab", () => { loadFunctions(); loadFaasMetrics(); });
loadFunctions();
