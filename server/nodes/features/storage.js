// features/storage.js  (Unit 4: Distributed file system + MapReduce)
//
// This node acts as an HDFS "DataNode": it stores blocks of files that the
// gateway (the "NameNode") hands to it. It can also run the MAP and REDUCE
// steps of a word-count job directly on the blocks it already holds, so the
// computation moves to the data instead of the data moving to the computation.

function hashWord(word, reducers) {
  let h = 0;
  for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  return h % reducers;
}

module.exports = function storage(ctx) {
  const blocks = new Map(); // blockId -> text
  ctx.countBlocks = () => blocks.size;

  return {
    storeBlock: ({ blockId, data }) => {
      blocks.set(blockId, String(data));
      return { stored: blockId, bytes: Buffer.byteLength(String(data)) };
    },
    getBlock: ({ blockId }) => {
      if (!blocks.has(blockId)) throw new Error(`Block ${blockId} not found on ${ctx.nodeId}`);
      return { blockId, data: blocks.get(blockId) };
    },
    deleteBlock: ({ blockId }) => ({ deleted: blocks.delete(blockId) }),
    listBlocks: () => ({
      deptCode: ctx.deptCode,
      blocks: [...blocks.entries()].map(([blockId, data]) => ({ blockId, bytes: Buffer.byteLength(data) })),
    }),

    // MAP: read one block, emit (word, 1) pairs, locally combine them, and split
    // the result into one partition per reducer (hash of the word picks the partition).
    mapWordCount: ({ blockId, reducers }) => {
      if (!blocks.has(blockId)) throw new Error(`Block ${blockId} not found on ${ctx.nodeId}`);
      const R = Math.max(1, Number(reducers) || 1);
      const partitions = Array.from({ length: R }, () => ({}));
      const words = blocks.get(blockId).toLowerCase().match(/[a-z0-9']+/g) || [];
      for (const w of words) {
        const p = hashWord(w, R);
        partitions[p][w] = (partitions[p][w] || 0) + 1;
      }
      return { mapper: ctx.deptCode, blockId, wordsSeen: words.length, partitions };
    },

    // REDUCE: add up the partial counts that the shuffle phase sent to this node.
    reduceMerge: ({ partials }) => {
      const total = {};
      for (const part of partials || []) {
        for (const [w, c] of Object.entries(part)) total[w] = (total[w] || 0) + c;
      }
      return { reducer: ctx.deptCode, distinctWords: Object.keys(total).length, counts: total };
    },
  };
};
