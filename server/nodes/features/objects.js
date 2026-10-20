// features/objects.js  (Unit 4: Distributed object-based systems)
//
// Every resource on this node is exposed as a REMOTE OBJECT with:
//   - a global reference   obj://<node-id>/<object-id>
//   - an interface (a fixed list of methods other machines may call)
// A caller only needs the reference and a method name. This is the idea behind
// Java RMI and CORBA; the gateway plays the role of the client-side proxy/stub.

const INTERFACE = ["describe", "availability", "utilization", "book", "cancel"];

module.exports = function objects(ctx) {
  function find(objectId) {
    const r = ctx.state.find((x) => x.id === objectId);
    if (!r) throw new Error(`Remote object ${objectId} does not exist on ${ctx.nodeId}`);
    return r;
  }

  return {
    listObjects: () =>
      ctx.state.map((r) => ({
        ref: `obj://${ctx.nodeId}/${r.id}`,
        objectId: r.id,
        name: r.name,
        interface: INTERFACE,
      })),

    invokeObject: ({ objectId, method, args }) => {
      const r = find(objectId);
      const a = args || {};
      const ref = `obj://${ctx.nodeId}/${objectId}`;
      let returnValue;
      switch (method) {
        case "describe":
          returnValue = { class: "CampusResource", id: r.id, name: r.name, capacity: r.capacity, hostedOn: ctx.nodeId };
          break;
        case "availability":
          returnValue = Object.fromEntries(Object.entries(r.slots).map(([id, s]) => [s.label, s.booked ? "booked" : "free"]));
          break;
        case "utilization": {
          const slots = Object.values(r.slots);
          returnValue = { bookedSlots: slots.filter((s) => s.booked).length, totalSlots: slots.length };
          break;
        }
        case "book":
          returnValue = ctx.procedures.bookResource({
            resourceId: objectId, slotId: a.slotId, studentName: a.studentName || "remote-caller", requesterDept: a.requesterDept,
          });
          returnValue = { booked: true, slot: returnValue.slotLabel };
          break;
        case "cancel":
          returnValue = ctx.procedures.cancelBooking({ resourceId: objectId, slotId: a.slotId });
          returnValue = { cancelled: true, slot: returnValue.slotLabel };
          break;
        default:
          throw new Error(`Method ${method} is not part of the CampusResource interface`);
      }
      return { ref, method, returnValue };
    },
  };
};
