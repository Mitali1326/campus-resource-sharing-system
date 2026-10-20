// common.js - tiny helpers shared by app.js, unit3.js and unit4.js

const DEPT_CODES = ["comp", "it", "mech", "elec", "civil", "entc", "central"];
const DEPT_LABELS = {
  comp: "Computer Engineering", it: "Information Technology", mech: "Mechanical Engineering",
  elec: "Electrical Engineering", civil: "Civil Engineering", entc: "Electronics & Telecommunication",
  central: "Central Library",
};

// Escape text before putting it into innerHTML (names typed by users, chat text, ...)
function esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// fetch wrapper: always returns { status, ok, data, headers } and never throws on HTTP errors
async function api(method, url, body, extraHeaders) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

function setOut(id, text) {
  const el = document.getElementById(id);
  el.classList.remove("d-none");
  el.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}
function setHtml(id, html) { document.getElementById(id).innerHTML = html; }

// Build a table. headers = ["A","B"], rows = [["x","y"], ...]. Cells are raw HTML, so callers esc() user data.
function tbl(headers, rows) {
  const head = "<tr>" + headers.map((h) => `<th>${h}</th>`).join("") + "</tr>";
  const body = rows.map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("");
  return `<table class="table-sm"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
function stateTag(state) { return `<span class="state state-${String(state).replace(/\s+/g, "-")}">${esc(state)}</span>`; }
function stepsList(lines) { return `<ol class="steps">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>`; }
function verdictBox(kind, html) { return `<div class="verdict ${kind}">${html}</div>`; }

// compact vector clock text: only non-zero entries, e.g. "comp:2 it:1"
function vcText(v) {
  const parts = DEPT_CODES.filter((d) => v && v[d]).map((d) => `${d}:${v[d]}`);
  return parts.length ? parts.join(" ") : "all zero";
}

function fillDeptSelect(id, withLabels) {
  const el = document.getElementById(id);
  el.innerHTML = DEPT_CODES.map((d) => `<option value="${d}">${withLabels ? DEPT_LABELS[d] : d}</option>`).join("");
}

// Attach a click handler that disables the button while it runs and shows errors in the page
function wire(id, handler) {
  const btn = document.getElementById(id);
  if (!btn) { console.warn("wire(): no element with id", id); return; }
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await handler();
    } catch (err) {
      console.error(err);
      alert("Something went wrong: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// Is an accordion section currently open?
function isOpen(sectionId) {
  const el = document.getElementById(sectionId);
  return Boolean(el && el.classList.contains("show"));
}
function ms(n) { return `${n} ms`; }
