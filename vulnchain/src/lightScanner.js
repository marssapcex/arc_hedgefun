/**
 * lightScanner.js — reuse BugChainIndexer's REAL scanner classes without
 * REQUIRING Alchemy keys, Etherscan keys or PostgreSQL — but all three can now
 * be supplied per-chain via src/chainConfig.js.
 *
 * Scanner (scanners/common/Scanner.js) is subclassed. We override only the
 * I/O boundary (RPC + DB + explorer) so that the original
 *   LogFetcher.fetchLogs()      (adaptive eth_getLogs)
 *   EOAFilter.filterAddresses()(isContracts / getCodeHashes / deploy cache)
 *   ContractVerifier.verify()  (Etherscan V2 when a key is configured)
 * keep running unmodified. This is the integration point, not a rewrite.
 */
'use strict';

const Scanner = require('../scanners/common/Scanner');
const { keccak256 } = require('ethers');
const { detectMinimalProxy } = require('./bytecode');
const {
  resolveChain, PUBLIC_RPCS, explorerParams, explorerCandidates,
} = require('./chainConfig');



class LightScanner extends Scanner {
  constructor(opts = {}) {
    // resolve BEFORE super(): registering a custom network must happen first,
    // because the upstream Scanner constructor throws on unknown network names.
    const chain = opts.chain || resolveChain(opts.network || 'ethereum', opts);
    super('VulnChain', {
      network: chain.network,
      timeout: 600,
      maxRetries: 2,
      batchSizes: { default: 200, rpc: 50 },
    });
    this.chain = chain;
    this.rpcUrls = chain.rpcUrls;
    this.config.chainId = this.chain.chainId;
    this.etherscanEnabled = false;
    this._codeCache = new Map();
  }

  /** Deliberately DOES NOT call super.initialize() (would require Postgres). */
  async initialize() {
    this.db = { query: async () => ({ rows: [] }) };
    const self = this;
    this.alchemyClient = {
      makeRequest: (m, p) => self.rpcAny(m, p),
      getBlockNumber: async () => parseInt(await self.rpcAny('eth_blockNumber', []), 16),
      getLogs: f => self.rpcAny('eth_getLogs', [f]),
      getBlock: n => self.rpcAny('eth_getBlockByNumber', [n, true]),
    };
    this.rpc = this.alchemyClient;
    this.logsClient = this.alchemyClient;
    this.log(`LightScanner ready: network=${this.network} chainId=${this.chain.chainId} ` +
      `rpc=${this.chain.rpcSource} explorerKey=${this.chain.hasEtherscan ? 'set' : 'none'}`);
    return this;
  }

  async rpcAny(method, params, timeout = 20000) {
    let lastErr = null;
    for (const url of this.rpcUrls) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        const r = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        const j = await r.json();
        if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160));
        if (j.result !== undefined && j.result !== null) return j.result;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error(`${method} failed on all endpoints`);
  }

  async getLogs(filter) { return this.rpcAny('eth_getLogs', [filter]); }
  async rpcCall(method, params = []) { return this.rpcAny(method, params); }
  async getBlockNumber() { return parseInt(await this.rpcAny('eth_blockNumber', []), 16); }
  async getBlockByNumber(n) { return this.rpcAny('eth_getBlockByNumber', [n, true]); }
  async queryDB() { return { rows: [] }; }
  /**
   * Explorer API. Etherscan V2 (chainid) first; if that rejects the key,
   * auto-retry the chain's legacy V1 explorer (BscScan for chainId 56, ...).
   * A free key from either issuer therefore works without config changes.
   */
  async etherscanCall(params = {}) {
    const key = this.chain.etherscanKey;
    if (!key) throw new Error('no explorer API key configured');
    const bases = explorerCandidates(this.chain.chainId, this.chain.explorerApi);
    let lastErr;
    for (const base of bases) {
      try {
        const q = new URLSearchParams(explorerParams(this.chain.chainId, key, params, base));
        const r = await fetch(`${base}?${q}`, {
          signal: AbortSignal.timeout(15000),
          headers: { Accept: 'application/json', 'User-Agent': 'vulnchain/1.0' },
        });
        if (!r.ok) throw new Error(`explorer HTTP ${r.status}`);
        const ct = String(r.headers.get('content-type') || '');
        const text = await r.text();
        // Rate-limited / Cloudflare / V1 endpoints often answer with an HTML
        // page. r.json() on that throws "Unexpected token '<'" and silently
        // downgrades the contract to unverified. Detect it explicitly so the
        // fallback endpoint actually gets a chance.
        if (!ct.includes('json') || text.trimStart().startsWith('<')) {
          throw new Error(`explorer returned HTML (${ct || 'no content-type'}, HTTP ${r.status})`);
        }
        const j = JSON.parse(text);
        if (j.status === '1' || Array.isArray(j.result)) return j.result;
        throw new Error(String(j.result || j.message || 'explorer error').slice(0, 140));
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('explorer call failed');
  }

  async getCode(address, tag = 'latest') {
    const key = `${address.toLowerCase()}:${tag}`;
    if (this._codeCache.has(key)) return this._codeCache.get(key);
    const code = await this.rpcAny('eth_getCode', [address, tag]);
    this._codeCache.set(key, code || '0x');
    return code || '0x';
  }

  /**
   * EIP-1167 proxies contain only delegation code; fingerprinting them makes
   * every clone look identical to every known-vulnerable proxy. Resolve the
   * implementation address from the runtime code and fingerprint THAT instead.
   */
  async getEffectiveCode(address) {
    const code = await this.getCode(address);
    const impl = detectMinimalProxy(code);
    if (!impl) return { code, viaProxy: null };
    try {
      const ic = await this.getCode(impl);
      if (ic && ic.length > 2) return { code: ic, viaProxy: impl };
    } catch (_) { /* implementation not deployed / pruned */ }
    return { code, viaProxy: impl };
  }

  async isContracts(addresses) {
    const out = [];
    for (const a of addresses) {
      try { out.push((await this.getCode(a)).length > 2); }
      catch (_) { out.push(false); }
    }
    return out;
  }

  async getCodeHashes(addresses) {
    const out = [];
    for (const a of addresses) {
      try {
        const c = await this.getCode(a);
        out.push(c.length > 2 ? keccak256(c) : null);
      } catch (_) { out.push(null); }
    }
    return out;
  }

  /** Also discover literal contract-creation txs (to == null). */
  async creationContracts(fromBlock, toBlock) {
    const out = [];
    for (let n = fromBlock; n <= toBlock; n++) {
      let blk;
      try { blk = await this.rpcAny('eth_getBlockByNumber', ['0x' + n.toString(16), true]); }
      catch (_) { continue; }
      for (const tx of (blk.transactions || [])) {
        if (!tx || typeof tx !== 'object' || tx.to != null) continue;
        let rc;
        try { rc = await this.rpcAny('eth_getTransactionReceipt', [tx.hash]); }
        catch (_) { continue; }
        if (rc && rc.status === '0x0') continue;
        const addr = rc && rc.contractAddress;
        if (!addr) continue;
        try {
          const code = await this.getCode(addr);
          if (code.length > 2) out.push({ address: addr.toLowerCase(), creator: (tx.from || '').toLowerCase(), block: n, code });
        } catch (_) { /* self-destruct / transient */ }
      }
    }
    return out;
  }
}

module.exports = { LightScanner, PUBLIC_RPCS };
