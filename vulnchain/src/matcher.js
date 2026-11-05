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
 *   0.50  semantic feature cosine  (caller check / msg.value / state write /
 *                                  spot-price read / loop over user array ...)
 *   0.35  body n-gram similarity   (MinHash Jaccard + SimHash Hamming)
 *   0.15  exact selector equality  (same canonical signature)
 *
 * LSH banding + selector inverted index restrict candidates. No address
 * lookups, no clusters, no generic opcode rules.
 */
'use strict';

const {
  splitBytecodeFunctions, extractSourceFunctions, functionSimilarity,
  mergeFeatures, activeFeatures, FEATURE_KEYS
} = require('./functions');
const { detectMinimalProxy } = require('./bytecode');

const MIN_SCORE = 0.46;
const MIN_FEATURE_COS = 0.55;
const MIN_ACTIVE_FEATURES = 4;
const MIN_BODY_OR_SELECTOR = 0.10;

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
    const matched = [];
    for (const fn of fns) {
      if ((fn.activeFeatures || []).length < MIN_ACTIVE_FEATURES) continue;
      let best = null;
      for (const i of this._candidates(fn)) {
        const ref = this.fns[i];
        if ((ref.activeFeatures || []).length < MIN_ACTIVE_FEATURES) continue;
        const sim = functionSimilarity(fn, ref);
        // a bare feature-vector coincidence is not a label
        if (sim.featureCos < MIN_FEATURE_COS) continue;
        if (sim.sel === 0 && sim.body < MIN_BODY_OR_SELECTOR) continue;
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
        selectorEqual: best.sim.sel === 1,
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
      proxyImplementation: contract.viaProxy || detectMinimalProxy(contract.code || '0x'),
      decomposition: fns.some(f => f.from === 'bytecode') ? 'dispatcher' : 'fallback',
      disclaimer: 'Function-shape similarity labels for human review. Not a vulnerability proof.',
    };
  }
}

module.exports = { FunctionLabeler, MIN_SCORE, MIN_FEATURE_COS, MIN_ACTIVE_FEATURES };
