#!/usr/bin/env python3
"""Read-only zombie-chain census over public RPCs.

For every chain DefiLlama reports at chainTvl <= $5m (scripts/zombie_data.json),
actually call eth_chainId / eth_blockNumber / eth_getBlockByNumber('latest')
and measure how old the last block is.  Then, on chains that answer, read
eth_getCode + eth_getBalance for known deployed contract addresses.

A "Deprecated / TVL=0" label in DefiLlama is an adapter state, not proof the
chain is dead.  This script distinguishes:
  DEAD_RPC        no public endpoint answers
  FROZEN          last block older than 30 days (real zombie)
  STALLED         last block 1h .. 30 days old
  LIVE            last block < 1h old, chain still producing blocks
  CHAINID_MISMATCH endpoint answers but reports a different chain

No keys, no tx, no fork. eth_call-free except eth_getCode/getBalance.
Usage: python3 scripts/rpc_zombie.py [--workers N] [--out rpc_zombie_raw.json --md ZOMBIE_CHAINS.md]
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc_probe import rpc  # noqa: E402

NOW = datetime.datetime.now(datetime.timezone.utc)
NOW_TS = int(NOW.timestamp())
HOUR = 3600
# endpoints known to answer for a DIFFERENT network than the chainlist entry
BAD_ENDPOINTS = (
    "mainnet.base.org", "rpc-gel.inkonchain.com", "rpc.mainnet.arc.io",
    "testnet.zkevm.cronos.org", "rpc-testnet.bitkubchain.io",
    "devnet.adilchain-rpc.io", "public-zigchain-testnet",
    "rpc.mayachain.io", "rpc.hydradx.cloud",
)
DAY = 86400


def try_endpoint(url, expected_id, timeout=5):
    """Return dict with chainId, blockNumber, blockTimestamp, ageSeconds, error."""
    r = {"url": url, "chainId": None, "block": None, "blockTimestamp": None,
         "ageSeconds": None, "error": None, "chainIdMatches": None}
    try:
        cid = rpc(url, "eth_chainId", [], timeout=timeout)
        if cid is None:
            cid = rpc(url, "net_version", [], timeout=timeout)
            if cid is not None and not str(cid).startswith("0x"):
                cid = hex(int(str(cid)))
        r["chainId"] = int(cid, 16) if isinstance(cid, str) else cid
    except Exception as e:
        r["error"] = f"chainId: {str(e)[:100]}"
        return r
    if expected_id and r["chainId"] != int(expected_id):
        r["chainIdMatches"] = False
        return r
    r["chainIdMatches"] = True
    try:
        bn = rpc(url, "eth_blockNumber", [], timeout=timeout)
        r["block"] = int(bn, 16) if isinstance(bn, str) else bn
    except Exception as e:
        r["error"] = f"blockNumber: {str(e)[:100]}"
        return r
    try:
        blk = rpc(url, "eth_getBlockByNumber", ["latest", False], timeout=timeout)
        if isinstance(blk, dict) and blk.get("timestamp"):
            ts = int(blk["timestamp"], 16) if str(blk["timestamp"]).startswith("0x") else int(blk["timestamp"])
            r["blockTimestamp"] = ts
            r["ageSeconds"] = int(time.time()) - ts
    except Exception as e:
        r["error"] = f"getBlock: {str(e)[:100]}"
    return r


def probe_chain(entry, workers):
    name = entry["name"]
    out = {"name": name, "chainTvl": entry["chainTvl"],
           "protocolCount": entry["protocolCount"], "chainlistName": entry["chainlistName"],
           "expectedChainId": entry["chainId"], "native": entry.get("native"),
           "addresses": entry.get("addresses", []), "attempts": [], "endpoint": None,
           "status": None, "contracts": []}
    valid = []
    for url in entry["rpcs"][:5]:
        a = try_endpoint(url, entry["chainId"])
        a["suspect"] = any(w in url.lower() for w in ("testnet", "devnet", "sepolia", "goerli")) \
            or any(b in url for b in BAD_ENDPOINTS)
        out["attempts"].append(a)
        if a["blockTimestamp"] is not None and a["chainIdMatches"] and not a["suspect"]:
            valid.append(a)
    if not valid:
        mism = [a for a in out["attempts"] if a["chainIdMatches"] is False]
        susp = [a for a in out["attempts"] if a["suspect"]]
        if mism:
            out["status"] = "CHAINID_MISMATCH"
        elif susp:
            out["status"] = "SUSPECT_RPC"
        else:
            out["status"] = "DEAD_RPC"
        return out
    ep = min(valid, key=lambda a: a["ageSeconds"] if a["ageSeconds"] is not None else 10**12)
    out["endpoint"] = ep["url"]
    age = ep["ageSeconds"]
    out["block"] = ep["block"]
    out["blockTimestamp"] = ep["blockTimestamp"]
    out["ageSeconds"] = age
    out["ageDays"] = round(age / DAY, 2) if age is not None else None
    out["lastBlockTime"] = datetime.datetime.fromtimestamp(ep["blockTimestamp"], datetime.timezone.utc).isoformat()
    if age < -300:
        out["status"] = "CLOCK_SKEW"
    elif age <= HOUR:
        out["status"] = "LIVE"
    elif age <= 30 * DAY:
        out["status"] = "STALLED"
    else:
        out["status"] = "FROZEN"
    # FROZEN proof: ask explicitly for block N+1 on every endpoint that answered
    if out["status"] == "FROZEN":
        out["nextBlockProbe"] = []
        for a in out["attempts"]:
            if a.get("block") is None or a.get("error"):
                continue
            try:
                nxt = rpc(a["url"], "eth_getBlockByNumber", [hex(a["block"] + 1), False], timeout=6)
                out["nextBlockProbe"].append({"url": a["url"], "next": a["block"] + 1,
                                              "exists": isinstance(nxt, dict) and bool(nxt)})
            except Exception as e:
                out["nextBlockProbe"].append({"url": a["url"], "next": a["block"] + 1,
                                              "error": str(e)[:80]})
    # contracts: code + native balance, only on answering chains
    url = out["endpoint"]
    for ad in entry.get("addresses", [])[:10]:
        c = {"address": ad, "codeBytes": None, "nativeWei": None}
        try:
            code = rpc(url, "eth_getCode", [ad, "latest"], timeout=6)
            c["codeBytes"] = (len(code) - 2) // 2 if isinstance(code, str) else 0
        except Exception as e:
            c["error"] = str(e)[:80]
        try:
            b = rpc(url, "eth_getBalance", [ad, "latest"], timeout=6)
            c["nativeWei"] = int(b, 16) if isinstance(b, str) else b
        except Exception as e:
            c["balanceError"] = str(e)[:80]
        out["contracts"].append(c)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="scripts/zombie_data.json")
    ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--limit", type=int, default=0, help="only first N chains (debug)")
    ap.add_argument("--out", default="rpc_zombie_raw.json")
    ap.add_argument("--md", default="ZOMBIE_CHAINS.md")
    a = ap.parse_args()
    doc = json.load(open(a.data))
    chains = doc["chains"]
    if a.limit:
        chains = chains[:a.limit]
    print(f"probing {len(chains)} chains, now={NOW.isoformat()}", flush=True)
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as ex:
        results = list(ex.map(lambda e: probe_chain(e, a.workers), chains))
    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(f"done in {time.time()-t0:.1f}s: {counts}", flush=True)
    payload = {"generatedAt": NOW.isoformat(), "source": doc["source"], "criterion": doc["criterion"],
               "nonEvmOrUnmapped": doc["nonEvmOrUnmapped"], "totalChainsInSnapshot": 335,
               "evmMapped": len(results), "counts": counts, "results": results}
    json.dump(payload, open(a.out, "w"), indent=2, default=str)
    L = ["# Zombie-chain RPC census", "",
         f"Generated `{NOW.isoformat()}`. Read-only `eth_chainId` / `eth_blockNumber` / "
         "`eth_getBlockByNumber` / `eth_getCode` / `eth_getBalance`. No tx, no fork, no key.", "",
         f"Universe: 335 chains with DefiLlama `chainTvl <= $5m`; "
         f"{doc['nonEvmOrUnmapped']} non-EVM/unmapped skipped; **{len(results)} EVM chains actually probed**.", "",
         "| Status | Count | Meaning |", "|---|---|---|",
         "| LIVE | %d | last block < 1h |" % counts.get("LIVE", 0),
         "| STALLED | %d | last block 1h..30d |" % counts.get("STALLED", 0),
         "| FROZEN | %d | last block > 30d (zombie thật) |" % counts.get("FROZEN", 0),
         "| DEAD_RPC | %d | không endpoint nào trả lời |" % counts.get("DEAD_RPC", 0),
         "| CHAINID_MISMATCH | %d | endpoint trả chain khác |" % counts.get("CHAINID_MISMATCH", 0),
         "| SUSPECT_RPC | %d | chỉ có endpoint testnet/sai mạng, loại |" % counts.get("SUSPECT_RPC", 0),
         "| CLOCK_SKEW | %d | block timestamp lệch > 5 phút |" % counts.get("CLOCK_SKEW", 0),
         "", "## FROZEN / DEAD_RPC (chain chết thật)", "",
         "| Chain | DefiLlama TVL | Status | Block cuối | Tuổi | RPC |", "|---|---|---|---|---|---|"]
    for r in sorted(results, key=lambda x: (x["status"] != "FROZEN", x["status"] != "DEAD_RPC", -(x.get("ageDays") or 0))):
        if r["status"] in ("FROZEN", "DEAD_RPC", "CHAINID_MISMATCH", "SUSPECT_RPC", "CLOCK_SKEW"):
            L.append(f"| {r['name']} | ${r['chainTvl']:,.0f} | {r['status']} | "
                     f"{r.get('lastBlockTime','—')[:19]} | {r.get('ageDays','—')}d | {r['endpoint'] or '—'} |")
    L += ["", "## LIVE nhưng DefiLlama báo TVL thấp / 0", "",
          "| Chain | DefiLlama TVL | Block | Tuổi | Contract còn code | Native trên contract |",
          "|---|---|---|---|---|---|"]
    for r in sorted(results, key=lambda x: x.get("ageDays") or 999):
        if r["status"] != "LIVE":
            continue
        codes = sum(1 for c in r["contracts"] if (c.get("codeBytes") or 0) > 0)
        nat = sum((c.get("nativeWei") or 0) for c in r["contracts"]) / 1e18
        L.append(f"| {r['name']} | ${r['chainTvl']:,.0f} | {r.get('block','—')} | "
                 f"{r.get('ageDays','—')}d | {codes}/{len(r['contracts'])} | {nat:.4f} |")
    L += ["", "Raw: `rpc_zombie_raw.json`.", ""]
    open(a.md, "w").write("\n".join(L))
    print(f"wrote {a.out} ({os.path.getsize(a.out)} B), {a.md} ({os.path.getsize(a.md)} B)")


if __name__ == "__main__":
    main()
