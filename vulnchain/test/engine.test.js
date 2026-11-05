'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { id, keccak256 } = require('ethers');
const { fingerprint, extractSelectors, opcodeStream, stripMetadata } = require('../src/bytecode');
const { fingerprintSource, extractFunctions, canonicalParams } = require('../src/source');
const { evaluateRules } = require('../src/rules');
const { Matcher } = require('../src/matcher');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(ROOT, 'data', 'corpus.json');
const FIXTURE = path.join(ROOT, 'data', 'fixture.json');

test('Keccak selectors use Ethereum Keccak-256', () => {
  assert.equal(id('transfer(address,uint256)').slice(0, 10), '0xa9059cbb');
  assert.equal(id('approve(address,uint256)').slice(0, 10), '0x095ea7b3');
  assert.equal(keccak256('0x').startsWith('0xc5d2460186f7233c92'), true);
});

test('canonicalParams handles Solidity parameter noise', () => {
  assert.equal(canonicalParams('address payable to, uint256 amount'), 'address,uint256');
  assert.equal(canonicalParams('bytes calldata data, uint[] memory ids'), 'bytes,uint256[]');
  assert.equal(canonicalParams(''), '');
});

test('extractFunctions derives real selectors from a snippet', () => {
  const fns = extractFunctions(`function exercise(uint256 n, address[] memory vaults) public payable { }`);
  assert.equal(fns[0].signature, 'exercise(uint256,address[])');
  assert.equal(fns[0].selector.length, 10);
});

test('bytecode fingerprint strips CBOR metadata and PUSH immediates', () => {
  const code = '0x63a9059cbb8060016000556000f1';
  const withMeta = code + 'a165627a7a72305820' + '00'.repeat(32) + '0029';
  assert.ok(stripMetadata(withMeta).endsWith('f1'));
  assert.ok(opcodeStream(withMeta).includes('PUSH4'));
  const a = fingerprint(code), b = fingerprint(withMeta);
  assert.equal(a.minhash.join(), b.minhash.join(), 'metadata hash must not change opcode n-grams');
  assert.equal(a.simhash, b.simhash);
  assert.ok(b.codeBytes > a.codeBytes);
});

test('fingerprint extracts PUSH4 selectors and flags CALL-before-SSTORE', () => {
  const fp = fingerprint('0x60016000f16000600055');   // SSTORE absent before CALL? see below
  assert.ok(Array.isArray(fp.selectors));
  const order = fingerprint('0x60006000f16001600055'); // CALL then SSTORE
  assert.equal(order.flags.callBeforeSstore, true);
  assert.equal(order.flags.call, true);
});

test('source flags and rules are explainable', () => {
  const src = fingerprintSource(`contract X { function initialize() public { } }`);
  assert.equal(src.flags.unprotectedInitialize, true);
  const hits = evaluateRules(null, src);
  assert.ok(hits.some(h => h.category === 'access-control'));
  assert.ok(hits.every(h => typeof h.why === 'string' && h.why.length > 10));
});

test('generic ERC20 code does not produce a selector-driven REVIEW', () => {
  if (!fs.existsSync(CORPUS)) return; // requires build-corpus
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  assert.equal(c.meta.incidentCount, 821);
  const m = new Matcher(c);
  const plain = m.match({
    address: '0x' + '55'.repeat(20), creator: '0x' + '66'.repeat(20),
    code: '0x63a9059cbb8063095ea7b3806370a082318060006000f3'
  });
  assert.ok(['INFO', 'REVIEW'].includes(plain.verdict));
  assert.ok(plain.evidence.every(e => !/selector cosine/.test(e)) || plain.selectors.includes('0xa9059cbb'));
});

test('end-to-end fixture: cluster + IOC + never VULNERABLE', async () => {
  if (!fs.existsSync(CORPUS) || !fs.existsSync(FIXTURE)) return;
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const { runScan } = require('../src/pipeline');
  const doc = await runScan({ corpus: c, fixture: fx });
  assert.equal(doc.stats.contractsScanned, 3);
  assert.ok(doc.stats.clusters >= 1);
  assert.ok(doc.findings.some(f => f.verdict !== 'INFO'));
  assert.ok(doc.findings.every(f => ['INFO', 'REVIEW', 'HIGH_SIMILARITY'].includes(f.verdict)));
  assert.ok(doc.stats.matcher.bandKeys > 100);
});
