// board.js - AVAILABILITY BOARD  (Unit 4: distributed web-based system, caching / CDN)
//
// The board only READS. It asks the REST API
//   GET /api/v1/departments/<dept>/resources?edge=<cache server>
// The cache server answers from its own copy (HIT) or asks the department node
// (MISS). The browser also remembers each answer with its ETag and sends it back
// in If-None-Match; if nothing changed the server replies 304 and we simply
// reuse the copy we already hold.

const boardCopies = {}; // "edge:dept" -> { etag, body }
const SLOT_ORDER = ["s1", "s2", "s3", "s4", "s5"];
const SLOT_SHORT = ["9-11", "11-1", "1-3", "3-5", "5-7"];

async function loadBoard() {
  const edge = document.getElementById("board-edge").value;
  const rows = await Promise.all(DEPT_CODES.map(async (d) => {
    const key = edge + ":" + d;
    const headers = boardCopies[key] ? { "If-None-Match": boardCopies[key].etag } : {};
    const t0 = performance.now();
    const r = await api("GET", `/api/v1/departments/${d}/resources?edge=${edge}`, null, headers);
    const took = Math.round(performance.now() - t0);
    let body = null, label;
    if (r.status === 304 && boardCopies[key]) {
      body = boardCopies[key].body; label = "304";
    } else if (r.ok && r.data) {
      body = r.data;
      const et = r.headers.get("etag");
      if (et) boardCopies[key] = { etag: et, body };
      label = r.headers.get("x-cache") || "BYPASS";
    } else {
      label = "ERROR";
    }
    return { d, body, label, took, error: r.data && r.data.error };
  }));

  const count = (l) => rows.filter((x) => x.label === l).length;
  document.getElementById("board-summary").textContent =
    `updated ${new Date().toLocaleTimeString()}  |  HIT ${count("HIT")}  MISS ${count("MISS")}  304 ${count("304")}  no-cache ${count("BYPASS")}`;

  document.getElementById("board-out").innerHTML = rows.map((x) => {
    const chipClass = x.label === "HIT" ? "cache-hit" : x.label === "MISS" ? "cache-miss" : x.label === "304" ? "cache-304" : "";
    const chipText = x.label === "304" ? "304 reused my copy" : x.label;
    let table;
    if (!x.body) {
      table = `<p class="text-danger small mb-0">${esc(x.error || "department server not reachable")}</p>`;
    } else {
      table = `<table class="board-table"><thead><tr><th style="text-align:left">Resource</th>${SLOT_SHORT.map((s) => `<th>${s}</th>`).join("")}</tr></thead><tbody>` +
        x.body.resources.map((res) =>
          `<tr><td>${esc(res.name)}</td><td class="slots" colspan="5">` +
          SLOT_ORDER.map((sid) => {
            const s = res.slots[sid];
            return `<span class="cell ${s.booked ? "cell-booked" : "cell-free"}" title="${esc(s.label)}: ${s.booked ? "booked by " + esc(s.bookedBy) + " (" + esc(s.bookedByDept) + ")" : "free"}"></span>`;
          }).join("") + "</td></tr>").join("") + "</tbody></table>";
    }
    return `<div class="col-lg-6"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center">
      <span>${esc(DEPT_LABELS[x.d])}</span><span class="cache-chip ${chipClass}">${chipText} &middot; ${x.took} ms</span></div>
      <div class="card-body py-2">${table}</div></div></div>`;
  }).join("");
}

wire("board-refresh", loadBoard);
document.getElementById("board-edge").addEventListener("change", loadBoard);
setInterval(() => {
  if (document.getElementById("board-auto").checked && document.getElementById("tab-board").classList.contains("active")) loadBoard();
}, 5000);
document.querySelector('[data-bs-target="#tab-board"]').addEventListener("shown.bs.tab", loadBoard);
loadBoard();
