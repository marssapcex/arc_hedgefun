/**
 * corpus.js — Tool A, rebuilt INSIDE the merged codebase.
 *
 * Reads the 821 real incident markdown files that now live in incidents/,
 * extracts metadata, IOC addresses/tx, vulnerability categories, and — most
 * importantly — fingerprints of the *vulnerable Solidity snippets* themselves.
 * No invented signatures: everything is derived from the reports.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { id } = require('ethers');
const { fingerprintSource } = require('./source');
const { extractSourceFunctions } = require('./functions');

const ROOT = path.join(__dirname, '..');
const INC = path.join(ROOT, 'incidents');
const ADDR = /0x[a-fA-F0-9]{40}/g;
const TX = /0x[a-fA-F0-9]{64}/g;
const CODE_BLOCK = /```([a-zA-Z]*)\s*\n([\s\S]*?)```/g;
const YEAR_FILE = /^(\d{4}-\d{2}-\d{2})_(.+)\.md$/;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'is', 'was',
  'for', 'with', 'that', 'this', 'by', 'on', 'from', 'as', 'not', 'be', 'are',
  'function', 'contract', 'uint256', 'address', 'return', 'returns', 'public',
  'external', 'internal', 'memory', 'calldata']);

function cleanCell(v) {
  return String(v || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function metadata(text) {
  const out = {};
  for (const line of text.slice(0, 6000).split('\n')) {
    const m = line.match(/^\|\s*\*\*([^*|]+)\*\*\s*\|\s*(.*?)\s*\|\s*$/);
    if (m) out[m[1].trim()] = cleanCell(m[2]);
  }
  return out;
}

function categories() {
  const map = Object.create(null);
  for (const f of fs.readdirSync(path.join(INC, 'vulns')).filter(x => x.endsWith('.md') && x !== 'README.md')) {
    const slug = f.slice(0, -3);
    const t = fs.readFileSync(path.join(INC, 'vulns', f), 'utf8');
    for (const m of t.matchAll(/\]\(\.\.\/\d{4}\/([^)]+\.md)\)/g)) {
      (map[m[1]] ||= []).push(slug);
    }
  }
  return map;
}

function snippets(text) {
  const vulnerable = [], fixed = [];
  for (const m of text.matchAll(CODE_BLOCK)) {
    const lang = m[1].toLowerCase(), body = m[2];
    if (lang && !['solidity', 'sol', 'javascript', 'js', ''].includes(lang)) continue;
    if (!/\bfunction\b|\bcontract\b|\bmsg\.|\.call\b/.test(body)) continue;
    if (/✅|Correct pattern|Fixed|fixed version/i.test(body)) fixed.push(body);
    if (/❌|Vulnerab|Root cause|On-Chain Original/i.test(body)) vulnerable.push(body);
  }
  // reports with no emoji markers: treat the first non-fixed code block as vulnerable
  if (!vulnerable.length && fixed.length) {
    const first = [...text.matchAll(CODE_BLOCK)].map(m => m[2])
      .find(b => /\bfunction\b/.test(b) && !/✅|Correct pattern/i.test(b));
    if (first) vulnerable.push(first);
  }
  return { vulnerable, fixed };
}

function chainOf(s) {
  const x = String(s || '').toLowerCase();
  if (/ethereum|mainnet|^eth$|erc20/.test(x)) return 'ethereum';
  if (/bsc|binance|bnb/.test(x)) return 'bsc';
  if (/arbitrum/.test(x)) return 'arbitrum';
  if (/optimism|^op$/.test(x)) return 'optimism';
  if (/base/.test(x)) return 'base';
  if (/polygon|matic/.test(x)) return 'polygon';
  if (/avalanche|avax/.test(x)) return 'avalanche';
  if (/fantom|ftm/.test(x)) return 'fantom';
  if (/solana|sui|starknet|move|aptos/.test(x)) return 'non-evm';
  return 'other';
}

function lossUsd(s) {
  const m = String(s || '').match(/\$?\s*([\d,]+(?:\.\d+)?)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const k = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return n > 0 ? Math.round(n * k * 100) / 100 : null;
}

function keywords(text) {
  const t = (String(text || '').toLowerCase().match(/[a-z][a-z0-9_.]{2,}/g) || [])
    .filter(w => !STOP.has(w));
  const c = Object.create(null);
  for (const w of t) c[w] = (c[w] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 30).map(e => e[0]);
}

function build() {
  const catMap = categories();
  const files = [];
  for (const y of fs.readdirSync(INC)) {
    if (!/^20\d\d$/.test(y)) continue;
    for (const f of fs.readdirSync(path.join(INC, y))) {
      if (f.endsWith('.md') && f.toLowerCase() !== 'readme.md') files.push(path.join(INC, y, f));
    }
  }
  files.sort();
  const incidents = [];
  for (const file of files) {
    const base = path.basename(file);
    const m = base.match(YEAR_FILE);
    const text = fs.readFileSync(file, 'utf8');
    const meta = metadata(text);
    const sn = snippets(text);
    const src = fingerprintSource(sn.vulnerable.join('\n\n'));
    const title = (text.match(/^#\s+(.+)$/m) || [, ''])[1];
    const grab = key => (meta[key] || '').match(ADDR) || [];
    const rec = {
      id: base.slice(0, -3),
      file: path.relative(ROOT, file),
      date: meta.Date || (m ? m[1] : ''),
      protocol: meta.Protocol || '',
      chain: chainOf(meta.Chain),
      chainRaw: meta.Chain || '',
      lossUsd: lossUsd(meta.Loss),
      rootCause: meta['Root Cause'] || '',
      title,
      categories: [...new Set(catMap[base] || [])],
      cwe: meta.CWE || '',
      pocSource: meta['PoC Source'] || '',
      vulnerableContracts: [...new Set((grab('Vulnerable Contract').concat(grab('Attack Contract'))).map(a => a.toLowerCase()))],
      attackerAddresses: [...new Set((grab('Attacker').concat(grab('Attacker EOA'))).map(a => a.toLowerCase()))],
      attackTxs: [...new Set((meta['Attack Tx'] || '').match(TX) || [])].map(t => t.toLowerCase()),
      hasMetadataTable: Object.keys(meta).length > 0,
      vulnerableSnippetCount: sn.vulnerable.length,
      fixedSnippetCount: sn.fixed.length,
      keywords: keywords(`${meta['Root Cause']} ${title} ${(catMap[base] || []).join(' ')}`),
    };
    incidents.push(rec);
  }

  // FUNCTION-LEVEL corpus: every vulnerable function becomes its own record.
  const vulnerableFunctions = [];
  for (const inc of incidents) {
    const text = fs.readFileSync(path.join(ROOT, inc.file), 'utf8');
    const sn = snippets(text);
    const fns = sn.vulnerable.flatMap(b => extractSourceFunctions(b));
    const seen = new Set();
    for (const fn of fns) {
      const key = fn.selector + ':' + fn.simhash;
      if (seen.has(key)) continue;
      seen.add(key);
      vulnerableFunctions.push({
        ...fn,
        incidentId: inc.id,
        incidentDate: inc.date,
        incidentProtocol: inc.protocol,
        incidentCategories: inc.categories,
        rootCause: (inc.rootCause || '').slice(0, 240),
        lossUsd: inc.lossUsd,
        labels: inc.categories.length ? inc.categories : ['other'],
      });
    }
    inc.vulnerableFunctionCount = fns.length;
  }
  const catCount = Object.create(null), chainCount = Object.create(null);
  let snippetCount = 0;
  const uniqueSelectors = new Set();
  for (const i of incidents) {
    for (const c of i.categories) catCount[c] = (catCount[c] || 0) + 1;
    chainCount[i.chain] = (chainCount[i.chain] || 0) + 1;
    snippetCount += i.vulnerableSnippetCount;
    for (const f of vulnerableFunctions) if (f.incidentId === i.id) uniqueSelectors.add(f.selector);
  }
  return {
    meta: {
      builtAt: new Date().toISOString(),
      sources: ['kismp123/BugChainIndexer', 'kismp123/DeFi-Security-Incident'],
      incidentCount: incidents.length,
      withMetadataTable: incidents.filter(i => i.hasMetadataTable).length,
      reportsWithVulnerableSnippets: incidents.filter(i => i.vulnerableSnippetCount > 0).length,
      uniqueSelectors: uniqueSelectors.size,
      vulnerableFunctionCount: vulnerableFunctions.length,
      incidentsWithFunctions: incidents.filter(i => i.vulnerableFunctionCount > 0).length,
      note: 'Function-level similarity corpus for labelling. Not a vulnerability oracle.',
    },
    stats: { categories: catCount, chains: chainCount, vulnerableSnippets: snippetCount },
    incidents,
    vulnerableFunctions,
  };
}

function write(corpus, out = path.join(ROOT, 'data', 'corpus.json')) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(corpus));
  return out;
}

module.exports = { build, write, metadata, snippets, chainOf, lossUsd };
