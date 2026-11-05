'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  minhash, jaccardMinhash, lshBands, simhash, hammingSimilarity,
  fnv1a64
} = require('../src/hashing');

const S = a => new Set(a);

test('fnv1a64 is deterministic and 64-bit', () => {
  assert.equal(fnv1a64('abc'), fnv1a64('abc'));
  assert.ok(fnv1a64('abc') < (1n << 64n));
});

test('MinHash: identical sets score 1, disjoint sets score near 0', () => {
  const a = minhash(S(['a', 'b', 'c', 'd', 'e']));
  assert.equal(jaccardMinhash(a, minhash(S(['a', 'b', 'c', 'd', 'e']))), 1);
  assert.ok(jaccardMinhash(a, minhash(S(['x', 'y', 'z']))) < 0.2);
  assert.equal(a.length, 128);
});

test('MinHash tolerates small edits (one n-gram changed)', () => {
  const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const edited = ['a', 'b', 'c', 'X', 'e', 'f', 'g', 'h'];
  const j = jaccardMinhash(minhash(S(base)), minhash(S(edited)));
  assert.ok(j > 0.5 && j < 1, `expected partial similarity, got ${j}`);
});

test('LSH bands share buckets for near-identical signatures', () => {
  const a = minhash(S(['a', 'b', 'c', 'd', 'e', 'f', 'g']));
  const b = minhash(S(['a', 'b', 'c', 'd', 'e', 'f', 'X']));
  const shared = lshBands(a).filter(x => lshBands(b).includes(x));
  assert.ok(shared.length > 0);
});

test('SimHash Hamming similarity', () => {
  assert.equal(hammingSimilarity(simhash(S(['x', 'y'])), simhash(S(['x', 'y']))), 1);
  assert.ok(hammingSimilarity(simhash(S(['x'])), simhash(S(['y']))) < 1);
});

