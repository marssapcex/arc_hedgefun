#!/usr/bin/env python3
"""Read-only pass 4: separate token BALANCE from actual VOTING POWER.

A hit list says "cheap mcap".  On-chain, what matters is whether the votes
needed for quorum/threshold are delegated to an address the governance path
controls.  This measures getVotes/getCurrentVotes/getPriorVotes for the
addresses found in passes 1-3.

No keys, no tx, no fork. eth_call + eth_blockNumber only.
Usage: python3 scripts/rpc_votes.py [--rpc URL]
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

# (chain, label, vote token, account, note)
PAIRS = [
    # Moonwell Apollo — the chain that closes governor -> timelock -> markets
    ("moonriver", "Moonwell governor", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1",
     "0x2BE2e230e89c59c8E20E633C524AD2De246e7370", "governor itself"),
    ("moonriver", "Moonwell timelock", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1",
     "0x04e6322D196E0E4cCBb2610dd8B8f2871E160bd7", "timelock"),
    ("moonriver", "Moonwell Unitroller", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1",
     "0x0b7a0EAA884849c6Af7a129e899536dDDcA4905E", "comptroller"),
    ("moonriver", "Moonwell oracle", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1",
     "0x892bE716Dcf0A6199677F355f45ba8CC123BAF60", "oracle"),
    ("moonriver", "Moonwell breakGlassGuardian", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1",
     "0x5ded9d1025a158554ab19540ae83182d890bb8db", "guardian"),
    ("moonriver", "Moonwell comptroller impl", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1",
     "0x8529ea4dbdca738aa928d682ea9c1382bf2ff098", "impl"),
    ("moonriver", "Moonwell MFAM token contract", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1",
     "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1", "token self"),
    # Hop
    ("ethereum", "Hop governor", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc",
     "0xed8bdb5895b8b7f9fdb3c087628fd8410e853d48", "governor"),
    ("ethereum", "Hop timelock", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc",
     "0xeea8422a08258e73c139fc32a25e10410c14bd7a", "timelock"),
    ("ethereum", "Hop bridge USDC", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc",
     "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a", "bridge"),
    # Angle
    ("ethereum", "Angle governor", "0x31429d1856aD1377A8A0079410B297e1a9e214c2",
     "0x59153e939c5b4721543251ff3049ea04c755373b", "governor"),
    ("ethereum", "Angle timelock", "0x31429d1856aD1377A8A0079410B297e1a9e214c2",
     "0x5183f032bf42109cd370b9559fd22207e432301e", "timelock"),
    ("ethereum", "Angle ANGLE token self", "0x31429d1856aD1377A8A0079410B297e1a9e214c2",
     "0x31429d1856aD1377A8A0079410B297e1a9e214c2", "token self"),
    # BiFi — voting token is GBiFi, NOT the BIFI token in the hit list
    ("ethereum", "BiFi governor", "0x22f68ae048b126ad76cd5dbc2c671603a188d6dc",
     "0x54F50d2f584F1DD05307aB5eB298Ba96C7d4E0ea", "governor"),
    ("ethereum", "BiFi timelock", "0x22f68ae048b126ad76cd5dbc2c671603a188d6dc",
     "0xe75fe5f37bd2e2613b1473f27644cf983555ffdf", "timelock"),
    ("ethereum", "BiFi owner EOA", "0x22f68ae048b126ad76cd5dbc2c671603a188d6dc",
     "0xfbb3544329679a7cc1f7644bae1b65d36bf5ce63", "owner"),
]

SELS = {
    "getVotes(address)": ("0x9ab24eb0", False),
    "getCurrentVotes(address)": ("0xb4b5ea57", False),
    "delegates(address)": ("0x587cde1e", False),
    "balanceOf(address)": ("0x70a08231", False),
    "getPriorVotes(address,block-1)": ("0x782d6fe1", True),
    "getPastVotes(address,block-1)": ("0xeb9019d4", True),
}


def a32(a):
    return a.lower().replace("0x", "").rjust(64, "0")


def u32(n):
    return hex(int(n))[2:].rjust(64, "0")


def call(url, to, data, kind="uint"):
    for k in range(3):
        try:
            v = rpc(url, "eth_call", [{"to": to, "data": data}, "latest"], timeout=15)
            return decode(v, kind)
        except Exception as e:
            if "429" in str(e) or "Too Many" in str(e):
                time.sleep(0.8 * (k + 1))
                continue
            return None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc")
    ap.add_argument("--out", default="rpc_votes_raw.json")
    a = ap.parse_args()
    chains = sorted({p[0] for p in PAIRS})
    endpoints, blocks = {}, {}
    for c in chains:
        u, b = find_rpc(c, a.rpc if c == "ethereum" else None)
        endpoints[c], blocks[c] = u, b
        print(f"{c}: {u or 'NONE'} block={b}", flush=True)
    out = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        jobs = []
        for chain, label, token, account, note in PAIRS:
            if not endpoints.get(chain):
                continue
            for name, (sel, needs_block) in SELS.items():
                data = "0x" + sel + a32(account)
                if needs_block and blocks.get(chain):
                    data += u32(blocks[chain] - 1)
                if needs_block and not blocks.get(chain):
                    continue
                jobs.append((chain, label, token, account, note, name,
                             ex.submit(call, endpoints[chain], token, data,
                                       "address" if name.startswith("delegates") else "uint")))
        vals = {}
        for chain, label, token, account, note, name, f in jobs:
            try:
                v = f.result(timeout=30)
            except Exception:
                v = None
            vals.setdefault((chain, label, token, account, note), {})[name] = v
        for (chain, label, token, account, note), v in vals.items():
            out.append({"chain": chain, "label": label, "token": token,
                        "account": account, "note": note,
                        "values": {k: x for k, x in v.items() if x is not None}})
    doc = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "method": "read-only eth_call (getVotes/getCurrentVotes/getPriorVotes/getPastVotes/balanceOf/delegates)",
           "endpoints": endpoints, "blocks": blocks, "results": out}
    json.dump(doc, open(a.out, "w"), indent=2, default=str)
    print(f"wrote {a.out} ({os.path.getsize(a.out)} B); {len(out)} rows", flush=True)
    for r in out:
        print(f"  {r['chain']:10} {r['label'][:34]:34} {r['values']}", flush=True)


if __name__ == "__main__":
    main()
