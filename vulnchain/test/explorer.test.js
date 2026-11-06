'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveChain } = require('../src/chainConfig');
const { LightScanner } = require('../src/lightScanner');

let savedKey;
test.beforeEach(() => { savedKey = process.env.ETHERSCAN_API_KEY; process.env.ETHERSCAN_API_KEY = 'TESTKEY'; });
test.afterEach(() => {
  if (savedKey === undefined) delete process.env.ETHERSCAN_API_KEY;
  else process.env.ETHERSCAN_API_KEY = savedKey;
});

test('HTML rate-limit page falls through to BscScan V1 instead of "Unexpected token <"', async () => {
  const s = new LightScanner({ network: 'binance', chain: resolveChain('binance') });
  const orig = global.fetch;
  let n = 0;
  global.fetch = async () => {
    n++;
    if (n === 1) return {
      ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<!doctype html><html>rate limited</html>',
    };
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ status: '1', result: [{ SourceCode: 'contract X {}', ContractName: 'X', ABI: '[]' }] }),
    };
  };
  try {
    const r = await s.etherscanCall({ module: 'contract', action: 'getsourcecode', address: '0x' + '11'.repeat(20) });
    assert.ok(Array.isArray(r));
    assert.equal(r[0].ContractName, 'X');
    assert.equal(n, 2);   // V2 HTML -> V1 JSON
  } finally { global.fetch = orig; }
});

test('all-HTML responses throw a readable error, never a JSON parse error', async () => {
  const s = new LightScanner({ network: 'binance', chain: resolveChain('binance') });
  const orig = global.fetch;
  global.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => 'text/html' },
    text: async () => '<!doctype html>',
  });
  try {
    await assert.rejects(() => s.etherscanCall({ module: 'contract' }), /explorer returned HTML/);
  } finally { global.fetch = orig; }
});
