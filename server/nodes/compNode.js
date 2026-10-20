const createResourceNode = require("./createResourceNode");

createResourceNode({
  nodeId: "comp-node",
  deptCode: "comp",
  deptName: "Computer Engineering",
  port: 5001,
  resources: [
    { id: "comp-r1", name: "Computer Lab 1", capacity: 30 },
    { id: "comp-r2", name: "Computer Lab 2", capacity: 30 },
    { id: "comp-r3", name: "Department Seminar Hall", capacity: 80 },
  ],
});
