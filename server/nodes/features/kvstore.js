// features/kvstore.js  (Unit 4 self-study: trade-offs in distributed databases)
//
// One replica of the "campus notice board" key-value store. The gateway
// writes each key to three replicas and decides how many must answer (W for
// writes, R for reads) - see the quorum section of the gateway.

module.exports = function kvstore(ctx) {
  const data = new Map(); // key -> { value, version, writer }

  return {
    kvPut: ({ key, value, version, writer }) => {
      const cur = data.get(key);
      if (!cur || version >= cur.version) data.set(key, { value, version, writer });
      return { deptCode: ctx.deptCode, version: data.get(key).version };
    },
    kvGet: ({ key }) => {
      const cur = data.get(key);
      return { deptCode: ctx.deptCode, found: Boolean(cur), ...(cur || {}) };
    },
  };
};
