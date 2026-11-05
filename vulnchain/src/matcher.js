/**
 * matcher.js — FUNCTION-LEVEL LABELLER (rewritten).
 *
 * Removed, because nobody redeploys hacked code byte-for-byte:
 *   - whole-contract bytecode Jaccard / seeded vulnerable bytecode
 *   - IOC address matching + identical-code clusters (22%)
 *   - static opcode rules like CALL-before-SSTORE (10%)
 *   - contract-level REVIEW/INFO verdicts
 *
 * What remains, per user request: for every FUNCTION of a newly deployed
 * contract, find the most similar VULNERABLE FUNCTION among the 821 incident
 * reports, then LABEL the contract with that function's incident categories.
 *
 * Similarity for one function pair:
 *   0.60  semantic feature cosine  (caller check / msg.value / state write /
 *                                  spot-price read / loop over user array ...)
 *   0.40  body n-gram similarity   (MinHash Jaccard + SimHash Hamming)
 *    0    selector equality         DISPLAY ONLY, never scored.
 *
 * WHY: `withdraw(address,uint256)` (0xf3fef3a3) appears both in Lendf.Me /
 * Platypus incident reports and in thousands of harmless onlyOwner searcher
 * bots. Scoring that 4-byte collision produced a false "reentrancy" label.
 * A selector is now only used to RETRIEVE candidates, never as evidence.
 *
 * HARD VETO: a function guarded by an immutable owner / self-call check
 * cannot be the entry point of a permissionless exploit, so it is dropped
 * before any comparison. Generic signatures additionally require strong
 * body evidence.
 */
'use strict';

const {
  splitBytecodeFunctions, extractSourceFunctions, functionSimilarity,
  mergeFeatures, activeFeatures, FEATURE_KEYS
} = require('./functions');
const { detectMinimalProxy } = require('./bytecode');

const MIN_SCORE = 0.58;
const MIN_FEATURE_COS = 0.70;
const MIN_ACTIVE_FEATURES = 4;
const MIN_BODY = 0.30;             // mandatory; selector can no longer substitute
const GENERIC_SIGNATURES = new Set([
  'withdraw(address,uint256)', 'withdraw(uint256)', 'withdraw()',
  'transfer(address,uint256)', 'transferFrom(address,address,uint256)',
  'approve(address,uint256)', 'deposit()', 'deposit(uint256)',
  'swap(address,address,uint256)', 'balanceOf(address)', 'owner()',
  'withdrawToken(address,address,uint256)', 'unwrapEth(uint256)', 'wrapEth(uint256)',
]);

class FunctionLabeler {
  constructor(corpus) {
    this.corpus = corpus;
    this.fns = corpus.vulnerableFunctions || [];
    this.byBand = new Map();
    this.bySelector = new Map();
    this.categoryHistogram = Object.create(null);
    for (let i = 0; i < this.fns.length; i++) {
      const f = this.fns[i];
      for (const b of f.bands || []) {
        if (!this.byBand.has(b)) this.byBand.set(b, new Set());
        this.byBand.get(b).add(i);
      }
      if (f.selector) {
        if (!this.bySelector.has(f.selector)) this.bySelector.set(f.selector, new Set());
        this.bySelector.get(f.selector).add(i);
      }
      for (const c of f.labels || []) this.categoryHistogram[c] = (this.categoryHistogram[c] || 0) + 1;
    }
  }

  stats() {
    return {
      vulnerableFunctions: this.fns.length,
      incidents: this.corpus.meta.incidentsWithFunctions,
      bandKeys: this.byBand.size,
      selectorKeys: this.bySelector.size,
      categories: Object.keys(this.categoryHistogram).length,
      featureKeys: FEATURE_KEYS.length,
    };
  }

  _candidates(fn) {
    const out = new Set();
    for (const b of fn.bands || []) for (const i of (this.byBand.get(b) || [])) out.add(i);
    for (const i of (this.bySelector.get(fn.selector) || [])) out.add(i);
    return out;
  }

  _functionsOf(contract) {
    const code = contract.code || '0x';
    const bytecodeFns = splitBytecodeFunctions(code);
    const sourceFns = contract.verifiedSource ? extractSourceFunctions(contract.verifiedSource) : [];
    // merge by selector: source gives the name + richer features, bytecode gives the body
    const bySel = new Map();
    for (const f of bytecodeFns) bySel.set(f.selector, { ...f });
    for (const s of sourceFns) {
      if (bySel.has(s.selector)) {
        const b = bySel.get(s.selector);
        b.name = s.name; b.signature = s.signature;
        b.features = mergeFeatures(b.features, s.features);
        b.activeFeatures = activeFeatures(b.features);
        // verified source carries the real body -> prefer its fingerprint
        if (s.gramCount > b.gramCount) {
          b.minhash = s.minhash; b.simhash = s.simhash;
          b.bands = s.bands; b.gramCount = s.gramCount;
        }
        b.bodyText = s.bodyText || b.bodyText;
        b.sourceBody = true;
      } else {
        bySel.set(s.selector, { ...s, sourceOnly: true });
      }
    }
    return [...bySel.values()];
  }

  /**
   * @returns {{address, labelled:boolean, labels:Array, matchedFunctions:Array,
   *            functionCount:number, proxyImplementation:string|null}}
   */
  labelContract(contract) {
    const fns = this._functionsOf(contract);
    const matched = [], vetoes = [];
    for (const fn of fns) {
      // (1) HARD VETO: owner-only / self-call-only functions are not
      //     permissionless exploit entry points, whatever their selector.
      if (fn.features.ownerGuard || fn.features.selfCallGuard) {
        vetoes.push({ selector: fn.selector,
          reason: fn.features.ownerGuard ? 'immutable owner guard' : 'self-call-only guard' });
        continue;
      }
      if ((fn.activeFeatures || []).length < MIN_ACTIVE_FEATURES) continue;
      const genericSignature = GENERIC_SIGNATURES.has(fn.signature || '');
      let best = null;
      for (const i of this._candidates(fn)) {
        const ref = this.fns[i];
        if ((ref.activeFeatures || []).length < MIN_ACTIVE_FEATURES) continue;
        // (2) a corpus function that requires user-balance accounting cannot
        //     be matched by a function with no such accounting
        if (ref.features.userBalanceAccounting && !fn.features.userBalanceAccounting) continue;
        const sim = functionSimilarity(fn, ref);
        if (sim.featureCos < MIN_FEATURE_COS) continue;
        // (3) body evidence is MANDATORY; a matching 4-byte selector buys nothing
        if (sim.body < MIN_BODY) continue;
        if (genericSignature && (sim.body < 0.45 || sim.featureCos < 0.85)) continue;
        if (sim.score < MIN_SCORE) continue;
        if (!best || sim.score > best.sim.score) best = { sim, ref };
      }
      if (!best) continue;
      matched.push({
        selector: fn.selector,
        name: fn.name || null,
        signature: fn.signature || null,
        sourceBody: !!fn.sourceBody,
        score: Number(best.sim.score.toFixed(4)),
        featureCos: Number(best.sim.featureCos.toFixed(3)),
        body: Number(best.sim.body.toFixed(3)),
        selectorEqual: best.sim.sel === 1,   // display only, not scored
        genericSignature,
        activeFeatures: fn.activeFeatures,
        matchedVulnerableFunction: best.ref.signature || best.ref.name || best.ref.selector,
        incidentId: best.ref.incidentId,
        incidentProtocol: best.ref.incidentProtocol,
        rootCause: best.ref.rootCause,
        categories: best.ref.labels,
      });
    }
    matched.sort((a, b) => b.score - a.score);

    // aggregate into contract labels, one per incident category
    const byCat = new Map();
    for (const m of matched) {
      for (const c of m.categories) {
        if (!byCat.has(c)) byCat.set(c, {
          category: c, confidence: 0, functionCount: 0,
          incidents: new Set(), examples: [],
        });
        const e = byCat.get(c);
        e.confidence = Math.max(e.confidence, m.score);
        e.functionCount++;
        e.incidents.add(m.incidentId);
        if (e.examples.length < 3) e.examples.push({
          selector: m.selector, name: m.name, score: m.score,
          incidentId: m.incidentId, matchedVulnerableFunction: m.matchedVulnerableFunction,
        });
      }
    }
    const labels = [...byCat.values()]
      .map(e => ({ category: e.category, confidence: Number(e.confidence.toFixed(4)),
        functionCount: e.functionCount, incidents: [...e.incidents].slice(0, 5),
        examples: e.examples }))
      .sort((a, b) => b.confidence - a.confidence);

    return {
      address: contract.address,
      creator: contract.creator || null,
      block: contract.block || null,
      labelled: labels.length > 0,
      labels,
      matchedFunctions: matched,
      functionCount: fns.length,
      vetoes,
      proxyImplementation: contract.viaProxy || detectMinimalProxy(contract.code || '0x'),
      decomposition: fns.some(f => f.from === 'bytecode') ? 'dispatcher' : 'fallback',
      disclaimer: 'Function-shape similarity labels for human review. Not a vulnerability proof.',
    };
  }
}

module.exports = {
  FunctionLabeler, MIN_SCORE, MIN_FEATURE_COS, MIN_ACTIVE_FEATURES,
  MIN_BODY, GENERIC_SIGNATURES
};
