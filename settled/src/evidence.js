'use strict';

/**
 * Evidence loader. Khong goi mang, khong can key.
 * Doc cac file JSON do chinh repo tu do bang RPC read-only, cong snapshot
 * DefiLlama da capture. Moi fact trong report deu truy ve duoc file + method.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HERE = path.resolve(__dirname, '..');

function readJson(file, fallback = null) {
  try {
    // JSON.parse ep so nguyen lon thanh double -> mat chinh xac (getCash,
    // native balance wei). Boc cac integer >=16 chu so thanh string TRUOC
    // khi parse de giu nguyen bien lai. So thap phan / so nho khong doi.
    const text = fs.readFileSync(file, 'utf8')
      .replace(/:\s*(-?\d{16,})(?=\s*[,}\]])/g, ': "$1"');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function loadEvidence(root = ROOT) {
  return {
    root,
    probe: readJson(path.join(root, 'rpc_probe_raw.json'), {}),
    target: readJson(path.join(root, 'rpc_target_raw.json'), {}),
    votes: readJson(path.join(root, 'rpc_votes_raw.json'), {}),
    follow: readJson(path.join(root, 'rpc_follow_raw.json'), {}),
    zombie: readJson(path.join(root, 'rpc_zombie_raw.json'), {}),
    snapshot: readJson(path.join(HERE, 'data', 'snapshot.json'), {}),
    files: {
      probe: 'rpc_probe_raw.json',
      target: 'rpc_target_raw.json',
      votes: 'rpc_votes_raw.json',
      follow: 'rpc_follow_raw.json',
      zombie: 'rpc_zombie_raw.json',
      snapshot: 'settled/data/snapshot.json',
    },
  };
}

function results(ev, key) {
  const d = ev[key];
  return Array.isArray(d && d.results) ? d.results : [];
}

function findResult(ev, key, predicate) {
  return results(ev, key).find(predicate) || null;
}

function moonriverTargets(ev) {
  return results(ev, 'target').filter(r => r.chain === 'moonriver');
}

function humanCash(snapshot, name) {
  const rows = (snapshot.moonwellCashHuman && snapshot.moonwellCashHuman.rows) || [];
  return rows.find(r => name.toLowerCase().includes(r.match.toLowerCase())) || null;
}

module.exports = { ROOT, HERE, loadEvidence, results, findResult, moonriverTargets, humanCash, readJson };
