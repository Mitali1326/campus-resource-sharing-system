// features/locks.js  (Unit 3: Mutual exclusion - coordinator based)
//
// Whichever node is the elected leader acts as the LOCK MANAGER. Before the
// gateway books or cancels a slot, it must acquire that slot's lock from the
// leader. Waiters line up in a FIFO queue, so access is granted fairly in
// the order requests arrived. This is the "centralised algorithm" for
// distributed mutual exclusion.

module.exports = function locks() {
  const table = {}; // key -> { holder, queue: [] }

  return {
    lockAcquire: ({ key, owner }) => {
      const l = (table[key] = table[key] || { holder: null, queue: [] });
      if (l.holder === owner) return { granted: true };
      if (!l.holder && (l.queue.length === 0 || l.queue[0] === owner)) {
        l.holder = owner;
        l.queue = l.queue.filter((o) => o !== owner);
        return { granted: true };
      }
      if (!l.queue.includes(owner)) l.queue.push(owner);
      return { granted: false, holder: l.holder, position: l.queue.indexOf(owner) + 1 };
    },
    lockRelease: ({ key, owner }) => {
      const l = table[key];
      if (l && l.holder === owner) l.holder = null;
      return { released: true };
    },
    lockCancel: ({ key, owner }) => {
      const l = table[key];
      if (l) l.queue = l.queue.filter((o) => o !== owner);
      return { cancelled: true };
    },
    lockStatus: () => table,
  };
};
