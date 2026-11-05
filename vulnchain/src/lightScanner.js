/**
 * lightScanner.js — reuse BugChainIndexer's REAL scanner classes without
 * requiring Alchemy keys, Etherscan keys or PostgreSQL.
 *
 * Scanner (scanners/common/Scanner.js) is subclassed. We override only the
 * I/O boundary (RPC + DB) so that the original
 *   LogFetcher.fetchLogs()      (adaptive eth_getLogs)
 *   EOAFilter.filterAddresses()(isContracts / getCodeHashes / deploy cache)
 *   ContractVerifier.verify()  (optional, degrades gracefully without a key)
 * keep running unmodified. This is the integration point, not a rewrite.
 */
'use strict';

const Scanner = require('../scanners/common/Scanner');
const { keccak256 } = require('ethers');

const PUBLIC_RPCS = {
  ethereum: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.llamarpc.com',
    'https://1rpc.io/eth',
    'https://rpc.flashbots.net',
  ],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://binance.llamarpc.com'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com'],
  base: ['https://base-rpc.publicnode.com'],
  optimism: ['https://optimism-rpc.publicnode.com'],
  polygon: ['https://polygon-bor-rpc.publicnode.com'],
};

class LightScanner extends Scanner {
  constructor(opts = {}) {
    super('VulnChain', {
      network: opts.network || 'ethereum',
      timeout: 600,
      maxRetries: 2,
      batchSizes: { default: 200, rpc: 50 },
    });
    this.rpcUrls = opts.rpcUrls || PUBLIC_RPCS[this.network] || PUBLIC_RPCS.ethereum;
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
    this.log('LightScanner ready (public RPC, no DB, no API keys)');
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
  async etherscanCall() { throw new Error('no explorer API key configured'); }

  async getCode(address, tag = 'latest') {
    const key = `${address.toLowerCase()}:${tag}`;
    if (this._codeCache.has(key)) return this._codeCache.get(key);
    const code = await this.rpcAny('eth_getCode', [address, tag]);
    this._codeCache.set(key, code || '0x');
    return code || '0x';
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
