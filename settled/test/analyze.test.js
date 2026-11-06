'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEvidence } = require('../src/evidence');
const {
  deadCapital, liveness, governance, volumeQuality, buildReport, DEAD_RPC_NOTE,
} = require('../src/analyze');

const FILES = {
  probe: 'rpc_probe_raw.json', target: 'rpc_target_raw.json', votes: 'rpc_votes_raw.json',
  follow: 'rpc_follow_raw.json', zombie: 'rpc_zombie_raw.json', snapshot: 'settled/data/snapshot.json',
};

function fixture(overrides = {}) {
  const base = {
    files: { ...FILES },
    target: {
      generatedAt: '2026-11-04T10:30:25Z',
      blocks: { moonriver: 17381654 },
      results: [
        {
          chain: 'moonriver', label: 'Moonwell market MOVR (0x6a1A771C)',
          address: '0x6a1A771C7826596652daDC9145fEAaE62b1cd07f', codeBytes: 21171,
          calls: { 'getCash()': 86942718531600587949091, 'admin()': '0xfea5a5927645c0dc5c1e740ec1b24ad320c7e58f' },
          balances: { native: 86942718531600587949091 },
        },
        {
          chain: 'moonriver', label: 'Moonwell Apollo Unitroller',
          address: '0x0b7a0EAA884849c6Af7a129e899536dDDcA4905E', codeBytes: 1508,
          calls: { 'admin()': '0x04e6322d196e0e4ccbb2610dd8b8f2871e160bd7', 'oracle()': '0x892be716dcf0a6199677f355f45ba8cc123baf60' },
          balances: { native: 8512587738918715260996 },
        },
        {
          chain: 'moonriver', label: 'Moonwell Apollo governor',
          address: '0x2BE2e230e89c59c8E20E633C524AD2De246e7370', codeBytes: 22521,
          calls: {
            'getQuorum()': 40000001000000000000000000,
            'currentQuorum()': 40000001000000000000000000,
            'proposalThreshold()': 100000000000000000000000000,
            'votingDelay()': 60, 'votingPeriod()': 259200, 'proposalCount()': 238,
            'govToken()': '0xbb8d88bcd9749636bc4d2be22aac4bb3b01a58f1',
            'timelock()': '0x04e6322d196e0e4ccbb2610dd8b8f2871e160bd7',
            'breakGlassGuardian()': '0x5ded9d1025a158554ab19540ae83182d890bb8db',
            'guardianSunset()': 1681187191,
          }, balances: { native: 0 },
        },
        {
          chain: 'moonriver', label: 'Moonwell Apollo timelock',
          address: '0x04e6322D196E0E4cCBb2610dd8B8f2871E160bd7', codeBytes: 7486,
          calls: { 'delay()': 86400, 'admin()': '0x2be2e230e89c59c8e20e633c524ad2de246e7370' },
          balances: { native: 0 },
        },
      ],
    },
    zombie: {
      generatedAt: '2026-11-04T14:57:01Z',
      counts: { FROZEN: 8, DEAD_RPC: 83, LIVE: 111 },
      results: [{
        name: 'Moonriver', status: 'FROZEN', block: 17381654, blockTimestamp: 1786350468,
        lastBlockTime: '2026-08-10T08:27:48+00:00', ageDays: 86.27,
        nextBlockProbe: [
          { url: 'https://moonriver.api.onfinality.io/public', next: 17381655, exists: false },
          { url: 'https://moonriver.drpc.org', next: 17381655, exists: false },
        ],
        contracts: [{ codeBytes: 8186 }, { codeBytes: 22521 }, { codeBytes: 1508 }],
      }],
    },
    snapshot: {
      measured: { block: 17381654, chainId: 1285 },
      defillama: {
        fees: { total24h: 100, total30d: 3000, source: 'fees-url' },
        dexs: { total24h: 10000, total30d: 300000, source: 'dexs-url' },
        moonwellApollo: { currentChainTvls: { Moonriver: 0 }, source: 'protocol-url' },
      },
      moonwellCashHuman: { source: 'RPC_ONCHAIN_TARGETS.md', rows: [
        { match: 'market MOVR', amount: 86942.7185, unit: 'MOVR' },
        { match: 'Unitroller', amount: 8512.5877, unit: 'MOVR' },
      ] },
      reported: {
        hyperliquid: { volume30d: 1000, fees30d: 10, source: 'hl-url' },
        kalshi: { contractVolumeWeekly: 1000, executionPriceUsdWeekly: 232, sources: ['kalshi-url'] },
        x402: { transactions: 1000, settlementUsd: 380, agentDrivenLow: 0.006, agentDrivenHigh: 0.075, sources: ['x402-url'] },
        mipR39: { date: '2026-03-24', costUsd: 1808, quorumTokensAtTime: 40000000, forVotes: 41570000, treasuryUsd: 1080000, ratioCostToTreasury: 597, outcome: 'khong execute' },
        mipR41: { date: '2026-07-21', claimedThresholdTokens: 100000000, claimedQuorumTokens: 100000000, source: 'mip-r41-url' },
      },
    },
  };
  return { ...base, ...overrides };
}

test('deadCapital: tracker 0 nhưng contract còn tiền → bất đồng, không quy đổi USD', () => {
  const ev = fixture();
  const d = deadCapital(ev);
  assert.equal(d.claimedUsd, 0);
  assert.equal(d.contractsHoldingValue, 2);
  assert.equal(d.nonZeroBalances, 2);
  assert.equal(d.disagreement, true);
  assert.equal(d.usdConverted, false);
  assert.equal(d.holdings[0].humanAmount, 86942.7185);
  assert.equal(d.holdings[1].unit, 'MOVR');
  assert.ok(d.evidence.length >= 2);
});

test('deadCapital: tracker khác 0 → không báo bất đồng', () => {
  const ev = fixture();
  ev.snapshot.defillama.moonwellApollo.currentChainTvls.Moonriver = 1234;
  const d = deadCapital(ev);
  assert.equal(d.disagreement, false);
});

test('liveness: FROZEN chỉ khi 2 endpoint độc lập cùng trả N và N+1 = null', () => {
  const ev = fixture();
  const l = liveness(ev);
  assert.equal(l.status, 'FROZEN_AT_BLOCK');
  assert.equal(l.independentEndpoints, 2);
  assert.equal(l.interpretedAsDeath, false);
  assert.equal(l.contractsWithCode, 3);
  assert.ok(l.caveat.includes('DEAD_RPC'));
});

test('liveness: DEAD_RPC không bị gán nhầm thành FROZEN / chain chết', () => {
  const ev = fixture();
  ev.zombie.results[0].status = 'DEAD_RPC';
  ev.zombie.results[0].nextBlockProbe = [];
  const l = liveness(ev);
  assert.equal(l.status, 'DEAD_RPC');
  assert.equal(l.interpretedAsDeath, false);
  assert.ok(l.implication.includes('Chua du dieu kien'));
  assert.match(DEAD_RPC_NOTE, /KHONG phai chain chet/);
});

test('governance: đọc đúng scalar và phát hiện drift giữa bản sửa và chain', () => {
  const ev = fixture();
  const g = governance(ev);
  assert.equal(g.quorumTokens, 40000001);
  assert.equal(g.proposalThresholdTokens, 100000000);
  assert.equal(g.timelockDelaySeconds, 86400);
  assert.equal(g.votingPeriodSeconds, 259200);
  assert.equal(g.historicalIncident.ratioCostToTreasury, 597);
  assert.equal(g.parameterDrift, true);
  assert.ok(g.driftNote.includes('40,000,001'));
  assert.ok(g.guardianSunsetIso.startsWith('2023-04'));
  assert.match(g.guardianSunsetMeaning, /khong tu dong mat quyen/);
});

test('volumeQuality: xếp theo fee/volume, không tự bịa USD từ tỉ lệ', () => {
  const ev = fixture();
  const v = volumeQuality(ev);
  assert.equal(v.rankedBy, 'fee/volume, khong phai volume');
  assert.equal(v.rows[0].ratioBps, 100);                   // 100/10000*10000 = 100 bps
  assert.equal(v.rows[1].ratioBps, 100);                   // 10/1000*10000 = 100 bps
  assert.ok(Math.abs(v.rows[2].cashRatio - 0.232) < 1e-9);
  assert.ok(Math.abs(v.rows[3].avgSettlementPerTxUsd - 0.38) < 1e-9);
  assert.match(v.rows[3].agentUsdNotComputed, /khong nhan them/);
});

test('buildReport: gom bất đồng, giữ provenance, không chứa từ cấm', () => {
  const rep = buildReport(fixture());
  assert.equal(rep.meta.noKey, true);
  assert.equal(rep.meta.noTx, true);
  assert.equal(rep.meta.noPriceAssumption, true);
  assert.equal(rep.meta.noScoring, true);
  assert.deepEqual(rep.disagreements.map(x => x.id).sort(),
    ['tracker_vs_chain', 'claimed_fix_vs_chain', 'notional_vs_cash'].sort());
  for (const s of Object.values(rep.sections)) assert.ok(s.evidence && s.evidence.length >= 1);
  const text = JSON.stringify(rep);
  assert.doesNotMatch(text, /VULNERABLE|verdict|\bbuy\b|airdrop|exploitable|guaranteed|REVIEW\/INFO/i);
  assert.ok(rep.headline.includes('2 contract'));
});

test('evidence thật trong repo: 8 market + FROZEN + quorum 40.000.001', () => {
  const ev = loadEvidence();
  assert.ok(ev.target.results && ev.target.results.length > 0, 'rpc_target_raw.json phải đọc được');
  const d = deadCapital(ev);
  assert.ok(d.contractsHoldingValue >= 8, 'có ít nhất 8 chỗ giữ tiền');
  assert.equal(d.disagreement, true);
  assert.equal(liveness(ev).status, 'FROZEN_AT_BLOCK');
  const g = governance(ev);
  assert.equal(g.quorumTokens, 40000001);
  assert.equal(g.proposalThresholdTokens, 100000000);
  const rep = buildReport(ev);
  assert.ok(rep.disagreements.length >= 2);
});
