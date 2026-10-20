const createResourceNode = require("./createResourceNode");

createResourceNode({
  nodeId: "mech-node",
  deptCode: "mech",
  deptName: "Mechanical Engineering",
  port: 5003,
  resources: [
    { id: "mech-r1", name: "Mechanical Workshop", capacity: 25 },
    { id: "mech-r2", name: "3D Printing Lab", capacity: 15 },
    { id: "mech-r3", name: "CAD/CAM Lab", capacity: 30 },
  ],
});
