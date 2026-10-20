// shared/config.js
// Facts that BOTH the gateway and the department nodes need to agree on.

const DEPT_ORDER = ["comp", "it", "mech", "elec", "civil", "entc", "central"];

const DEPT_NAMES = {
  comp: "Computer Engineering",
  it: "Information Technology",
  mech: "Mechanical Engineering",
  elec: "Electrical Engineering",
  civil: "Civil Engineering",
  entc: "Electronics & Telecommunication",
  central: "Central Library",
};

// Used by the Bully election: higher number = stronger node.
const ELECTION_PRIORITY = {
  central: 7, entc: 6, civil: 5, elec: 4, mech: 3, it: 2, comp: 1,
};

// Where each department node lives. Locally these are localhost ports,
// in Docker/Kubernetes they are service names (set through env vars).
const NODE_REGISTRY = {
  comp: process.env.COMP_URL || "http://localhost:5001",
  it: process.env.IT_URL || "http://localhost:5002",
  mech: process.env.MECH_URL || "http://localhost:5003",
  elec: process.env.ELEC_URL || "http://localhost:5004",
  civil: process.env.CIVIL_URL || "http://localhost:5005",
  entc: process.env.ENTC_URL || "http://localhost:5006",
  central: process.env.CENTRAL_URL || "http://localhost:5007",
};

// Starting error (ms) of every node's physical clock - used by the clock
// synchronisation demo (Cristian / Berkeley) so the clocks visibly disagree.
const DEFAULT_SKEW_MS = {
  comp: 1800, it: -2400, mech: 950, elec: -700, civil: 3100, entc: -1500, central: 0,
};

module.exports = { DEPT_ORDER, DEPT_NAMES, ELECTION_PRIORITY, NODE_REGISTRY, DEFAULT_SKEW_MS };
