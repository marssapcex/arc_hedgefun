"""Single entrypoint for both tools.

    python3 -m bugchain.cli build-db  --source ... --out ... --signatures ...
    python3 -m bugchain.cli make-fixture --database ... --signatures ... --out ...
    python3 -m bugchain.cli index --fixture ... --out ...
    python3 -m bugchain.cli index --mode creation --blocks 5 --out ...
    python3 -m bugchain.cli scan --signatures ... --database ... --contracts ... --out ... --md ...
    python3 -m bugchain.cli selftest
"""
import argparse
import json
import os
import tempfile

from . import incident_db, indexer, scanner
from .keccak import keccak256, selector


def _make_fixture(database, signatures, first=25360690, last=25360696):
    """Build an offline block fixture using REAL values from the incident DB.

    Two contracts share identical bytecode (mass-deploy / 66-child pattern),
    one is created by an address that appears in the incident IOC list.
    Selectors include both generic (transfer/approve) and rare ones.
    """
    sel = signatures["selectors"]
    cutoff = max(3, int(database["meta"]["incidentCount"] * 0.10))
    rare = [s for s, v in sel.items() if v["incidentCount"] < cutoff]
    generic = [s for s, v in sel.items() if v["incidentCount"] >= cutoff]
    rare = rare[:2] or ["0x51cff8d9"]
    generic = generic[:2] or ["0xa9059cbb"]
    creator = next(
        (a for r in database["incidents"] for a in r["attackerAddresses"]
         if not a.startswith("0x00000000") and a in signatures["knownAddresses"]),
        next(iter(signatures["knownAddresses"]), "0x" + "11" * 20))

    def code(sels):
        return "0x" + "".join("63" + s[2:] + "80" for s in sels) + "600052"

    same = code(rare + generic)
    other = code(generic + ["0xc269a509"])
    return {
        "first": first, "last": last,
        "_fixtureInfo": {"creatorFromKnownAddresses": creator,
                         "rareSelectors": rare, "genericSelectors": generic},
        "contracts": [
            {"block": last - 2, "address": "0x" + "aa" * 20,
             "txHash": "0x" + "a1" * 32, "creator": "0x" + "22" * 20, "code": same},
            {"block": last - 1, "address": "0x" + "bb" * 20,
             "txHash": "0x" + "b2" * 32, "creator": "0x" + "33" * 20, "code": same},
            {"block": last, "address": "0x" + "cc" * 20,
             "txHash": "0x" + "c3" * 32, "creator": creator, "code": other},
        ],
    }


def selftest(db_path="bugchain/data/incident_db.json",
             sig_path="bugchain/data/incident_signatures.json"):
    checks = []

    def chk(name, cond, extra=""):
        checks.append((name, bool(cond), extra))
        print(("PASS " if cond else "FAIL ") + name + (" — " + str(extra) if extra else ""))

    chk("keccak256(b'')", keccak256(b"").hex() ==
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
    chk("selector transfer", selector("transfer(address,uint256)") == "0xa9059cbb")
    chk("selector approve", selector("approve(address,uint256)") == "0x095ea7b3")
    chk("selector balanceOf", selector("balanceOf(address)") == "0x70a08231")
    sels = indexer.extract_selectors("0x63a9059cbb8063" + "095ea7b3" + "80")
    chk("PUSH4 selector extraction", "0xa9059cbb" in sels, sels)

    if not (os.path.exists(db_path) and os.path.exists(sig_path)):
        print("\nSKIP end-to-end (incident DB not built yet); run build-db first.")
        return all(c[1] for c in checks)
    db, sig = scanner.load(db_path), scanner.load(sig_path)
    chk("821 incidents parsed", db["meta"]["incidentCount"] == 821,
        db["meta"]["incidentCount"])
    chk("derived selectors > 50", len(sig["selectors"]) > 50, len(sig["selectors"]))
    chk("known IOC addresses > 100", len(sig["knownAddresses"]) > 100,
        len(sig["knownAddresses"]))

    with tempfile.TemporaryDirectory() as td:
        fx = os.path.join(td, "fixture.json")
        co = os.path.join(td, "contracts.json")
        fi = os.path.join(td, "findings.json")
        with open(fx, "w") as fh:
            json.dump(_make_fixture(db, sig), fh)
        indexer.run(fixture=fx, out=co)
        contracts = scanner.load(co)
        chk("fixture indexed 3 contracts", contracts["meta"]["contractCount"] == 3)
        chk("identical-bytecode cluster found", len(contracts["clusters"]) >= 1,
            [c["count"] for c in contracts["clusters"]])
        res = scanner.scan(sig, db, contracts)
        with open(fi, "w") as fh:
            json.dump(res, fh, indent=1)
        chk("generic selectors dropped", res["summary"]["genericSelectorsDropped"] > 0,
            res["summary"]["genericSelectorsDropped"])
        chk("KNOWN_ACTOR from creator IOC",
            any(f["verdict"] == "KNOWN_ACTOR" for f in res["findings"]),
            res["summary"]["verdictCounts"])
        chk("never claims VULNERABLE",
            all(f["verdict"] in ("INFO", "REVIEW", "KNOWN_ACTOR") for f in res["findings"]))
        print("\nselftest summary:", json.dumps(res["summary"]["verdictCounts"]))
    return all(c[1] for c in checks)


def main():
    ap = argparse.ArgumentParser(prog="bugchain")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("build-db")
    p.add_argument("--source", required=True)
    p.add_argument("--out", default="bugchain/data/incident_db.json")
    p.add_argument("--signatures", default="bugchain/data/incident_signatures.json")

    p = sub.add_parser("make-fixture")
    p.add_argument("--database", default="bugchain/data/incident_db.json")
    p.add_argument("--signatures", default="bugchain/data/incident_signatures.json")
    p.add_argument("--out", default="bugchain/data/fixture_blocks.json")

    p = sub.add_parser("index")
    p.add_argument("--rpc", action="append")
    p.add_argument("--mode", choices=["creation", "events"], default="creation")
    p.add_argument("--blocks", type=int, default=5)
    p.add_argument("--from-block", type=int)
    p.add_argument("--to-block", type=int)
    p.add_argument("--max-contracts", type=int, default=200)
    p.add_argument("--fixture")
    p.add_argument("--out", default="bugchain/data/new_contracts.json")

    p = sub.add_parser("scan")
    p.add_argument("--signatures", default="bugchain/data/incident_signatures.json")
    p.add_argument("--database", default="bugchain/data/incident_db.json")
    p.add_argument("--contracts", default="bugchain/data/new_contracts.json")
    p.add_argument("--generic-ratio", type=float, default=0.10)
    p.add_argument("--out", default="bugchain/data/bugchain_findings.json")
    p.add_argument("--md", default="BUGCHAIN_REPORT.md")

    sub.add_parser("selftest")
    a = ap.parse_args()

    if a.cmd == "build-db":
        db, sig = incident_db.build(a.source, a.out, a.signatures)
        print(f"built {db['meta']['incidentCount']} incidents, "
              f"{db['meta']['withMetadataTable']} with metadata tables, "
              f"{db['meta']['derivedSelectorCount']} derived selectors")
        print(f"wrote {a.out} ({os.path.getsize(a.out)} B), "
              f"{a.signatures} ({os.path.getsize(a.signatures)} B)")
    elif a.cmd == "make-fixture":
        db, sig = scanner.load(a.database), scanner.load(a.signatures)
        fx = _make_fixture(db, sig)
        with open(a.out, "w") as fh:
            json.dump(fx, fh, indent=1)
        print("wrote", a.out, "—", fx["_fixtureInfo"])
    elif a.cmd == "index":
        doc = indexer.run(rpc_urls=a.rpc, mode=a.mode, blocks=a.blocks,
                          first=a.from_block, last=a.to_block,
                          fixture=a.fixture, max_contracts=a.max_contracts, out=a.out)
        print(f"indexed {doc['meta']['contractCount']} contracts "
              f"({doc['meta']['mode']}, blocks {doc['meta']['fromBlock']}–{doc['meta']['toBlock']}), "
              f"{len(doc['clusters'])} identical-code clusters, {len(doc['errors'])} RPC errors")
        print("wrote", a.out)
    elif a.cmd == "scan":
        res = scanner.scan(scanner.load(a.signatures), scanner.load(a.database),
                           scanner.load(a.contracts), a.generic_ratio)
        with open(a.out, "w") as fh:
            json.dump(res, fh, indent=1)
        with open(a.md, "w") as fh:
            fh.write(scanner.markdown(res))
        print(f"scanned {res['summary']['newContractsScanned']} contracts, "
              f"verdicts {res['summary']['verdictCounts']}")
        print("wrote", a.out, "and", a.md)
    elif a.cmd == "selftest":
        raise SystemExit(0 if selftest() else 1)


if __name__ == "__main__":
    main()
