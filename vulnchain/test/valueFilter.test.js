'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createValueFilter, callData, units, CHAINLINK_NATIVE } = require('../src/valueFilter');

const ADDR = '0x' + 'ab'.repeat(20);
const word = n => BigInt(n).toString(16).padStart(64, '0');

function mockScanner({ price = 690e8, balances = {}, native = 0 } = {}) {
  return {
    rpcAny: async (method, params) => {
      if (method === 'eth_getBalance') return '0x' + BigInt(Math.round(native * 1e18)).toString(16);
      if (method === 'eth_call') {
        const to = params[0].to.toLowerCase();
        const data = params[0].data;
        if (data === '0xfeaf968c') return '0x' + word(1) + word(price) + word(1) + word(1) + word(1);
        return '0x' + (balances[to] !== undefined ? word(balances[to]) : word(0));
      }
      return '0x0';
    },
  };
}

test('balanceOf calldata is ABI-padded and lowercase', () => {
  assert.equal(callData(ADDR), '0x70a08231' + 'ab'.repeat(20).padStart(64, '0'));
  assert.equal(units('0x' + (1000000n).toString(16), 6), 1);
});

test('Chainlink BNB/USD price decoded from latestRoundData', async () => {
  const s = mockScanner({ price: 690e8 });
  const vf = createValueFilter(s, 56);
  const p = await vf.nativePrice();
  assert.equal(p.price, 690);
  assert.equal(p.source, 'chainlink latestRoundData');
});

test('contract holding 12000 USDT passes the $10k gate', async () => {
  const usdt = '0x55d398326f99059fF775485246999027B3197955'.toLowerCase();
  const s = mockScanner({ balances: { [usdt]: 12000n * 10n ** 18n } });
  const vf = createValueFilter(s, 56);
  const v = await vf.estimate(ADDR);
  assert.ok(v.usd >= 10000, String(v.usd));
  assert.equal(v.price, 690);
  assert.ok(v.parts[usdt] >= 12000);
});

test('dust contract is below the gate', async () => {
  const s = mockScanner({ balances: {} });
  const v = await createValueFilter(s, 56).estimate(ADDR);
  assert.equal(v.usd, 0);
});

test('no Chainlink feed -> stables-only, native contributes 0, no invented price', async () => {
  const s = { rpcAny: async (m, p) => m === 'eth_getBalance'
    ? '0x' + (10n * 10n ** 18n).toString(16)
    : '0x' + word(20000n * 10n ** 18n) };
  const v = await createValueFilter(s, 999999).estimate(ADDR);
  assert.equal(v.price, null);
  assert.equal(v.priceSource, 'stables-only');
  assert.equal(v.usd, 0);   // 10 native coins NOT priced out of thin air
});

test('--native-price explicitly enables counting native balance', async () => {
  const s = mockScanner({ native: 20 });
  const v = await createValueFilter(s, 56, { nativePrice: 690 }).estimate(ADDR);
  assert.equal(v.price, 690);
  assert.equal(v.priceSource, 'cli --native-price');
  assert.equal(v.usd, 13800);
});
