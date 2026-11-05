/**
 * source.js — normalize Solidity snippets from the incident reports and from
 * verified sources (Sourcify/Etherscan), then fingerprint them.
 *
 * Selectors come from real function declarations, computed with ethers.id()
 * (Keccak-256). Tokens/4-grams feed SimHash + MinHash so two differently
 * formatted copies of the same vulnerable pattern still match.
 */
'use strict';

const { id } = require('ethers');
const { minhash, simhash } = require('./hashing');

const QUALIFIERS = new Set(['memory', 'calldata', 'storage', 'payable', 'indexed',
  'public', 'external', 'internal', 'private', 'view', 'pure', 'virtual',
  'override', 'returns', 'constant', 'immutable']);
const ALIAS = { uint: 'uint256', int: 'int256', byte: 'bytes1', 'address payable': 'address' };
const TYPE_RE = /^(u?int\d*|bytes\d*|address|bool|string|bytes|tuple|function)(\[\d*\])*$/;

function normalize(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function canonicalParams(raw) {
  if (!raw || !raw.trim()) return '';
  const parts = [];
  let depth = 0, buf = '';
  for (const ch of raw) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; }
    else buf += ch;
  }
  parts.push(buf);
  const types = [];
  for (const p of parts) {
    const toks = p.trim().split(/\s+/).filter(t => t && !QUALIFIERS.has(t));
    if (!toks.length) return null;
    let t = toks[0];
    if (t === 'address' && toks[1] === 'payable') t = 'address';
    // canonicalize the base type but keep array suffixes: uint[] -> uint256[]
    const arr = t.match(/^(.*?)(\[\d*\])+$/);
    if (arr) t = (ALIAS[arr[1]] || arr[1]) + arr[2];
    else t = ALIAS[t] || t;
    if (!TYPE_RE.test(t)) return null;
    types.push(t);
  }
  return types.join(',');
}

function extractFunctions(text) {
  const clean = normalize(text);
  const out = [];
  const re = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(clean))) {
    const canon = canonicalParams(m[2]);
    if (canon === null) continue;
    const sig = `${m[1]}(${canon})`;
    out.push({ name: m[1], signature: sig, selector: id(sig).slice(0, 10) });
  }
  return out;
}

function tokens(text) {
  return normalize(text).match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+|[^\s\w]/g) || [];
}

function grams(text, k = 4) {
  const t = tokens(text);
  const g = new Set();
  for (let i = 0; i + k <= t.length; i++) g.add(t.slice(i, i + k).join(' '));
  return g;
}

function sourceFlags(text) {
  const c = normalize(text);
  return {
    externalCallWithValue: /\.call\s*\{[^}]*value\s*:|\.call\.value\s*\(/.test(c),
    onlyOwnerGuard: /onlyOwner|Ownable|require\s*\(\s*msg\.sender|msg\.sender\s*==\s*owner/.test(c),
    reentrancyGuard: /nonReentrant|ReentrancyGuard/.test(c),
    unprotectedInitialize: /function\s+initialize\s*\(/.test(c) && !/initializer/.test(c),
    spotPrice: /getReserves|balanceOf\s*\(|reserve0|reserve1/.test(c),
    arbitraryCall: /delegatecall|\.call\s*\(|functionCall\s*\(/.test(c),
    unlimitedApprove: /type\s*\(\s*uint256\s*\)\s*\.\s*max|uint256\s*\(\s*-1\s*\)|2\s*\*\*\s*256|MaxUint256/.test(c),
    msgValueInLoop: /msg\.value/.test(c) && /\bfor\s*\(/.test(c),
    selfTransfer: /from\s*==\s*to|to\s*==\s*from/.test(c),
    delegateCallUserInput: /delegatecall/.test(c) && /msg\.data|calldata|_data|data\)/.test(c),
  };
}

function fingerprintSource(text) {
  const g = grams(text);
  const fns = extractFunctions(text);
  return {
    tokenCount: tokens(text).length,
    gramCount: g.size,
    minhash: minhash(g),
    simhash: simhash(g),
    selectors: [...new Set(fns.map(f => f.selector))],
    signatures: [...new Set(fns.map(f => f.signature))],
    functionNames: [...new Set(fns.map(f => f.name))],
    flags: sourceFlags(text),
  };
}

module.exports = {
  normalize, canonicalParams, extractFunctions, tokens, grams,
  sourceFlags, fingerprintSource
};
