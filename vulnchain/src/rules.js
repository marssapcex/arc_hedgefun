/**
 * rules.js — small, explainable static rules derived from the incident
 * categories. Deliberately NOT a vulnerability proof: each hit is just a
 * reason to put a contract higher on the review list, and every hit carries
 * its own explanation string.
 */
'use strict';

const RULES = [
  {
    category: 'reentrancy',
    bytecode: f => f.call && f.callBeforeSstore,
    source: s => s.externalCallWithValue && !s.reentrancyGuard,
    why: 'external CALL occurs before the first SSTORE and no reentrancy guard token in source'
  },
  {
    category: 'access-control',
    bytecode: f => f.unprotectedInitialize,
    source: s => s.unprotectedInitialize,
    why: 'initialize() selector present with no initializer guard'
  },
  {
    category: 'arbitrary-call',
    bytecode: f => f.delegatecall && f.calldatacopy,
    source: s => s.delegateCallUserInput,
    why: 'DELEGATECALL combined with caller-supplied calldata'
  },
  {
    category: 'proxy-storage',
    bytecode: f => f.proxyish,
    source: s => s.delegateCallUserInput && s.unprotectedInitialize,
    why: 'EIP-1967 implementation slot + DELEGATECALL (proxy layout)'
  },
  {
    category: 'oracle-price-manipulation',
    bytecode: f => f.staticcall && f.call,
    source: s => s.spotPrice && !s.reentrancyGuard,
    why: 'spot reserve/balanceOf read combined with an external call'
  },
  {
    category: 'approval-abuse',
    bytecode: () => false,
    source: s => s.unlimitedApprove,
    why: 'unlimited approve pattern in source'
  },
  {
    category: 'business-logic',
    bytecode: () => false,
    source: s => s.msgValueInLoop,
    why: 'msg.value reused inside a loop (double-spend of the same ETH)'
  },
  {
    category: 'self-balance-exploit',
    bytecode: () => false,
    source: s => s.selfTransfer,
    why: 'from == to branch that can double-count a balance'
  },
  {
    category: 'create2-exploit',
    bytecode: f => f.create2 && f.selfdestruct,
    source: () => false,
    why: 'CREATE2 + SELFDESTRUCT in the same runtime (address reuse)'
  }
];

function evaluateRules(bytecodeFp, sourceFp) {
  const bf = bytecodeFp ? bytecodeFp.flags : {};
  const sf = sourceFp ? sourceFp.flags : {};
  const hits = [];
  for (const r of RULES) {
    let from = null;
    try {
      if (sourceFp && r.source(sf)) from = 'source';
      else if (bytecodeFp && r.bytecode(bf)) from = 'bytecode';
    } catch (_) { /* rule not applicable */ }
    if (from) hits.push({ category: r.category, from, why: r.why });
  }
  // de-duplicate by category
  return [...new Map(hits.map(h => [h.category, h])).values()];
}

module.exports = { RULES, evaluateRules };
