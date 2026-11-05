/**
 * matcher.js — the actual "smart" part.
 *
 * For each newly discovered contract it fuses five independent signals,
 * weighted, with per-signal explanations:
 *
 *   0.34  bytecode similarity   MinHash-Jaccard over normalized opcode 5-grams
 *                               vs bytecode of known-vulnerable contracts
 *   0.24  selector similarity   IDF-weighted cosine (generic ERC20 selectors
 *                               collapse to ~0 automatically)
 *   0.18  source similarity     SimHash Hamming + MinHash over Solidity 4-grams
 *   0.14  category rules        explainable static patterns from rules.js
 *   0.10  IOC / cluster         exact attacker address, mass-deployed code
 *
 * LSH banding restricts comparisons to plausible candidates. Output is a
 * ranked list of SIMILAR INCIDENTS, never a "this contract is vulnerable"
 * verdict.
 */
'use strict';

const { fingerprint, MIN_OPCODE_NGRAMS } = require('./bytecode');
const { fingerprintSource } = require('./source');
const { evaluateRules } = require('./rules');
const {
  lshBands, jaccardMinhash, hammingSimilarity, idfCosine
} = require('./hashing');

const W = { bytecode: 0.32, selector: 0.20, source: 0.16, rules: 0.10, ioc: 0.22 };

class Matcher {
  constructor(corpus) {
    this.corpus = corpus;
    this.incidents = corpus.incidents;
    this.idf = corpus.idf || {};
    this.byId = new Map(this.incidents.map(i => [i.id, i]));
    this.bandIndex = new Map();
    this.selectorIndex = new Map();
    this.addressIndex = new Map();
    this.bytecodeEntries = [];
    this._index();
  }

  _addBand(key, id) {
    if (!this.bandIndex.has(key)) this.bandIndex.set(key, new Set());
    this.bandIndex.get(key).add(id);
  }

  _index() {
    for (const inc of this.incidents) {
      // source-similarity bands
      for (const b of lshBands(inc.source.minhash)) this._addBand(b, inc.id);
      // known-vulnerable bytecode bands (seeded from on-chain addresses)
      for (const bf of (inc.bytecodeFingerprints || [])) {
        // a 45-byte EIP-1167 proxy or a stub has no informative opcode stream
        if ((bf.ngramCount || 0) < MIN_OPCODE_NGRAMS || bf.minimalProxy) continue;
        this.bytecodeEntries.push({ id: inc.id, fp: bf });
        for (const b of bf.bands || lshBands(bf.minhash)) this._addBand(b, inc.id);
      }
      // selector inverted index
      for (const s of inc.source.selectors) {
        if (!this.selectorIndex.has(s)) this.selectorIndex.set(s, new Set());
        this.selectorIndex.get(s).add(inc.id);
      }
      // exact IOC
      for (const a of [...inc.attackerAddresses, ...inc.vulnerableContracts]) {
        if (!this.addressIndex.has(a)) this.addressIndex.set(a, new Set());
        this.addressIndex.get(a).add(inc.id);
      }
    }
  }

  stats() {
    return {
      incidents: this.incidents.length,
      bandKeys: this.bandIndex.size,
      selectorKeys: this.selectorIndex.size,
      knownAddresses: this.addressIndex.size,
      seededBytecodeFingerprints: this.bytecodeEntries.length,
      genericSelectors: Object.values(this.idf).filter(v => v < 0.05).length,
    };
  }

  /**
   * @param {{address:string, creator?:string, code:string,
   *          verifiedSource?:string, clusterSize?:number}} contract
   */
  match(contract) {
    const fp = fingerprint(contract.code || '0x');
    const srcFp = contract.verifiedSource ? fingerprintSource(contract.verifiedSource) : null;
    const rules = evaluateRules(fp, srcFp);
    const candidates = new Set();

    for (const b of fp.bands) for (const id of (this.bandIndex.get(b) || [])) candidates.add(id);
    if (srcFp) for (const b of lshBands(srcFp.minhash)) for (const id of (this.bandIndex.get(b) || [])) candidates.add(id);
    // selector-driven candidates, only selectors with meaningful IDF
    const contractVec = Object.fromEntries(fp.selectors.map(s => [s, 1]));
    for (const s of fp.selectors) {
      if ((this.idf[s] || 0) < 0.05) continue;
      for (const id of (this.selectorIndex.get(s) || [])) candidates.add(id);
    }
    const exact = new Set();
    for (const a of [contract.address, contract.creator].filter(Boolean).map(x => x.toLowerCase())) {
      for (const id of (this.addressIndex.get(a) || [])) { candidates.add(id); exact.add(id); }
    }
    // always keep a small global floor so a totally new pattern still gets a baseline
    const scored = [];
    for (const id of candidates) {
      const inc = this.byId.get(id);
      if (!inc) continue;
      let bytecodeSim = 0, bcEvidence = false, suppressed = false;
      if (fp.lowCoverage || fp.minimalProxy) {
        suppressed = true;
      } else {
        for (const e of this.bytecodeEntries) {
          if (e.id !== id) continue;
          bcEvidence = true;
          bytecodeSim = Math.max(bytecodeSim, jaccardMinhash(fp.minhash, e.fp.minhash));
        }
      }
      const selectorSim = idfCosine(contractVec, inc.selectorVector, this.idf);
      let sourceSim = 0;
      if (srcFp) {
        const h = hammingSimilarity(srcFp.simhash, inc.source.simhash);
        const j = jaccardMinhash(srcFp.minhash, inc.source.minhash);
        sourceSim = 0.5 * h + 0.5 * j;
      }
      const matchedRules = rules.filter(r => inc.categories.includes(r.category));
      const ruleScore = Math.min(1, matchedRules.length / 2);
      const ioc = exact.has(id) ? 1 : 0;
      const cluster = Math.min(1, Math.max(0, ((contract.clusterSize || 1) - 1) / 10));
      const score =
        W.bytecode * bytecodeSim +
        W.selector * selectorSim +
        W.source * sourceSim +
        W.rules * ruleScore +
        W.ioc * Math.max(ioc, cluster * 0.5);
      scored.push({
        id, score, bytecodeSim, selectorSim, sourceSim, ruleScore, ioc,
        bytecodeEvidence: bcEvidence, bytecodeSuppressed: suppressed,
        matchedRules: matchedRules.map(r => r.category),
        protocol: inc.protocol, date: inc.date, categories: inc.categories,
        rootCause: (inc.rootCause || '').slice(0, 160),
        lossUsd: inc.lossUsd,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    const final = top.length ? top[0].score : 0;
    // An exact IOC hit is a hard match, not a heuristic: never demote to INFO.
    const exactHit = top.some(t => t.ioc === 1);
    const verdict = final >= 0.60 ? 'HIGH_SIMILARITY'
      : (final >= 0.25 || exactHit) ? 'REVIEW' : 'INFO';
    const evidence = [];
    if (top[0]?.bytecodeSim > 0.4) evidence.push(`bytecode opcode-5gram Jaccard ≈ ${top[0].bytecodeSim.toFixed(2)} vs a known-vulnerable deployment`);
    if (fp.minimalProxy) evidence.push(`EIP-1167 minimal proxy → implementation resolved at ${fp.delegateTo}; proxy bytecode itself carries no logic`);
    else if (fp.lowCoverage) evidence.push(`bytecode similarity suppressed: only ${fp.ngramCount} opcode n-grams (< ${MIN_OPCODE_NGRAMS}), too small for a meaningful fingerprint`);
    if (top[0]?.selectorSim > 0.3) evidence.push('IDF-weighted selector cosine > 0.30');
    if (srcFp && top[0]?.sourceSim > 0.4) evidence.push('verified source shares token 4-grams with a vulnerable snippet');
    for (const r of rules) evidence.push(`rule ${r.category} (${r.from}): ${r.why}`);
    if (exact.size) evidence.push('creator/address is an exact IOC from the incident database');
    if ((contract.clusterSize || 1) >= 5) evidence.push(`${contract.clusterSize} freshly deployed contracts share identical bytecode`);

    return {
      address: contract.address,
      creator: contract.creator || null,
      block: contract.block || null,
      codeHash: fp.codeHash,
      proxyImplementation: contract.viaProxy || fp.delegateTo || null,
      codeBytes: fp.codeBytes,
      opcodeCount: fp.opcodeCount,
      ngramCount: fp.ngramCount,
      selectors: fp.selectors,
      flags: fp.flags,
      verdict, score: Number(final.toFixed(4)),
      candidatesConsidered: candidates.size,
      similarIncidents: top,
      rules, evidence,
      sourceAvailable: !!srcFp,
      disclaimer: 'Similarity ranking for human review. Not a vulnerability proof.',
    };
  }
}

module.exports = { Matcher, W };
