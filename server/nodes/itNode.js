const createResourceNode = require("./createResourceNode");

createResourceNode({
  nodeId: "it-node",
  deptCode: "it",
  deptName: "Information Technology",
  port: 5002,
  resources: [
    { id: "it-r1", name: "IT Lab 1", capacity: 30 },
    { id: "it-r2", name: "Server Room (Practical)", capacity: 10 },
    { id: "it-r3", name: "Conference Room", capacity: 20 },
  ],
});
