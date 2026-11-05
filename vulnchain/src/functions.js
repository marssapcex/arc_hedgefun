/**
 * functions.js — the unit of comparison is now a FUNCTION, not a contract.
 *
 * Nobody redeploys a hacked contract byte-for-byte, so whole-bytecode Jaccard
 * is the wrong question. The thing that actually recurs across incidents is a
 * FUNCTION SHAPE: e.g. "take a user-supplied array, loop, forward msg.value,
 * pay out, never update the accounting" (Opyn 2020), or "compute a price from
 * live reserves and let anyone call it" (oracle incidents).
 *
 * This module extracts per-function records from two places:
 *   1. runtime bytecode — decompose the Solidity/Vyper dispatcher
 *      (PUSH4 sel; EQ; PUSH2 dest; JUMPI) into one opcode segment per function
 *   2. verified Solidity source — brace-matched function bodies
 *
 * Each function gets a semantic FEATURE VECTOR plus a body MinHash/SimHash.
 * Matching happens function-to-function; the contract is then LABELLED with
 * the incident categories of the functions it resembles.
 */
'use strict';

const { id } = require('ethers');
const { stripMetadata, opcodeStream, extractSelectors } = require('./bytecode');
const { canonicalParams, normalize } = require('./source');
const { minhash, lshBands, simhash, jaccardMinhash, hammingSimilarity } = require('./hashing');

const PERMS = 64;
const BANDS = 16;

/** Semantic features that actually distinguish one vulnerable function shape. */
const FEATURE_KEYS = [
  'externalCall', 'callWithValue', 'delegatecall', 'staticcall', 'callerControlledCalldata',
  'stateWrite', 'stateRead', 'balanceRead', 'selfBalance', 'originCheck', 'callerCheck',
  'usesMsgValue', 'loop', 'math', 'division', 'unchecked', 'timestamp', 'create',
  'selfdestruct', 'revert', 'transferFrom', 'approve', 'getReserves', 'oracleRead',
  'initializer', 'reentrancyGuard', 'slippageGuard', 'userArrayParam', 'payable',
  // guard/context features: a function only the owner (or the contract itself)
  // can call CANNOT be the entry point of a permissionless exploit.
  'ownerGuard', 'selfCallGuard', 'userBalanceAccounting',
];

function blank() { return Object.fromEntries(FEATURE_KEYS.map(k => [k, 0])); }

function featuresFromOpcodes(stream) {
  const f = blank();
  const has = op => stream.includes(op);
  f.externalCall = +['f1', 'f2', 'f4', 'fa'].some(has);
  f.callWithValue = +(has('34') && has('f1'));
  f.delegatecall = +has('f4');
  f.staticcall = +has('fa');
  f.callerControlledCalldata = +(['35', '36', '37'].some(has) && has('f4'));
  f.stateWrite = +has('55');
  f.stateRead = +has('54');
  f.balanceRead = +has('31');
  f.selfBalance = +has('47');
  f.originCheck = +has('32');
  f.callerCheck = +has('33');
  f.usesMsgValue = +has('34');
  f.loop = +(stream.filter(o => o === '5b').length > 2 && has('57'));
  f.math = +['01', '02', '03', '04', '05', '06', '07', '08', '0a', '0b'].some(has);
  f.division = +['04', '05'].some(has);
  f.timestamp = +has('42');
  f.create = +['f0', 'f5'].some(has);
  f.selfdestruct = +has('ff');
  f.revert = +has('fd');
  // CALLER; PUSH20 <hardcoded owner>; EQ  -> immutable owner check
  // CALLER; ADDRESS; EQ                   -> self-call only
  for (let i = 0; i + 4 < stream.length; i++) {
    if (stream[i] === '33' && stream[i + 1] === 'PUSH20' && stream.slice(i + 2, i + 6).includes('14')) f.ownerGuard = 1;
    if (stream[i] === '33' && stream[i + 1] === '30' && stream.slice(i + 2, i + 5).includes('14')) f.selfCallGuard = 1;
  }
  if (has('20') && has('54') && has('55') && has('33')) f.userBalanceAccounting = 1;
  return f;
}

function featuresFromSource(body) {
  const c = normalize(body);
  const t = s => +(new RegExp(s).test(c));
  const f = blank();
  f.externalCall = t('\\.call\\s*\\(|\\.transfer\\s*\\(|\\.send\\s*\\(|delegatecall|transferFrom|safeTransfer');
  f.callWithValue = t('\\.call\\s*\\{[^}]*value\\s*:|\\.call\\.value\\s*\\(');
  f.delegatecall = t('delegatecall');
  f.staticcall = t('staticcall');
  f.callerControlledCalldata = t('delegatecall') && t('msg\\.data|calldata|_data|data\\)');
  f.stateWrite = t('\\+=|-=|\\+\\+|--|\\b\\w+\\s*=|\\.push\\(|delete\\s');
  f.stateRead = t('balanceOf|\\.balance|reserves|storage|mapping|getReserves');
  f.balanceRead = t('balanceOf\\s*\\(|address\\(this\\)\\.balance|\\.balance\\b');
  f.selfBalance = t('address\\(this\\)\\.balance');
  f.originCheck = t('tx\\.origin');
  f.callerCheck = t('msg\\.sender|onlyOwner|require\\s*\\(');
  f.usesMsgValue = t('msg\\.value');
  f.loop = t('\\bfor\\s*\\(|\\bwhile\\s*\\(');
  f.math = t('\\*|/|\\+|\\-');
  f.division = t('/|\\bdiv\\b');
  f.unchecked = t('unchecked\\s*\\{');
  f.timestamp = t('block\\.timestamp|block\\.number');
  f.create = t('new\\s+\\w+|create2|CREATE2');
  f.transferFrom = t('transferFrom\\s*\\(');
  f.approve = t('approve\\s*\\(');
  f.getReserves = t('getReserves|reserve0|reserve1');
  f.oracleRead = t('latestRoundData|getPrice|oracle\\.|consult\\(');
  f.initializer = t('initializer|initialize\\s*\\(');
  f.reentrancyGuard = t('nonReentrant|ReentrancyGuard');
  f.slippageGuard = t('amountOutMin|minAmountOut|deadline|slippage');
  f.userArrayParam = t('\\[\\]\\s*(memory|calldata)');
  f.payable = t('payable');
  f.ownerGuard = t('onlyOwner|Ownable|NotOwner|require\\s*\\(\\s*msg\\.sender\\s*==\\s*(owner|_owner|0x[0-9a-fA-F]{40})|msg\\.sender\\s*!=\\s*owner');
  f.selfCallGuard = t('msg\\.sender\\s*==\\s*(address\\(this\\)|this)|msg\\.sender\\s*-\\s*this|msg\\.sender\\s*!=\\s*this');
  f.userBalanceAccounting = t('balances?\\s*\\[\\s*msg\\.sender|_balances\\s*\\[|userBalance|deposits?\\s*\\[');
  return f;
}

function mergeFeatures(a, b) {
  const out = blank();
  for (const k of FEATURE_KEYS) out[k] = Math.max(a[k] || 0, b[k] || 0);
  return out;
}

function featureNorm(f) {
  return Math.sqrt(FEATURE_KEYS.reduce((s, k) => s + (f[k] || 0) ** 2, 0));
}

function featureCosine(a, b) {
  const na = featureNorm(a), nb = featureNorm(b);
  if (na < 1 || nb < 1) return 0;                 // too few signals -> no claim
  let dot = 0;
  for (const k of FEATURE_KEYS) dot += (a[k] || 0) * (b[k] || 0);
  return dot / (na * nb);
}

function activeFeatures(f) { return FEATURE_KEYS.filter(k => f[k] > 0); }

/** Evaluate a function body into the stored record shape. */
function makeRecord({ name, signature, selector, bodyText, stream, features, extra = {} }) {
  const grams = new Set();
  if (stream) {
    for (let i = 0; i + 4 <= stream.length; i++) grams.add(stream.slice(i, i + 4).join(':'));
  }
  if (bodyText) {
    const t = normalize(bodyText).match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+|[^\s\w]/g) || [];
    for (let i = 0; i + 3 <= t.length; i++) grams.add('s:' + t.slice(i, i + 3).join(' '));
  }
  const sig = minhash(grams, PERMS);
  return {
    name, signature, selector,
    features,
    activeFeatures: activeFeatures(features),
    gramCount: grams.size,
    minhash: sig,
    simhash: simhash(grams),
    bands: lshBands(sig, BANDS),
    bodyText: bodyText || null,
    ...extra,
  };
}

/**
 * Decompose runtime bytecode into dispatcher entries.
 * Solidity: DUP1 PUSH4 <sel> EQ PUSH2 <dest> JUMPI  =>  80 63???????? 14 61???? 57
 */
function splitBytecodeFunctions(runtimeHex) {
  const raw = stripMetadata(runtimeHex);
  let b;
  try { b = Buffer.from(raw, 'hex'); } catch (_) { return []; }
  const entries = [];
  for (let i = 0; i + 10 < b.length; i++) {
    if (b[i] !== 0x63) continue;
    const sel = '0x' + b.slice(i + 1, i + 5).toString('hex');
    if (sel === '0x00000000' || sel === '0xffffffff') continue;
    let dest = null;
    if (b[i + 5] === 0x14 && b[i + 6] === 0x61 && b[i + 9] === 0x57) {
      dest = b.readUInt16BE(i + 7);
    } else if (b[i + 5] === 0x14 && b[i + 6] === 0x60 && b[i + 8] === 0x57) {
      dest = b[i + 7];
    }
    if (dest === null || dest >= b.length || b[dest] !== 0x5b) continue;   // JUMPDEST
    entries.push({ selector: sel, dest });
    i += 9;
  }
  // de-duplicate by selector, sort by bytecode offset
  const seen = new Set();
  const uniq = entries.filter(e => !seen.has(e.selector) && seen.add(e.selector))
    .sort((a, b2) => a.dest - b2.dest);
  const out = [];
  for (let k = 0; k < uniq.length; k++) {
    const start = uniq[k].dest + 1;
    const end = k + 1 < uniq.length ? uniq[k + 1].dest : b.length;
    const segment = '0x' + b.slice(start, Math.max(start, end)).toString('hex');
    const stream = opcodeStream(segment);
    out.push(makeRecord({
      name: null, signature: null, selector: uniq[k].selector,
      stream, features: featuresFromOpcodes(stream),
      extra: { from: 'bytecode', bodyOpcodes: stream.length, dest: uniq[k].dest },
    }));
  }
  if (out.length) return out;
  // no recognisable dispatcher: one fallback record per PUSH4 selector
  const all = opcodeStream(runtimeHex);
  return extractSelectors(runtimeHex).map(sel => makeRecord({
    name: null, signature: null, selector: sel, stream: all,
    features: featuresFromOpcodes(all),
    extra: { from: 'bytecode-fallback', bodyOpcodes: all.length, dest: null },
  }));
}

/** Brace-matched function bodies from verified Solidity source. */
function extractSourceFunctions(text) {
  const clean = normalize(text);
  const out = [];
  const re = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(clean))) {
    const open = clean.indexOf('{', m.index + m[0].length);
    if (open < 0) continue;
    let depth = 0, close = -1;
    for (let i = open; i < clean.length; i++) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}' && --depth === 0) { close = i; break; }
    }
    const body = close > open ? clean.slice(open, close + 1) : '';
    const canon = canonicalParams(m[2]);
    if (canon === null || body.length < 12) continue;
    const signature = `${m[1]}(${canon})`;
    out.push(makeRecord({
      name: m[1], signature, selector: id(signature).slice(0, 10),
      bodyText: body, features: featuresFromSource(body),
      extra: { from: 'source', bodyChars: body.length },
    }));
    re.lastIndex = close > open ? close + 1 : m.index + m[0].length;
  }
  return out;
}

/** Similarity of ONE new function against ONE corpus function. */
/**
 * Selector equality is NOT evidence. `withdraw(address,uint256)` exists in
 * thousands of harmless owner-only bots and in Lendf.Me/Platypus incident
 * reports; matching that 4-byte value once produced exactly the false alarm
 * the user called out. Score now uses only shape + body.
 */
function functionSimilarity(a, b) {
  const featureCos = featureCosine(a.features, b.features);
  const bodyJ = jaccardMinhash(a.minhash, b.minhash);
  const bodyH = hammingSimilarity(a.simhash, b.simhash);
  const body = 0.65 * bodyJ + 0.35 * bodyH;
  const sel = a.selector && a.selector === b.selector ? 1 : 0;   // display only
  const score = 0.60 * featureCos + 0.40 * body;
  return { score, featureCos, body, sel };
}

module.exports = {
  FEATURE_KEYS, blank, featuresFromOpcodes, featuresFromSource, mergeFeatures,
  featureCosine, activeFeatures, makeRecord, splitBytecodeFunctions,
  extractSourceFunctions, functionSimilarity, PERMS, BANDS
};
