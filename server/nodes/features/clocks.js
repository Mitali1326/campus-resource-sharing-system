// features/clocks.js  (Unit 3: Clock synchronization + Logical clocks)
//
// Two different kinds of "time" live inside every node:
//
//  1. PHYSICAL clock  - Date.now() plus a deliberate error ("skew"), so each
//     container's clock is a little wrong, like real computers. Cristian's and
//     Berkeley's algorithms (run by the gateway) read and correct this value.
//
//  2. VECTOR clock    - one counter per department. It does NOT measure time;
//     it records cause and effect ("did event A influence event B?").

const { DEPT_ORDER, DEFAULT_SKEW_MS } = require("../../shared/config");

module.exports = function clocks(ctx) {
  let offsetMs = DEFAULT_SKEW_MS[ctx.deptCode] || 0;
  const vc = {};
  DEPT_ORDER.forEach((d) => (vc[d] = 0));

  ctx.nodeNow = () => Date.now() + offsetMs;
  ctx.vcCopy = () => ({ ...vc });
  ctx.vcTick = () => {
    vc[ctx.deptCode] += 1;
    return ctx.vcCopy();
  };
  // Receive rule of vector clocks: take the element-wise maximum, then tick.
  ctx.vcMerge = (other) => {
    if (other) {
      for (const d of DEPT_ORDER) vc[d] = Math.max(vc[d], other[d] || 0);
    }
    return ctx.vcTick();
  };

  return {
    getTime: () => ({ deptCode: ctx.deptCode, nodeTime: ctx.nodeNow(), offsetMs }),
    adjustClock: ({ deltaMs }) => {
      offsetMs += Number(deltaMs) || 0;
      return { deptCode: ctx.deptCode, offsetMs };
    },
    setClockOffset: ({ offsetMs: v }) => {
      offsetMs = Number(v) || 0;
      return { deptCode: ctx.deptCode, offsetMs };
    },
    getVector: () => ({ deptCode: ctx.deptCode, vector: ctx.vcCopy() }),
    vcLocalEvent: () => ({ deptCode: ctx.deptCode, vector: ctx.vcTick() }),
  };
};
