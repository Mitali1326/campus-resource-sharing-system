// createResourceNode.js
//
// This factory boots ONE independent "department node". Each department
// (Computer, IT, Mechanical, Electrical, Civil, E&TC, Central Library) runs
// this same code as its own separate process / container, with its own local
// data. The Gateway never touches that data directly - it only calls the
// remote procedures listed below.
//
// What lives inside every node
//   FA-1 : resources with time-slot bookings, its own copy of chat messages
//   Unit 3: physical clock with skew, vector clock, beacon sender,
//           snapshot recorder, lock table (used when this node is the leader)
//   Unit 4: remote objects, DFS block storage + MapReduce, ledger copy,
//           key-value replica
//
// The Unit 3 / Unit 4 pieces are split into small files under ./features so
// each one can be read and explained on its own.

const express = require("express");
const cors = require("cors");

const clocks = require("./features/clocks");
const startBeacon = require("./features/beacon");
const snapshot = require("./features/snapshot");
const locks = require("./features/locks");
const objects = require("./features/objects");
const storage = require("./features/storage");
const ledger = require("./features/ledger");
const kvstore = require("./features/kvstore");

// Every resource uses the same fixed daily time slots, so a resource is never
// "booked" as a whole - only specific slots on it are.
const SLOT_DEFS = [
  { id: "s1", label: "9:00 AM - 11:00 AM" },
  { id: "s2", label: "11:00 AM - 1:00 PM" },
  { id: "s3", label: "1:00 PM - 3:00 PM" },
  { id: "s4", label: "3:00 PM - 5:00 PM" },
  { id: "s5", label: "5:00 PM - 7:00 PM" },
];

function emptySlots() {
  const slots = {};
  for (const def of SLOT_DEFS) {
    slots[def.id] = { label: def.label, booked: false, bookedBy: null, bookedByDept: null, bookedAt: null };
  }
  return slots;
}

function createResourceNode({ nodeId, deptCode, deptName, port, resources }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // In-memory "database" local to this node only.
  const state = resources.map((r) => ({ ...r, slots: emptySlots() }));

  // This node's own copy of every chat message it sent or received.
  const messages = [];
  const sentTo = {};
  const receivedFrom = {};

  const ctx = { nodeId, deptCode, deptName, state, messages, sentTo, receivedFrom, procedures: null };
  ctx.countBooked = () =>
    state.reduce((n, r) => n + Object.values(r.slots).filter((s) => s.booked).length, 0);
  ctx.countBlocks = () => 0; // replaced by features/storage.js

  // ---- FA-1 procedures (unchanged behaviour) ----
  const core = {
    listResources: () => ({ deptCode, deptName, nodeId, resources: state }),

    bookResource: ({ resourceId, slotId, studentName, requesterDept }) => {
      const resource = state.find((r) => r.id === resourceId);
      if (!resource) throw new Error(`Resource ${resourceId} not found on node ${nodeId}`);
      const slot = resource.slots[slotId];
      if (!slot) throw new Error(`Time slot ${slotId} does not exist on ${resource.name}`);
      if (slot.booked) throw new Error(`${resource.name} is already booked for ${slot.label}`);
      slot.booked = true;
      slot.bookedBy = studentName;
      slot.bookedByDept = requesterDept || deptCode;
      slot.bookedAt = Date.now();
      return {
        deptCode, deptName, nodeId, resource, slotId, slotLabel: slot.label,
        crossDept: Boolean(requesterDept) && requesterDept !== deptCode,
      };
    },

    cancelBooking: ({ resourceId, slotId }) => {
      const resource = state.find((r) => r.id === resourceId);
      if (!resource) throw new Error(`Resource ${resourceId} not found on node ${nodeId}`);
      const slot = resource.slots[slotId];
      if (!slot) throw new Error(`Time slot ${slotId} does not exist on ${resource.name}`);
      const slotLabel = slot.label;
      slot.booked = false;
      slot.bookedBy = null;
      slot.bookedByDept = null;
      slot.bookedAt = null;
      return { deptCode, deptName, nodeId, resource, slotId, slotLabel };
    },

    // Inter-department chat. Each node stores its own copy. Unit 3 addition:
    // every message carries a VECTOR CLOCK so we can tell which messages are
    // causally related and which happened concurrently.
    logMessage: ({ withDept, text, direction, kind, vector }) => {
      const received = direction === "received";
      let vc;
      if (received) {
        vc = ctx.vcMerge(vector); // merge sender's vector, then tick
        receivedFrom[withDept] = (receivedFrom[withDept] || 0) + 1;
        if (ctx.onChatReceived) ctx.onChatReceived(withDept, text);
      } else {
        vc = ctx.vcTick();
        sentTo[withDept] = (sentTo[withDept] || 0) + 1;
      }
      messages.push({
        withDept, text,
        direction: received ? "received" : "sent",
        kind: kind === "system" ? "system" : "user",
        timestamp: Date.now(),
        vector: vc,
      });
      return { deptCode, stored: true, vector: vc };
    },

    getMessages: ({ withDept }) => ({
      deptCode, deptName, withDept,
      messages: messages.filter((m) => m.withDept === withDept),
    }),
  };

  const procedures = {
    ...core,
    ...clocks(ctx),
    ...snapshot(ctx),
    ...locks(ctx),
    ...objects(ctx),
    ...storage(ctx),
    ...ledger(ctx),
    ...kvstore(ctx),
  };
  ctx.procedures = procedures;

  // ---- The RPC endpoint ----
  // The Gateway sends { method, params } over HTTP. This node runs the
  // matching local procedure and sends the result back as JSON. It is a
  // simplified JSON-RPC: the same idea as gRPC / Java RMI, written over plain
  // HTTP so it is easy to read and explain.
  app.post("/rpc", (req, res) => {
    const { method, params } = req.body;
    const procedure = procedures[method];
    if (!procedure) return res.status(400).json({ ok: false, error: `Unknown procedure: ${method}` });
    try {
      res.json({ ok: true, result: procedure(params || {}) });
    } catch (err) {
      res.status(409).json({ ok: false, error: err.message });
    }
  });

  app.get("/health", (req, res) => {
    res.json({ nodeId, deptCode, deptName, status: "up", port });
  });

  app.listen(port, () => {
    console.log(`[${nodeId}] ${deptName} node listening on port ${port}`);
  });

  startBeacon(ctx);
  return app;
}

module.exports = createResourceNode;
