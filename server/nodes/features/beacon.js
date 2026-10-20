// features/beacon.js  (Unit 3: beacon protocol / failure detection)
//
// Every node PUSHES a small "I am alive" message (a beacon) to the gateway
// every 3 seconds. The gateway notices when beacons stop arriving. This is
// the opposite of the gateway polling the nodes (a pull), and it is how many
// real systems detect crashed machines.

module.exports = function startBeacon(ctx) {
  const url = (process.env.GATEWAY_URL || "http://localhost:5000") + "/api/beacon";
  let seq = 0;
  async function beat() {
    seq += 1;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deptCode: ctx.deptCode,
          nodeId: ctx.nodeId,
          seq,
          nodeTime: ctx.nodeNow(),
          vector: ctx.vcCopy(),
          bookedSlots: ctx.countBooked(),
          storedBlocks: ctx.countBlocks(),
        }),
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      // Gateway not reachable right now - just try again at the next beat.
    }
  }
  setTimeout(beat, 1500); // first beacon shortly after start-up
  setInterval(beat, 3000);
};
