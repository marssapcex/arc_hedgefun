'use strict';

/**
 * SETTLED — doi chieu bien lai, khong doan.
 *
 * Khong co ML, khong co "diem nguy co", khong gan nhan contract.
 * Moi ket qua la phep so sanh giua 2 nguon co the kiem chung, kem
 * file/method/block da doc. Neu 2 nguon khac nhau -> day vao
 * `disagreements`, KHONG chon mot ben de ket luan.
 */
const { findResult, moonriverTargets, humanCash } = require('./evidence');

const E18 = 1e18;
const DEAD_RPC_NOTE =
  'DEAD_RPC nghia la khong endpoint nao tra loi, KHONG phai chain chet. ' +
  'FROZEN chi duoc khang dinh khi >=2 endpoint doc lap cung tra block N va N+1 = null.';

function rawOf(v) {
  if (typeof v === 'string') return /^-?\d+$/.test(v) ? v : '0';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v)).toString();
  return '0';
}

function baseEvidence(ev, extra = {}) {
  return {
    source: ev.files.target,
    method: 'read-only eth_call / eth_getBalance / eth_getCode / eth_getStorageAt',
    at: ev.target.generatedAt || null,
    block: (ev.target.blocks || {}).moonriver ?? (ev.snapshot.measured || {}).block ?? null,
    chainId: (ev.snapshot.measured || {}).chainId ?? 1285,
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * 1. Tracker noi $0, on-chain con tien?
 * ------------------------------------------------------------------ */
function deadCapital(ev) {
  const claimed = ev.snapshot?.defillama?.moonwellApollo?.currentChainTvls?.Moonriver ?? null;
  const rows = moonriverTargets(ev).filter(r => {
    const hasCash = r.calls && r.calls['getCash()'] !== undefined;
    const hasNative = r.balances && Number(r.balances.native || 0) > 0;
    return hasCash || hasNative;
  });

  const holdings = rows.map(r => {
    const human = humanCash(ev.snapshot, r.label || '');
    const raw = rawOf(r.calls && r.calls['getCash()'] !== undefined
      ? r.calls['getCash()']
      : r.balances.native);
    return {
      name: r.label,
      address: r.address,
      raw,
      method: r.calls && r.calls['getCash()'] !== undefined ? 'getCash()' : 'eth_getBalance',
      humanAmount: human ? human.amount : null,
      unit: human ? human.unit : null,
      admin: (r.calls && r.calls['admin()']) || null,
      codeBytes: r.codeBytes || 0,
    };
  });

  const withCode = holdings.filter(h => h.codeBytes > 0).length;
  const nonZero = holdings.filter(h => BigInt(h.raw) > 0n).length;
  return {
    id: 'dead_capital',
    protocol: 'Moonwell Apollo',
    chain: 'Moonriver',
    claimedUsd: claimed,
    claimedSource: ev.snapshot?.defillama?.moonwellApollo?.source || null,
    contractsHoldingValue: holdings.length,
    contractsWithCode: withCode,
    nonZeroBalances: nonZero,
    holdings,
    disagreement: claimed === 0 && nonZero > 0,
    usdConverted: false,
    noPriceReason: 'So token tho. Khong quy doi USD vi khong co gia tai block do.',
    evidence: [
      { source: ev.files.snapshot, method: 'GET /protocol/moonwell-apollo', value: claimed },
      baseEvidence(ev, { contracts: holdings.length }),
      { source: (ev.snapshot.moonwellCashHuman || {}).source || null, method: 'so token tho da doi chieu thu cong' },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 2. Chain con san xuat block khong?
 * ------------------------------------------------------------------ */
function liveness(ev, name = 'Moonriver') {
  const z = (ev.zombie.results || []).find(r => r.name === name);
  if (!z) {
    return { id: 'liveness', name, status: 'NO_EVIDENCE', evidence: [{ source: ev.files.zombie }] };
  }
  const probes = z.nextBlockProbe || [];
  const independentUrls = new Set(probes.map(p => p.url)).size;
  const independent = independentUrls >= 2;
  const allMissing = probes.length >= 2 && probes.every(p => p.exists === false);
  const frozen = z.status === 'FROZEN' && independent && allMissing;

  return {
    id: 'liveness',
    name,
    status: frozen ? 'FROZEN_AT_BLOCK' : z.status,
    interpretedAsDeath: false,
    block: z.block,
    blockTimestamp: z.blockTimestamp,
    lastBlockTime: z.lastBlockTime,
    ageDays: z.ageDays,
    independentEndpoints: independentUrls,
    nextBlockProbe: probes.map(p => ({ url: p.url, next: p.next, exists: p.exists })),
    contractsWithCode: (z.contracts || []).filter(c => c.codeBytes > 0).length,
    implication: frozen
      ? 'Khong co block moi -> khong propose/vote/execute/queue/settlement nao xay ra duoc.'
      : 'Chua du dieu kien de khang dinh FROZEN.',
    caveat: DEAD_RPC_NOTE,
    evidence: [
      { source: ev.files.zombie, method: 'eth_blockNumber + eth_getBlockByNumber(N+1)', at: ev.zombie.generatedAt },
      { source: ev.files.zombie, method: 'counts', value: ev.zombie.counts || null },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 3. Cai gia cua mot cu takeover, do bang so doc duoc
 * ------------------------------------------------------------------ */
function governance(ev) {
  const g = findResult(ev, 'target', r =>
    r.chain === 'moonriver' && /governor/i.test(r.label || '') && r.calls && r.calls['getQuorum()']);
  const t = findResult(ev, 'target', r =>
    r.chain === 'moonriver' && /timelock/i.test(r.label || '') && r.calls && r.calls['delay()']);
  const u = findResult(ev, 'target', r =>
    r.chain === 'moonriver' && /Unitroller/i.test(r.label || '') && r.calls && r.calls['admin()']);
  if (!g) return { id: 'governance', status: 'NO_EVIDENCE' };

  const c = g.calls;
  const quorumTokens = Math.round(Number(c['getQuorum()']) / E18);
  const currentQuorumTokens = Math.round(Number(c['currentQuorum()']) / E18);
  const thresholdTokens = Math.round(Number(c['proposalThreshold()']) / E18);
  const incident = (ev.snapshot.reported || {}).mipR39 || {};
  const fix = (ev.snapshot.reported || {}).mipR41 || {};
  const drift = fix.claimedQuorumTokens != null && quorumTokens !== fix.claimedQuorumTokens;

  return {
    id: 'governance',
    governor: g.address,
    govToken: c['govToken()'],
    quorumTokens,
    currentQuorumTokens,
    proposalThresholdTokens: thresholdTokens,
    votingDelaySeconds: c['votingDelay()'],
    votingPeriodSeconds: c['votingPeriod()'],
    proposalCount: c['proposalCount()'],
    timelock: c['timelock()'],
    timelockDelaySeconds: t ? t.calls['delay()'] : null,
    comptrollerAdmin: u ? u.calls['admin()'] : null,
    oracleAdmin: u ? u.calls['oracle()'] : null,
    breakGlassGuardian: c['breakGlassGuardian()'],
    guardianSunset: c['guardianSunset()'],
    guardianSunsetIso: new Date(Number(c['guardianSunset()']) * 1000).toISOString(),
    guardianSunsetMeaning:
      'Sau thoi diem nay governance CO THE go guardian qua __removeGuardians(); khong tu dong mat quyen.',
    historicalIncident: {
      name: 'MIP-R39',
      date: incident.date || null,
      costUsd: incident.costUsd ?? null,
      quorumTokensAtTime: incident.quorumTokensAtTime ?? null,
      forVotes: incident.forVotes ?? null,
      treasuryUsd: incident.treasuryUsd ?? null,
      ratioCostToTreasury: incident.ratioCostToTreasury ?? null,
      outcome: incident.outcome || null,
    },
    claimedFix: {
      name: 'MIP-R41',
      date: fix.date || null,
      claimedThresholdTokens: fix.claimedThresholdTokens ?? null,
      claimedQuorumTokens: fix.claimedQuorumTokens ?? null,
    },
    parameterDrift: drift,
    driftNote: drift
      ? 'MIP-R41 ghi nang ca threshold lan quorum len 100.000.000, nhung getQuorum()/currentQuorum() van tra ' +
        quorumTokens.toLocaleString('en-US') + '. Floating quorum tinh dong; khong ket luan nguyen nhan.'
      : 'Threshold va quorum khop voi gia tri da cong bo.',
    evidence: [
      baseEvidence(ev, { method: 'getQuorum()/currentQuorum()/proposalThreshold()/votingDelay()/votingPeriod()' }),
      { source: (incident.sources || [])[0] || null, method: 'forum + Blockful report' },
      { source: fix.source || null, method: 'monthly governance report' },
      { source: 'https://github.com/moonwell-fi/contracts-open-source', method: 'MoonwellApolloGovernor.sol / Timelock.sol' },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 4. Volume bao cao vs tien that thu
 * ------------------------------------------------------------------ */
function volumeQuality(ev) {
  const d = ev.snapshot.defillama || {};
  const r = ev.snapshot.reported || {};
  const fees = d.fees || {};
  const dexs = d.dexs || {};
  const dexFeeBps = fees.total24h && dexs.total24h
    ? (fees.total24h / dexs.total24h) * 10000 : null;
  const hyper = r.hyperliquid || {};
  const hyperFeeBps = hyper.fees30d && hyper.volume30d
    ? (hyper.fees30d / hyper.volume30d) * 10000 : null;
  const kalshi = r.kalshi || {};
  const kalshiCashRatio = kalshi.executionPriceUsdWeekly && kalshi.contractVolumeWeekly
    ? kalshi.executionPriceUsdWeekly / kalshi.contractVolumeWeekly : null;
  const x402 = r.x402 || {};
  const x402AvgUsd = x402.settlementUsd && x402.transactions
    ? x402.settlementUsd / x402.transactions : null;

  return {
    id: 'volume_quality',
    rankedBy: 'fee/volume, khong phai volume',
    rows: [
      {
        name: 'DeFi DEX (24h)',
        reported: dexs.total24h ?? null,
        reportedUnit: 'USD volume',
        settled: fees.total24h ?? null,
        settledUnit: 'USD fees',
        ratioBps: dexFeeBps,
        source: dexs.source || fees.source || null,
      },
      {
        name: 'Hyperliquid (30d)',
        reported: hyper.volume30d ?? null,
        reportedUnit: 'USD perp volume',
        settled: hyper.fees30d ?? null,
        settledUnit: 'USD fees',
        ratioBps: hyperFeeBps,
        source: hyper.source || null,
      },
      {
        name: 'Kalshi (weekly)',
        reported: kalshi.contractVolumeWeekly ?? null,
        reportedUnit: 'USD notional (contract $1 face)',
        settled: kalshi.executionPriceUsdWeekly ?? null,
        settledUnit: 'USD execution-price',
        cashRatio: kalshiCashRatio,
        shareFrom15MinMarkets: kalshi.shareFrom15MinMarkets ?? null,
        source: (kalshi.sources || [])[0] || null,
      },
      {
        name: 'x402 (cumulative)',
        reported: x402.transactions ?? null,
        reportedUnit: 'transactions',
        settled: x402.settlementUsd ?? null,
        settledUnit: 'USD settlement',
        avgSettlementPerTxUsd: x402AvgUsd,
        reportedAgentShare: [x402.agentDrivenLow ?? null, x402.agentDrivenHigh ?? null],
        agentUsdNotComputed: 'Nguon chi cho ty le, khong nhan them ra USD.',
        source: (x402.sources || [])[0] || null,
      },
    ],
    insight:
      'Cung mot thi truong, 3 lop so khac nhau: notional -> cash settlement -> fee. ' +
      'Tool xep hang o lop cuoi.',
    evidence: [
      { source: fees.source || null, method: 'GET /overview/fees' },
      { source: dexs.source || null, method: 'GET /overview/dexs' },
      { source: hyper.source || null, method: 'reported statistics' },
      { source: (kalshi.sources || [])[0] || null, method: 'reported weekly volume' },
    ],
  };
}

/* ------------------------------------------------------------------ */
function buildReport(ev) {
  const dead = deadCapital(ev);
  const live = liveness(ev);
  const gov = governance(ev);
  const vol = volumeQuality(ev);
  const disagreements = [];

  if (dead.disagreement) {
    disagreements.push({
      id: 'tracker_vs_chain',
      a: 'DefiLlama currentChainTvls.Moonriver = 0',
      b: dead.nonZeroBalances + ' contract con so du khac 0 tai block ' + live.block,
      resolution: 'Adapter ngung track (chain Deprecated), khong phai hop dong can tien.',
    });
  }
  if (gov.parameterDrift) {
    disagreements.push({
      id: 'claimed_fix_vs_chain',
      a: 'MIP-R41: quorum 100.000.000',
      b: 'getQuorum() = ' + gov.quorumTokens.toLocaleString('en-US'),
      resolution: 'Chua ket luan; floating quorum tinh dong theo participation.',
    });
  }
  const kalshi = vol.rows.find(x => x.name.startsWith('Kalshi'));
  if (kalshi && kalshi.cashRatio != null && kalshi.cashRatio < 0.5) {
    disagreements.push({
      id: 'notional_vs_cash',
      a: 'Kalshi $19,03B weekly contract volume',
      b: '$4,42B execution-price USD',
      resolution: 'Notional hop dong menh gia $1 khong phai tien da chay.',
    });
  }

  return {
    product: 'settled',
    tagline: 'Dung tin so lieu. Doi chieu bien lai.',
    headline: dead.disagreement
      ? 'Tracker bao $0, ' + dead.nonZeroBalances + ' contract van giu so du tai block ' + live.block + '.'
      : 'Khong co bat dong giua tracker va on-chain.',
    meta: {
      generatedAt: new Date().toISOString(),
      mode: 'offline evidence pack',
      noKey: true,
      noTx: true,
      noPriceAssumption: true,
      noScoring: true,
      sources: ev.files,
    },
    sections: { deadCapital: dead, liveness: live, governance: gov, volumeQuality: vol },
    disagreements,
    limits: [
      'Khong phai oracle gia, khong quy doi USD.',
      'Khong chung minh bug, khong gan nhan contract, khong xep hang rui ro.',
      'So "reported" la trich dan bao chi/forum, khong phai ket qua eth_call.',
      'FROZEN chi dung cho state doc duoc; khong khang dinh chain chet.',
    ],
  };
}

module.exports = { deadCapital, liveness, governance, volumeQuality, buildReport, DEAD_RPC_NOTE };
