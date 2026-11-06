'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveChain, redactRpc } = require('../src/chainConfig');

const KEYS = ['RPC_URL', 'RPC_URL_ETHEREUM', 'RPC_URL_BASE', 'RPC_URL_MYCHAIN',
  'CHAIN_ID', 'CHAIN_ID_MYCHAIN', 'ETHERSCAN_API_KEY', 'DEFAULT_ETHERSCAN_KEYS',
  'ALCHEMY_API_KEY', 'INFURA_PROJECT_ID', 'VULNCHAIN_CHAINS', 'EXPLORER_API_URL'];
let saved;
test.beforeEach(() => { saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])); KEYS.forEach(k => delete process.env[k]); });
test.afterEach(() => {
  KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

test('zero-key default still resolves ethereum chainId 1 + public RPC', () => {
  const c = resolveChain('ethereum');
  assert.equal(c.chainId, 1);
  assert.equal(c.hasEtherscan, false);
  assert.match(c.rpcUrls[0], /publicnode/);
  assert.equal(c.rpcSource, 'public RPC (no key)');
});

test('per-chain RPC URL + Etherscan key are picked up', () => {
  process.env.RPC_URL_BASE = 'https://base-mainnet.g.alchemy.com/v2/SECRET123456';
  process.env.ETHERSCAN_API_KEY = 'ETHKEY999';
  const c = resolveChain('base');
  assert.equal(c.chainId, 8453);
  assert.equal(c.rpcSource, 'env RPC_URL_BASE');
  assert.ok(c.rpcUrls[0].includes('SECRET123456'));
  assert.equal(c.hasEtherscan, true);
  assert.equal(redactRpc(c.rpcUrls[0]), 'https://base-mainnet.g.alchemy.com/v2/***');
});

test('CLI --rpc and --chain-id override env and upstream config', () => {
  process.env.RPC_URL_BASE = 'https://env.example/';
  const c = resolveChain('base', { rpcUrl: 'https://cli.example/v3/CLIKEY123', chainId: 999 });
  assert.equal(c.rpcSource, 'cli --rpc');
  assert.equal(c.chainId, 999);
  assert.equal(c.rpcUrls[0], 'https://cli.example/v3/CLIKEY123');
  assert.equal(redactRpc(c.rpcUrls[0]), 'https://cli.example/v3/***');
});

test('ALCHEMY_API_KEY builds the right per-chain endpoint', () => {
  process.env.ALCHEMY_API_KEY = 'ALCH123456';
  const c = resolveChain('arbitrum');
  assert.equal(c.chainId, 42161);
  assert.equal(c.rpcUrls[0], 'https://arb-mainnet.g.alchemy.com/v2/ALCH123456');
  assert.equal(c.rpcSource, 'Alchemy key');
});

test('custom chain via env pair works end-to-end', () => {
  process.env.RPC_URL_MYCHAIN = 'https://rpc.mychain.example/v2/KEY987654';
  process.env.CHAIN_ID_MYCHAIN = '12345';
  process.env.ETHERSCAN_API_KEY = 'EKEY';
  const c = resolveChain('mychain');
  assert.equal(c.chainId, 12345);
  assert.equal(c.hasEtherscan, true);
  assert.equal(redactRpc(c.rpcUrls[0]), 'https://rpc.mychain.example/v2/***');
  const { LightScanner } = require('../src/lightScanner');
  const s = new LightScanner({ network: 'mychain', chain: c });
  assert.equal(s.config.chainId, 12345);
  assert.equal(s.chain.hasEtherscan, true);
});

test('VULNCHAIN_CHAINS defines chain + custom explorer', () => {
  process.env.VULNCHAIN_CHAINS = JSON.stringify({
    zeta: { chainId: 7000, rpcUrls: ['https://zeta.example/<K>'], explorerApi: 'https://zeta.example/api' },
  });
  const c = resolveChain('zeta');
  assert.equal(c.chainId, 7000);
  assert.equal(c.explorerApi, 'https://zeta.example/api');
  assert.equal(c.rpcSource, 'VULNCHAIN_CHAINS');
});

test('unknown chain without rpc / chainId fails with an actionable message', () => {
  assert.throws(() => resolveChain('nowhere'), /No RPC for network 'nowhere'/);
  process.env.RPC_URL_NOWHERE = 'https://nowhere.example/';
  assert.throws(() => resolveChain('nowhere'), /No chainId/);
});

test('redactRpc masks query apikey and provider keys', () => {
  assert.equal(redactRpc('https://x/api?apikey=SECRET&a=1'), 'https://x/api?apikey=***&a=1');
  assert.equal(redactRpc('https://mainnet.infura.io/v3/PROJ123456789'), 'https://mainnet.infura.io/v3/***');
  assert.equal(redactRpc('https://public.example/'), 'https://public.example/');
});

const {
  isV2Explorer, explorerParams, explorerCandidates, LEGACY_EXPLORER,
} = require('../src/chainConfig');

test('explorer V2 sends chainid, legacy BscScan V1 does not', () => {
  assert.equal(isV2Explorer('https://api.etherscan.io/v2/api'), true);
  assert.equal(isV2Explorer('https://api.bscscan.com/api'), false);
  const v2 = explorerParams(56, 'KEY', { module: 'contract' }, 'https://api.etherscan.io/v2/api');
  assert.equal(v2.chainid, '56');
  assert.equal(v2.apikey, 'KEY');
  const v1 = explorerParams(56, 'KEY', { module: 'contract' }, 'https://api.bscscan.com/api');
  assert.equal(v1.chainid, undefined);
  assert.equal(v1.apikey, 'KEY');
  assert.equal(v1.module, 'contract');
});

test('BSC key auto-falls back from Etherscan V2 to BscScan V1', () => {
  const c = explorerCandidates(56, 'https://api.etherscan.io/v2/api');
  assert.deepEqual(c, ['https://api.etherscan.io/v2/api', LEGACY_EXPLORER[56]]);
  assert.deepEqual(explorerCandidates(56, 'https://api.bscscan.com/api'), ['https://api.bscscan.com/api']);
});

test('DEFAULT_ETHERSCAN_KEYS (legacy upstream name) is accepted', () => {
  process.env.DEFAULT_ETHERSCAN_KEYS = 'KEYONE,KEYTWO';
  const c = resolveChain('binance');
  assert.equal(c.hasEtherscan, true);
  assert.equal(c.chainId, 56);
});
