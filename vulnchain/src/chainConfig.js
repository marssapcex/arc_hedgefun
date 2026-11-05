/**
 * chainConfig.js — let the user supply their OWN RPC key, their OWN Etherscan
 * key, and their OWN chain. Nothing is hardcoded to one network.
 *
 * Resolution order for the RPC endpoint (first hit wins):
 *   1. --rpc <url>                       (CLI, may already contain the key)
 *   2. RPC_URL_<NETWORK>                 e.g. RPC_URL_BASE, RPC_URL_MY_CHAIN
 *   3. RPC_URL                           generic
 *   4. --rpc-key <key> / ALCHEMY_API_KEY (built from the network's Alchemy slug)
 *   5. INFURA_PROJECT_ID                 (built from the network's Infura slug)
 *   6. VULNCHAIN_CHAINS.<network>.rpcUrls
 *   7. upstream BugChainIndexer public rpcUrls
 *
 * Etherscan key:
 *   --etherscan-key <key> | ETHERSCAN_API_KEY_<NETWORK> | ETHERSCAN_API_KEY
 *   | DEFAULT_ETHERSCAN_KEYS (comma separated, first wins)
 * Explorer API base: --explorer-api | EXPLORER_API_URL_<NETWORK> |
 *   EXPLORER_API_URL | https://api.etherscan.io/v2/api (default, multichain V2)
 *
 * Custom chain (no code change needed):
 *   VULNCHAIN_CHAINS='{"mychain":{"chainId":12345,"rpcUrls":["https://..."],"explorerApi":"https://..."}}'
 *   node src/cli.js scan --network mychain --etherscan-key <KEY>
 * or simply:
 *   RPC_URL_MYCHAIN=https://... CHAIN_ID_MYCHAIN=12345 \
 *     node src/cli.js scan --network mychain
 *
 * SECURITY: keys are never written into meta.rpc / reports. redactRpc() masks
 * /v2/<key>, /v3/<key> and any apikey= query parameter.
 */
'use strict';

const { NETWORKS } = require('../scanners/config/networks');

const DEFAULT_EXPLORER = 'https://api.etherscan.io/v2/api';

// Zero-key fallback, kept stable so CI behaviour does not change when the
// upstream config happens to list a flaky public endpoint first.
const PUBLIC_RPCS = {
  ethereum: ['https://ethereum-rpc.publicnode.com'],
  bsc: ['https://bsc-rpc.publicnode.com'],
  binance: ['https://bsc-rpc.publicnode.com'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com'],
  base: ['https://base-rpc.publicnode.com'],
  optimism: ['https://optimism-rpc.publicnode.com'],
  polygon: ['https://polygon-bor-rpc.publicnode.com'],
};

// Alchemy / Infura slugs for the networks shipped with BugChainIndexer.
const ALCHEMY_SLUG = {
  ethereum: 'eth-mainnet', arbitrum: 'arb-mainnet', optimism: 'opt-mainnet',
  base: 'base-mainnet', polygon: 'polygon-mainnet', binance: 'bnb-mainnet',
  avalanche: 'avax-mainnet', linea: 'linea-mainnet', scroll: 'scroll-mainnet',
};
const INFURA_SLUG = {
  ethereum: 'mainnet', arbitrum: 'arbitrum-mainnet', optimism: 'optimism-mainnet',
  base: 'base-mainnet', polygon: 'polygon-mainnet', avalanche: 'avalanche-mainnet',
  linea: 'linea-mainnet',
};

function envKey(network, prefix) {
  return `${prefix}_${String(network).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function customChains() {
  try { return JSON.parse(process.env.VULNCHAIN_CHAINS || '{}') || {}; }
  catch (_) { return {}; }
}

function first(...xs) { return xs.find(x => x !== undefined && x !== null && x !== ''); }

function redactRpc(url) {
  if (!url || typeof url !== 'string') return url;
  return url
    .replace(/(\/v[23]\/)([A-Za-z0-9_-]{8,})/g, '$1***')
    .replace(/([?&](?:apikey|api_key|key|token)=)[^&]+/gi, '$1***');
}

/**
 * @param {string} network  any name; unknown names need an explicit rpc + chainId
 * @param {object} opts     CLI overrides
 * @returns {{network, chainId, rpcUrls, rpcSource, etherscanKey, explorerApi, custom}}
 */
function resolveChain(network, opts = {}) {
  const net = String(network || 'ethereum').toLowerCase();
  const upstream = NETWORKS[net];
  const custom = customChains()[net] || {};
  const per = k => process.env[envKey(net, k)];
  const suffix = String(net).toUpperCase().replace(/[^A-Z0-9]/g, '_');

  // ── chainId ────────────────────────────────────────────────────────────
  const rawId = first(opts.chainId, per('CHAIN_ID'), process.env.CHAIN_ID,
    custom.chainId, upstream && upstream.chainId);
  const chainId = rawId === undefined ? undefined : parseInt(rawId, 10);

  // ── RPC endpoint ───────────────────────────────────────────────────────
  const alchemyKey = first(opts.rpcKey, process.env.ALCHEMY_API_KEY);
  const infuraKey = process.env.INFURA_PROJECT_ID;
  const slug = custom.alchemyNetwork || (upstream && upstream.alchemyNetwork) || ALCHEMY_SLUG[net];
  const islug = custom.infuraNetwork || INFURA_SLUG[net];

  let rpcUrls, rpcSource;
  const cliUrl = opts.rpcUrl || (opts.rpcUrls && opts.rpcUrls[0]);
  if (cliUrl) { rpcUrls = [cliUrl]; rpcSource = 'cli --rpc'; }
  else if (opts.rpcUrls && opts.rpcUrls.length) { rpcUrls = opts.rpcUrls; rpcSource = 'cli --rpc list'; }
  else if (per('RPC_URL')) { rpcUrls = [per('RPC_URL')]; rpcSource = `env ${envKey(net, 'RPC_URL')}`; }
  else if (process.env.RPC_URL) { rpcUrls = [process.env.RPC_URL]; rpcSource = 'env RPC_URL'; }
  else if (alchemyKey && slug) {
    rpcUrls = [`https://${slug}.g.alchemy.com/v2/${alchemyKey}`]; rpcSource = 'Alchemy key';
  }
  else if (infuraKey && islug) {
    rpcUrls = [`https://${islug}.infura.io/v3/${infuraKey}`]; rpcSource = 'Infura key';
  }
  else if (custom.rpcUrls && custom.rpcUrls.length) { rpcUrls = custom.rpcUrls; rpcSource = 'VULNCHAIN_CHAINS'; }
  else if (PUBLIC_RPCS[net]) { rpcUrls = PUBLIC_RPCS[net]; rpcSource = 'public RPC (no key)'; }
  else if (upstream && upstream.rpcUrls && upstream.rpcUrls.length) {
    rpcUrls = upstream.rpcUrls.filter(u => !/\/v2\/demo(\/|$)/.test(u)).slice(0, 5);
    rpcSource = 'upstream public RPC list';
  }

  if (!rpcUrls || !rpcUrls.length) {
    throw new Error(
      `No RPC for network '${net}'. Set RPC_URL_${suffix}=<url> ` +
      `or pass --rpc <url>. For a private key: ALCHEMY_API_KEY=<key> (or --rpc-key). ` +
      `Custom chains also need CHAIN_ID_${suffix} or VULNCHAIN_CHAINS.`
    );
  }
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(
      `No chainId for network '${net}'. Pass --chain-id <id>, set CHAIN_ID_${suffix}, ` +
      `or add it to VULNCHAIN_CHAINS. Needed for Etherscan V2 + Sourcify.`
    );
  }

  // ── explorer key / API base ─────────────────────────────────────────────
  const dfltKeys = (process.env.DEFAULT_ETHERSCAN_KEYS || '').split(/[,\s]+/).filter(Boolean);
  const etherscanKey = first(opts.etherscanKey, per('ETHERSCAN_API_KEY'),
    process.env.ETHERSCAN_API_KEY, dfltKeys[0], custom.etherscanKey);
  const explorerApi = first(opts.explorerApi, per('EXPLORER_API_URL'),
    process.env.EXPLORER_API_URL, custom.explorerApi, DEFAULT_EXPLORER);

  // Register unknown networks on the upstream config object so the inherited
  // BugChainIndexer Scanner/LogFetcher/EOAFilter classes accept them.
  if (!upstream) {
    NETWORKS[net] = {
      chainId, name: custom.name || net,
      alchemyNetwork: slug || net,
      rpcUrls, maxLogsBlockRange: custom.maxLogsBlockRange || 50,
    };
  } else if (chainId !== upstream.chainId) {
    upstream.chainId = chainId;   // env override takes precedence
  }

  return {
    network: net, chainId, rpcUrls, rpcSource,
    etherscanKey: etherscanKey || null, explorerApi,
    hasEtherscan: !!etherscanKey,
    custom: !!custom.chainId || !upstream,
  };
}

module.exports = {
  resolveChain, redactRpc, envKey, customChains,
  DEFAULT_EXPLORER, ALCHEMY_SLUG, INFURA_SLUG, PUBLIC_RPCS,
};
