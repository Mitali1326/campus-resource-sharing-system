// features/ledger.js  (Unit 4 self-study: blockchain / distributed ledger)
//
// Every node keeps its OWN full copy of the booking ledger. A node never
// trusts a new block blindly - it recomputes the hash, checks the link to the
// previous block and checks the proof-of-work before appending it.

const { genesisBlock, checkBlock, validateChain } = require("../../shared/ledgerUtil");

module.exports = function ledger() {
  let chain = [genesisBlock()];

  return {
    ledgerTip: () => {
      const last = chain[chain.length - 1];
      return { index: last.index, hash: last.hash, length: chain.length };
    },
    ledgerAppend: ({ block }) => {
      const problem = checkBlock(block, chain[chain.length - 1]);
      if (problem) throw new Error(`Block rejected: ${problem}`);
      chain.push(block);
      return { accepted: true, length: chain.length };
    },
    ledgerGet: () => ({ chain, ...validateChain(chain) }),
    // Demo helper: silently edit an old record WITHOUT redoing the hashes,
    // exactly what a dishonest node would try.
    ledgerTamper: ({ index }) => {
      const i = Number(index);
      if (!chain[i] || i === 0) throw new Error("Pick a block number that exists (not the genesis block)");
      chain[i] = { ...chain[i], tx: { ...chain[i].tx, by: "FORGED-USER", note: "edited after the fact" } };
      return { tampered: i };
    },
    ledgerReplace: ({ chain: newChain }) => {
      const v = validateChain(newChain);
      if (!v.valid) throw new Error("Refusing to adopt an invalid chain");
      chain = newChain;
      return { length: chain.length };
    },
  };
};
