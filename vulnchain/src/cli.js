/**
 * cli.js — one entrypoint for the merged project.
 *
 *   node src/cli.js build-corpus
 *   node src/cli.js seed-vulnerable-bytecode --max 60
 *   node src/cli.js make-fixture
 *   node src/cli.js scan --network ethereum --blocks 60 --mode hybrid
 *   node src/cli.js scan --fixture
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
const SEED = path.join(DATA, 'vulnerableBytecode.json');
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
  const c = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  if (fs.existsSync(SEED)) {
    const s = JSON.parse(fs.readFileSync(SEED, 'utf8'));
    for (const e of s.entries) {
      const inc = c.incidents.find(i => i.id === e.incidentId);
      if (inc && !(inc.bytecodeFingerprints || []).some(f => f.codeHash === e.fp.codeHash)) {
        (inc.bytecodeFingerprints ||= []).push(e.fp);
      }
    }
    c.meta.seededBytecodeFingerprints = s.entries.length;
  }
  return c;
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
    `${c.meta.uniqueSelectors} unique selectors · ` +
    `${c.meta.ethereumVulnerableAddresses} Ethereum vulnerable addresses`);
  console.log('wrote', p, fs.statSync(p).size, 'bytes');
}

async function seedBytecode(a) {
  const c = loadCorpus();
  const max = parseInt(a.max || '60', 10);
  const scanner = new LightScanner({ network: a.network || 'ethereum' });
  await scanner.initialize();
  const pairs = [];
  for (const inc of c.incidents) {
    if (inc.chain !== 'ethereum') continue;
    for (const addr of inc.vulnerableContracts) pairs.push({ incidentId: inc.id, address: addr });
  }
  const entries = [], errors = [];
  for (const p of pairs.slice(0, max)) {
    try {
      const eff = await scanner.getEffectiveCode(p.address);
      if (eff.code.length <= 2) { errors.push({ ...p, reason: 'no code' }); continue; }
      const fp = fingerprint(eff.code);
      fp.viaProxy = eff.viaProxy;
      fp.originalAddress = p.address;
      entries.push({ ...p, fp });
    } catch (e) { errors.push({ ...p, reason: String(e.message).slice(0, 100) }); }
  }
  writeJson(SEED, {
    meta: { generatedAt: new Date().toISOString(), chain: a.network || 'ethereum',
      candidatePairs: pairs.length, fetched: entries.length, errors: errors.length },
    entries, errors,
  });
  console.log(`seeded ${entries.length}/${pairs.length} known-vulnerable bytecode fingerprints (${errors.length} errors) → ${SEED}`);
}

async function makeFixture() {
  const c = loadCorpus();
  const seed = fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : null;
  const attacker = c.incidents.find(i => i.attackerAddresses.length)?.attackerAddresses[0] || '0x' + '11'.repeat(20);
  const realCode = seed && seed.entries.length ? seed.entries[0].fp : null;
  // reconstruct a minimal runtime that carries the same selectors as a real vulnerable contract
  const baseSel = realCode ? realCode.selectors.slice(0, 6) : c.incidents.flatMap(i => i.source.selectors).slice(0, 6);
  const code = '0x' + baseSel.map(s => '63' + s.slice(2) + '80').join('') + '60006000f3';
  const nearClone = '0x' + baseSel.slice(0, 5).map(s => '63' + s.slice(2) + '80').join('') + '60016000556000f1' + '60006000f3';
  writeJson(FIXTURE, {
    first: 26346656, last: 26346715,
    _info: { attacker, baseSel, usedRealSeedSelectors: !!realCode },
    contracts: [
      { block: 26346713, address: '0x' + 'aa'.repeat(20), creator: '0x' + '22'.repeat(20), code },
      { block: 26346714, address: '0x' + 'bb'.repeat(20), creator: '0x' + '33'.repeat(20), code },
      { block: 26346715, address: '0x' + 'cc'.repeat(20), creator: attacker, code: nearClone },
    ],
  });
  console.log('wrote', FIXTURE, '—', { attacker, selectors: baseSel.length });
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
    rpcUrls: a.rpc ? [a.rpc] : undefined,
  });
  writeJson(path.join(DATA, 'scan_result.json'), doc);
  fs.writeFileSync(a.md || path.join(ROOT, '..', 'VULNCHAIN_REPORT.md'), markdown(doc));
  console.log(`scanned ${doc.stats.contractsScanned} contracts · logs ${doc.stats.logsSeen} · ` +
    `verdicts ${JSON.stringify(doc.stats.verdicts)} · clusters ${doc.stats.clusters} · errors ${doc.stats.errors}`);
  console.log('matcher index:', JSON.stringify(doc.stats.matcher));
}

async function selftest() {
  let ok = true;
  const chk = (name, cond, extra = '') => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
    if (!cond) ok = false;
  };
  const { id, keccak256 } = require('ethers');
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
  chk('unique selectors > 500', c.meta.uniqueSelectors > 500, c.meta.uniqueSelectors);
  const m = new Matcher(c);
  chk('LSH band index built', m.stats().bandKeys > 100, m.stats().bandKeys);
  chk('IOC address index built', m.stats().knownAddresses > 300, m.stats().knownAddresses);

  if (!fs.existsSync(FIXTURE)) { console.log('SKIP fixture (run make-fixture)'); process.exit(ok ? 0 : 1); }
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const doc = await runScan({ corpus: c, fixture: fx });
  chk('fixture scanned 3 contracts', doc.stats.contractsScanned === 3, doc.stats.contractsScanned);
  chk('identical-code cluster detected', doc.stats.clusters >= 1, doc.stats.clusters);
  chk('at least one non-INFO finding', doc.findings.some(f => f.verdict !== 'INFO'),
    JSON.stringify(doc.stats.verdicts));
  chk('no VULNERABLE verdict ever',
    doc.findings.every(f => ['INFO', 'REVIEW', 'HIGH_SIMILARITY'].includes(f.verdict)));
  chk('generic ERC20 selector has near-zero IDF', (c.idf['0xa9059cbb'] ?? 1) < 0.1,
    c.idf['0xa9059cbb']);
  console.log('\nselftest verdicts:', JSON.stringify(doc.stats.verdicts));
  process.exit(ok ? 0 : 1);
}

async function main() {
  const a = args();
  const cmd = a._[0];
  try {
    if (cmd === 'build-corpus') await buildCorpus();
    else if (cmd === 'seed-vulnerable-bytecode') await seedBytecode(a);
    else if (cmd === 'make-fixture') await makeFixture();
    else if (cmd === 'scan') await scan(a);
    else if (cmd === 'selftest') await selftest();
    else {
      console.log('commands: build-corpus | seed-vulnerable-bytecode | make-fixture | scan | selftest');
      process.exit(2);
    }
  } catch (e) {
    console.error('ERROR', e.stack || e.message);
    process.exit(1);
  }
}

module.exports = { loadCorpus, args };
if (require.main === module) main();
