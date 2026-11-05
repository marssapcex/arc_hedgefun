/**
 * hashing.js — similarity primitives for the matching engine.
 *
 * Why these, not "count matching selectors":
 *   - MinHash estimates Jaccard over opcode/source n-grams without keeping
 *     the full sets, and is robust to metadata hashes, addresses and PUSH data
 *     being different between two compiles of the same vulnerable code.
 *   - LSH banding turns an O(821 x N) comparison into a candidate lookup.
 *   - SimHash gives a cheap 64-bit source fingerprint (Hamming distance).
 *
 * Pure JS, deterministic, no dependency.
 */
'use strict';

const M64 = (1n << 64n) - 1n;

function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const p = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * p) & M64;
  }
  return h;
}

// Deterministic permutation coefficients (a must be odd for a bijection)
function coeffs(perms, seed = 0x9e3779b97f4a7c15n) {
  const out = [];
  let x = seed;
  for (let i = 0; i < perms; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) & M64;
    const a = x | 1n;
    x = (x * 6364136223846793005n + 1442695040888963407n) & M64;
    out.push([a, x]);
  }
  return out;
}

const PERMS = 128;
const C = coeffs(PERMS);

function permute(h, a, b) {
  return (a * h + b) & M64;
}

/** 128 x 64-bit MinHash signature of a set of strings (stored as hex). */
function minhash(setLike, perms = PERMS) {
  const vals = [...setLike];
  if (!vals.length) return new Array(perms).fill(M64.toString(16).padStart(16, '0'));
  const hashes = vals.map(fnv1a64);
  const sig = [];
  for (let i = 0; i < perms; i++) {
    const [a, b] = C[i % C.length];
    let m = M64;
    for (const h of hashes) {
      const v = permute(h, a, b);
      if (v < m) m = v;
    }
    sig.push(m.toString(16).padStart(16, '0'));
  }
  return sig;
}

function jaccardMinhash(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}

/** LSH band keys: similar signatures land in the same bucket. */
function lshBands(sig, bands = 32) {
  const rows = Math.floor(sig.length / bands);
  const out = [];
  for (let b = 0; b < bands; b++) {
    out.push(`${b}:${sig.slice(b * rows, (b + 1) * rows).join('')}`);
  }
  return out;
}

/** 64-bit SimHash of a set of weighted strings. */
function simhash(setLike) {
  const v = new Array(64).fill(0);
  for (const s of setLike) {
    const h = fnv1a64(s);
    for (let i = 0; i < 64; i++) {
      v[i] += ((h >> BigInt(i)) & 1n) === 1n ? 1 : -1;
    }
  }
  let bits = 0n;
  for (let i = 0; i < 64; i++) if (v[i] > 0) bits |= (1n << BigInt(i));
  return bits.toString(16).padStart(16, '0');
}

function hammingSimilarity(a, b) {
  if (!a || !b) return 0;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let d = 0;
  while (x) { d += Number(x & 1n); x >>= 1n; }
  return (64 - d) / 64;
}

module.exports = {
  M64, fnv1a64, minhash, jaccardMinhash, lshBands, simhash,
  hammingSimilarity, PERMS
};
