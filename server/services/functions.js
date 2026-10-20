// services/functions.js
// The "serverless functions" of the project. Each one is a small STATELESS
// function: it receives an event and an api object, returns a result, and keeps
// nothing in memory between calls. The gateway runs them on demand inside an
// isolated vm context (like a tiny Function-as-a-Service platform).
// The code is fixed here on purpose - the server never runs code sent by users.

module.exports = {
  utilizationReport: {
    description: "Reads every department node and reports what percentage of its time slots is booked.",
    triggers: ["http"],
    source: `async (event, api) => {
      const rows = [];
      for (const d of api.depts) {
        try {
          const r = await api.rpc(d, "listResources", {});
          let total = 0, booked = 0;
          for (const res of r.resources) for (const s of Object.values(res.slots)) { total++; if (s.booked) booked++; }
          rows.push({ dept: d, booked, total, percent: Math.round(100 * booked / total) });
        } catch (e) { rows.push({ dept: d, error: "node unreachable" }); }
      }
      return rows;
    }`,
  },

  peakSlotFinder: {
    description: "Finds which daily time slot is booked most often across the whole campus.",
    triggers: ["http"],
    source: `async (event, api) => {
      const counts = {};
      for (const d of api.depts) {
        try {
          const r = await api.rpc(d, "listResources", {});
          for (const res of r.resources) for (const s of Object.values(res.slots)) if (s.booked) counts[s.label] = (counts[s.label] || 0) + 1;
        } catch (e) {}
      }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([slot, bookings]) => ({ slot, bookings }));
      return { busiestSlot: ranked[0] || null, ranking: ranked };
    }`,
  },

  bookingAudit: {
    description: "Runs automatically (event trigger) every time a slot is booked or cancelled and writes one audit line.",
    triggers: ["event: booking"],
    source: `async (event, api) => {
      return { line: api.now() + "  " + event.action + "  " + event.resource + " (" + event.slot + ")  on " + event.dept };
    }`,
  },

  broadcastNotice: {
    description: "Sends a notice from one department (default Central Library) to every other department's chat.",
    triggers: ["http"],
    source: `async (event, api) => {
      const from = event.from || "central";
      let sent = 0;
      for (const d of api.depts) {
        if (d === from) continue;
        try { await api.chat(from, d, "[Notice] " + (event.text || "Library closes at 6 PM today.")); sent++; } catch (e) {}
      }
      return { from: from, deliveredTo: sent };
    }`,
  },
};
