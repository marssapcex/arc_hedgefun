#!/usr/bin/env python3
"""Read-only on-chain check of Opyn Convexity (v1) deployed contracts.

No keys, no tx, no fork. eth_call / eth_getCode / eth_getBalance only.
Verifies the deployed OptionsFactory, its owner/oracle/exchange, enumerates
oToken series, and measures ETH/ERC20 still sitting in expired series.

Usage: python3 scripts/rpc_opyn.py [--rpc URL] [--max-series N]
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc_probe import find_rpc, rpc, decode  # noqa: E402

FACTORY = "0xcC5d905b9c2c8C9329Eb4e25dc086369D6C7777C"
FORGOTTEN = "0xb529964f86fbf99a6aa67f72a27e59fa3fa4feac"  # forgotteneth.com/opyn-v1
EXCHANGE = "0x39246c4F3F6592C974EBC44F80bA6dC69b817c71"
ORACLE = "0x7054e08461e3eCb7718B63540adDB3c3A1746415"

VIEWS = {
    "owner()": ("8da5cb5b", "address"),
    "getNumberOfOptionsContracts()": ("857c26ff", "uint"),
    "oracleAddress()": ("a89ae4ba", "address"),
    "optionsExchange()": ("3bd33f62", "address"),
    "isOwner()": ("8f32d59b", "uint"),
    "hasExpired()": ("90e64d13", "uint"),
    "expiry()": ("e184c9be", "uint"),
    "windowSize()": ("8a14117a", "uint"),
    "collateral()": ("d8dfeb45", "address"),
    "underlying()": ("6f307dc3", "address"),
    "totalCollateral()": ("4ac8eb5f", "uint"),
    "totalUnderlying()": ("c70920bc", "uint"),
    "totalSupply()": ("18160ddd", "uint"),
    "symbol()": ("95d89b41", "string"),
    "decimals()": ("313ce567", "uint"),
    "name()": ("06fdde03", "string"),
    "COMPOUND_ORACLE()": ("b8c6a2ea", "address"),
}
SERIES_VIEW = ("eeafd00b", "address")  # optionsContracts(uint256)

TOKENS = {
    "USDC": ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    "USDT": ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    "DAI": ("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
    "WETH": ("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
    "WBTC": ("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8),
    "UNI": ("0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18),
    "DPI": ("0x1494CA1F11D487c2bBe4543E90080AeBa4BA3C2b", 18),
    "DYDX": ("0x92D6C1e31e14520e676a687F0a93788B716BEff5", 18),
}


def a32(a):
    return a.lower().replace("0x", "").rjust(64, "0")


def call(url, to, selector, kind, arg=None):
    data = "0x" + selector + (a32(arg) if arg is not None else "")
    for k in range(3):
        try:
            v = rpc(url, "eth_call", [{"to": to, "data": data}, "latest"], timeout=12)
            return decode(v, kind)
        except Exception as e:
            if "429" in str(e) or "Too Many" in str(e):
                time.sleep(0.7 * (k + 1))
                continue
            return None
    return None


def read_all(url, addr):
    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        futs = {n: ex.submit(call, url, addr, sel, kind) for n, (sel, kind) in VIEWS.items()}
        for n, f in futs.items():
            try:
                v = f.result(timeout=25)
                if v is not None:
                    out[n] = v
            except Exception:
                pass
    try:
        c = rpc(url, "eth_getCode", [addr, "latest"], timeout=12)
        out["codeBytes"] = (len(c) - 2) // 2 if isinstance(c, str) else 0
    except Exception:
        pass
    try:
        b = rpc(url, "eth_getBalance", [addr, "latest"], timeout=12)
        out["nativeWei"] = int(b, 16) if isinstance(b, str) else b
    except Exception:
        pass
    return out


def balances(url, addr):
    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futs = {s: ex.submit(call, url, tok, "70a08231", "uint", addr)
                for s, (tok, dec) in TOKENS.items()}
        for s, f in futs.items():
            try:
                v = f.result(timeout=25)
                if v:
                    out[s] = {"raw": str(v), "human": round(v / 10 ** TOKENS[s][1], 6)}
            except Exception:
                pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc")
    ap.add_argument("--max-series", type=int, default=60)
    ap.add_argument("--out", default="rpc_opyn_raw.json")
    ap.add_argument("--md", default="OPYN_ONCHAIN.md")
    a = ap.parse_args()
    url, block = find_rpc("ethereum", a.rpc)
    print(f"ethereum: {url} block={block}", flush=True)
    if not url:
        raise SystemExit("no RPC")

    doc = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "rpc": url, "block": block,
           "factory": FACTORY, "forgottenEthContract": FORGOTTEN,
           "targets": {}, "series": [], "totals": {}}

    for label, ad in (("OptionsFactory", FACTORY), ("forgotteneth Opyn v1", FORGOTTEN),
                      ("OptionsExchange", EXCHANGE), ("Compound oracle", ORACLE)):
        d = read_all(url, ad)
        d["address"] = ad
        d["balances"] = balances(url, ad)
        doc["targets"][label] = d
        print(f"{label}: {d}", flush=True)

    n = doc["targets"]["OptionsFactory"].get("getNumberOfOptionsContracts()")
    if not n:
        print("no series count", flush=True)
    else:
        n = int(n)
        idxs = list(range(min(n, a.max_series)))
        if n > a.max_series:
            idxs += list(range(n - 10, n))
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
            got = list(ex.map(lambda i: (i, call(url, FACTORY, SERIES_VIEW[0], "address", hex(i))), idxs))
        addrs = sorted({ad for i, ad in got if ad})
        print(f"{n} series, resolved {len(addrs)} addresses", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            futs = {ad: ex.submit(read_all, url, ad) for ad in addrs}
            balfuts = {ad: ex.submit(balances, url, ad) for ad in addrs}
            for ad in addrs:
                d = futs[ad].result(timeout=60)
                d["address"] = ad
                d["balances"] = balfuts[ad].result(timeout=60)
                doc["series"].append(d)
        eth = sum(s.get("nativeWei", 0) for s in doc["series"]) / 1e18
        erc = {}
        for s in doc["series"]:
            for sym, v in s.get("balances", {}).items():
                erc[sym] = erc.get(sym, 0) + v["human"]
        doc["totals"] = {"seriesProbed": len(doc["series"]), "seriesTotal": n,
                         "nativeEthOnSeries": eth, "erc20OnSeries": erc,
                         "expiredSeries": sum(1 for s in doc["series"] if s.get("hasExpired()")),
                         "seriesWithCode": sum(1 for s in doc["series"] if s.get("codeBytes"))}
        print("totals", doc["totals"], flush=True)

    json.dump(doc, open(a.out, "w"), indent=2, default=str)
    L = ["# Opyn Convexity v1 — read-only on-chain check", "",
         f"Generated {doc['generatedAt']} · block {block} · `{url}`. No tx, no fork, no key.", "",
         "| Contract | Code | Native ETH | Note |", "|---|---|---|---|"]
    for label, d in doc["targets"].items():
        L.append(f"| {label} `{d['address']}` | {d.get('codeBytes','—')}B | "
                 f"{d.get('nativeWei',0)/1e18:.6f} | owner={d.get('owner()','—')} |")
    L += ["", f"Factory `getNumberOfOptionsContracts()` = **{doc['totals'].get('seriesTotal','—')}**, "
          f"probed {doc['totals'].get('seriesProbed','—')}. "
          f"Expired: {doc['totals'].get('expiredSeries','—')}. "
          f"ETH still on oToken contracts: {doc['totals'].get('nativeEthOnSeries',0):.6f}.", "",
          "ERC20 still on oToken contracts:",
          ""]
    for s, v in sorted(doc["totals"].get("erc20OnSeries", {}).items()):
        L.append(f"- {s}: {v:,.6f}")
    L += ["", "Raw: `rpc_opyn_raw.json`.", ""]
    open(a.md, "w").write("\n".join(L))
    print(f"wrote {a.out} ({os.path.getsize(a.out)} B), {a.md}")


if __name__ == "__main__":
    main()
