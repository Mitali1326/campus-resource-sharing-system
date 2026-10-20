const createResourceNode = require("./createResourceNode");

createResourceNode({
  nodeId: "civil-node",
  deptCode: "civil",
  deptName: "Civil Engineering",
  port: 5005,
  resources: [
    { id: "civil-r1", name: "Surveying Lab", capacity: 25 },
    { id: "civil-r2", name: "Concrete Testing Lab", capacity: 15 },
    { id: "civil-r3", name: "Structural Drawing Hall", capacity: 40 },
  ],
});
