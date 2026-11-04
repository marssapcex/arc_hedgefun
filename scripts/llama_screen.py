#!/usr/bin/env python3
"""One-off DefiLlama screen: cheap governance token vs locked value, incl. zombie chains."""
import json, os, sys

D = "/tmp/llama"
OUT = "screen.json"

def load(name):
    with open(os.path.join(D, name)) as f:
        return json.load(f)

full = load("protocols_full.json")          # /protocols  : mcap, governanceID, github, address, oraclesBreakdown
lite = load("protocols2.json")["protocols"] # /lite/protocols2
chains = load("chains.json")                # /v2/chains
meta = load("appmeta.json")                 # config/smol/appMetadata-protocols.json

by_slug = {p.get("slug"): p for p in lite if p.get("slug")}
by_name = {p.get("name"): p for p in lite if p.get("name")}

def compact(p, chain_tvl=None):
    q = {}
    for k in ("id", "name", "slug", "symbol", "category", "chains", "tvl", "mcap",
              "governanceID", "github", "address", "audits", "oraclesBreakdown",
              "deadFrom", "url", "parentProtocol", "listedAt", "change_1d", "change_7d"):
        v = p.get(k)
        if v is not None:
            q[k] = v
    l = by_slug.get(p.get("slug")) or by_name.get(p.get("name")) or {}
    if l.get("governanceID"):
        q["governanceID"] = l["governanceID"]
    if l.get("governanceID") or l.get("geckoId"):
        q["geckoId"] = l.get("geckoId")
    if chain_tvl is not None:
        q["chainTvl"] = chain_tvl
    if p.get("id") and str(p["id"]) in meta:
        m = meta[str(p["id"])]
        q["metaFlags"] = {k: v for k, v in m.items() if k in
                          ("governance", "deprecated", "hacks", "treasury", "borrowed",
                           "oraclesBreakdown", "deadFrom")}
    return q

# --- 1. Reconstruct the user's 156-row screen ---------------------------------
rows = []
for p in full:
    mc, tv = p.get("mcap"), p.get("tvl")
    if mc is None or not isinstance(mc, (int, float)) or mc < 0 or not tv:
        continue
    rows.append(p)
print("protocols with numeric mcap:", len(rows), file=sys.stderr)

def screen(mc_max, tvl_min, ratio_max, allow_zero=True):
    out = []
    for p in rows:
        mc, tv = p["mcap"], p["tvl"]
        if mc > mc_max or tv < tvl_min:
            continue
        if mc == 0 and not allow_zero:
            continue
        if tv and mc / tv > ratio_max:
            continue
        out.append(p)
    return out

variants = {}
for label, args in {
    "main": (1_010_000, 100_000, 1.0, True),
    "nozero": (1_010_000, 100_000, 1.0, False),
    "mc1m": (1_000_000, 100_000, 1.0, True),
    "mc1m_nozero": (1_000_000, 100_000, 1.0, False),
}.items():
    variants[label] = len(screen(*args))
print("variant counts:", variants, file=sys.stderr)

m = screen(1_010_000, 100_000, 1.0, True)
m.sort(key=lambda p: (p["mcap"] / p["tvl"]) if p["tvl"] else 9e9)
matches = [compact(p) for p in m]

# --- 2. Governance-tagged protocols (all, not just matches) ------------------
gov = [compact(p) for p in full if p.get("governanceID")]

# --- 3. Zombie / near-dead chains --------------------------------------------
chain_tvl = {c["name"]: (c.get("tvl") or 0) for c in chains}
zombie_names = [n for n, v in chain_tvl.items() if v <= 5_000_000]
zombie = {}
for cn in zombie_names:
    hits = []
    for p in full:
        ct = (p.get("chainTvls") or {}).get(cn)
        if isinstance(ct, (int, float)) and ct >= 50_000:
            hits.append(compact(p, ct))
    hits.sort(key=lambda q: -q["chainTvl"])
    zombie[cn] = {"chainTvl": chain_tvl[cn], "protocolCount": len(hits), "protocols": hits[:120]}

# --- 4. All small-mcap protocols regardless of ratio (cheap-vote universe) ----
cheap = [compact(p) for p in rows if 0 < p["mcap"] <= 1_010_000 and p["tvl"] >= 50_000]

out = {
    "variantCounts": variants,
    "mcapUniverse": len(rows),
    "matches": matches,
    "governanceTagged": gov,
    "zombieChains": zombie,
    "cheapMcap": cheap,
    "chainTvl": chain_tvl,
}
with open(OUT, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
print("wrote", OUT, os.path.getsize(OUT), "bytes; matches", len(matches), file=sys.stderr)
