const createResourceNode = require("./createResourceNode");

createResourceNode({
  nodeId: "entc-node",
  deptCode: "entc",
  deptName: "Electronics & Telecommunication",
  port: 5006,
  resources: [
    { id: "entc-r1", name: "Communication Lab", capacity: 25 },
    { id: "entc-r2", name: "Electronics Lab", capacity: 25 },
    { id: "entc-r3", name: "Project Lab", capacity: 15 },
  ],
});
