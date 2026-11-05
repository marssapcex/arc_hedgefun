"""Tool B — discover newly deployed contracts, read-only.

Inspired by kismp123/BugChainIndexer. That project discovers *active
addresses* from Transfer + Approval `eth_getLogs`, then classifies EOA vs
contract with `eth_getCode`/code hash. It does not literally scan creation
transactions. This tool supports BOTH:

  --mode creation : eth_getBlockByNumber(n, true) -> tx with `to == null`
                    -> receipt.contractAddress -> eth_getCode
  --mode events   : Transfer/Approval logs in 50-block chunks -> topic
                    addresses -> eth_getCode -> keep contracts (BugChain style)

No keys, no tx, no fork, no Postgres, no Alchemy. stdlib JSON-RPC only.
Everything is read-only; output is a local JSON catalogue.

Usage:
    python3 -m bugchain.cli index --mode creation --blocks 5 \
        --out bugchain/data/new_contracts.json
    python3 -m bugchain.cli index --fixture bugchain/data/fixture_blocks.json \
        --out bugchain/data/fixture_contracts.json
"""
import collections
import datetime
import json
import time
import urllib.request

from .keccak import code_hash

TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
DEFAULT_RPCS = [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
    "https://rpc.flashbots.net",
]


def rpc(url, method, params, timeout=20, tries=3):
    """Minimal JSON-RPC with retry. Returns result or None."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                       "params": params}).encode()
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.load(r)
            if "error" in d:
                raise RuntimeError(str(d["error"])[:120])
            return d.get("result")
        except Exception:
            if k == tries - 1:
                return None
            time.sleep(0.5 * (k + 1))
    return None


def rpc_any(urls, method, params, timeout=20):
    for u in urls:
        v = rpc(u, method, params, timeout=timeout, tries=2)
        if v is not None:
            return v, u
    return None, None


def h(n):
    return hex(n)


def extract_selectors(code_hex, window=2048):
    """Candidate 4-byte selectors = PUSH4 immediates in the dispatcher area.

    Deliberately a heuristic: PUSH4 is also used for constants. The scanner
    intersects these with selectors derived from real incident reports, which
    removes most noise. Never treat a match as proof of a bug.
    """
    raw = code_hex[2:] if code_hex.startswith("0x") else code_hex
    try:
        b = bytes.fromhex(raw)
    except ValueError:
        return []
    out = set()
    for i in range(0, min(len(b), window) - 4):
        if b[i] == 0x63:  # PUSH4
            s = "0x" + b[i + 1:i + 5].hex()
            if s != "0x00000000" and s != "0xffffffff":
                out.add(s)
    return sorted(out)


def _record(block, tx_hash, creator, address, code, source):
    body = code if code.startswith("0x") else "0x" + code
    return {
        "block": block, "txHash": tx_hash, "creator": (creator or "").lower(),
        "address": (address or "").lower(),
        "codeBytes": max(0, (len(body) - 2) // 2),
        "codeHash": code_hash(body) if len(body) > 2 else None,
        "candidateSelectors": extract_selectors(body),
        "codeSource": source,
    }


def index_creation(urls, first, last, max_contracts=200):
    contracts, errors = [], []
    stats = {"blocksScanned": 0, "txSeen": 0, "hashOnlyTx": 0,
             "creationTxSeen": 0, "receiptMissing": 0}
    for n in range(first, last + 1):
        blk, src = rpc_any(urls, "eth_getBlockByNumber", [h(n), True])
        if not isinstance(blk, dict):
            errors.append({"block": n, "reason": "block unavailable"})
            continue
        stats["blocksScanned"] += 1
        for tx in blk.get("transactions", []):
            stats["txSeen"] += 1
            if isinstance(tx, str):
                # some public endpoints ignore the `true` flag and return hashes
                stats["hashOnlyTx"] += 1
                tx, _ = rpc_any(urls, "eth_getTransactionByHash", [tx])
            if not isinstance(tx, dict) or tx.get("to") not in (None, "0x", ""):
                continue
            stats["creationTxSeen"] += 1
            if len(contracts) >= max_contracts:
                break
            rc, rsrc = rpc_any(urls, "eth_getTransactionReceipt", [tx["hash"]])
            addr = rc.get("contractAddress") if isinstance(rc, dict) else None
            if not addr:
                stats["receiptMissing"] += 1
                errors.append({"block": n, "tx": tx["hash"], "reason": "no contractAddress in receipt"})
                continue
            code, csrc = rpc_any(urls, "eth_getCode", [addr, "latest"])
            if not isinstance(code, str) or len(code) <= 2:
                errors.append({"block": n, "address": addr, "reason": "no runtime code"})
                continue
            contracts.append(_record(n, tx["hash"], tx.get("from"), addr, code, csrc))
        if len(contracts) >= max_contracts:
            break
    return contracts, errors, stats


def index_events(urls, first, last, max_contracts=200):
    """BugChainIndexer-style discovery from Transfer + Approval logs."""
    seen, contracts, errors = set(), [], []
    stats = {"chunks": 0, "logsSeen": 0, "addressesSeen": 0}
    for lo in range(first, last + 1, 50):
        hi = min(lo + 49, last)
        flt = {"fromBlock": h(lo), "toBlock": h(hi), "topics": [[TRANSFER, APPROVAL]]}
        stats["chunks"] += 1
        logs, src = rpc_any(urls, "eth_getLogs", [flt])
        if not isinstance(logs, list):
            errors.append({"range": [lo, hi], "reason": "eth_getLogs unavailable (public RPC limits)"})
            continue
        stats["logsSeen"] += len(logs)
        addrs = set()
        for lg in logs:
            for t in (lg.get("topics") or [])[1:3]:
                if len(t) >= 42:
                    addrs.add("0x" + t[-40:].lower())
        stats["addressesSeen"] += len(addrs)
        for a in sorted(addrs):
            if a in seen or len(contracts) >= max_contracts:
                continue
            seen.add(a)
            code, csrc = rpc_any(urls, "eth_getCode", [a, "latest"])
            if isinstance(code, str) and len(code) > 2:
                contracts.append(_record(hi, None, None, a, code, csrc))
        if len(contracts) >= max_contracts:
            break
    return contracts, errors, stats


def cluster_by_code(contracts):
    g = collections.defaultdict(list)
    for c in contracts:
        if c["codeHash"]:
            g[c["codeHash"]].append(c["address"])
    return [{"codeHash": k, "count": len(v), "addresses": sorted(set(v))}
            for k, v in sorted(g.items(), key=lambda kv: -len(kv[1])) if len(set(v)) > 1]


def run(rpc_urls=None, mode="creation", blocks=5, first=None, last=None,
        fixture=None, max_contracts=200, out="bugchain/data/new_contracts.json"):
    urls = rpc_urls or DEFAULT_RPCS
    if fixture:
        with open(fixture) as f:
            data = json.load(f)
        contracts = [_record(c["block"], c.get("txHash"), c.get("creator"),
                             c["address"], c["code"], "fixture")
                     for c in data["contracts"]]
        errors, stats, meta_mode, first, last = [], {}, "fixture", data.get("first"), data.get("last")
    else:
        head, head_src = rpc_any(urls, "eth_blockNumber", [])
        if not head:
            raise SystemExit("no RPC reachable")
        head_n = int(head, 16)
        last = last if last is not None else head_n
        first = first if first is not None else max(0, last - blocks + 1)
        if mode == "creation":
            contracts, errors, stats = index_creation(urls, first, last, max_contracts)
        elif mode == "events":
            contracts, errors, stats = index_events(urls, first, last, max_contracts)
        else:
            raise SystemExit("mode must be creation|events")
        meta_mode = mode
    doc = {
        "meta": {
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "mode": meta_mode, "fromBlock": first, "toBlock": last,
            "rpc": urls[0] if not fixture else "fixture",
            "contractCount": len(contracts),
            "note": "Newly observed contracts / candidate selectors. Discovery only, no vulnerability claim.",
        },
        "stats": stats,
        "clusters": cluster_by_code(contracts),
        "errors": errors,
        "contracts": contracts,
    }
    with open(out, "w") as f:
        json.dump(doc, f, indent=1)
    return doc
