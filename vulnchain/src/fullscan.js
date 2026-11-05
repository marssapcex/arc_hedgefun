/**
 * fullscan.js — scan the WHOLE chain history, not just the latest blocks.
 *
 * Ethereum has >26M blocks. No single process (and certainly no CI run) walks
 * that in one shot. This is a RESUMABLE, checkpointed range scanner:
 *   - splits [fromBlock, toBlock] into chunks (default 2000 blocks)
 *   - writes data/full_scan_state.json after every chunk (lastBlock)
 *   - appends only LABELLED contracts to data/full_scan_labels.jsonl
 *   - --resume continues from lastBlock+1 after a crash / rate limit
 *   - --full == --from-block 0 --to-block latest --resume
 *
 * Each chunk uses creation-only discovery (tx.to == null -> receipt ->
 * eth_getCode). Reading every historical block is inherently O(chain length);
 * there is no creation event to subscribe to. Use a private archive RPC via
 * --rpc for production throughput.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { runScan } = require('./pipeline');
const { LightScanner } = require('./lightScanner');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const STATE = path.join(DATA, 'full_scan_state.json');
const OUT = path.join(DATA, 'full_scan_labels.jsonl');

async function fullScan(opts = {}) {
  if (!opts.corpus) throw new Error('corpus required');
  const network = opts.network || 'ethereum';
  const chunk = opts.chunk || 2000;
  const maxChunks = opts.maxChunks ?? Infinity;
  const scanner = new LightScanner({ network, rpcUrls: opts.rpcUrls });
  await scanner.initialize();
  const head = await scanner.getBlockNumber();
  const to = opts.toBlock ?? head;
  let from = opts.fromBlock ?? 0;

  let state = { network, lastBlock: from - 1, chunksDone: 0,
    contractsScanned: 0, functionsExamined: 0, labelledTotal: 0 };
  if (opts.resume && fs.existsSync(STATE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(STATE, 'utf8'));
      if (prev.network === network && Number.isFinite(prev.lastBlock)) {
        state = prev;
        from = Math.max(from, prev.lastBlock + 1);
      }
    } catch (_) { /* corrupt checkpoint -> restart */ }
  }
  // Always make both artifacts exist, even when every chunk errors out
  // (public full nodes often prune 2015-era receipts). Downstream git add
  // must not fail on a missing pathspec.
  if (!opts.resume || !fs.existsSync(OUT)) fs.writeFileSync(OUT, '');
  fs.writeFileSync(STATE, JSON.stringify({ ...state, targetBlock: to, head,
    chunkSize: chunk, updatedAt: new Date().toISOString() }, null, 1));

  const errors = [];
  let chunks = 0;
  const started = Date.now();
  for (let lo = from; lo <= to && chunks < maxChunks; lo += chunk) {
    const hi = Math.min(lo + chunk - 1, to);
    let doc;
    try {
      doc = await runScan({
        corpus: opts.corpus, network, mode: 'creation',
        fromBlock: lo, toBlock: hi,
        maxContracts: opts.maxContracts || 200,
        sourcify: false, rpcUrls: opts.rpcUrls,
      });
    } catch (e) {
      errors.push({ range: [lo, hi], reason: String(e.message).slice(0, 160) });
      // do NOT advance lastBlock on a failed chunk, but persist the error list
      fs.writeFileSync(STATE, JSON.stringify({ ...state, targetBlock: to, head,
        chunkSize: chunk, lastError: errors[errors.length - 1],
        updatedAt: new Date().toISOString() }, null, 1));
      continue;
    }
    const labelled = doc.contracts.filter(c => c.labelled);
    if (labelled.length) {
      fs.appendFileSync(OUT, labelled.map(c => JSON.stringify({
        network, block: c.block, address: c.address,
        labels: c.labels, functionCount: c.functionCount,
        matched: c.matchedFunctions.slice(0, 3),
      })).join('\n') + '\n');
    }
    state = {
      network, lastBlock: hi,
      chunksDone: state.chunksDone + 1,
      contractsScanned: state.contractsScanned + doc.stats.contractsScanned,
      functionsExamined: state.functionsExamined + doc.stats.functionsExamined,
      labelledTotal: state.labelledTotal + doc.stats.labelledContracts,
      targetBlock: to, head, chunkSize: chunk,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
    chunks++;
    console.log(`chunk ${lo}–${hi}: ${doc.stats.contractsScanned} contracts, ` +
      `${doc.stats.labelledContracts} labelled, errors ${doc.stats.errors}`);
  }
  fs.writeFileSync(STATE, JSON.stringify({ ...state, targetBlock: to, head,
    chunkSize: chunk, errors: errors.length,
    updatedAt: new Date().toISOString() }, null, 1));
  return {
    meta: {
      generatedAt: new Date().toISOString(), network,
      fromBlock: from, toBlock: to, head, chunkSize: chunk,
      resume: !!opts.resume, durationMs: Date.now() - started,
      note: 'Checkpointed full-chain scan. Not a one-shot full history result.',
    },
    state, errors,
    statePath: STATE, labelsPath: OUT,
  };
}

module.exports = { fullScan, STATE, OUT };
