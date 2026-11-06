/**
 * valueFilter.js — only scan contracts that actually hold >= $10k on-chain.
 *
 * No off-chain price API, no DefiLlama, no IOC list. Value is measured with
 * read-only RPC calls:
 *   - native balance          eth_getBalance
 *   - stablecoin balances     balanceOf(address) on known stables (1 USD each)
 *   - wrapped-native balance  balanceOf(address), priced at the native price
 *   - native price            Chainlink latestRoundData() (on-chain, no key)
 *
 * If the Chainlink feed is unavailable, native/wrapped-native contribute 0 and
 * ONLY stablecoins count (priceSource 'stables-only'). No invented prices:
 * pass --native-price <usd> explicitly if you want BNB/ETH counted anyway.
 *
 * Override token lists without touching code:
 *   VULNCHAIN_TOKENS='{"56":[{"addr":"0x...","decimals":18,"usd":1}]}'
 * Keys: addr, decimals, usd (number) or usd:"native" (wrapped native).
 */
'use strict';

const BALANCE_OF = '0x70a08231';
const LATEST_ROUND = '0xfeaf968c';

const CHAINLINK_NATIVE = {
  1: { addr: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', decimals: 8 },  // ETH/USD
  56: { addr: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE', decimals: 8 }, // BNB/USD
};

// Only addresses we are confident about; override via VULNCHAIN_TOKENS.
const DEFAULT_TOKENS = {
  1: [
    { addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, usd: 1 },   // USDT
    { addr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, usd: 1 },   // USDC
    { addr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, usd: 'native' }, // WETH
  ],
  56: [
    { addr: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, usd: 1 },   // USDT (BSC)
    { addr: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, usd: 'native' }, // WBNB
  ],
};

function customTokens(chainId) {
  try {
    const j = JSON.parse(process.env.VULNCHAIN_TOKENS || '{}');
    return j[String(chainId)] || j[chainId] || null;
  } catch (_) { return null; }
}

function hexToNumber(hex) {
  if (!hex || hex === '0x') return 0;
  try { return Number(BigInt(hex)); } catch (_) { return 0; }
}

function units(hex, decimals) {
  return hexToNumber(hex) / Math.pow(10, decimals);
}

function callData(address) {
  return BALANCE_OF + address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
}

function createValueFilter(scanner, chainId, opts = {}) {
  const tokens = customTokens(chainId) || DEFAULT_TOKENS[chainId] || [];
  const feed = CHAINLINK_NATIVE[chainId];
  let priceCache;

  async function nativePrice() {
    if (opts.nativePrice !== undefined && opts.nativePrice !== null) {
      const p = Number(opts.nativePrice);
      return Number.isFinite(p) && p > 0 ? { price: p, source: 'cli --native-price' } : { price: null, source: 'stables-only' };
    }
    if (!feed) return { price: null, source: 'stables-only' };
    if (priceCache !== undefined) return priceCache;
    try {
      const r = await scanner.rpcAny('eth_call', [{ to: feed.addr, data: LATEST_ROUND }, 'latest']);
      if (!r || r.length < 130) throw new Error('short round data');
      const answer = BigInt('0x' + r.slice(66, 130));
      const p = Number(answer) / Math.pow(10, feed.decimals);
      priceCache = Number.isFinite(p) && p > 0
        ? { price: p, source: 'chainlink latestRoundData' }
        : { price: null, source: 'stables-only' };
    } catch (_) {
      priceCache = { price: null, source: 'stables-only' };
    }
    return priceCache;
  }

  async function estimate(address) {
    const { price, source } = await nativePrice();
    let usd = 0;
    const parts = Object.create(null);
    try {
      const bal = await scanner.rpcAny('eth_getBalance', [address, 'latest']);
      const native = units(bal, 18);
      parts.native = native;
      usd += native * (price || 0);
    } catch (_) { /* unreadable balance contributes 0 */ }

    for (const t of tokens) {
      try {
        const r = await scanner.rpcAny('eth_call', [{ to: t.addr, data: callData(address) }, 'latest']);
        const amount = units(r, t.decimals);
        const rate = t.usd === 'native' ? (price || 0) : Number(t.usd);
        if (!Number.isFinite(amount) || !Number.isFinite(rate)) continue;
        parts[t.addr.toLowerCase()] = amount;
        usd += amount * rate;
      } catch (_) { /* token not held / call reverted */ }
    }
    return { usd: Number(usd.toFixed(2)), price, priceSource: source, parts };
  }

  return { estimate, nativePrice, tokenCount: tokens.length };
}

module.exports = { createValueFilter, DEFAULT_TOKENS, CHAINLINK_NATIVE, callData, units };
