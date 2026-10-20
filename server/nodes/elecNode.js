const createResourceNode = require("./createResourceNode");

createResourceNode({
  nodeId: "elec-node",
  deptCode: "elec",
  deptName: "Electrical Engineering",
  port: 5004,
  resources: [
    { id: "elec-r1", name: "Electrical Machines Lab", capacity: 25 },
    { id: "elec-r2", name: "Electrical Reference Library", capacity: 20 },
    { id: "elec-r3", name: "Control Systems Lab", capacity: 20 },
  ],
});
