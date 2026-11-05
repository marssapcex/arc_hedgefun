/**
 * pipeline.js — single-chain end-to-end scan.
 *
 * Uses the ORIGINAL BugChainIndexer modules:
 *   LogFetcher.fetchLogs(scanner, ...)         adaptive eth_getLogs
 *   EOAFilter.filterAddresses(scanner, ...)   EOA/contract classification
 *   ContractVerifier.verify(scanner, ...)     only when an explorer key exists
 * plus literal creation-tx discovery, bytecode fingerprinting and Matcher.
 *
 * Read-only. No tx, no fork, no PoC.
 */
'use strict';

const { fetchLogs } = require('../scanners/common/LogFetcher');
const { filterAddresses } = require('../scanners/common/EOAFilter');
const { verify } = require('../scanners/common/ContractVerifier');
const { LightScanner } = require('./lightScanner');
const { Matcher } = require('./matcher');
const { fingerprint } = require('./bytecode');

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

async function fetchWindow(scanner, lo, hi) {
  try {
    const r = await fetchLogs(scanner, lo, hi, [[TRANSFER, APPROVAL]]);
    return r.logs || [];
  } catch (_) {
    // some public endpoints reject nested topic OR; fall back to two calls
    const out = [];
    for (const t of [TRANSFER, APPROVAL]) {
      try { out.push(...((await fetchLogs(scanner, lo, hi, [t])).logs || [])); }
      catch (_) { /* skip this chunk */ }
    }
    return out;
  }
}

function addressesFromLogs(logs) {
  const out = new Set();
  for (const lg of logs) {
    for (const t of (lg.topics || []).slice(1, 3)) {
      if (t && t.length >= 42) out.add('0x' + t.slice(-40).toLowerCase());
    }
  }
  return [...out];
}

async function sourcifySource(chainId, address) {
  for (const kind of ['full_match', 'partial_match']) {
    try {
      const url = `https://repo.sourcify.dev/contracts/${kind}/${chainId}/${address}/metadata.json`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const meta = await r.json();
      return Object.values(meta.sources || {}).map(s => s.content || '').join('\n\n');
    } catch (_) { /* not verified */ }
  }
  return null;
}

async function runScan(opts = {}) {
  const corpus = opts.corpus;
  if (!corpus) throw new Error('corpus required');
  const matcher = new Matcher(corpus);
  const network = opts.network || 'ethereum';
  const blocks = opts.blocks || 20;
  const maxContracts = opts.maxContracts || 80;
  const mode = opts.mode || 'hybrid';
  let contracts = [], logsSeen = 0, errors = [], head = null, from = null, to = null;
  let scanner = null;

  if (opts.fixture) {
    contracts = opts.fixture.contracts.map(c => ({ ...c }));
    from = opts.fixture.first; to = opts.fixture.last;
    head = to;
  } else {
    scanner = new LightScanner({ network, rpcUrls: opts.rpcUrls });
    await scanner.initialize();
    head = await scanner.getBlockNumber();
    to = opts.toBlock || head;
    from = opts.fromBlock || Math.max(0, to - blocks + 1);
    const found = new Map();

    if (mode === 'events' || mode === 'hybrid') {
      for (let lo = from; lo <= to; lo += 50) {
        const hi = Math.min(lo + 49, to);
        const logs = await fetchWindow(scanner, lo, hi);
        logsSeen += logs.length;
        const addrs = addressesFromLogs(logs).slice(0, 400);
        if (!addrs.length) continue;
        try {
          const res = await filterAddresses(scanner, addrs);
          for (const c of res.contracts) {
            if (!found.has(c.address.toLowerCase())) {
              found.set(c.address.toLowerCase(), {
                address: c.address.toLowerCase(), creator: null,
                block: hi, code: null, codeHashFromIndexer: c.codeHash,
              });
            }
          }
        } catch (e) { errors.push({ range: [lo, hi], reason: String(e.message).slice(0, 120) }); }
      }
    }
    if (mode === 'creation' || mode === 'hybrid') {
      try {
        for (const c of await scanner.creationContracts(from, to)) {
          if (!found.has(c.address)) found.set(c.address, c);
          else Object.assign(found.get(c.address), { creator: c.creator, block: c.block, code: c.code });
        }
      } catch (e) { errors.push({ reason: 'creation scan: ' + String(e.message).slice(0, 120) }); }
    }
    for (const c of [...found.values()].slice(0, maxContracts)) {
      try {
        c.code = c.code || await scanner.getCode(c.address);
        if (c.code.length <= 2) { errors.push({ address: c.address, reason: 'no runtime code' }); continue; }
        if (opts.sourcify) c.verifiedSource = await sourcifySource(scanner.config.chainId || 1, c.address);
        contracts.push(c);
      } catch (e) { errors.push({ address: c.address, reason: String(e.message).slice(0, 120) }); }
    }
    if (process.env.DEFAULT_ETHERSCAN_KEYS && contracts.length) {
      try { await verify(scanner, contracts.slice(0, 10).map(c => ({ address: c.address }))); }
      catch (_) { /* explorer optional */ }
    }
  }

  // identical-bytecode clusters (the 66-child pattern)
  const byHash = new Map();
  for (const c of contracts) {
    const fp = fingerprint(c.code);
    c._fp = fp;
    if (!byHash.has(fp.codeHash)) byHash.set(fp.codeHash, []);
    byHash.get(fp.codeHash).push(c.address);
  }
  const clusters = [...byHash.entries()].filter(([, a]) => a.length > 1)
    .map(([h, a]) => ({ codeHash: h, count: a.length, addresses: a }))
    .sort((a, b) => b.count - a.count);
  const clusterSize = Object.fromEntries(clusters.flatMap(c => c.addresses.map(a => [a, c.count])));

  const findings = contracts.map(c => matcher.match({
    address: c.address, creator: c.creator, block: c.block,
    code: c.code, verifiedSource: c.verifiedSource,
    clusterSize: clusterSize[c.address] || 1,
  })).sort((a, b) => b.score - a.score);

  const verdicts = {};
  for (const f of findings) verdicts[f.verdict] = (verdicts[f.verdict] || 0) + 1;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      network, mode, fromBlock: from, toBlock: to, head,
      rpc: opts.fixture ? 'fixture' : scanner.rpcUrls[0],
      incidentCount: corpus.meta.incidentCount,
      note: 'Ranked similarity to known incidents. Not a vulnerability proof.',
    },
    stats: {
      contractsScanned: contracts.length, logsSeen, verdicts,
      clusters: clusters.length, errors: errors.length,
      matcher: matcher.stats(),
      sourcifyHits: contracts.filter(c => c.verifiedSource).length,
    },
    clusters, errors, findings,
  };
}

function markdown(doc) {
  const s = doc.stats;
  const L = [
    '# VulnChain — live triage report', '',
    `Generated ${doc.meta.generatedAt} · chain \`${doc.meta.network}\` · mode \`${doc.meta.mode}\` · blocks ${doc.meta.fromBlock}–${doc.meta.toBlock}`, '',
    '**Đây là xếp hạng độ giống với 821 sự cố đã biết, không phải kết luận có lỗ hổng.**', '',
    '| Metric | Value |', '|---|---|',
  ];
  for (const [k, v] of Object.entries({
    incidentCount: doc.meta.incidentCount,
    contractsScanned: s.contractsScanned, logsSeen: s.logsSeen,
    verdicts: JSON.stringify(s.verdicts), clusters: s.clusters,
    sourcifyHits: s.sourcifyHits, errors: s.errors,
    bandKeys: s.matcher.bandKeys, selectorKeys: s.matcher.selectorKeys,
    knownAddresses: s.matcher.knownAddresses,
    seededBytecodeFingerprints: s.matcher.seededBytecodeFingerprints,
  })) L.push(`| ${k} | \`${v}\` |`);
  L.push('', '## Top findings', '',
    '| Verdict | Score | Address | Creator | Similar incident | Bytecode sim | Selector sim | Rules |',
    '|---|---|---|---|---|---|---|---|');
  for (const f of doc.findings.slice(0, 30)) {
    const t = f.similarIncidents[0];
    L.push(`| ${f.verdict} | ${f.score} | \`${f.address}\` | \`${f.creator || '—'}\` | ` +
      `${t ? t.id.slice(0, 44) : '—'} | ${t ? t.bytecodeSim.toFixed(2) : '—'} | ` +
      `${t ? t.selectorSim.toFixed(2) : '—'} | ${f.rules.map(r => r.category).join(', ') || '—'} |`);
  }
  if (!doc.findings.length) L.push('', '_No contracts in range._');
  L.push('', '## Evidence (top 5)', '');
  for (const f of doc.findings.slice(0, 5)) {
    L.push(`### \`${f.address}\` — ${f.verdict} (${f.score})`, '');
    for (const e of f.evidence) L.push(`- ${e}`);
    for (const t of f.similarIncidents.slice(0, 3)) {
      L.push(`- → \`${t.id}\` (${t.protocol}, ${t.date}) score ${t.score.toFixed(3)}: ` +
        `bc=${t.bytecodeSim.toFixed(2)} sel=${t.selectorSim.toFixed(2)} src=${t.sourceSim.toFixed(2)}`);
    }
    L.push('');
  }
  L.push('---', '', `_${doc.meta.note}_`, '',
    'Artifacts: `vulnchain/data/corpus.json`, `vulnchain/data/vulnerableBytecode.json`, `vulnchain/data/scan_result.json`.');
  return L.join('\n') + '\n';
}

module.exports = { runScan, markdown, fetchWindow, addressesFromLogs, sourcifySource };
