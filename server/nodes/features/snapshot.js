// features/snapshot.js  (Unit 3: Global state - Chandy-Lamport snapshot)
//
// Goal: record a CONSISTENT picture of the whole distributed system even
// though nobody has a global clock and messages are in flight.
//
// Node-side rules:
//  - First MARKER received (or when initiating): record my own local state,
//    then start recording every other incoming channel, except the one the
//    marker came on (that channel is recorded as empty).
//  - A later MARKER on channel X: stop recording channel X.
//  - Any normal chat message arriving on a channel that is still being
//    recorded is "in flight" and becomes part of the snapshot's channel state.

module.exports = function snapshot(ctx) {
  const snaps = {};

  function captureLocal() {
    return {
      deptCode: ctx.deptCode,
      bookedSlots: ctx.countBooked(),
      chatSentTo: { ...ctx.sentTo },
      chatReceivedFrom: { ...ctx.receivedFrom },
      vector: ctx.vcCopy(),
    };
  }

  // Called by logMessage whenever a chat message is received.
  ctx.onChatReceived = (fromDept, text) => {
    for (const s of Object.values(snaps)) {
      if (s.recording[fromDept]) s.channelState[fromDept].push({ from: fromDept, text });
    }
  };

  return {
    snapshotMarker: ({ snapshotId, fromDept, initiator, participants }) => {
      let s = snaps[snapshotId];
      const others = (participants || []).filter((d) => d !== ctx.deptCode);
      if (!s) {
        s = snaps[snapshotId] = {
          id: snapshotId,
          initiator,
          local: captureLocal(),
          channelState: {},
          recording: {},
          closed: {},
        };
        for (const d of others) {
          s.channelState[d] = [];
          s.recording[d] = d !== fromDept; // channel the marker came on = empty
          s.closed[d] = d === fromDept;
        }
      } else if (fromDept) {
        s.recording[fromDept] = false;
        s.closed[fromDept] = true;
      }
      const done = Object.values(s.closed).every(Boolean);
      return { deptCode: ctx.deptCode, done };
    },
    snapshotResult: ({ snapshotId }) => {
      const s = snaps[snapshotId];
      if (!s) throw new Error("No such snapshot on this node");
      return {
        deptCode: ctx.deptCode,
        local: s.local,
        channelState: s.channelState,
        done: Object.values(s.closed).every(Boolean),
      };
    },
  };
};
