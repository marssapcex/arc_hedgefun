'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadEvidence } = require('./evidence');
const { buildReport } = require('./analyze');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

function usd(n) {
  if (n == null) return 'n/a';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function num(n, digits = 2) {
  return n == null ? 'n/a' : Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function reported(r) {
  if (r.reportedUnit === 'transactions') return num(r.reported / 1e6, 1) + 'M tx';
  return usd(r.reported);
}

function rule(char = '─', n = 74) { return char.repeat(n); }

function printReport(rep) {
  const s = rep.sections;
  const d = s.deadCapital, l = s.liveness, g = s.governance, v = s.volumeQuality;

  console.log(rule('═'));
  console.log('  SETTLED — ' + rep.tagline);
  console.log('  ' + rep.meta.mode + ' · NO KEY · NO TX · NO USD CONVERSION · NO SCORING');
  console.log(rule('═'));
  console.log('  ' + rep.headline);
  console.log('');

  console.log('  [1] TRACKER vs ON-CHAIN');
  console.log('  DefiLlama currentChainTvls.Moonriver : ' + usd(d.claimedUsd));
  console.log('  Contract con code                   : ' + d.contractsWithCode + '/' + d.contractsHoldingValue);
  console.log('  So du khac 0                        : ' + d.nonZeroBalances);
  console.log('  ' + rule('·', 70));
  console.log('  ' + 'CONTRACT'.padEnd(38) + 'HUMAN'.padEnd(18) + 'RAW (wei/unit)');
  for (const h of d.holdings) {
    const human = h.humanAmount == null ? 'n/a' : num(h.humanAmount, 4) + ' ' + h.unit;
    console.log('  ' + String(h.name).slice(0, 37).padEnd(38) + human.slice(0, 17).padEnd(18) + h.raw);
  }
  console.log('');

  console.log('  [2] LIVENESS');
  console.log('  Status            : ' + l.status + '  (khong khang dinh chain chet)');
  console.log('  Block             : ' + num(l.block, 0) + '  ·  ' + (l.lastBlockTime || 'n/a'));
  console.log('  Endpoint doc lap  : ' + l.independentEndpoints + '  ·  N+1 = null ca 2');
  console.log('  ' + l.implication);
  console.log('');

  console.log('  [3] GOVERNANCE — gia cua mot cu takeover');
  console.log('  Governor               : ' + g.governor);
  console.log('  Quorum / Threshold     : ' + num(g.quorumTokens, 0) + ' / ' + num(g.proposalThresholdTokens, 0) + ' MFAM');
  console.log('  votingDelay / Period   : ' + g.votingDelaySeconds + 's / ' + g.votingPeriodSeconds + 's');
  console.log('  Timelock delay         : ' + g.timelockDelaySeconds + 's');
  console.log('  MIP-R39                : ' + usd(g.historicalIncident.costUsd) + ' mua phieu → ' +
    usd(g.historicalIncident.treasuryUsd) + ' tai san (1:' + g.historicalIncident.ratioCostToTreasury + ')');
  console.log('  Parameter drift        : ' + (g.parameterDrift ? 'CO' : 'KHONG'));
  console.log('');

  console.log('  [4] VOLUME BAO CAO vs TIEN THAT THU  (xep theo fee/volume)');
  console.log('  ' + 'NGUON'.padEnd(24) + 'REPORTED'.padEnd(16) + 'SETTLED'.padEnd(16) + 'RATIO');
  for (const r of v.rows) {
    const ratio = r.ratioBps != null ? num(r.ratioBps, 2) + ' bps'
      : r.cashRatio != null ? num(r.cashRatio * 100, 1) + '% cash'
        : num(r.avgSettlementPerTxUsd, 4) + ' USD/tx';
    console.log('  ' + r.name.slice(0, 23).padEnd(24) + reported(r).padEnd(16) + usd(r.settled).padEnd(16) + ratio);
  }
  console.log('');

  console.log('  [5] BAT DONG (' + rep.disagreements.length + ')');
  for (const x of rep.disagreements) {
    console.log('  • ' + x.id);
    console.log('    A: ' + x.a);
    console.log('    B: ' + x.b);
    console.log('    → ' + x.resolution);
  }
  console.log('');
  console.log('  GIOI HAN');
  for (const x of rep.limits) console.log('  - ' + x);
  console.log(rule('═'));
}

function serve(port) {
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api/report') {
      const body = JSON.stringify(buildReport(loadEvidence()), null, 2);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(body);
    }
    if (url === '/' || url === '/index.html') {
      try {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      } catch {
        res.writeHead(404); return res.end('public/index.html missing');
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  });
  server.listen(port, '0.0.0.0', () => {
    console.log('SETTLED dashboard: http://0.0.0.0:' + port + '  (api: /api/report)');
  });
}

function main() {
  const args = process.argv.slice(2);
  const ev = loadEvidence();
  const rep = buildReport(ev);

  const outIdx = args.indexOf('--out');
  if (outIdx >= 0 && args[outIdx + 1]) {
    fs.writeFileSync(args[outIdx + 1], JSON.stringify(rep, null, 2));
    console.log('wrote ' + args[outIdx + 1]);
    return;
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(rep, null, 2));
    return;
  }
  if (args[0] === 'serve') {
    const portIdx = args.indexOf('--port');
    const port = Number(portIdx >= 0 ? args[portIdx + 1] : (process.env.PORT || 3000));
    return serve(port);
  }
  printReport(rep);
}

main();
