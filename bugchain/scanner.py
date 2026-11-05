"""Integrator — join Tool A (821-incident database) with Tool B (new contracts).

IMPORTANT: this is TRIAGE, not a vulnerability detector.

A selector overlap between a fresh contract and an incident report does NOT
mean the contract is vulnerable: every ERC20 has `transfer(address,uint256)`.
So the scanner:
  * drops "generic" selectors seen across many incident reports,
  * weights known attacker/creator addresses (real IOC) highest,
  * flags mass-deployed identical bytecode (the 66-child Jared pattern),
  * outputs REVIEW / KNOWN_ACTOR / INFO — never "VULNERABLE".

Usage:
    python3 -m bugchain.cli scan \
        --signatures bugchain/data/incident_signatures.json \
        --database bugchain/data/incident_db.json \
        --contracts bugchain/data/new_contracts.json \
        --out bugchain/data/bugchain_findings.json \
        --md BUGCHAIN_REPORT.md
"""
import collections
import datetime
import json


def load(p):
    with open(p) as f:
        return json.load(f)


def scan(signatures, database, contracts, generic_ratio=0.10):
    sel_index = signatures["selectors"]
    known_addr = signatures["knownAddresses"]
    total_incidents = database["meta"]["incidentCount"]
    generic_cut = max(3, int(total_incidents * generic_ratio))

    generic = {s for s, v in sel_index.items() if v["incidentCount"] >= generic_cut}
    incident_by_id = {r["id"]: r for r in database["incidents"]}
    cluster_size = {c["address"]: cl["count"]
                    for cl in contracts.get("clusters", [])
                    for c in contracts["contracts"]
                    if c["codeHash"] == cl["codeHash"]}

    findings = []
    for c in contracts["contracts"]:
        ioc, hits, cats = [], [], collections.Counter()
        addr, creator = c["address"], c.get("creator", "")
        if addr in known_addr:
            ioc.append({"field": "address", "address": addr,
                        "incidents": known_addr[addr]["sampleIncidents"]})
        if creator and creator in known_addr:
            ioc.append({"field": "creator", "address": creator,
                        "incidents": known_addr[creator]["sampleIncidents"]})
        for s in c.get("candidateSelectors", []):
            if s in generic or s not in sel_index:
                continue
            v = sel_index[s]
            hits.append({"selector": s, "signatures": v["signatures"],
                         "incidents": v["sampleIncidents"]})
            for iid in v["sampleIncidents"]:
                for cat in incident_by_id.get(iid, {}).get("categories", []):
                    cats[cat] += 1
        cl = cluster_size.get(addr, 1)
        score = 0
        score += 60 * sum(1 for x in ioc if x["field"] == "creator")
        score += 40 * sum(1 for x in ioc if x["field"] == "address")
        score += min(30, 10 * len(hits))
        score += 15 if cl >= 5 else 0
        if score >= 60:
            verdict = "KNOWN_ACTOR"
        elif score >= 10:
            verdict = "REVIEW"
        else:
            verdict = "INFO"
        findings.append({
            "address": addr, "block": c["block"], "txHash": c.get("txHash"),
            "creator": creator, "codeBytes": c["codeBytes"], "codeHash": c["codeHash"],
            "candidateSelectorCount": len(c.get("candidateSelectors", [])),
            "verdict": verdict, "score": score,
            "knownAddressHits": ioc, "selectorHits": hits,
            "incidentCategories": dict(cats.most_common()),
            "identicalBytecodeClusterSize": cl,
        })
    findings.sort(key=lambda x: (-x["score"], x["block"]))
    summary = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "incidentCount": total_incidents,
        "derivedSelectors": len(sel_index),
        "genericSelectorsDropped": len(generic),
        "genericCutoff": generic_cut,
        "newContractsScanned": len(contracts["contracts"]),
        "indexerMode": contracts["meta"]["mode"],
        "blockRange": [contracts["meta"]["fromBlock"], contracts["meta"]["toBlock"]],
        "verdictCounts": dict(collections.Counter(f["verdict"] for f in findings)),
        "identicalBytecodeClusters": len(contracts.get("clusters", [])),
        "indexerErrors": len(contracts.get("errors", [])),
        "indexerStats": contracts.get("stats", {}),
        "disclaimer": "Heuristic triage. Selector overlap is NOT a vulnerability. No exploit, no tx, no claim of drainable value.",
    }
    return {"summary": summary, "findings": findings}


def markdown(result):
    s = result["summary"]
    L = ["# BugChain integration — triage report", "",
         f"Generated {s['generatedAt']}. Read-only: RPC discovery + local incident database.", "",
         "**Đây là xếp hạng để đọc tiếp, không phải kết luận có lỗ hổng.** "
         "Selector trùng ≠ bug (mọi ERC20 đều có `transfer(address,uint256)`).", "",
         "| Metric | Value |", "|---|---|"]
    for k in ["incidentCount", "derivedSelectors", "genericSelectorsDropped",
              "genericCutoff", "newContractsScanned", "indexerMode", "blockRange",
              "verdictCounts", "identicalBytecodeClusters", "indexerErrors",
              "indexerStats"]:
        L.append(f"| {k} | `{json.dumps(s[k])}` |")
    L += ["", "## Findings (top 30)", "",
          "| Verdict | Score | Address | Block | Creator | Selector hits | Identical code |",
          "|---|---|---|---|---|---|---|"]
    for f in result["findings"][:30]:
        L.append(f"| {f['verdict']} | {f['score']} | `{f['address']}` | {f['block']} | "
                 f"`{f['creator'] or '—'}` | {len(f['selectorHits'])} | "
                 f"{f['identicalBytecodeClusterSize']} |")
    if not result["findings"]:
        L += ["", "_No contracts in range._"]
    L += ["", "## Known-actor hits (exact IOC match)", ""]
    ka = [f for f in result["findings"] if f["knownAddressHits"]]
    if ka:
        for f in ka:
            for x in f["knownAddressHits"]:
                L.append(f"- `{f['address']}` — {x['field']} `{x['address']}` "
                         f"appears in {', '.join(x['incidents'])}")
    else:
        L.append("_None._")
    L += ["", "## Selector hits (non-generic)", ""]
    sh = [f for f in result["findings"] if f["selectorHits"]]
    if sh:
        for f in sh[:20]:
            for hh in f["selectorHits"][:5]:
                L.append(f"- `{f['address']}` `{hh['selector']}` → "
                         f"{', '.join(hh['signatures'][:3])} (incidents: "
                         f"{', '.join(hh['incidents'][:3])})")
    else:
        L.append("_None._")
    L += ["", "---", "", f"_{s['disclaimer']}_", "",
          "Artifacts: `bugchain/data/incident_db.json`, "
          "`bugchain/data/incident_signatures.json`, "
          "`bugchain/data/new_contracts.json`, `bugchain/data/bugchain_findings.json`."]
    return "\n".join(L) + "\n"
