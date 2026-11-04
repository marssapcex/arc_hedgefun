#!/usr/bin/env python3
"""Read-only pass 3: measure the money behind the verified ownership chains.

No keys, no tx, no fork. eth_call / eth_getCode / eth_getBalance /
eth_getStorageAt only.  Follows addresses returned by pass 1+2 and the
protocol's own deployed-address config.

Usage: python3 scripts/rpc_target.py [--rpc URL] [--workers N]
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

PROPOSER_ROLE = "b09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1"
EXECUTOR_ROLE = "d8aa0f3194971a2a116679f7c2090f6939c8d13fec43cfd25c078a9c61c3ad4c8f8f"
CANCELLER_ROLE = "fd643c72710c63c0180259aba6b8d054680e36a4461fa03b7372cf215b10b9f8e0a8"
ADMIN_ROLE = "00" * 32

ZERO = {
    "owner()": ("0x8da5cb5b", "address"),
    "admin()": ("0xf851a440", "address"),
    "pendingAdmin()": ("0x26782247", "address"),
    "getMinDelay()": ("0xf27a0c92", "uint"),
    "delay()": ("0x6a42b8f8", "uint"),
    "getOwners()": ("0xa0e67e2b", "raw"),
    "getThreshold()": ("0xe75235b8", "uint"),
    "getQuorum()": ("0xc26c12eb", "uint"),
    "currentQuorum()": ("0xbb3da091", "uint"),
    "breakGlassGuardian()": ("0x0fbc82b8", "address"),
    "guardianSunset()": ("0xc5f62ca2", "uint"),
    "govToken()": ("0x05268cff", "address"),
    "proposalCount()": ("0xda35c664", "uint"),
    "proposalThreshold()": ("0xb58131b0", "uint"),
    "quorumVotes()": ("0x24bc1a64", "uint"),
    "votingDelay()": ("0x3932abb1", "uint"),
    "votingPeriod()": ("0x02a251a3", "uint"),
    "timelock()": ("0xd33219b4", "address"),
    "token()": ("0xfc0c546a", "address"),
    "oracle()": ("0x7dc0d1d0", "address"),
    "getPriceOracle()": ("0xfca513a8", "address"),
    "implementation()": ("0x5c60da1b", "address"),
    "getCash()": ("0x3b1d21a2", "uint"),
    "totalBorrows()": ("0x47bd3718", "uint"),
    "totalReserves()": ("0x8f840ddd", "uint"),
    "underlying()": ("0x6f307dc3", "address"),
    "totalSupply()": ("0x18160ddd", "uint"),
    "decimals()": ("0x313ce567", "uint"),
    "symbol()": ("0x95d89b41", "string"),
    "paused()": ("0x5c975abb", "uint"),
    "PROPOSER_ROLE()": ("0x8f61f4f5", "bytes32"),
    "EXECUTOR_ROLE()": ("0x07bd0265", "bytes32"),
    "getRoleMemberCount(PROPOSER_ROLE)": ("0xca15c873" + PROPOSER_ROLE, "uint"),
    "getRoleMemberCount(EXECUTOR_ROLE)": ("0xca15c873" + EXECUTOR_ROLE, "uint"),
    "getRoleMemberCount(CANCELLER_ROLE)": ("0xca15c873" + CANCELLER_ROLE, "uint"),
    "getRoleMemberCount(ADMIN_ROLE)": ("0xca15c873" + ADMIN_ROLE, "uint"),
    "getRoleMember(PROPOSER_ROLE,0)": ("0x9010d07c" + PROPOSER_ROLE + "0" * 64, "address"),
    "getRoleMember(EXECUTOR_ROLE,0)": ("0x9010d07c" + EXECUTOR_ROLE + "0" * 64, "address"),
}

# Moonwell Apollo markets, from moonwell-fi/moonwell.js src/environments/moonriver.ts
MARKETS = [
    ("MOVR", "0x6a1A771C7826596652daDC9145fEAaE62b1cd07f", None, 18),
    ("xcKSM", "0xa0D116513Bd0B8f3F14e6Ea41556c6Ec34688e0f",
     "0xffffffff1fcacbd218edc0eba20fc2308c778080", 12),
    ("FRAX", "0x93Ef8B7c6171BaB1C0A51092B2c9da8dc2ba0e9D",
     "0x1A93B23281CC1CDE4C4741353F3064709A16197d", 18),
    ("BTC.multi", "0x6E745367F4Ad2b3da7339aee65dC85d416614D90",
     "0x6aB6d61428fde76768D7b45D8BFeec19c6eF91A8", 8),
    ("USDC.multi", "0xd0670AEe3698F66e2D4dAf071EB9c690d978BFA8",
     "0xE3F5a90F9cb311505cd691a46596599aA1A0AD7D", 6),
    ("ETH.multi", "0x6503D905338e2ebB550c9eC39Ced525b612E77aE",
     "0x639A647fbe20b6c8ac19E48E2de44ea792c62c5C", 18),
    ("USDT.multi", "0x36918B66F9A3eC7a59d0007D8458DB17bDffBF21",
     "0xB44a9B6905aF7c801311e8F4E76932ee959c663C", 6),
]

TARGETS = [
    ("moonriver", "Moonwell Apollo governor", "0x2BE2e230e89c59c8E20E633C524AD2De246e7370", None),
    ("moonriver", "Moonwell Apollo timelock", "0x04e6322D196E0E4cCBb2610dd8B8f2871E160bd7", None),
    ("moonriver", "Moonwell Apollo Unitroller", "0x0b7a0EAA884849c6Af7a129e899536dDDcA4905E", None),
    ("moonriver", "Moonwell Apollo oracle", "0x892bE716Dcf0A6199677F355f45ba8CC123BAF60", None),
    ("moonriver", "MFAM token", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1", None),
    ("moonriver", "Moonwell comptroller impl", "0x8529ea4dbdca738aa928d682ea9c1382bf2ff098", None),
    ("ethereum", "Hop timelock", "0xeea8422a08258e73c139fc32a25e10410c14bd7a",
     "0xed8bdb5895b8b7f9fdb3c087628fd8410e853d48"),
    ("ethereum", "Hop governor", "0xed8bdb5895b8b7f9fdb3c087628fd8410e853d48", None),
    ("ethereum", "HOP token", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc", None),
    ("ethereum", "Hop L1 bridge USDC", "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a", None),
    ("ethereum", "Hop L1 bridge DAI", "0x3d4Cc8A61c7528Fd86C55cfe061a78dCBA48EDd1", None),
    ("ethereum", "Hop L1 bridge ETH", "0x3E4a3a4796d16c0Cd582C382691998f7c06420B6", None),
    ("ethereum", "Angle timelock", "0x5183f032bf42109cd370b9559fd22207e432301e",
     "0x59153e939c5b4721543251ff3049ea04c755373b"),
    ("ethereum", "Angle governor", "0x59153e939c5b4721543251ff3049ea04c755373b", None),
    ("ethereum", "ANGLE token", "0x31429d1856aD1377A8A0079410B297e1a9e214c2", None),
    ("ethereum", "Flux timelock", "0x2c5898da4df1d45eab2b7b192a361c3b9eb18d9c", None),
    ("ethereum", "Flux governor", "0x336505EC1BcC1A020EeDe459f57581725D23465A", None),
    ("ethereum", "BiFi timelock", "0xe75fe5f37bd2e2613b1473f27644cf983555ffdf",
     "0x54F50d2f584F1DD05307aB5eB298Ba96C7d4E0ea"),
    ("ethereum", "BiFi governor", "0x54F50d2f584F1DD05307aB5eB298Ba96C7d4E0ea", None),
    ("ethereum", "GBiFi vote token", "0x22f68ae048b126ad76cd5dbc2c671603a188d6dc", None),
    ("ethereum", "Concentrator multisig", "0xA0FB1b11ccA5871fb0225B64308e249B97804E99", None),
    ("ethereum", "Concentrator ProxyAdmin", "0x12b1326459d72F2Ab081116bf27ca46cD97762A0", None),
]
for sym, mtoken, underlying, dec in MARKETS:
    TARGETS.append(("moonriver", f"Moonwell market {sym} ({mtoken[:10]})", mtoken, None))

ERC20 = {
    "USDC": ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    "USDT": ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    "DAI": ("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
    "HOP": ("0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc", 18),
    "ANGLE": ("0x31429d1856aD1377A8A0079410B297e1a9e214c2", 18),
    "CRV": ("0xD533a949740bb3306d119CC777fa900bA034cd52", 18),
    "CVX": ("0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B", 18),
    "cvxCRV": ("0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7", 18),
}


def a32(a):
    return a.lower().replace("0x", "").rjust(64, "0")


def u32(n):
    return hex(int(n))[2:].rjust(64, "0")


def call(url, to, data, kind):
    for k in range(3):
        try:
            v = rpc(url, "eth_call", [{"to": to, "data": data}, "latest"], timeout=15)
            if kind == "raw":
                return v if v and v != "0x" else None
            return decode(v, kind)
        except Exception as e:
            if "429" in str(e) or "Too Many" in str(e):
                time.sleep(0.8 * (k + 1))
                continue
            return None
    return None


def has_role(url, c, role, who):
    return call(url, c, "0x91d14854" + role + a32(who), "uint")


def votes(url, token, who, block):
    for sel in ("0x782d6fe1", "0xeb9019d4", "0x9ab24eb0"):
        if sel == "0x9ab24eb0":
            data = sel + a32(who)
        else:
            data = sel + a32(who) + u32(block)
        v = call(url, token, data, "uint")
        if v:
            return sel, v
    return None, None


def balance(url, token, holder):
    return call(url, token, "0x70a08231" + a32(holder), "uint")


def decode_owners(raw):
    """Decode address[] from ABI-encoded return."""
    if not raw or not isinstance(raw, str):
        return None
    h = raw[2:] if raw.startswith("0x") else raw
    try:
        n = int(h[64:128], 16)
        if n <= 0 or n > 50:
            return None
        return ["0x" + h[128 + i * 64:128 + i * 64 + 64][-40:] for i in range(n)]
    except Exception:
        return None


def probe(entry, endpoints, blocks, workers):
    chain, label, addr, governor = entry
    url = endpoints.get(chain)
    if not url:
        return {"chain": chain, "label": label, "address": addr, "error": "no RPC"}
    o = {"chain": chain, "label": label, "address": addr, "calls": {},
         "roles": {}, "balances": {}, "votes": {}, "markets": {}}
    try:
        c = rpc(url, "eth_getCode", [addr, "latest"], timeout=20)
        o["codeBytes"] = (len(c) - 2) // 2 if isinstance(c, str) else 0
    except Exception as e:
        o["codeBytes"] = 0
        o["error"] = str(e)[:120]
    if not o["codeBytes"]:
        return o
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        jobs = [(n, ex.submit(call, url, addr, sel, kind)) for n, (sel, kind) in ZERO.items()]
        for n, f in jobs:
            try:
                v = f.result(timeout=30)
                if v is None:
                    continue
                if n == "getOwners()":
                    v = decode_owners(v) or v
                o["calls"][n] = v
            except Exception:
                pass
        more = []
        if governor:
            for rn, role in [("PROPOSER_ROLE", PROPOSER_ROLE),
                            ("EXECUTOR_ROLE", EXECUTOR_ROLE),
                            ("CANCELLER_ROLE", CANCELLER_ROLE),
                            ("ADMIN_ROLE", ADMIN_ROLE)]:
                more.append((f"hasRole({rn},governor)",
                             ex.submit(has_role, url, addr, role, governor)))
            more.append(("hasRole(EXECUTOR_ROLE,zero)",
                         ex.submit(has_role, url, addr, EXECUTOR_ROLE,
                                   "0x0000000000000000000000000000000000000000")))
        b = blocks.get(chain)
        if b:
            more.append(("quorum(block-1)",
                         ex.submit(call, url, addr, "0xf8ce560a" + u32(b - 1), "uint")))
            more.append(("getPastTotalSupply(block-1)",
                         ex.submit(call, url, addr, "0x8e539e8c" + u32(b - 1), "uint")))
        for n, f in more:
            try:
                v = f.result(timeout=30)
                if v is not None:
                    o["roles"][n] = v
            except Exception:
                pass
        baljobs = []
        try:
            nb = ex.submit(rpc, url, "eth_getBalance", [addr, "latest"], timeout=20)
            baljobs.append(("native", nb))
        except Exception:
            pass
        if chain == "ethereum":
            for sym, (tok, dec) in ERC20.items():
                baljobs.append((sym, ex.submit(balance, url, tok, addr)))
        for n, f in baljobs:
            try:
                v = f.result(timeout=30)
                if n == "native":
                    o["balances"]["native"] = int(v, 16) if isinstance(v, str) else v
                elif v:
                    dec = ERC20[n][1]
                    o["balances"][n] = {"raw": str(v), "human": v / 10 ** dec}
            except Exception:
                pass
        # market cash: underlying ERC20 balance held by mToken + native balance
        for sym, mtoken, underlying, dec in MARKETS:
            if mtoken.lower() != addr.lower():
                continue
            if underlying:
                o["markets"][f"{sym} underlying.balanceOf(mToken)"] = balance(url, underlying, addr)
            else:
                try:
                    nb = rpc(url, "eth_getBalance", [addr, "latest"], timeout=15)
                    o["markets"][f"{sym} native.balance"] = int(nb, 16) if isinstance(nb, str) else nb
                except Exception:
                    pass
        # voting power of this address on the two vote tokens, plus governor/timelock
        vt = {"Hop timelock": ("ethereum", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc"),
              "Hop governor": ("ethereum", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc"),
              "HOP token": ("ethereum", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc"),
              "Angle timelock": ("ethereum", "0x31429d1856aD1377A8A0079410B297e1a9e214c2"),
              "Angle governor": ("ethereum", "0x31429d1856aD1377A8A0079410B297e1a9e214c2"),
              "ANGLE token": ("ethereum", "0x31429d1856aD1377A8A0079410B297e1a9e214c2"),
              "MFAM token": ("moonriver", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1"),
              "Moonwell Apollo governor": ("moonriver", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1"),
              "Moonwell Apollo timelock": ("moonriver", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1"),
              "Moonwell Apollo Unitroller": ("moonriver", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1"),
              }
        if label in vt and blocks.get(chain):
            tchain, tok = vt[label]
            if tchain == chain:
                sel, v = votes(url, tok, addr, blocks[chain] - 1)
                if v:
                    o["votes"] = {"selector": sel, "account": addr, "votes": v}
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", default="rpc_target_raw.json")
    ap.add_argument("--md", default="RPC_TARGET.md")
    a = ap.parse_args()
    chains = sorted({t[0] for t in TARGETS})
    endpoints, blocks = {}, {}
    for c in chains:
        u, b = find_rpc(c, a.rpc if c == "ethereum" else None)
        endpoints[c], blocks[c] = u, b
        print(f"{c}: {u or 'NONE'} block={b}", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(lambda e: probe(e, endpoints, blocks, a.workers), TARGETS))
    doc = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "method": "read-only eth_call / eth_getCode / eth_getBalance / eth_getStorageAt",
           "endpoints": endpoints, "blocks": blocks, "results": results}
    json.dump(doc, open(a.out, "w"), indent=2, default=str)
    L = ["# Pass 3 — money behind the ownership chain", "",
         f"Generated {doc['generatedAt']}. Read-only RPC. No tx, no fork, no key.", "",
         "| Chain | Contract | Code | Views that answered |",
         "|---|---|---|---|"]
    for r in results:
        if r.get("codeBytes"):
            L.append(f"| {r['chain']} | {r['label']} | {r['codeBytes']}B | "
                     f"{', '.join(list(r['calls'])[:6]) or '—'} |")
    L += ["", "Raw: `rpc_target_raw.json`.", ""]
    open(a.md, "w").write("\n".join(L))
    print(f"wrote {a.out} ({os.path.getsize(a.out)} B), {a.md}")


if __name__ == "__main__":
    main()
