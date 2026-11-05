"""Tool A — build a machine-readable vulnerability/incident database.

Source: kismp123/DeFi-Security-Incident (821 real incident reports, 2020-2026).

It does NOT invent signatures. Everything in the output is derived from:
  * the incident markdown metadata table (Date / Protocol / Chain / Loss /
    Attacker / Vulnerable Contract / Attack Tx / Root Cause / PoC Source ...)
  * the 24 `vulns/*.md` category indexes
  * function declarations found inside the reports' own Solidity code blocks

Selectors are computed with a local Keccak-256 implementation (Ethereum's
variant), so `function transfer(address,uint256)` -> 0xa9059cbb without any
third-party package.

Usage:
    python3 -m bugchain.cli build-db --source /path/to/DeFi-Security-Incident \
        --out bugchain/data/incident_db.json \
        --signatures bugchain/data/incident_signatures.json
"""
import collections
import datetime
import glob
import json
import os
import re

from .keccak import selector

ADDR_RE = re.compile(r"0x[a-fA-F0-9]{40}")
TX_RE = re.compile(r"0x[a-fA-F0-9]{64}")
FUNC_RE = re.compile(r"\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)")
CODE_BLOCK_RE = re.compile(r"```(?:solidity|sol)?\s*(.*?)```", re.S | re.I)
LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
YEAR_FILE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})_(.+)\.md$")

SKIP_NAMES = {
    "if", "for", "while", "require", "return", "constructor", "function",
    "modifier", "event", "emit", "assert", "revert", "mapping", "struct",
}
TYPE_ALIAS = {
    "uint": "uint256", "int": "int256", "byte": "bytes1",
    "address payable": "address", "uint[]": "uint256[]",
}
QUALIFIERS = {"memory", "calldata", "storage", "payable", "indexed", "public",
              "external", "internal", "private", "view", "pure", "returns"}


def _clean(v):
    """Strip markdown decoration from a metadata cell."""
    v = LINK_RE.sub(r"\1", v or "")
    v = v.replace("**", "").replace("`", "").strip()
    return re.sub(r"\s+", " ", v)


def _metadata(text):
    out = {}
    for line in text[:4000].splitlines():
        m = re.match(r"^\|\s*\*\*([^*|]+)\*\*\s*\|\s*(.*?)\s*\|\s*$", line)
        if m:
            out[m.group(1).strip()] = _clean(m.group(2))
    return out


def _canonical_params(raw):
    """Best-effort `address payable to, uint256 amount` -> address,uint256"""
    if not raw.strip():
        return ""
    parts, depth, buf = [], 0, ""
    for ch in raw:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    parts.append(buf)
    types = []
    for p in parts:
        toks = [t for t in p.strip().split() if t not in QUALIFIERS]
        if not toks:
            return None
        t = toks[0]
        # drop a trailing variable name when a second identifier follows
        t = TYPE_ALIAS.get(t, t)
        if t.endswith("[]") or re.match(r"^(u?int\d*|bytes\d*|address|bool|string|bytes|tuple)$", t) \
                or "[" in t:
            types.append(t)
        else:
            return None
    return ",".join(types)


def _signatures_from_code(text):
    """Extract canonical function signatures from Solidity snippets in a report."""
    found = {}
    for block in CODE_BLOCK_RE.findall(text):
        block = re.sub(r"//[^\n]*", "", block)  # ignore commented-out declarations
        for name, params in FUNC_RE.findall(block):
            if name in SKIP_NAMES or len(name) < 2:
                continue
            canon = _canonical_params(params)
            if canon is None:
                continue
            sig = f"{name}({canon})"
            sel = selector(sig)
            if sel in ("0x00000000", "0xffffffff"):
                continue
            try:
                found[sig] = sel
            except Exception:
                continue
    return found


def _loss_usd(v):
    if not v:
        return None
    nums = re.findall(r"\$?\s*([\d,]+(?:\.\d+)?)\s*([KMB])?", v, re.I)
    for n, suf in nums:
        try:
            x = float(n.replace(",", ""))
        except ValueError:
            continue
        x *= {"k": 1e3, "m": 1e6, "b": 1e9}.get(suf.lower(), 1)
        if x > 0:
            return round(x, 2)
    return None


def _categories(source):
    """Map incident filename -> category slugs from vulns/*.md indexes."""
    out = collections.defaultdict(list)
    for f in glob.glob(os.path.join(source, "vulns", "*.md")):
        slug = os.path.splitext(os.path.basename(f))[0]
        if slug == "README":
            continue
        with open(f, errors="ignore") as fh:
            text = fh.read()
        for m in re.finditer(r"\]\(\.\./\d{4}/([^)]+\.md)\)", text):
            out[m.group(1)].append(slug)
    return out


def build(source, out_path, signatures_path):
    if not os.path.isdir(source):
        raise SystemExit(f"incident source dir not found: {source}")
    cats = _categories(source)
    incidents = []
    files = sorted(f for f in glob.glob(os.path.join(source, "20*", "*.md"))
                   if os.path.basename(f).lower() != "readme.md")
    for path in files:
        base = os.path.basename(path)
        m = YEAR_FILE_RE.match(base)
        if m:
            date, vuln_from_name = f"{m.group(1)}-{m.group(2)}-{m.group(3)}", m.group(4)
        else:
            dm = re.match(r"^(\d{4}-\d{2}-\d{2})", base)
            date, vuln_from_name = (dm.group(1) if dm else ""), base[:-3]
        with open(path, errors="ignore") as fh:
            text = fh.read()
        meta = _metadata(text)
        heading = next((l.lstrip("# ").strip() for l in text.splitlines()
                        if l.startswith("# ")), "")
        sigs = _signatures_from_code(text)
        vuln_contracts, attackers, txs, attack_contracts, attacker_eoas = [], [], [], [], []
        if meta:
            for key, bucket in [("Vulnerable Contract", vuln_contracts),
                                ("Attack Contract", attack_contracts),
                                ("Attacker", attackers), ("Attacker EOA", attacker_eoas),
                                ("Attack Tx", txs)]:
                for a in ADDR_RE.findall(meta.get(key, "")):
                    bucket.append(a.lower())
                for a in TX_RE.findall(meta.get(key, "")):
                    txs.append(a.lower())
        rec = {
            "id": base[:-3],
            "file": os.path.relpath(path, source),
            "date": meta.get("Date", date),
            "protocol": meta.get("Protocol", ""),
            "chain": meta.get("Chain", ""),
            "lossRaw": meta.get("Loss", ""),
            "lossUsd": _loss_usd(meta.get("Loss", "")),
            "rootCause": meta.get("Root Cause", ""),
            "vulnTypeFromFilename": vuln_from_name,
            "title": heading,
            "categories": sorted(set(cats.get(base, []))),
            "pocSource": meta.get("PoC Source", ""),
            "cwe": meta.get("CWE", ""),
            "vulnerableContracts": sorted(set(vuln_contracts)),
            "attackContracts": sorted(set(attack_contracts)),
            "attackerAddresses": sorted(set(attackers + attacker_eoas)),
            "attackTxs": sorted(set(txs)),
            "functionSignatures": sorted(sigs),
            "selectors": sorted(set(sigs.values())),
            "hasMetadataTable": bool(meta),
        }
        incidents.append(rec)

    # aggregate
    sel_index = collections.defaultdict(lambda: {"signatures": set(), "incidents": []})
    addr_index = collections.defaultdict(list)
    tx_index = collections.defaultdict(list)
    cat_counts = collections.Counter()
    chain_counts = collections.Counter()
    func_counts = collections.Counter()
    for r in incidents:
        for c in r["categories"]:
            cat_counts[c] += 1
        chain_counts[r["chain"] or "unknown"] += 1
        for s in r["functionSignatures"]:
            func_counts[s] += 1
        for sig in r["functionSignatures"]:
            sel = selector(sig)
            sel_index[sel]["signatures"].add(sig)
            sel_index[sel]["incidents"].append(r["id"])
        for a in r["attackerAddresses"] + r["attackContracts"] + r["vulnerableContracts"]:
            addr_index[a].append(r["id"])
        for t in r["attackTxs"]:
            tx_index[t].append(r["id"])

    db = {
        "meta": {
            "source": "kismp123/DeFi-Security-Incident",
            "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "incidentCount": len(incidents),
            "withMetadataTable": sum(1 for r in incidents if r["hasMetadataTable"]),
            "categoryIndexCount": len(cat_counts),
            "derivedSelectorCount": len(sel_index),
            "note": "Heuristic database for triage, not a vulnerability proof.",
        },
        "stats": {
            "categories": dict(cat_counts.most_common()),
            "chains": dict(chain_counts.most_common()),
            "topFunctionSignatures": dict(func_counts.most_common(40)),
        },
        "incidents": incidents,
    }
    sigs_out = {
        "meta": db["meta"],
        "selectors": {k: {"signatures": sorted(v["signatures"]),
                          "incidentCount": len(set(v["incidents"])),
                          "sampleIncidents": sorted(set(v["incidents"]))[:5]}
                      for k, v in sorted(sel_index.items())},
        "knownAddresses": {a: {"incidentCount": len(set(ids)),
                               "sampleIncidents": sorted(set(ids))[:5]}
                           for a, ids in sorted(addr_index.items())},
        "knownAttackTxs": {t: sorted(set(ids))[:5] for t, ids in sorted(tx_index.items())},
        "categoryKeywords": {
            "reentrancy": ["call{value", "reenter", "re-entrancy", "before state"],
            "access-control": ["onlyowner", "unprotected", "missing modifier", "unauthorized"],
            "oracle-price-manipulation": ["spot price", "getreserves", "twap", "flash loan"],
            "arbitrary-call": ["delegatecall", "arbitrary call", "calldata"],
            "proxy-storage": ["initialize", "storage collision", "implementation"],
            "approval-abuse": ["approve", "allowance", "transferfrom"],
            "flash-loan": ["flashloan", "flash loan", "callback"],
        },
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(db, f, indent=1)
    with open(signatures_path, "w") as f:
        json.dump(sigs_out, f, indent=1)
    return db, sigs_out
