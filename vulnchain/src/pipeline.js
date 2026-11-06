/**
 * pipeline.js — single-chain function-level LABELLING pipeline.
 *
 * Still uses the ORIGINAL BugChainIndexer modules for discovery:
 *   LogFetcher.fetchLogs(scanner, ...)        adaptive eth_getLogs
 *   EOAFilter.filterAddresses(scanner, ...)  EOA vs contract classification
 * plus literal creation-tx discovery and Sourcify source lookup.
 *
 * No IOC matching, no identical-code clusters, no static opcode rules,
 * no seeded bytecode of already-hacked contracts. Output is LABELS.
 */
'use strict';

const { fetchLogs } = require('../scanners/common/LogFetcher');
const { filterAddresses } = require('../scanners/common/EOAFilter');
const { LightScanner } = require('./lightScanner');
const { resolveChain, redactRpc } = require('./chainConfig');
const { verify } = require('../scanners/common/ContractVerifier');
const { createValueFilter } = require('./valueFilter');

/** Etherscan returns either a flat .sol file or a {{"path":{"content":...}}} bundle. */
function flattenSource(sc) {
  if (typeof sc !== 'string') return '';
  const t = sc.trim();
  if (t.startsWith('{{') && t.endsWith('}}')) {
    try {
      const o = JSON.parse(t.slice(1, -1));
      const src = o.sources || o;
      return Object.entries(src).map(([k, v]) => `// ${k}\n${(v && v.content) || ''}`).join('\n\n');
    } catch (_) { return t; }
  }
  return t;
}
const { FunctionLabeler } = require('./matcher');

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

async function fetchWindow(scanner, lo, hi) {
  try {
    return (await fetchLogs(scanner, lo, hi, [[TRANSFER, APPROVAL]])).logs || [];
  } catch (_) {
    const out = [];
    for (const t of [TRANSFER, APPROVAL]) {
      try { out.push(...((await fetchLogs(scanner, lo, hi, [t])).logs || [])); }
      catch (_) { /* chunk unavailable on public RPC */ }
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
  const labeler = new FunctionLabeler(corpus);
  const network = opts.network || 'ethereum';
  const blocks = opts.blocks || 20;
  const maxContracts = opts.maxContracts || 80;
  const mode = opts.mode || 'hybrid';
  const minUsd = opts.fixture ? 0 : (opts.minUsd ?? 10000);
  const maxCandidates = opts.maxCandidates || 400;
  let contracts = [], logsSeen = 0, errors = [], head = null, from = null, to = null;
  let scanner = null;
  const chain = opts.fixture ? null : (opts.chain || resolveChain(network, opts));
  let etherscanHits = 0, skippedBelowMinUsd = 0, pricedContracts = 0;
  let priceSource = 'n/a';

  if (opts.fixture) {
    contracts = opts.fixture.contracts.map(c => ({ ...c }));
    from = opts.fixture.first; to = opts.fixture.last; head = to;
  } else {
    scanner = new LightScanner({ network: chain.network, chain });
    await scanner.initialize();
    head = await scanner.getBlockNumber();
    to = opts.toBlock ?? head;
    from = opts.fromBlock ?? Math.max(0, to - blocks + 1);
    const found = new Map();

    if (mode === 'creation' || mode === 'hybrid') {
      try {
        for (const c of await scanner.creationContracts(from, to)) {
          if (!found.has(c.address)) found.set(c.address, c);
          else Object.assign(found.get(c.address), { creator: c.creator, block: c.block, code: c.code });
        }
      } catch (e) { errors.push({ reason: 'creation scan: ' + String(e.message).slice(0, 120) }); }
    }
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
            const a = c.address.toLowerCase();
            if (!found.has(a)) found.set(a, { address: a, creator: null, block: hi, code: null });
          }
        } catch (e) { errors.push({ range: [lo, hi], reason: String(e.message).slice(0, 120) }); }
      }
    }
    const value = createValueFilter(scanner, chain.chainId, opts);
    for (const c of [...found.values()].slice(0, maxCandidates)) {
      if (contracts.length >= maxContracts) break;
      try {
        if (!c.code) {
          const eff = await scanner.getEffectiveCode(c.address);  // resolve EIP-1167 proxy -> implementation
          c.code = eff.code;
          c.viaProxy = eff.viaProxy;
        }
        if (c.code.length <= 2) { errors.push({ address: c.address, reason: 'no runtime code' }); continue; }
        // only contracts holding real on-chain value are worth labelling
        if (minUsd > 0) {
          const v = await value.estimate(c.address);
          priceSource = v.priceSource;
          c.valueUsd = v.usd;
          c.priceSource = v.priceSource;
          if (v.usd < minUsd) { skippedBelowMinUsd++; continue; }
          pricedContracts++;
        }
        if (opts.sourcify) c.verifiedSource = await sourcifySource(chain.chainId, c.address);
        contracts.push(c);
      } catch (e) { errors.push({ address: c.address, reason: String(e.message).slice(0, 120) }); }
    }
  }

  // Etherscan V2: user-supplied key -> real ContractVerifier source lookup.
  // Skipped entirely when no key is configured (the zero-key default still works).
  if (chain && chain.hasEtherscan && contracts.length) {
    try {
      const batch = contracts.slice(0, opts.maxVerify || 25).map(c => ({ address: c.address }));
      const results = await verify(scanner, batch);
      for (const r of results || []) {
        if (!r.verified || !r.sourceCode) continue;
        const c = contracts.find(x => String(x.address).toLowerCase() === String(r.address).toLowerCase());
        if (!c || c.verifiedSource) continue;
        c.verifiedSource = flattenSource(r.sourceCode);
        etherscanHits++;
      }
    } catch (e) { errors.push({ reason: 'etherscan: ' + String(e.message).slice(0, 120) }); }
  }

  const labelled = contracts.map(c => labeler.labelContract({
    address: c.address, creator: c.creator, block: c.block,
    code: c.code, verifiedSource: c.verifiedSource, viaProxy: c.viaProxy,
  }));
  const byCategory = Object.create(null);
  for (const r of labelled) for (const l of r.labels) {
    byCategory[l.category] = (byCategory[l.category] || 0) + 1;
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      network, mode, fromBlock: from, toBlock: to, head,
      rpc: opts.fixture ? 'fixture' : redactRpc(chain.rpcUrls[0]),
      chainId: chain ? chain.chainId : 1,
      rpcSource: chain ? chain.rpcSource : 'fixture',
      explorerKeyConfigured: !!(chain && chain.hasEtherscan),
      minUsd, priceSource,
      incidentCount: corpus.meta.incidentCount,
      vulnerableFunctionCount: corpus.meta.vulnerableFunctionCount,
      note: 'Function-shape similarity labels. Not a vulnerability proof.',
    },
    stats: {
      contractsScanned: contracts.length,
      functionsExamined: labelled.reduce((s, r) => s + r.functionCount, 0),
      labelledContracts: labelled.filter(r => r.labelled).length,
      labelsByCategory: byCategory,
      logsSeen, sourcifyHits: contracts.filter(c => c.verifiedSource).length - etherscanHits,
      etherscanHits, skippedBelowMinUsd, pricedContracts, priceSource,
      minUsd, errors: errors.length,
      labeler: labeler.stats(),
    },
    contracts: labelled.sort((a, b) =>
      (b.labels[0]?.confidence || 0) - (a.labels[0]?.confidence || 0)),
    errors,
  };
}

function markdown(doc) {
  const s = doc.stats;
  const L = [
    '# VulnChain — function-level labels', '',
    `Generated ${doc.meta.generatedAt} · chain \`${doc.meta.network}\` · mode \`${doc.meta.mode}\` · blocks ${doc.meta.fromBlock}–${doc.meta.toBlock}`, '',
    '**Nhãn = hàm của contract này giống hàm lỗi trong 821 vụ đã biết. Không phải kết luận có lỗ hổng.**', '',
    '| Metric | Value |', '|---|---|',
  ];
  for (const [k, v] of Object.entries({
    chainId: doc.meta.chainId, rpcSource: doc.meta.rpcSource, minUsd: doc.meta.minUsd,
    priceSource: doc.meta.priceSource, skippedBelowMinUsd: s.skippedBelowMinUsd,
    pricedContracts: s.pricedContracts,
    explorerKeyConfigured: doc.meta.explorerKeyConfigured,
    incidentCount: doc.meta.incidentCount,
    vulnerableFunctionCount: doc.meta.vulnerableFunctionCount,
    contractsScanned: s.contractsScanned, functionsExamined: s.functionsExamined,
    labelledContracts: s.labelledContracts,
    labelsByCategory: JSON.stringify(s.labelsByCategory),
    logsSeen: s.logsSeen, sourcifyHits: s.sourcifyHits, etherscanHits: s.etherscanHits,
    errors: s.errors,
    bandKeys: s.labeler.bandKeys, selectorKeys: s.labeler.selectorKeys,
  })) L.push(`| ${k} | \`${v}\` |`);

  L.push('', '## Labelled contracts', '',
    '| Address | Functions | Labels | Top confidence | Creator |',
    '|---|---|---|---|---|');
  for (const c of doc.contracts.filter(x => x.labelled).slice(0, 40)) {
    L.push(`| \`${c.address}\` | ${c.functionCount} | ` +
      `${c.labels.map(l => `${l.category}(${l.confidence})`).join(', ')} | ` +
      `${c.labels[0]?.confidence ?? '—'} | \`${c.creator || '—'}\` |`);
  }
  if (!doc.contracts.some(c => c.labelled)) L.push('', '_Không contract nào trong range có hàm vượt ngưỡng tương đồng._');

  L.push('', '## Evidence (top 10 matched functions)', '');
  let n = 0;
  for (const c of doc.contracts) {
    for (const m of c.matchedFunctions) {
      if (n++ >= 10) break;
      L.push(`- \`${c.address}\` · \`${m.selector}\` **${m.name || m.matchedVulnerableFunction}** ` +
        `→ \`${m.incidentId}\` (${m.incidentProtocol || '—'}) · ` +
        `score ${m.score} (feature ${m.featureCos}, body ${m.body}, selector ${m.selectorEqual ? '=' : '≠'}) · ` +
        `labels ${m.categories.join(', ')}`);
      L.push(`  - features: ${m.activeFeatures.join(', ')}`);
      if (m.rootCause) L.push(`  - root cause: ${m.rootCause.slice(0, 150)}`);
    }
    if (n >= 10) break;
  }
  L.push('', '---', '', `_${doc.meta.note}_`, '',
    'Artifacts: `vulnchain/data/corpus.json`, `vulnchain/data/scan_result.json`.');
  return L.join('\n') + '\n';
}

module.exports = { runScan, markdown, fetchWindow, addressesFromLogs, sourcifySource };
