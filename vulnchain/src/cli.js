/**
 * cli.js — one entrypoint for the merged project.
 *
 *   node src/cli.js build-corpus
 *   node src/cli.js make-fixture
 *   node src/cli.js scan --network ethereum --blocks 60 --mode hybrid
 *   node src/cli.js scan --fixture
 *   node src/cli.js full-scan --full --resume
 *   node src/cli.js full-scan --from-block 0 --to-block 400 --chunk 100 --max-chunks 4
 *   node src/cli.js selftest
 */
'use strict';

const fs = require('fs');
const path = require('path');
const corpusLib = require('./corpus');
const { runScan, markdown } = require('./pipeline');
const { Matcher } = require('./matcher');
const { fingerprint, extractSelectors } = require('./bytecode');
const { LightScanner } = require('./lightScanner');
const { minhash, jaccardMinhash, simhash, hammingSimilarity } = require('./hashing');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CORPUS = path.join(DATA, 'corpus.json');
const FIXTURE = path.join(DATA, 'fixture.json');

function args() {
  const out = { _: [] };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function loadCorpus() {
  if (!fs.existsSync(CORPUS)) throw new Error('run build-corpus first');
  return JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
}

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 1));
  return p;
}

async function buildCorpus() {
  const c = corpusLib.build();
  const p = corpusLib.write(c, CORPUS);
  console.log(`built ${c.meta.incidentCount} incidents · ${c.meta.withMetadataTable} metadata tables · ` +
    `${c.meta.reportsWithVulnerableSnippets} with vulnerable snippets · ` +
    `${c.meta.vulnerableFunctionCount} vulnerable functions from ` +
    `${c.meta.incidentsWithFunctions} incidents`);
  console.log('wrote', p, fs.statSync(p).size, 'bytes');
}

async function makeFixture() {
  const c = loadCorpus();
  const ref = c.vulnerableFunctions.find(f => f.bodyText && f.signature) || c.vulnerableFunctions[0];
  const params = ref.signature.slice(ref.name.length + 1, -1);
  const verifiedSource = `pragma solidity ^0.8.0; contract X { function ${ref.name}(${params}) public ${ref.bodyText} }`;
  // minimal Solidity dispatcher: PUSH4 sel; EQ; PUSH2 dest; JUMPI; JUMPDEST; STOP
  const sel = ref.selector.slice(2);
  const dispatcher = '0x60003560e01c80' + '63' + sel + '14610011575b';
  const code = dispatcher + '00';
  writeJson(FIXTURE, {
    first: 26346846, last: 26346885,
    _info: { referenceVulnerableFunction: ref.signature, incidentId: ref.incidentId,
      selector: ref.selector, labels: ref.labels },
    contracts: [
      { block: 26346883, address: '0x' + 'aa'.repeat(20), creator: '0x' + '22'.repeat(20),
        code, verifiedSource },
      { block: 26346884, address: '0x' + 'bb'.repeat(20), creator: '0x' + '33'.repeat(20),
        code: '0x60006000f3' },
      { block: 26346885, address: '0x' + 'cc'.repeat(20), creator: '0x' + '44'.repeat(20),
        code: '0x60006000fd' },
    ],
  });
  console.log('wrote', FIXTURE, '— reference', ref.signature, ref.incidentId);
}

async function scan(a) {
  const c = loadCorpus();
  const fixture = a.fixture ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;
  const doc = await runScan({
    corpus: c, fixture,
    network: a.network || 'ethereum',
    blocks: parseInt(a.blocks || '60', 10),
    mode: a.mode || 'hybrid',
    maxContracts: parseInt(a['max-contracts'] || '80', 10),
    sourcify: !!a.sourcify,
    fromBlock: a['from-block'] !== undefined ? parseInt(a['from-block'], 10) : undefined,
    toBlock: a['to-block'] !== undefined ? parseInt(a['to-block'], 10) : undefined,
    rpcUrls: a.rpc ? [a.rpc] : undefined,
  });
  const outPath = a.out || (a.fixture
    ? path.join(DATA, 'demo_result.json')
    : path.join(DATA, 'scan_result.json'));
  writeJson(outPath, doc);
  const mdPath = a.md || (a.fixture
    ? path.join(ROOT, '..', 'VULNCHAIN_DEMO_REPORT.md')
    : path.join(ROOT, '..', 'VULNCHAIN_REPORT.md'));
  fs.writeFileSync(mdPath, markdown(doc));
  console.log(`scanned ${doc.stats.contractsScanned} contracts · ${doc.stats.functionsExamined} functions · ` +
    `labelled ${doc.stats.labelledContracts} · logs ${doc.stats.logsSeen} · errors ${doc.stats.errors}`);
  console.log('labels by category:', JSON.stringify(doc.stats.labelsByCategory));
  console.log('labeler index:', JSON.stringify(doc.stats.labeler));
  console.log('report:', mdPath);
}


async function fullScanCmd(a) {
  const c = loadCorpus();
  const r = await require('./fullscan').fullScan({
    corpus: c,
    network: a.network || 'ethereum',
    fromBlock: a.full ? 0 : (a['from-block'] !== undefined ? parseInt(a['from-block'], 10) : 0),
    toBlock: a['to-block'] !== undefined ? parseInt(a['to-block'], 10) : undefined,
    chunk: parseInt(a.chunk || '2000', 10),
    maxChunks: a['max-chunks'] !== undefined ? parseInt(a['max-chunks'], 10) : Infinity,
    resume: !!a.resume || !!a.full,
    maxContracts: parseInt(a['max-contracts'] || '200', 10),
    rpcUrls: a.rpc ? [a.rpc] : undefined,
  });
  console.log(`full-scan: blocks ${r.meta.fromBlock}–${r.meta.toBlock} (head ${r.meta.head}), ` +
    `${r.state.chunksDone} chunks done, ${r.state.contractsScanned} contracts, ` +
    `${r.state.labelledTotal} labelled, ${r.errors.length} chunk errors`);
  console.log('checkpoint:', r.statePath, '| labels:', r.labelsPath);
}

async function selftest() {
  let ok = true;
  const chk = (name, cond, extra = '') => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
    if (!cond) ok = false;
  };
  const { id, keccak256 } = require('ethers');
  const { splitBytecodeFunctions, extractSourceFunctions } = require('./functions');
  chk('keccak selector transfer', id('transfer(address,uint256)').slice(0, 10) === '0xa9059cbb');
  chk('keccak selector approve', id('approve(address,uint256)').slice(0, 10) === '0x095ea7b3');
  chk('keccak empty vector', keccak256('0x').startsWith('0xc5d2460186f7233c92'));
  const set = a => new Set(a);
  const m1 = minhash(set(['a', 'b', 'c', 'd'])), m2 = minhash(set(['a', 'b', 'c', 'd']));
  chk('minhash identical sets = 1', jaccardMinhash(m1, m2) === 1);
  chk('minhash disjoint sets < 0.2', jaccardMinhash(m1, minhash(set(['x', 'y', 'z']))) < 0.2);
  chk('simhash identical = 1', hammingSimilarity(simhash(set(['a', 'b'])), simhash(set(['a', 'b']))) === 1);
  const code = '0x63a9059cbb8063095ea7b38060006000556000f1';
  const fp = fingerprint(code);
  chk('PUSH4 selectors', fp.selectors.includes('0xa9059cbb') && fp.selectors.includes('0x095ea7b3'),
    fp.selectors.join(','));
  chk('fingerprint deterministic', fp.codeHash === fingerprint(code).codeHash);
  chk('metadata stripping removes CBOR tail',
    fingerprint(code + 'a165627a7a72305820' + '00'.repeat(32) + '0029').codeBytes >
    fingerprint(code).codeBytes);

  if (!fs.existsSync(CORPUS)) { console.log('SKIP corpus checks (run build-corpus)'); process.exit(ok ? 0 : 1); }
  const c = loadCorpus();
  chk('821 incidents', c.meta.incidentCount === 821, c.meta.incidentCount);
  chk('vulnerable snippets extracted', c.meta.reportsWithVulnerableSnippets > 400,
    c.meta.reportsWithVulnerableSnippets);
  chk('vulnerable functions > 1000', c.meta.vulnerableFunctionCount > 1000,
    c.meta.vulnerableFunctionCount);
  const m = new (require('./matcher').FunctionLabeler)(c);
  chk('LSH band index built', m.stats().bandKeys > 100, m.stats().bandKeys);
  chk('no IOC / cluster / rules in stats',
    !('knownAddresses' in m.stats()) && !('seededBytecodeFingerprints' in m.stats()),
    JSON.stringify(m.stats()));

  if (!fs.existsSync(FIXTURE)) { console.log('SKIP fixture (run make-fixture)'); process.exit(ok ? 0 : 1); }
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const doc = await runScan({ corpus: c, fixture: fx });
  chk('fixture scanned 3 contracts', doc.stats.contractsScanned === 3, doc.stats.contractsScanned);
  chk('functions decomposed from dispatcher', doc.stats.functionsExamined >= 1,
    doc.stats.functionsExamined);
  chk('at least one contract labelled', doc.stats.labelledContracts >= 1,
    JSON.stringify(doc.stats.labelsByCategory));
  chk('labels are incident categories',
    doc.contracts.every(r => r.labels.every(l => typeof l.category === 'string' && l.confidence > 0)));
  chk('no verdict / IOC / cluster fields',
    doc.contracts.every(r => !('verdict' in r) && !('knownAddressHits' in r) && !('identicalBytecodeClusterSize' in r)));
  console.log('\nselftest labels:', JSON.stringify(doc.stats.labelsByCategory));
  process.exit(ok ? 0 : 1);
}

async function main() {
  const a = args();
  const cmd = a._[0];
  try {
    if (cmd === 'build-corpus') await buildCorpus();
    else if (cmd === 'make-fixture') await makeFixture();
    else if (cmd === 'scan') await scan(a);
    else if (cmd === 'full-scan') await fullScanCmd(a);
    else if (cmd === 'selftest') await selftest();
    else {
      console.log('commands: build-corpus | make-fixture | scan | full-scan | selftest');
      process.exit(2);
    }
  } catch (e) {
    console.error('ERROR', e.stack || e.message);
    process.exit(1);
  }
}

module.exports = { loadCorpus, args };
if (require.main === module) main();
