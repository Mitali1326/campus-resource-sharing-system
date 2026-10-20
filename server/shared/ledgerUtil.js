// shared/ledgerUtil.js
// Tiny blockchain helpers used by the gateway (which mines blocks) and by
// every department node (which independently validates and stores them).

const crypto = require("crypto");

const DIFFICULTY = 3; // a valid hash must start with this many zeros

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function hashBlock(b) {
  return sha256(`${b.index}|${b.timestamp}|${JSON.stringify(b.tx)}|${b.prevHash}|${b.nonce}`);
}

function meetsDifficulty(hash) {
  return hash.startsWith("0".repeat(DIFFICULTY));
}

function genesisBlock() {
  const b = {
    index: 0,
    timestamp: 0, // fixed, so every node creates the identical genesis block
    tx: { type: "GENESIS", note: "Campus booking ledger" },
    prevHash: "0".repeat(64),
    nonce: 0,
    miner: "-",
  };
  b.hash = hashBlock(b);
  return b;
}

// Proof of work: keep changing the nonce until the hash starts with zeros.
function mineBlock(index, tx, prevHash, miner) {
  const timestamp = Date.now();
  let nonce = 0;
  for (;;) {
    const candidate = { index, timestamp, tx, prevHash, nonce, miner };
    const hash = hashBlock(candidate);
    if (meetsDifficulty(hash)) return { ...candidate, hash, attempts: nonce + 1 };
    nonce++;
  }
}

// Returns null if the block is fine, otherwise a short reason.
function checkBlock(block, prev) {
  if (hashBlock(block) !== block.hash) return "hash does not match contents (data was altered)";
  if (!prev) return block.index === 0 ? null : "first block is not genesis";
  if (block.index !== prev.index + 1) return "wrong block number";
  if (block.prevHash !== prev.hash) return "previous-hash link is broken";
  if (!meetsDifficulty(block.hash)) return "proof-of-work missing";
  return null;
}

function validateChain(chain) {
  for (let i = 0; i < chain.length; i++) {
    const problem = checkBlock(chain[i], i === 0 ? null : chain[i - 1]);
    if (problem) return { valid: false, brokenAt: i, reason: problem };
  }
  return { valid: true, brokenAt: null, reason: null };
}

module.exports = { DIFFICULTY, sha256, hashBlock, genesisBlock, mineBlock, checkBlock, validateChain };
