'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { id, keccak256 } = require('ethers');
const { extractSelectors, stripMetadata, detectMinimalProxy } = require('../src/bytecode');
const { canonicalParams, extractFunctions } = require('../src/source');
const {
  splitBytecodeFunctions, extractSourceFunctions, featuresFromSource,
  featuresFromOpcodes, featureCosine, functionSimilarity, FEATURE_KEYS
} = require('../src/functions');
const { FunctionLabeler } = require('../src/matcher');
const { runScan } = require('../src/pipeline');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(ROOT, 'data', 'corpus.json');
const FIXTURE = path.join(ROOT, 'data', 'fixture.json');

test('Keccak selectors use Ethereum Keccak-256', () => {
  assert.equal(id('transfer(address,uint256)').slice(0, 10), '0xa9059cbb');
  assert.equal(id('approve(address,uint256)').slice(0, 10), '0x095ea7b3');
  assert.ok(keccak256('0x').startsWith('0xc5d2460186f7233c92'));
});

test('canonicalParams handles Solidity noise and array suffixes', () => {
  assert.equal(canonicalParams('address payable to, uint256 amount'), 'address,uint256');
  assert.equal(canonicalParams('bytes calldata data, uint[] memory ids'), 'bytes,uint256[]');
});

test('source function extraction gives one record per function with features', () => {
  const src = `contract X {
    function drain(uint256 amount, address[] memory paths) public {
      for (uint i=0;i<paths.length;i++) { (bool ok,) = paths[i].call{value: msg.value}(""); }
      balances[msg.sender] -= amount;
    }
    function viewOnly() external view returns (uint) { return 1; }
  }`;
  const fns = extractSourceFunctions(src);
  assert.equal(fns.length, 2);
  const d = fns.find(f => f.name === 'drain');
  assert.equal(d.selector.length, 10);
  assert.equal(d.features.loop, 1);
  assert.equal(d.features.callWithValue, 1);
  assert.equal(d.features.usesMsgValue, 1);
  assert.ok(d.activeFeatures.length >= 4);
  assert.ok(d.bodyText.includes('call'));
});

test('dispatcher decomposition splits bytecode into per-function segments', () => {
  const sel = 'a9059cbb';
  const code = '0x60003560e01c80' + '63' + sel + '14610011575b' + '33' + '34' + '600055' + '6000f1' + '00';
  const fns = splitBytecodeFunctions(code);
  assert.equal(fns.length, 1);
  assert.equal(fns[0].selector, '0x' + sel);
  assert.equal(fns[0].from, 'bytecode');
  assert.equal(fns[0].features.callerCheck, 1);
  assert.equal(fns[0].features.stateWrite, 1);
});

test('metadata stripping and EIP-1167 detection', () => {
  const code = '0x60006000f1';
  assert.ok(stripMetadata(code + 'a165627a7a72305820' + '00'.repeat(32) + '0029').endsWith('f1'));
  const proxy = '0x363d3d373d3d3d363d73' + 'aa'.repeat(20) + '5af43d82803e903d91602b57fd5bf3';
  assert.equal(detectMinimalProxy(proxy), '0x' + 'aa'.repeat(20));
});

test('semantic feature cosine: identical shapes 1, unrelated shapes low', () => {
  const a = featuresFromSource('function a(){ require(msg.sender==owner); x.balance; msg.value; balances[msg.sender]-=1; }');
  const b = featuresFromSource('function b(){ require(owner==msg.sender); address(this).balance; msg.value; balances[msg.sender]+=1; }');
  const c = featuresFromSource('function c(){ return 7; }');
  assert.ok(featureCosine(a, b) > 0.7, String(featureCosine(a, b)));
  assert.ok(featureCosine(a, c) < 0.4, String(featureCosine(a, c)));
  assert.equal(FEATURE_KEYS.length, 32);
});

test('functionSimilarity of a record with itself is high', () => {
  const fns = extractSourceFunctions('function f(address[] memory p) public { for(uint i=0;i<p.length;i++){ p[i].call{value:msg.value}(""); } x = x - 1; }');
  const sim = functionSimilarity(fns[0], fns[0]);
  assert.ok(sim.score > 0.9, JSON.stringify(sim));
  assert.equal(sim.sel, 1);
});

test('corpus is function-level: no IOC / rules / cluster fields', () => {
  if (!fs.existsSync(CORPUS)) return;
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  assert.equal(c.meta.incidentCount, 821);
  assert.ok(c.meta.vulnerableFunctionCount > 1000);
  assert.ok(!('categoryRules' in c));
  assert.ok(!('idf' in c));
  assert.ok(!('bytecodeFingerprints' in c.incidents[0]));
  const f = c.vulnerableFunctions[0];
  assert.ok(f.labels.length >= 1 && f.incidentId && f.features && f.minhash.length === 64);
  const l = new FunctionLabeler(c);
  const st = l.stats();
  assert.ok(!('knownAddresses' in st) && !('seededBytecodeFingerprints' in st));
  assert.ok(st.bandKeys > 100);
});

test('end-to-end fixture produces LABELS, not verdicts', async () => {
  if (!fs.existsSync(CORPUS) || !fs.existsSync(FIXTURE)) return;
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const doc = await runScan({ corpus: c, fixture: fx });
  assert.equal(doc.stats.contractsScanned, 3);
  assert.ok(doc.stats.labelledContracts >= 1, JSON.stringify(doc.stats));
  assert.ok(!('verdicts' in doc.stats) && !('clusters' in doc.stats));
  assert.ok(doc.contracts.every(r => !('verdict' in r) && !('knownAddressHits' in r)));
  const labelled = doc.contracts.find(r => r.labelled);
  assert.ok(labelled.labels[0].category.length > 2);
  assert.ok(labelled.matchedFunctions[0].incidentId);
});

test('a trivial contract gets no label (no blanket labelling)', () => {
  if (!fs.existsSync(CORPUS)) return;
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const l = new FunctionLabeler(c);
  const r = l.labelContract({ address: '0x' + '55'.repeat(20), code: '0x60006000f3' });
  assert.equal(r.labelled, false);
});

test('REGRESSION: onlyOwner withdraw(address,uint256) is NOT labelled reentrancy', () => {
  if (!fs.existsSync(CORPUS)) return;
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const l = new FunctionLabeler(c);
  // the exact case: 0xf3fef3a3 collides with Lendf.Me / Platypus incident reports
  const src = `contract SearcherBot {
    address immutable owner = 0x12182b03cf82e0f5339711c56fe9abdb3aa5dd4;
    error NotOwner(); error TransferFailed();
    function withdraw(address _token, uint256 _amount) public {
      require(msg.sender == owner, NotOwner());
      (bool ok,) = _token.call{value: _amount}("");
      require(ok, TransferFailed());
    }
    function withdrawToken(address _t, address _a, uint256 _n) public {
      require(msg.sender == owner, NotOwner());
      _t.call(abi.encodeWithSignature("transfer(address,uint256)", _a, _n));
    }
  }`;
  // dispatcher: PUSH4 f3fef3a3 -> JUMPDEST; body = CALLER PUSH20<owner> EQ ... CALL
  const code = '0x60003560e01c80' + '63f3fef3a3' + '14610011575b' +
    '33' + '73' + '12'.repeat(20) + '14' + '6000' + '57' + '34' + '6000f1' + '00';
  const r = l.labelContract({ address: '0x' + 'e5'.repeat(20), code, verifiedSource: src });
  assert.equal(r.labelled, false, JSON.stringify(r.labels));
  assert.ok(r.vetoes.some(v => /owner guard|self-call/.test(v.reason)), JSON.stringify(r.vetoes));
  assert.ok(r.matchedFunctions.length === 0);
});

test('REGRESSION: selector equality alone never produces a label', () => {
  if (!fs.existsSync(CORPUS)) return;
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const l = new FunctionLabeler(c);
  const { functionSimilarity } = require('../src/functions');
  const a = extractSourceFunctions('function withdraw(address a, uint256 n) public { balances[msg.sender] -= n; a.call{value:n}(""); }')[0];
  const b = extractSourceFunctions('function withdraw(address a, uint256 n) public { uint256 x = n + 1; require(x > 0, "zero"); }')[0];
  const sim = functionSimilarity(a, b);
  assert.equal(sim.sel, 1);
  assert.ok(sim.body < 0.30, String(sim.body));
  const { MIN_BODY } = require('../src/matcher');
  assert.ok(sim.body < MIN_BODY, JSON.stringify(sim));
  assert.ok(sim.score < 0.60, JSON.stringify(sim));
  const r = l.labelContract({ address: '0x' + '66'.repeat(20),
    code: '0x60003560e01c80' + '63f3fef3a3' + '14610011575b' + '00' });
  assert.equal(r.labelled, false);
});
