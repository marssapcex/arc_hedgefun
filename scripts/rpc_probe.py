#!/usr/bin/env python3
"""
rpc_probe.py — READ-ONLY on-chain probe for cheap-governance / zombie-chain targets.

NO keys, NO transactions, NO fork, NO exploit. Only eth_call / eth_getBalance /
eth_getCode / eth_getStorageAt / eth_blockNumber against public JSON-RPC endpoints.

Usage (any machine with internet):
    python3 scripts/rpc_probe.py                       # auto-discovers working public RPCs
    python3 scripts/rpc_probe.py --rpc https://... --chains ethereum,fantom
    python3 scripts/rpc_probe.py --out my_result.json --md my_report.md

Output:
    rpc_probe_raw.json   full decoded results + block numbers
    RPC_PROBE.md         human-readable table

Why this exists: DefiLlama TVL=0 on a "Deprecated" chain means the *adapter* stopped
tracking, NOT that contracts are empty. This script reads actual storage/balances so
we can tell whether a governor still owns the setter that touches real money.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------------------------------------------------------- public RPCs
RPCS = {
    "ethereum": [
        "https://ethereum-rpc.publicnode.com",
        "https://eth.llamarpc.com",
        "https://eth.drpc.org",
        "https://1rpc.io/eth",
        "https://eth-mainnet.public.blastapi.io",
        "https://rpc.flashbots.net",
        "https://cloudflare-eth.com",
        "https://rpc.ankr.com/eth",
        "https://ethereum.blockpi.network/v1/rpc/public",
        "https://rpc.payload.de",
        "https://eth.merkle.io",
        "https://0xrpc.io/eth",
        "https://eth-mainnet.public.blastapi.io",
    ],
    "fantom": [
        "https://fantom-rpc.publicnode.com",
        "https://fantom.drpc.org",
        "https://rpcapi.fantom.network",
        "https://rpc.ftm.tools",
    ],
    "moonriver": [
        "https://rpc.api.moonriver.moonbeam.network",
        "https://moonriver-rpc.publicnode.com",
        "https://moonriver.drpc.org",
    ],
    "moonbeam": [
        "https://rpc.api.moonbeam.network",
        "https://moonbeam-rpc.publicnode.com",
    ],
    "aurora": ["https://mainnet.aurora.dev", "https://aurora.drpc.org"],
    "linea": ["https://rpc.linea.build", "https://linea-rpc.publicnode.com", "https://linea.drpc.org"],
    "monad": ["https://rpc.monad.xyz", "https://monad-rpc.publicnode.com"],
    "flare": ["https://flare-api.flare.network/ext/C/rpc", "https://rpc.flare.network", "https://flare-rpc.publicnode.com"],
    "kava": ["https://evm.kava.io", "https://kava-evm-rpc.publicnode.com"],
    "avalanche": ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
    "canto": ["https://canto.slingshot.finance", "https://rpc.canto.io"],
    "oktchain": ["https://exchainrpc.okex.org"],
    "harmony": ["https://api.harmony.one"],
    "gnosis": ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"],
    "polygonzkevm": ["https://zkevm-rpc.com", "https://1rpc.io/polygon/zkevm"],
    "blast": ["https://rpc.blast.io", "https://blast-rpc.publicnode.com"],
}

# ---------------------------------------------------------------- selectors
# name -> (4-byte selector, return kind)
SEL = {
    "owner()": ("0x8da5cb5b", "address"),
    "admin()": ("0xf851a440", "address"),
    "pendingAdmin()": ("0x26782247", "address"),
    "timelock()": ("0xd33219b4", "address"),
    "token()": ("0xfc0c546a", "address"),
    "proposalThreshold()": ("0xb58131b0", "uint"),
    "votingDelay()": ("0x3932abb1", "uint"),
    "votingPeriod()": ("0x02a251a3", "uint"),
    "quorumVotes()": ("0x24bc1a64", "uint"),
    "quorumNumerator()": ("0xa7713a70", "uint"),
    "quorumDenominator()": ("0x97c3d334", "uint"),
    "getMinDelay()": ("0xf27a0c92", "uint"),
    "delay()": ("0x6a42b8f8", "uint"),
    "totalSupply()": ("0x18160ddd", "uint"),
    "decimals()": ("0x313ce567", "uint"),
    "symbol()": ("0x95d89b41", "string"),
    "oracle()": ("0x7dc0d1d0", "address"),
    "implementation()": ("0x5c60da1b", "address"),
    "getPriceOracle()": ("0xfca513a8", "address"),
    "getPool()": ("0x026b1d5f", "address"),
    "guardian()": ("0x452a9320", "address"),
    "comptroller()": ("0x5fe3b567", "address"),
    "PROPOSER_ROLE()": ("0x8f61f4f5", "bytes32"),
}
IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e019e019bc2d26d6a0e0a4e1d0a0f4a1c5e"
PROPOSER_ROLE = "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1"

# ---------------------------------------------------------------- targets
# (chain, label, address, note)
TARGETS = [
    # --- Ethereum: on-chain governors & the contracts that hold money ---
    ("ethereum", "Hop HOP token", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc", "governance token"),
    ("ethereum", "Hop governor (DefiLlama compound id)", "0xed8bdb5895b8b7f9fdb3c087628fd8410e853d48", "governor"),
    ("ethereum", "Hop L1 bridge USDC", "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a", "bridge holding funds"),
    ("ethereum", "Hop L1 bridge ETH", "0x3E4a3a4796d16c0Cd582C382691998f7c06420B6", "bridge holding funds"),
    ("ethereum", "Hop L1 bridge DAI", "0x3d4Cc8A61c7528Fd86C55cfe061a78dCBA48EDd1", "bridge holding funds"),
    ("ethereum", "Hop L1 bridge USDT", "0x22B1Cbb8D98a01a3B71D034BB899775A76Eb1cc2", "bridge holding funds"),
    ("ethereum", "ANGLE token", "0x31429d1856aD1377A8A0079410B297e1a9e214c2", "governance token"),
    ("ethereum", "Angle governor (compound id)", "0x59153e939c5b4721543251ff3049ea04c755373b", "governor"),
    ("ethereum", "BIFI token", "0x2791BfD60D232150Bff86b39B7146c0eaAA2BA81", "governance token"),
    ("ethereum", "BiFi governor (eip155 id)", "0x54F50d2f584F1DD05307aB5eB298Ba96C7d4E0ea", "governor"),
    ("ethereum", "FLX token", "0x6243d8CEA23066d098a15582d81a598B4e8391F4", "governance token"),
    ("ethereum", "Reflexer gov (eip155 id)", "0x7a6BBe7fDd793CC9ab7e0fc33605FCd2D19371E8", "governor"),
    ("ethereum", "RGT token", "0xD291E7a03283640FDc51b121aC401383A46cC623", "governance token"),
    ("ethereum", "Rari governor #1", "0x91d9c2b5cF81D55a5f2Ecc0fC84E62f9cd2ceFd6", "governor"),
    ("ethereum", "Rari governor #2", "0x637deEED4e4deb1D222650bD4B64192abf002c00", "governor"),
    ("ethereum", "PEAK token", "0x630d98424eFe0Ea27Fb1b3Ab7741907dFFEaAd78", "governance token"),
    ("ethereum", "PEAKDEFI governor", "0x1a76ff40cddbf908e3289414d54f6caa85bef0a2", "governor"),
    ("ethereum", "Flux Finance governor", "0x336505EC1BcC1A020EeDe459f57581725D23465A", "governor"),
    ("ethereum", "Easedefi governor", "0xea5edef17c4fce9c120790f3c54d6e04823de587", "governor"),
    ("ethereum", "Unslashed governor", "0xa0ae994229b1bc31850d8a17a273904d1ed12190", "governor"),
    ("ethereum", "CTR token", "0xb3Ad645dB386D7F6D753B2b9C3F4B853DA6890B8", "governance token"),
    ("ethereum", "Concentrator ProxyAdmin", "0x12b1326459d72F2Ab081116bf27ca46cD97762A0", "proxy admin"),
    ("ethereum", "Concentrator multisig", "0xA0FB1b11ccA5871fb0225B64308e249B97804E99", "multisig"),
    ("ethereum", "Concentrator cvxCRV vault proxy", "0x2b95A1Dcc3D405535f9ed33c219ab38E8d7e0884", "vault holding funds"),
    ("ethereum", "veCTR", "0xe4C09928d834cd58D233CD77B5af3545484B4968", "vote escrow"),
    # --- Zombie / near-dead chains: is the money still in the contracts? ---
    ("fantom", "Tarot", "0xb7c2ddb1ebac1056231ef22c1b0a13988537a274", "lending, Fantom"),
    ("moonriver", "Moonwell Apollo", "0xbb8d88bcd9749636bc4d2be22aac4bb3b01a58f1", "lending, chain Deprecated"),
    ("aurora", "Aurigami", "0x09c9d464b58d96837f8d8b6f4d9fe4ad408d3a4f", "lending, Aurora"),
    ("aurora", "Trisolaris", "0xFa94348467f64D5A457F75F8bc40495D33c65aBB", "DEX, Aurora"),
    ("flare", "Kinetic", "0xE6505f92583103AF7ed9974DEC451A7Af4e3A3bE", "lending, Flare"),
    ("flare", "Kinetic Unitroller (from source)", "0x8041680Fb73E1Fe5F851e76233DCDfA0f2D2D7c8", "comptroller proxy"),
    ("linea", "Mendi Finance", "0x43e8809ea748eff3204ee01f08872f063e44065f", "lending, Linea"),
    ("linea", "Mendi timelock proposer", "0xe3CDa0A0896b70F0eBC6A1848096529AA7AEe9eE", "timelock proposer"),
    ("monad", "Neverland", "0xAD96C3dffCD6374294e2573A7fBBA96097CC8d7c", "lending, Monad"),
    ("avalanche", "Yield Yak", "0x59414b3089ce2AF0010e7523dea7E2b35d776Ec7", "yield aggregator"),
]

# ERC20 tokens to measure real balances held by the targets above
TOKENS = {
    "ethereum": [
        ("USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
        ("USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
        ("WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
        ("DAI", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
        ("WBTC", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8),
        ("cvxCRV", "0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7", 18),
        ("CRV", "0xD533a949740bb3306d119CC777fa900bA034cd52", 18),
        ("CVX", "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B", 18),
        ("HOP", "0xc5102fE9359FD9a28F877a67E36B0F050d81a3Cc", 18),
        ("ANGLE", "0x31429d1856aD1377A8A0079410B297e1a9e214c2", 18),
    ],
    "fantom": [
        ("WFTM", "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83", 18),
        ("USDC", "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", 6),
    ],
    "moonriver": [("WMOVR", "0x98878B06940aE243284CA214f92Bb71a2b032B8", 18)],
    "aurora": [("WETH", "0xC9BdeEd33CD01541eDeea21dAd5d6dBa1fa15E35", 18)],
}


def rpc(url, method, params, timeout=12):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "User-Agent": "rpc-probe/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = json.loads(r.read().decode())
    if "error" in out:
        raise RuntimeError(str(out["error"])[:160])
    return out.get("result")


def find_rpc(chain, override=None):
    cands = ([override] if override else []) + RPCS.get(chain, [])
    for u in cands:
        try:
            n = rpc(u, "eth_blockNumber", [], timeout=8)
            if n:
                return u, int(n, 16)
        except Exception as e:
            sys.stderr.write(f"  [{chain}] skip {u}: {str(e)[:80]}\n")
    return None, None


def decode(hexval, kind):
    if hexval is None or hexval in ("0x", ""):
        return None
    h = hexval[2:] if hexval.startswith("0x") else hexval
    if len(h) < 64:
        return None
    try:
        if kind == "address":
            a = h[-40:]
            return "0x" + a if int(a, 16) != 0 else None
        if kind == "uint":
            return int(h[:64], 16)
        if kind == "bytes32":
            return "0x" + h[:64]
        if kind == "string":
            # try dynamic ABI string: offset, length, data
            off = int(h[:64], 16)
            if 0 < off < len(h) // 2 and off + 32 <= len(h) // 2:
                ln = int(h[off * 2:off * 2 + 64], 16)
                if 0 <= ln < 1000:
                    raw = bytes.fromhex(h[off * 2 + 64:off * 2 + 64 + ln * 2])
                    return raw.decode("utf8", "replace")
            raw = bytes.fromhex(h[:64])
            return raw.rstrip(b"\x00").decode("ascii", "replace") or None
    except Exception:
        return None
    return None


def calldata(selector, args=()):
    out = selector
    for a in args:
        if isinstance(a, int):
            out += f"{a:064x}"
        elif isinstance(a, str) and a.startswith("0x"):
            out += a[2:].lower().rjust(64, "0")
    return out


def probe_one(chain, rpc_url, label, address, note):
    res = {"chain": chain, "label": label, "address": address, "note": note,
           "code": None, "nativeBalanceWei": None, "calls": {}, "storage": {}}
    try:
        code = rpc(rpc_url, "eth_getCode", [address, "latest"], timeout=12)
        res["code"] = len(code) if code else 0
    except Exception as e:
        res["codeError"] = str(e)[:120]
    try:
        b = rpc(rpc_url, "eth_getBalance", [address, "latest"], timeout=12)
        res["nativeBalanceWei"] = int(b, 16) if b else None
    except Exception:
        pass
    for name, (sel, kind) in SEL.items():
        try:
            v = rpc(rpc_url, "eth_call", [{"to": address, "data": calldata(sel)}, "latest"], timeout=12)
            d = decode(v, kind)
            if d is not None:
                res["calls"][name] = d
        except Exception:
            pass  # revert = method absent on this contract
    # hasRole(PROPOSER_ROLE, address) on timelock-like contracts
    try:
        v = rpc(rpc_url, "eth_call",
                [{"to": address, "data": calldata("0x91d14854", (PROPOSER_ROLE, address))}, "latest"], timeout=12)
        d = decode(v, "uint")
        if d is not None:
            res["calls"]["hasRole(PROPOSER_ROLE,self)"] = bool(d)
    except Exception:
        pass
    for slotname, slot in (("implementation(EIP1967)", IMPLEMENTATION_SLOT), ("admin(EIP1967)", ADMIN_SLOT)):
        try:
            v = rpc(rpc_url, "eth_getStorageAt", [address, slot, "latest"], timeout=12)
            d = decode(v, "address")
            if d:
                res["storage"][slotname] = d
        except Exception:
            pass
    return res


def probe_balances(chain, rpc_url, address):
    out = {}
    for sym, token, dec in TOKENS.get(chain, []):
        try:
            data = calldata("0x70a08231", (address,))
            v = rpc(rpc_url, "eth_call", [{"to": token, "data": data}, "latest"], timeout=12)
            n = decode(v, "uint")
            if n:
                out[sym] = {"raw": str(n), "human": round(n / (10 ** dec), 6)}
        except Exception:
            pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", default=None, help="override RPC URL (applied to all chains)")
    ap.add_argument("--chains", default=None, help="comma-separated subset")
    ap.add_argument("--out", default="rpc_probe_raw.json")
    ap.add_argument("--md", default="RPC_PROBE.md")
    ap.add_argument("--workers", type=int, default=10)
    a = ap.parse_args()

    chainset = sorted({t[0] for t in TARGETS})
    if a.chains:
        chainset = [c for c in chainset if c in a.chains.split(",")]
    endpoints, blocks = {}, {}
    for c in chainset:
        u, b = find_rpc(c, a.rpc)
        endpoints[c], blocks[c] = u, b
        print(f"RPC {c:12} -> {u or 'NONE'} block={b}", flush=True)

    jobs = [(c, l, ad, n) for (c, l, ad, n) in TARGETS if endpoints.get(c)]
    results = []
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(probe_one, c, endpoints[c], l, ad, n): (c, l) for c, l, ad, n in jobs}
        for f in as_completed(futs):
            try:
                r = f.result()
                results.append(r)
                sig = sorted(r["calls"].keys())
                print(f"  {r['chain']:10} {r['label'][:36]:36} code={r['code']} calls={len(sig)} {','.join(sig[:4])}", flush=True)
            except Exception as e:
                print("  probe failed:", futs[f], str(e)[:100], flush=True)

    # token balances, only on Ethereum mainnet (largest sample) + configured chains
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(probe_balances, r["chain"], endpoints[r["chain"]], r["address"]): i
                for i, r in enumerate(results) if r["chain"] in TOKENS}
        for f in as_completed(futs):
            try:
                results[futs[f]]["tokenBalances"] = f.result()
            except Exception:
                pass

    payload = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "method": "read-only eth_call / eth_getBalance / eth_getCode / eth_getStorageAt",
               "endpoints": endpoints, "blocks": blocks, "results": results}
    with open(a.out, "w") as f:
        json.dump(payload, f, indent=1, ensure_ascii=False)
    write_md(a.md, payload)
    print(f"wrote {a.out} and {a.md}; {len(results)} targets probed")


def write_md(path, d):
    L = ["# On-chain probe — read-only RPC results", "",
         f"Generated `{d['generatedAt']}` · no keys, no tx, no fork. "
         "Only `eth_call`, `eth_getBalance`, `eth_getCode`, `eth_getStorageAt`.", "",
         "| Chain | RPC | Block |", "|---|---|---|"]
    for c, u in d["endpoints"].items():
        L.append(f"| {c} | `{u or 'unreachable'}` | {d['blocks'].get(c) or '-'} |")
    L += ["", "## Decoded storage", "",
          "| Chain | Target | code bytes | native (ETH-equivalent) | owner / admin / timelock | quorum / threshold | other |",
          "|---|---|---|---|---|---|---|"]
    for r in d["results"]:
        c = r["calls"]
        key = [f"{k}={c[k]}" for k in ("owner()", "admin()", "timelock()", "pendingAdmin()") if k in c]
        q = [f"{k}={c[k]}" for k in ("quorumVotes()", "quorumNumerator()", "proposalThreshold()", "votingDelay()", "votingPeriod()", "getMinDelay()") if k in c]
        other = [f"{k}={c[k]}" for k in ("token()", "oracle()", "implementation()", "getPriceOracle()", "getPool()", "guardian()", "comptroller()", "symbol()", "totalSupply()") if k in c]
        other += [f"{k}={v}" for k, v in r["storage"].items()]
        nat = (r["nativeBalanceWei"] or 0) / 1e18
        L.append(f"| {r['chain']} | {r['label']} | {r['code']} | {nat:.4f} | "
                 f"{'; '.join(key) or '-'} | {'; '.join(q) or '-'} | {'; '.join(other)[:170] or '-'} |")
    L += ["", "## Real token balances sitting in probed contracts", "",
          "| Chain | Target | Token balances |", "|---|---|---|"]
    for r in d["results"]:
        tb = r.get("tokenBalances") or {}
        if tb:
            L.append(f"| {r['chain']} | {r['label']} | " +
                     ", ".join(f"{k} {v['human']}" for k, v in tb.items()) + " |")
    L += ["", "## Limits", "",
          "- Public RPCs are third-party and may be stale/rate-limited; re-run with `--rpc` against your own node.",
          "- `eth_call` returns current state only. It does NOT prove a drain, a passed proposal, or that a setter is reachable by a token vote.",
          "- A revert is recorded as *method absent*, not as a security control.",
          "- No proxy implementation bytecode was decompiled; EIP-1967 slots are reported as-is.", ""]
    with open(path, "w") as f:
        f.write("\n".join(L))


if __name__ == "__main__":
    main()
