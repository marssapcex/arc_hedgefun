/**
 * bytecode.js — compiler-independent runtime bytecode fingerprint.
 *
 * The key idea: strip everything that changes between two compiles of the
 * SAME source (P immediates, addresses, amounts, CBOR/IPFS metadata hash),
 * then hash the remaining opcode stream. A fork/clone/redeploy of a known
 * vulnerable contract keeps a very similar opcode 5-gram set even though its
 * codeHash is different.
 */
'use strict';

const { keccak256 } = require('ethers');
const { minhash, lshBands, simhash } = require('./hashing');

const METADATA_MARKERS = [
  'a165627a7a72305820', // solc CBOR (swarm)
  'a264697066735822'    // solc CBOR (ipfs)
];
const EIP1967_IMPL_SLOT =
  '360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const INITIALIZE_SEL = '8129fc1c';

function stripMetadata(hex) {
  let h = hex.startsWith('0x') ? hex.slice(2) : hex;
  let cut = h.length;
  for (const m of METADATA_MARKERS) {
    const i = h.indexOf(m);
    if (i >= 0) cut = Math.min(cut, i);
  }
  return h.slice(0, cut);
}

function opcodeStream(hex) {
  const h = stripMetadata(hex);
  const out = [];
  for (let i = 0; i + 1 < h.length;) {
    const op = parseInt(h.slice(i, i + 2), 16);
    i += 2;
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;                 // PUSH1..PUSH32
      out.push(`PUSH${n}`);
      i += n * 2;                          // discard the immediate entirely
    } else {
      out.push(op.toString(16).padStart(2, '0'));
    }
  }
  return out;
}

/** 4-byte selectors: PUSH4 immediates in the dispatcher area. Heuristic. */
function extractSelectors(hex, windowBytes = 2048) {
  let h = hex.startsWith('0x') ? hex.slice(2) : hex;
  h = h.slice(0, windowBytes * 2);
  const out = new Set();
  for (let i = 0; i + 10 <= h.length; i += 2) {
    if (h.slice(i, i + 2) !== '63') continue;   // PUSH4
    const s = h.slice(i + 2, i + 10);
    if (s !== '00000000' && s !== 'ffffffff') out.add('0x' + s);
    i += 8;
  }
  return [...out].sort();
}

function ngrams(stream, k = 5) {
  const g = new Set();
  for (let i = 0; i + k <= stream.length; i++) {
    g.add(stream.slice(i, i + k).join(':'));
  }
  return g;
}

function flags(hex, stream, selectors) {
  const lower = (hex.startsWith('0x') ? hex.slice(2) : hex).toLowerCase();
  const firstCall = stream.indexOf('f1');
  const firstSstore = stream.indexOf('55');
  return {
    delegatecall: stream.includes('f4'),
    call: firstCall >= 0,
    staticcall: stream.includes('fa'),
    create2: stream.includes('f5'),
    selfdestruct: stream.includes('ff'),
    calldatacopy: stream.includes('37'),
    callvalue: stream.includes('34'),
    callBeforeSstore: firstCall >= 0 && firstSstore >= 0 && firstCall < firstSstore,
    eip1967ImplSlot: lower.includes(EIP1967_IMPL_SLOT),
    unprotectedInitialize: selectors.includes('0x' + INITIALIZE_SEL),
    proxyish: stream.includes('f4') && lower.includes(EIP1967_IMPL_SLOT),
  };
}

/**
 * @param {string} runtimeHex 0x-prefixed deployed runtime bytecode
 * @returns {{codeHash,codeBytes,opcodeCount,ngramCount,selectors,minhash,simhash,bands,flags}}
 */
function fingerprint(runtimeHex) {
  const hex = runtimeHex && runtimeHex.startsWith('0x') ? runtimeHex : '0x' + (runtimeHex || '');
  const stream = opcodeStream(hex);
  const g = ngrams(stream);
  const sig = minhash(g);
  const selectors = extractSelectors(hex);
  return {
    codeHash: keccak256(hex),
    codeBytes: Math.max(0, (hex.length - 2) / 2),
    opcodeCount: stream.length,
    ngramCount: g.size,
    selectors,
    minhash: sig,
    simhash: simhash(g),
    bands: lshBands(sig),
    flags: flags(hex, stream, selectors),
  };
}

module.exports = { stripMetadata, opcodeStream, extractSelectors, ngrams, flags, fingerprint };
