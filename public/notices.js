// notices.js - NOTICE BOARD  (Unit 4: trade-offs in distributed databases: quorum, CAP)
//
// Every notice is stored on N = 3 department servers. A write must be confirmed by
// W servers, a read asks R servers and shows the newest version it sees.
//   W + R > 3  -> a read always meets the latest write (consistent)
//   smaller    -> faster and more available, but a read may see an older notice

const WRITE_LEVELS = { strong: 3, balanced: 2, fast: 1 };

function chips(list) {
  return list.map((x) => `<span class="state ${x.status === "ack" || x.status === "up" ? "state-OK" : "state-DOWN"}">${x.dept}: ${x.status}</span>`).join(" ");
}

wire("n-post", async () => {
  const level = document.getElementById("n-level").value;
  const payload = JSON.stringify({ text: document.getElementById("n-text").value, by: currentUser ? currentUser.name : "guest", dept: currentUser ? currentUser.dept : "-" });
  const r = await api("POST", "/api/kv/put", { key: document.getElementById("n-title").value.trim(), value: payload, W: WRITE_LEVELS[level] });
  const d = r.data;
  setHtml("n-msg", verdictBox(d.ok ? "good" : "bad", `<b>${d.ok ? "NOTICE PUBLISHED" : "NOTICE REFUSED"}</b> &mdash; ${esc(d.message || d.error)}`) +
    (d.replicas ? `<div class="small">Servers holding this notice: ${chips(d.replicas)}</div>` : ""));
  if (d.ok) await loadNotices();
});

async function loadNotices() {
  const R = Number(document.getElementById("n-readlevel").value);
  const k = await api("GET", "/api/kv/keys");
  const keys = (k.data && k.data.keys) || [];
  if (!keys.length) return setHtml("n-list", '<p class="hint">No notices yet.</p>');
  const cards = [];
  for (const key of keys) {
    const r = await api("GET", `/api/kv/get?key=${encodeURIComponent(key)}&R=${R}`);
    const d = r.data;
    if (!d.ok) {
      cards.push(`<div class="col-md-6"><div class="notice-card"><div class="notice-title">${esc(key)}</div>${verdictBox("bad", "<b>Cannot be read:</b> " + esc(d.error))}${d.replicas ? "<div class='small'>" + chips(d.replicas.map((x) => ({ dept: x.dept, status: x.status }))) + "</div>" : ""}</div></div>`);
      continue;
    }
    let body = { text: "(no answer)", by: "", dept: "" };
    try { body = JSON.parse(d.value); } catch (e) { body.text = d.value; }
    cards.push(`<div class="col-md-6"><div class="notice-card"><div class="notice-title">${esc(key)}</div>
      <div class="notice-text">${d.found ? esc(body.text) : "<span class='text-muted'>" + esc(d.note) + "</span>"}</div>
      <div class="notice-meta">${d.found ? `posted by ${esc(body.by)} (${esc(body.dept)}) &middot; version ${d.version} &middot; ` : ""}read from ${d.contacted.length} server(s): ${esc(d.contacted.map((c) => c.dept + (c.found ? " v" + c.version : " (no copy)")).join(", "))}</div>
      <div class="small mt-1">${chips(d.replicaPreferenceList)}</div>
      ${d.readRepairedReplicas && d.readRepairedReplicas.length ? `<div class="notice-meta">read repair updated: ${esc(d.readRepairedReplicas.join(", "))}</div>` : ""}</div></div>`);
  }
  setHtml("n-list", cards.join(""));
}
wire("n-refresh", loadNotices);
document.getElementById("n-readlevel").addEventListener("change", loadNotices);
document.querySelector('[data-bs-target="#tab-notices"]').addEventListener("shown.bs.tab", loadNotices);
