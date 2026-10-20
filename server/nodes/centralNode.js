const createResourceNode = require("./createResourceNode");

createResourceNode({
  nodeId: "central-node",
  deptCode: "central",
  deptName: "Central Library",
  port: 5007,
  resources: [
    { id: "central-r1", name: "Main Reading Hall", capacity: 100 },
    { id: "central-r2", name: "Group Study Room 1", capacity: 8 },
    { id: "central-r3", name: "Group Study Room 2", capacity: 8 },
  ],
});
