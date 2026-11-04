#!/usr/bin/env python3
"""Read-only follow-up: walk the ownership chain discovered by rpc_probe.py.

No keys, no transactions, no fork.  Only eth_call / eth_getCode /
eth_getStorageAt / eth_getBalance / eth_blockNumber against public RPCs.

Every address below was either returned by an on-chain call in
rpc_probe_raw.json, or comes from a deployed-address file in the protocol's
own repository.  This pass answers the question the hit list could not:
does governor -> timelock -> admin -> contract-that-holds-funds actually
connect, or does it stop at a multisig / guardian / impossible quorum?

Usage: python3 scripts/rpc_follow.py [--rpc URL] [--workers N]
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc_probe import find_rpc, rpc, decode  # noqa: E402

PROPOSER_ROLE = "b09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1"
EXECUTOR_ROLE = "d8aa0f3194971a2a116679f7c2090f6939c8d13fec43cfd25c078a9c61c3ad4c8f8f"
CANCELLER_ROLE = "fd643c72710c63c0180259aba6b8d054680e36a4461fa03b7372cf215b10b9f8e0a8"
ADMIN_ROLE = "0000000000000000000000000000000000000000000000000000000000000000"

# zero-argument views
ZERO = {
    "owner()": ("0x8da5cb5b", "address"),
    "getOwners()": ("0xa0e67e2b", "raw"),
    "getThreshold()": ("0xe75235b8", "uint"),
    "admin()": ("0xf851a440", "address"),
    "pendingAdmin()": ("0x26782247", "address"),
    "guardian()": ("0x452a9320", "address"),
    "delay()": ("0x6a42b8f8", "uint"),
    "getMinDelay()": ("0xf27a0c92", "uint"),
    "timelock()": ("0xd33219b4", "address"),
    "token()": ("0xfc0c546a", "address"),
    "implementation()": ("0x5c60da1b", "address"),
    "oracle()": ("0x7dc0d1d0", "address"),
    "proposalCount()": ("0xda35c664", "uint"),
    "proposalThreshold()": ("0xb58131b0", "uint"),
    "quorumVotes()": ("0x24bc1a64", "uint"),
    "quorumNumerator()": ("0xa7713a70", "uint"),
    "quorumDenominator()": ("0x97c3d334", "uint"),
    "votingDelay()": ("0x3932abb1", "uint"),
    "votingPeriod()": ("0x02a251a3", "uint"),
    "totalSupply()": ("0x18160ddd", "uint"),
    "decimals()": ("0x313ce567", "uint"),
    "symbol()": ("0x95d89b41", "string"),
    "paused()": ("0x5c975abb", "uint"),
    "getRegistry()": ("0x5ab1bd53", "address"),
    "registry()": ("0x7b103999", "address"),
    "getRoleMemberCount(PROPOSER_ROLE)": ("0xca15c873" + PROPOSER_ROLE, "uint"),
    "getRoleMemberCount(EXECUTOR_ROLE)": ("0xca15c873" + EXECUTOR_ROLE, "uint"),
    "getRoleMemberCount(ADMIN_ROLE)": ("0xca15c873" + ADMIN_ROLE, "uint"),
    "getRoleMember(PROPOSER_ROLE,0)": (
        "0x9010d07c" + PROPOSER_ROLE + "0" * 64, "address"),
    "getRoleMember(PROPOSER_ROLE,1)": (
        "0x9010d07c" + PROPOSER_ROLE + "0" * 63 + "1", "address"),
}

# (chain, label, address, governor-to-check-against-timelock)
FOLLOW = [
    ("ethereum", "Hop timelock", "0xeea8422a08258e73c139fc32a25e10410c14bd7a",
     "0xed8bdb5895b8b7f9fdb3c087628fd8410e853d48"),
    ("ethereum", "Hop governor", "0xed8bdb5895b8b7f9fdb3c087628fd8410e853d48", None),
    ("ethereum", "Hop L1 bridge USDC", "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a", None),
    ("ethereum", "Hop L1 bridge DAI", "0x3d4Cc8A61c7528Fd86C55cfe061a78dCBA48EDd1", None),
    ("ethereum", "Hop L1 bridge ETH", "0x3E4a3a4796d16c0Cd582C382691998f7c06420B6", None),
    ("ethereum", "Hop L1 bridge USDT", "0x22B1Cbb8D98a01a3B71D034BB899775A76Eb1cc2", None),
    ("ethereum", "Angle timelock", "0x5183f032bf42109cd370b9559fd22207e432301e",
     "0x59153e939c5b4721543251ff3049ea04c755373b"),
    ("ethereum", "Angle governor", "0x59153e939c5b4721543251ff3049ea04c755373b", None),
    ("ethereum", "BiFi timelock", "0xe75fe5f37bd2e2613b1473f27644cf983555ffdf",
     "0x54F50d2f584F1DD05307aB5eB298Ba96C7d4E0ea"),
    ("ethereum", "BiFi owner", "0xfbb3544329679a7cc1f7644bae1b65d36bf5ce63", None),
    ("ethereum", "BiFi governor", "0x54F50d2f584F1DD05307aB5eB298Ba96C7d4E0ea", None),
    ("ethereum", "Flux timelock/admin", "0x2c5898da4df1d45eab2b7b192a361c3b9eb18d9c", None),
    ("ethereum", "Flux governor", "0x336505EC1BcC1A020EeDe459f57581725D23465A", None),
    ("ethereum", "Reflexer timelock", "0x2cde6a1147b0ee61726b86d83fd548401b1162c7", None),
    ("ethereum", "Reflexer admin", "0xa57a4e6170930ac547c147cdf26ae4682fa8262e", None),
    ("ethereum", "Reflexer governor", "0x7a6BBe7fDd793CC9ab7e0fc33605FCd2D19371E8", None),
    ("ethereum", "PEAKDEFI timelock", "0x5a88bcfe2ab1a5cf720438cf605314e8ed2380d3", None),
    ("ethereum", "PEAKDEFI guardian", "0xbdbdfafb975b35a41fa228585c8700d31cce73c9", None),
    ("ethereum", "PEAKDEFI governor", "0x1a76ff40cddbf908e3289414d54f6caa85bef0a2", None),
    ("ethereum", "Rari timelock", "0x8ace03fc45139fddba944c6a4082b604041d19fc", None),
    ("ethereum", "Rari governor #2", "0x637deEED4e4deb1D222650bD4B64192abf002c00", None),
    ("ethereum", "Rari governor #1", "0x91d9c2b5cF81D55a5f2Ecc0fC84E62f9cd2ceFd6", None),
    ("ethereum", "Unslashed timelock", "0x1417fa839f4d03e59dbda9e60165a752d41b2045", None),
    ("ethereum", "Unslashed guardian", "0x3fdba971a35e238cea1602f50824e296bad85980", None),
    ("ethereum", "Easedefi timelock/admin", "0xea5edef1401e8c312c797c27a9842e03eb0e557a", None),
    ("ethereum", "Concentrator multisig", "0xA0FB1b11ccA5871fb0225B64308e249B97804E99", None),
    ("ethereum", "Concentrator ProxyAdmin", "0x12b1326459d72F2Ab081116bf27ca46cD97762A0", None),
    ("ethereum", "Concentrator vault impl", "0x9A68dEa7DCddfC5c4c6B3cB8aB278BF2cD87d3d3", None),
    ("ethereum", "Concentrator vault proxy", "0x2b95A1Dcc3D405535f9ed33c219ab38E8d7e0884", None),
    ("ethereum", "Angle governor impl", "0x3e399ae5b4d8bc0021e53b51c8bcdd66dd62c03b", None),
    ("ethereum", "Flux governor impl", "0x8886344a1b9b840bed590f2ef7379dd37e169c8e", None),
    ("ethereum", "Rari governor impl", "0xfd6aca12f464acda7901fcd650dd1bc272da039f", None),
    ("ethereum", "BIFI token owner", "0xa76540d1180b22db0b760c34336843506f9828ab", None),
    ("moonriver", "Moonwell Apollo governor", "0x2BE2e230e89c59c8E20E633C524AD2De246e7370", None),
    ("moonriver", "Moonwell Apollo timelock", "0x04e6322D196E0E4cCBb2610dd8B8f2871E160bd7", None),
    ("moonriver", "Moonwell Apollo comptroller", "0x0b7a0EAA884849c6Af7a129e899536dDDcA4905E", None),
    ("moonriver", "Moonwell Apollo oracle", "0x892bE716Dcf0A6199677F355f45ba8CC123BAF60", None),
    ("moonriver", "MFAM token", "0xBb8d88bcD9749636BC4D2bE22aaC4Bb3B01A58F1", None),
    ("flare", "Kinetic Unitroller admin", "0x81274d9250c8a36c62d3f45f18bd34d44d433b45", None),
    ("flare", "Kinetic oracle", "0xc1d7029c970d9b683da9d37b49d84d081dbed54c", None),
    ("aurora", "Aurigami admin", "0x4444588443c3a91288c5002483449aba1054192b", None),
    ("fantom", "Tarot owner", "0x5b0390bccca1f040d8993eb6e4ce8ded93721765", None),
    ("linea", "Mendi timelock proposer A", "0xe3CDa0A0896b70F0eBC6A1848096529AA7AEe9eE", None),
    ("linea", "Mendi timelock proposer B", "0x57cd331C7b2c7582625810465Ea3CF9bdcA21236", None),
    ("monad", "Neverland owner", "0xe72df2dde84880dd706c5976e92ed34bb586a38f", None),
    # --- vote tokens: total supply + past supply decide whether quorum is reachable ---
    ("ethereum", "HOP token (owner=timelock)", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc", None),
    ("ethereum", "ANGLE token", "0x31429d1856aD1377A8A0079410B297e1a9e214c2", None),
    ("ethereum", "BiFi vote token (governor.token)", "0x22f68ae048b126ad76cd5dbc2c671603a188d6dc", None),
    ("ethereum", "FLX token", "0x6243d8CEA23066d098a15582d81a598B4e8391F4", None),
    ("ethereum", "RGT token", "0xD291E7a03283640FDc51b121aC401383A46cC623", None),
    ("ethereum", "Rari vote token #2", "0xc7283b66eb1eb5fb86327f08e1b5816b0720212b", None),
    ("ethereum", "PEAK token", "0x630d98424eFe0Ea27Fb1b3Ab7741907dFFEaAd78", None),
    ("ethereum", "CTR token", "0xb3Ad645dB386D7F6D753B2b9C3F4B853DA6890B8", None),
    ("ethereum", "veCTR", "0xe4C09928d834cd58D233CD77B5af3545484B4968", None),
    ("moonriver", "Moonwell MFAM token", "0xbb8d88bcd9749636bc4d2be22aac4bb3b01a58f1", None),
    ("fantom", "TAROT token", "0xb7c2ddb1ebac1056231ef22c1b0a13988537a274", None),
    ("aurora", "Aurigami PLY token", "0x09c9d464b58d96837f8d8b6f4d9fe4ad408d3a4f", None),
    ("aurora", "TRI token", "0xFa94348467f64D5A457F75F8bc40495D33c65aBB", None),
    ("flare", "Kinetic JOULE token", "0xE6505f92583103AF7ed9974DEC451A7Af4e3A3bE", None),
    ("linea", "MENDI token", "0x43e8809ea748eff3204ee01f08872f063e44065f", None),
    ("monad", "Neverland DUST token", "0xAD96C3dffCD6374294e2573A7fBBA96097CC8d7c", None),
    # --- addresses discovered in follow v1 storage slots ---
    ("flare", "Kinetic oracle admin (slot0)", "0x58b1b315319ce94fff3a665e2c4a7f61375aaba8", None),
    ("moonriver", "Moonwell comptroller impl (slot2)", "0x8529ea4dbdca738aa928d682ea9c1382bf2ff098", None),
    ("moonriver", "Moonwell oracle slot1", "0x95c8465dabfdaf587c6f93a82c10018e7b9d3eb0", None),
    ("linea", "Mendi/Neverland Safe singleton", "0x29fcb43b46531bca003ddc8fcb67ffe91900c762", None),
    ("aurora", "Aurigami PLY admin (slot5)", "0x4444588443c3a91288c5002483449aba1054192b", None),
    ("fantom", "Tarot owner (slot0)", "0x5b0390bccca1f040d8993eb6e4ce8ded93721765", None),
]

# ERC20 balances to read on each follow address on ethereum
TOKEN_ADDRS = {
    "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "DAI": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "WETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "HOP": "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc",
    "ANGLE": "0x31429d1856aD1377A8A0079410B297e1a9e214c2",
    "cvxCRV": "0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7",
    "CRV": "0xD533a949740bb3306d119CC777fa900bA034cd52",
    "CVX": "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B",
    "RGT": "0xD291E7a03283640FDc51b121aC401383A46cC623",
    "FLX": "0x6243d8CEA23066d098a15582d81a598B4e8391F4",
    "CTR": "0xb3Ad645dB386D7F6D753B2b9C3F4B853DA6890B8",
    "PEAK": "0x630d98424eFe0Ea27Fb1b3Ab7741907dFFEaAd78",
    "BIFI": "0x2791BfD60D232150Bff86b39B7146c0eaAA2BA81",
    "MTA": "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
}
DECIMALS = {"USDC": 6, "USDT": 6, "PEAK": 8}


def _enc_addr(a):
    return a.lower().replace("0x", "").rjust(64, "0")


def _enc_uint(n):
    return hex(n)[2:].rjust(64, "0")


def call(url, contract, data, kind):
    import time
    for attempt in range(3):
        try:
            v = rpc(url, "eth_call", [{"to": contract, "data": data}, "latest"], timeout=15)
            if kind == "raw":
                return v if v and v != "0x" else None
            return decode(v, kind)
        except Exception as e:
            if "429" in str(e) or "Too Many" in str(e):
                time.sleep(0.8 * (attempt + 1))
                continue
            return None
    return None


def has_role(url, contract, role, account):
    return call(url, contract, "0x91d14854" + role + _enc_addr(account), "uint")


def quorum_at(url, contract, block):
    return call(url, contract, "0xf8ce560a" + _enc_uint(block), "uint")


def get_votes(url, contract, account, block):
    return call(url, contract, "0xeb9019d4" + _enc_addr(account) + _enc_uint(block), "uint")


def past_supply(url, contract, block):
    return call(url, contract, "0x8e539e8c" + _enc_uint(block), "uint")


def state_of(url, contract, pid):
    return call(url, contract, "0x3e4f49e6" + _enc_uint(pid), "uint")


def erc20_balance(url, token, holder):
    return call(url, token, "0x70a08231" + _enc_addr(holder), "uint")


def storage_addr(url, contract, slot):
    v = rpc(url, "eth_getStorageAt", [contract, hex(slot), "latest"])
    if not v or not isinstance(v, str) or len(v) < 66:
        return None
    a = "0x" + v[-40:]
    return None if a == "0x" + "0" * 40 else a


def probe(entry, endpoints, chain_blocks, workers=12):
    chain, label, addr, governor = entry
    url = endpoints.get(chain)
    if not url:
        return {"chain": chain, "label": label, "address": addr, "error": "no RPC"}
    out = {"chain": chain, "label": label, "address": addr,
           "rpc": url, "governorChecked": governor, "calls": {}, "storage": {},
           "roles": {}, "balances": {}, "proposals": {}}
    try:
        code = rpc(url, "eth_getCode", [addr, "latest"], timeout=20)
        out["codeBytes"] = (len(code) - 2) // 2 if isinstance(code, str) else 0
    except Exception as e:
        out["codeBytes"] = 0
        out["error"] = str(e)[:120]
    if not out["codeBytes"]:
        return out

    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for name, (selector, kind) in ZERO.items():
            jobs.append((name, ex.submit(call, url, addr, selector, kind)))
        for name, fut in jobs:
            try:
                v = fut.result(timeout=25)
            except Exception:
                v = None
            if v is not None:
                out["calls"][name] = v

        extra = []
        # Slot 0..6 often holds _owner / _admin in OZ Ownable & Compound Unitroller
        for slot in range(0, 7):
            extra.append((f"slot{slot}", ex.submit(storage_addr, url, addr, slot)))
        # Role checks on any contract that answered getRoleMemberCount
        if governor:
            for rname, role in [("PROPOSER_ROLE", PROPOSER_ROLE),
                                ("EXECUTOR_ROLE", EXECUTOR_ROLE),
                                ("ADMIN_ROLE", ADMIN_ROLE)]:
                extra.append((f"hasRole({rname},governor)",
                              ex.submit(has_role, url, addr, role, governor)))
        b = chain_blocks.get(chain)
        if b:
            extra.append(("quorum(block-1)", ex.submit(quorum_at, url, addr, b - 1)))
            extra.append(("getPastTotalSupply(block-1)",
                          ex.submit(past_supply, url, addr, b - 1)))
            if governor:
                extra.append(("getVotes(governor,block-1)",
                              ex.submit(get_votes, url, addr, governor, b - 1)))
        pc = out["calls"].get("proposalCount()")
        if pc:
            for pid in {1, pc, max(1, pc - 1), max(1, pc - 2)}:
                extra.append((f"state({pid})", ex.submit(state_of, url, addr, pid)))
        if chain == "ethereum":
            for t, ta in TOKEN_ADDRS.items():
                extra.append((t, ex.submit(erc20_balance, url, ta, addr)))
        bal = ex.submit(rpc, url, "eth_getBalance", [addr, "latest"])
        extra.append(("native", bal))
        for name, fut in extra:
            try:
                v = fut.result(timeout=25)
            except Exception:
                v = None
            if v is None:
                continue
            if name.startswith("slot"):
                out["storage"][name] = v
            elif name.startswith("hasRole") or name.startswith("quorum") or \
                    name.startswith("getVotes") or name.startswith("getPast"):
                out["roles"][name] = v
            elif name.startswith("state("):
                out["proposals"][name] = v
            elif name == "native":
                out["nativeBalanceWei"] = int(v, 16) if isinstance(v, str) else v
            else:
                try:
                    d = DECIMALS.get(name, 18)
                    out["balances"][name] = {"raw": str(v), "human": v / (10 ** d)}
                except Exception:
                    out["balances"][name] = str(v)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", help="override Ethereum RPC URL")
    ap.add_argument("--chains", help="comma separated subset")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--out", default="rpc_follow_raw.json")
    ap.add_argument("--md", default="RPC_FOLLOW.md")
    ap.add_argument("--raw", default="rpc_probe_raw.json")
    a = ap.parse_args()

    chain_blocks = {}
    if os.path.exists(a.raw):
        try:
            chain_blocks = json.load(open(a.raw)).get("blocks", {})
        except Exception:
            pass

    wanted = set(a.chains.split(",")) if a.chains else None
    entries = [e for e in FOLLOW if not wanted or e[0] in wanted]
    chains = sorted({e[0] for e in entries})
    endpoints = {}
    for c in chains:
        override = a.rpc if (c == "ethereum" and a.rpc) else None
        u, b = find_rpc(c, override)
        endpoints[c] = u
        if b and c not in chain_blocks:
            chain_blocks[c] = b
        print(f"{c}: {u or 'NO RPC'} block={chain_blocks.get(c)}", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda e: probe(e, endpoints, chain_blocks, a.workers), entries))

    doc = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "note": "read-only eth_call/getCode/getStorageAt/getBalance; derived from rpc_probe_raw.json + protocol deployment repos",
        "endpoints": endpoints,
        "blocks": chain_blocks,
        "results": results,
    }
    with open(a.out, "w") as f:
        json.dump(doc, f, indent=2, default=str)

    lines = ["# RPC follow-up: ownership chain, verified on-chain", "",
             f"Generated {doc['generatedAt']}. Read-only: `eth_call`, `eth_getCode`, "
             "`eth_getStorageAt`, `eth_getBalance`. No tx, no fork, no key.", "",
             "Addresses probed here were returned by on-chain calls in `rpc_probe_raw.json`, "
             "or taken from the protocol's own deployed-address config in its public repo. "
             "Every value below is what the chain returned at the block numbers in that file.", "",
             "| Chain | Contract | Code | Calls that answered |",
             "|---|---|---|---|"]
    for r in results:
        if r.get("codeBytes"):
            lines.append(f"| {r['chain']} | {r['label']} | {r['codeBytes']}B | "
                         f"{', '.join(list(r['calls'])[:8]) or '—'} |")
    lines += ["", "## Raw", "", "See `rpc_follow_raw.json`.", ""]
    with open(a.md, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {a.out} ({os.path.getsize(a.out)} B), {a.md}")


if __name__ == "__main__":
    main()
