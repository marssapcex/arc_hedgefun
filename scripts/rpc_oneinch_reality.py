#!/usr/bin/env python3
"""READ-ONLY on-chain verdict for the 1inch `wave3-drain` Reality.eth question.

No keys, no transactions, no fork. Only:
  eth_blockNumber / eth_getCode / eth_call / eth_getLogs / eth_getBalance

Why this exists: a September 2026 blog post claimed a `wave3-drain` proposal
against the 1inch DAO treasury Safe, with a live enabled RealityModuleETH and
5 opaque batched tx hashes. Every later write-up repeated "outcome unknown".
This script does not read any article. It asks the chain:

  1. Does the Safe exist, and is `0xa62d...f2e` actually an enabled module?
  2. Do the RealityModuleETH timing parameters match the claimed 72h/72h/7d?
  3. Does the Reality.eth question_id `0x03b47c...07d` exist at all?
     -> contentHash / historyHash / openingTS / resultFor / isFinalized
  4. What answer won (YES / NO / INVALID), and when did it finalize?
  5. Are there `ProposalExecuted` / `ExecutionSuccess` logs in the window?

Run on any machine with internet (the GitHub Actions runner has it):
    python3 scripts/rpc_oneinch_reality.py \
        --out rpc_oneinch_raw.json --md ONEINCH_REALITY_ONCHAIN.md
"""
import argparse
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc_probe import find_rpc, rpc  # noqa: E402

# ------------------------------------------------------------------ addresses
SAFE = "0x7951c7ef839e26F63DA87a42C9a87986507f1c07"
MODULE_LIVE = "0xa62d2a75eb39c12e908e9f6bf50f189641692f2e"   # claimed ENABLED
MODULE_DEAD = "0xa7456392eb978a756264d54968f55baf227fcbcf"   # claimed NOT enabled
ORACLE = "0x5b7dD1E86623548AF054A4985F7fc8Ccbb554E2c"        # RealityETH_v3_0
ATTACKER = "0x6f25Cc4d6bD161e7F4514948AF1aE1B8bafF5AE1"

Q = {
    "wave3-drain": "0x03b47cdd30ffa3f228f186bf7123ab6e73671c5b0c36bed8006eb84249e79f7d",
    "wave5-accumulation-001": "0xf84299c435bfe991936dfdfec377cc4e700a70b7fddd465385cbe832d786dae1",
}

# 4-byte selectors, all verified with `cast sig` locally.
SEL = {
    "isModuleEnabled(address)": "0x2d9ad53d",
    "nonce()": "0xaffed0e0",
    "getThreshold()": "0xe75235b8",
    "getOwners()": "0xa0e67e2b",
    "questionTimeout()": "0x1ba18b9b",
    "questionCooldown()": "0x14f5a395",
    "answerExpiration()": "0xd07acb5b",
    "minimumBond()": "0xaa7517e1",
    "oracle()": "0x7dc0d1d0",
    "avatar()": "0x5aef7de6",
    "target()": "0xd4b83992",
    "executor()": "0xc34c08e5",
    "owner()": "0x8da5cb5b",
    "questionArbitrator()": "0xb5a73e75",
    "resultFor(bytes32)": "0xd09cc57e",
    "isFinalized(bytes32)": "0x7f8d429e",
    "getFinalizeTS(bytes32)": "0xacae8f4e",
    "getBestAnswer(bytes32)": "0x8d552d46",
    "getHistoryHash(bytes32)": "0x82ffa9f7",
    "getBond(bytes32)": "0x26d6c97b",
    "getOpeningTS(bytes32)": "0x9e63fa6a",
    "getTimeout(bytes32)": "0x9f1025c6",
    "getMinBond(bytes32)": "0x484c0714",
    "getArbitrator(bytes32)": "0x2518904c",
    "getContentHash(bytes32)": "0x51577ea9",
}

TOPIC = {
    "LogNewAnswer": "0xe47ca4eb",
    "LogFinalize": "0x18d760be",
    "LogNotifyOfArbitrationRequest": "0x75d79399",
    "ProposalQuestionCreated": "0xa1f50470",
    "ProposalExecuted": "0x2b60307a",
    "ExecutionSuccess": "0x442e715f",
    "ExecutionFailure": "0x23428b18",
}

# keccak256 of the *indexed string* proposalId (Solidity indexed string stores
# the hash of the value). Verified locally with `cast keccak`.
PROPOSAL_HASH = {
    "wave3-drain": "0x7af7fc955674ae8dd6c338acbcb21de58b56b5c51d299d2923014de48d85e853",
    "wave5-accumulation-001": "0xfb3c45c6f2bd23f0e83767ff973331875db176fbd5cf86b794e640ffcebadff5",
}

# 2026-09-01 ~= 25.94M (calibrated from the repo's known head ~26.35M and the
# Term Finance Aug-23-2026 block 25,816,049 at ~12s/block).
FROM_BLOCK = 25_940_000
CHUNK = 10_000

URLS = [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://eth.drpc.org",
    "https://1rpc.io/eth",
    "https://rpc.flashbots.net",
    "https://cloudflare-eth.com",
    "https://eth.merkle.io",
    "https://0xrpc.io/eth",
    "https://rpc.ankr.com/eth",
    "https://eth-mainnet.public.blastapi.io",
]


def h(n):
    return hex(int(n))


def ts(unix):
    if unix is None:
        return None
    try:
        return datetime.datetime.fromtimestamp(int(unix), datetime.datetime.timezone.utc).isoformat()
    except Exception:
        return None


def r(url, method, params, timeout=18, tries=3):
    for k in range(tries):
        try:
            v = rpc(url, method, params, timeout=timeout)
            if v is not None:
                return v
        except Exception as e:
            if k == tries - 1:
                return {"__error__": str(e)[:180]}
        time.sleep(0.5 * (k + 1))
    return None


def r_any(method, params, timeout=18):
    for u in URLS:
        v = r(u, method, params, timeout=timeout, tries=2)
        if v is not None and not isinstance(v, dict):
            return v, u
        if isinstance(v, dict) and "__error__" not in v:
            return v, u
    return None, None


def call(url, to, sig, arg=None, block="latest"):
    data = SEL[sig]
    if arg is not None:
        data += arg.lower().replace("0x", "").rjust(64, "0")
    return r(url, "eth_call", [{"to": to, "data": data}, block])


def u256(v):
    return int(v, 16) if isinstance(v, str) and v.startswith("0x") else None


def boolean(v):
    n = u256(v)
    return None if n is None else bool(n)


def address(v):
    if not isinstance(v, str) or not v.startswith("0x"):
        return None
    n = int(v, 16)
    return None if n == 0 else "0x" + v[-40:].lower()


def b32(v):
    return v if isinstance(v, str) and v.startswith("0x") else None


def answer_label(v):
    """Reality.eth answer encoding."""
    if not isinstance(v, str) or not v.startswith("0x"):
        return "unknown", None
    n = int(v, 16)
    if n == 0:
        return "NO (0)", 0
    if n == 1:
        return "YES (1)", 1
    if n == (1 << 256) - 1:
        return "INVALID / unanswered (2^256-1)", None
    return f"other uint256 ({n})", n


def logs_range(url, address, topics, lo, hi, depth=0):
    """Try the whole range first; only bisect when the node rejects a wide range.

    Public nodes usually allow a wide eth_getLogs when `address` + `topics`
    are selective. This avoids hundreds of tiny requests on a 400k-block scan.
    """
    flt = {"fromBlock": h(lo), "toBlock": h(hi), "address": address, "topics": topics}
    v = r(url, "eth_getLogs", [flt], timeout=20, tries=1)
    if isinstance(v, list):
        return v, 1
    # Before bisecting, try the SAME wide range on other endpoints — some nodes
    # allow it with a selective filter, which is far cheaper than 100 chunks.
    if depth <= 1:
        for u in URLS:
            if u == url:
                continue
            v2 = r(u, "eth_getLogs", [flt], timeout=15, tries=1)
            if isinstance(v2, list):
                return v2, 1
    if hi - lo <= 20_000 or depth >= 5:
        return [], 1
    mid = (lo + hi) // 2
    left, nl = logs_range(url, address, topics, lo, mid, depth + 1)
    right, nr = logs_range(url, address, topics, mid + 1, hi, depth + 1)
    return left + right, nl + nr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc")
    ap.add_argument("--out", default="rpc_oneinch_raw.json")
    ap.add_argument("--md", default="ONEINCH_REALITY_ONCHAIN.md")
    a = ap.parse_args()

    url, head = find_rpc("ethereum", a.rpc)
    print(f"ethereum: {url} head={head}", flush=True)
    if not url:
        raise SystemExit("no working public RPC")

    doc = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "rpc": url, "headBlock": head,
        "addresses": {"safe": SAFE, "moduleLive": MODULE_LIVE,
                      "moduleDead": MODULE_DEAD, "oracle": ORACLE,
                      "attacker": ATTACKER},
        "code": {}, "safe": {}, "module": {}, "questions": {}, "logs": [],
    }

    # ---------------------------------------------------------- 1. code present
    for label, adr in [("safe", SAFE), ("moduleLive", MODULE_LIVE),
                       ("moduleDead", MODULE_DEAD), ("oracle", ORACLE)]:
        c = r(url, "eth_getCode", [adr, "latest"])
        doc["code"][label] = (len(c) - 2) // 2 if isinstance(c, str) else None
    print("code bytes:", doc["code"], flush=True)

    # ---------------------------------------------------------- 2. Safe state
    for label, mod in [("moduleLive", MODULE_LIVE), ("moduleDead", MODULE_DEAD)]:
        doc["safe"]["isModuleEnabled_" + label] = boolean(call(url, SAFE, "isModuleEnabled(address)", mod))
    doc["safe"]["nonce"] = u256(call(url, SAFE, "nonce()"))
    doc["safe"]["threshold"] = u256(call(url, SAFE, "getThreshold()"))
    doc["safe"]["balanceWei"] = u256(r(url, "eth_getBalance", [SAFE, "latest"]))
    doc["safe"]["balanceEth"] = (doc["safe"]["balanceWei"] / 1e18) if doc["safe"]["balanceWei"] else None
    print("safe:", doc["safe"], flush=True)

    # ---------------------------------------------------------- 3. module params
    for fn in ["questionTimeout()", "questionCooldown()", "answerExpiration()",
               "minimumBond()", "oracle()", "avatar()", "target()", "executor()",
               "owner()", "questionArbitrator()"]:
        v = call(url, MODULE_LIVE, fn)
        if fn.endswith("()") and fn in ("oracle()", "avatar()", "target()", "executor()",
                                       "owner()", "questionArbitrator()"):
            doc["module"][fn] = address(v)
        elif fn == "minimumBond()":
            n = u256(v)
            doc["module"][fn] = {"wei": n, "eth": n / 1e18 if n else None}
        else:
            n = u256(v)
            doc["module"][fn] = {"seconds": n, "days": round(n / 86400, 3) if n else None}
    print("module:", json.dumps(doc["module"], default=str)[:600], flush=True)

    # ---------------------------------------------------------- 4. question state
    for label, qid in Q.items():
        d = {"questionId": qid}
        for fn in ["resultFor(bytes32)", "isFinalized(bytes32)", "getFinalizeTS(bytes32)",
                   "getBestAnswer(bytes32)", "getHistoryHash(bytes32)", "getBond(bytes32)",
                   "getOpeningTS(bytes32)", "getTimeout(bytes32)", "getMinBond(bytes32)",
                   "getArbitrator(bytes32)", "getContentHash(bytes32)"]:
            v = call(url, ORACLE, fn, qid)
            if isinstance(v, dict):
                d[fn] = {"error": v.get("__error__")}
                continue
            if fn == "isFinalized(bytes32)":
                d[fn] = boolean(v)
            elif fn in ("getFinalizeTS(bytes32)", "getOpeningTS(bytes32)", "getTimeout(bytes32)",
                        "getBond(bytes32)", "getMinBond(bytes32)"):
                n = u256(v)
                d[fn] = {"raw": n, "utc": ts(n) if fn in ("getFinalizeTS(bytes32)",
                                                          "getOpeningTS(bytes32)") else None}
            elif fn == "getArbitrator(bytes32)":
                d[fn] = address(v)
            elif fn in ("resultFor(bytes32)", "getBestAnswer(bytes32)"):
                lab, num = answer_label(v)
                d[fn] = {"raw": b32(v), "label": lab, "num": num}
            else:
                d[fn] = b32(v)
        ch = d.get("getContentHash(bytes32)")
        d["exists"] = bool(isinstance(ch, str) and int(ch, 16) != 0)
        doc["questions"][label] = d
        print(f"question {label}: exists={d['exists']} "
              f"result={d['resultFor(bytes32)'].get('label')} "
              f"finalized={d['isFinalized(bytes32)']}", flush=True)

    # ---------------------------------------------------------- 5. logs
    # ---- FAST PATH: one very selective query. If the node allows this range,
    # we get the real questionId + its block immediately and skip wide scans.
    fast, nc_fast = logs_range(
        url, MODULE_LIVE,
        [TOPIC["ProposalQuestionCreated"], None, PROPOSAL_HASH["wave3-drain"]],
        FROM_BLOCK, head)
    total_calls = nc_fast
    print(f"  fast-path: {len(fast)} logs in {nc_fast} getLogs calls", flush=True)
    for lg in fast:
        doc["logs"].append({
            "source": "module", "address": lg.get("address"),
            "blockNumber": int(lg["blockNumber"], 16) if lg.get("blockNumber") else None,
            "txHash": lg.get("transactionHash"), "topics": lg.get("topics"),
            "data": lg.get("data"),
        })

    # eth_getLogs `topics` entries may be arrays = OR. 4 scans instead of 9.
    batch = [
        # A) module events on the live module (address as scalar: widest node support)
        ("module", MODULE_LIVE,
         [[TOPIC["ProposalQuestionCreated"], TOPIC["ProposalExecuted"]]]),
        # A2) the disabled/decoy module
        ("module", MODULE_DEAD,
         [[TOPIC["ProposalQuestionCreated"], TOPIC["ProposalExecuted"]]]),
        # B) oracle events for either questionId
        ("oracle", ORACLE,
         [[TOPIC["LogNewAnswer"], TOPIC["LogFinalize"],
           TOPIC["LogNotifyOfArbitrationRequest"]],
          [Q["wave3-drain"], Q["wave5-accumulation-001"]]]),
        # C) Safe execution outcomes
        ("safe", SAFE, [[TOPIC["ExecutionSuccess"], TOPIC["ExecutionFailure"]]]),
    ]
    if fast:
        # narrow the remaining scans to a window around the discovered proposal
        fb = min(x["blockNumber"] for x in fast if x.get("blockNumber")) or head
        lo_scan, hi_scan = max(FROM_BLOCK, fb - 60_000), min(head, fb + 260_000)
        batch = [
            ("module", MODULE_LIVE, [[TOPIC["ProposalExecuted"]]]),
            ("safe", SAFE, [[TOPIC["ExecutionSuccess"], TOPIC["ExecutionFailure"]]]),
        ]
        print(f"  fast-path hit at block {fb}; narrow window {lo_scan}..{hi_scan}", flush=True)
    else:
        lo_scan, hi_scan = FROM_BLOCK, head

    for src, adr, tops in batch:
        logs, nc = logs_range(url, adr, tops, lo_scan, hi_scan)
        total_calls += nc
        print(f"  scan {src}: {len(logs)} logs in {nc} getLogs calls", flush=True)
        for lg in logs:
            doc["logs"].append({
                "source": src, "address": lg.get("address"),
                "blockNumber": int(lg["blockNumber"], 16) if lg.get("blockNumber") else None,
                "txHash": lg.get("transactionHash"), "topics": lg.get("topics"),
                "data": lg.get("data"),
            })
    doc["getLogsCalls"] = total_calls
    print(f"logs collected: {len(doc['logs'])} via {total_calls} getLogs calls", flush=True)

    # ------------------------------------------- 5b. discover real questionIds
    created = [x for x in doc["logs"] if x["source"] == "module" and
               (x["topics"] or [""])[0].lower() == TOPIC["ProposalQuestionCreated"].lower()]
    discovered = {}
    for x in created:
        tops = x["topics"] or []
        if len(tops) < 3:
            continue
        qid, ph = tops[1].lower(), tops[2].lower()
        label = next((k for k, v in PROPOSAL_HASH.items() if v.lower() == ph),
                     "unknown:" + ph[:12])
        discovered.setdefault(label, []).append({
            "questionId": qid, "blockNumber": x["blockNumber"],
            "txHash": x["txHash"], "module": (x["address"] or "").lower(),
        })
    doc["discoveredQuestionIds"] = discovered
    print("discovered:", {k: [d["questionId"][:14] for d in v]
                          for k, v in discovered.items()}, flush=True)

    # Re-probe Reality.eth for every discovered id, and correct Q if it differs
    for label, items in discovered.items():
        for it in items[:3]:
            qid = it["questionId"]
            if qid in (Q.get("wave3-drain"), Q.get("wave5-accumulation-001")):
                continue
            d = {"questionId": qid, "discoveredFrom": "ProposalQuestionCreated log"}
            for fn in ["resultFor(bytes32)", "isFinalized(bytes32)",
                       "getFinalizeTS(bytes32)", "getBestAnswer(bytes32)",
                       "getHistoryHash(bytes32)", "getBond(bytes32)",
                       "getOpeningTS(bytes32)", "getTimeout(bytes32)",
                       "getContentHash(bytes32)"]:
                v = call(url, ORACLE, fn, qid)
                if isinstance(v, dict):
                    d[fn] = {"error": v.get("__error__")}
                elif fn == "isFinalized(bytes32)":
                    d[fn] = boolean(v)
                elif fn in ("resultFor(bytes32)", "getBestAnswer(bytes32)"):
                    lab, num = answer_label(v)
                    d[fn] = {"raw": b32(v), "label": lab, "num": num}
                elif fn in ("getFinalizeTS(bytes32)", "getOpeningTS(bytes32)",
                            "getTimeout(bytes32)", "getBond(bytes32)"):
                    n = u256(v)
                    d[fn] = {"raw": n, "utc": ts(n) if "TS" in fn else None}
                else:
                    d[fn] = b32(v)
            ch = d.get("getContentHash(bytes32)")
            d["exists"] = bool(isinstance(ch, str) and int(ch, 16) != 0)
            it["oracleProbe"] = d
            print(f"  discovered {label} {qid[:14]}: exists={d['exists']} "
                  f"result={d['resultFor(bytes32)'].get('label')}", flush=True)

    # ---------------------------------------------------------- verdict
    q3 = doc["questions"]["wave3-drain"]
    # prefer the chain-discovered id over the blog's claimed id
    dl = discovered.get("wave3-drain") or []
    if dl and dl[0].get("oracleProbe"):
        p = dl[0]["oracleProbe"]
        q3 = {**q3, "resultFor(bytes32)": p.get("resultFor(bytes32)", q3["resultFor(bytes32)"]),
              "isFinalized(bytes32)": p.get("isFinalized(bytes32)", q3["isFinalized(bytes32)"]),
              "getContentHash(bytes32)": p.get("getContentHash(bytes32)"),
              "source": "chain-discovered questionId " + dl[0]["questionId"]}
        doc["questions"]["wave3-drain-chain"] = q3
        exists = p.get("exists", q3.get("exists"))
    else:
        exists = q3.get("exists")
    enabled = doc["safe"].get("isModuleEnabled_moduleLive")
    res = q3.get("resultFor(bytes32)", {}).get("label")
    fin = q3.get("isFinalized(bytes32)")
    exec_logs = [x for x in doc["logs"] if x["source"] == "module" and
                 (x["topics"] or [""])[0].lower() == TOPIC["ProposalExecuted"].lower()]
    safe_exec = [x for x in doc["logs"] if x["source"] == "safe" and
                 (x["topics"] or [""])[0].lower() == TOPIC["ExecutionSuccess"].lower()]

    if not exists:
        verdict = "QUESTION_DOES_NOT_EXIST_ON_THIS_ORACLE"
        line = ("`wave3-drain` question_id khong ton tai tren RealityETH_v3_0 "
                "(`getContentHash = 0`). Bai blog khong khop chain, hoac question_id sai.")
    elif res and res.startswith("INVALID"):
        verdict = "NO_EXECUTABLE_ANSWER"
        line = "Reality.eth tra INVALID / chua co answer hop le. Module khong the executeProposal."
    elif res == "NO (0)":
        verdict = "DISPUTED_BLOCKED"
        line = "Answer cuoi la NO. Bi chan boi dispute / arbitration; khong execute duoc."
    elif res == "YES (1)":
        if exec_logs or safe_exec:
            verdict = "YES_AND_EXECUTION_LOGS_FOUND"
            line = "YES da finalize VA co log execute. Can doc receipt tung tx de biet so tien."
        else:
            verdict = "YES_BUT_NO_EXECUTION_LOG"
            line = ("YES finalize nhung KHONG co ProposalExecuted/ExecutionSuccess trong cua so "
                    "26 trieu block -> co the da het answerExpiration truoc khi ai do goi execute.")
    else:
        verdict = "INDETERMINATE"
        line = "Doc duoc question nhung khong xep duoc trang thai; xem raw JSON."
    doc["verdict"] = {
        "code": verdict, "summary": line,
        "moduleEnabled": enabled, "questionExists": exists,
        "result": res, "isFinalized": fin,
        "proposalExecutedLogs": len(exec_logs), "executionSuccessLogs": len(safe_exec),
    }
    print("VERDICT:", verdict, flush=True)

    json.dump(doc, open(a.out, "w"), indent=2, default=str)

    L = [
        "# 1inch `wave3-drain` — ket luan doc tu chain, khong doc bao",
        "",
        f"Generated {doc['generatedAt']} · RPC `{url}` · head block **{head}**. "
        "Read-only: `eth_getCode`, `eth_call`, `eth_getLogs`, `eth_getBalance`. "
        "Khong co key, khong co tx, khong co fork.",
        "",
        f"## Ket luan: **{verdict}**",
        "",
        line,
        "",
        f"- Safe `{SAFE}` code: {doc['code']['safe']} bytes; "
        f"`isModuleEnabled(0xa62d…f2e)` = **{enabled}**; "
        f"`isModuleEnabled(0xa745…bcf)` = **{doc['safe'].get('isModuleEnabled_moduleDead')}**; "
        f"nonce = {doc['safe']['nonce']}, threshold = {doc['safe']['threshold']}, "
        f"ETH balance = {doc['safe']['balanceEth']}.",
        f"- RealityModuleETH `{MODULE_LIVE}` code: {doc['code']['moduleLive']} bytes; "
        f"questionTimeout = {doc['module'].get('questionTimeout()')}, "
        f"questionCooldown = {doc['module'].get('questionCooldown()')}, "
        f"answerExpiration = {doc['module'].get('answerExpiration()')}, "
        f"minimumBond = {doc['module'].get('minimumBond()')}, "
        f"oracle = `{doc['module'].get('oracle()')}`, avatar = `{doc['module'].get('avatar()')}`.",
        f"- RealityETH_v3_0 `{ORACLE}` code: {doc['code']['oracle']} bytes.",
        "",
        "## Hai question_id",
        "",
        "| label | exists | resultFor | isFinalized | finalizeTS | contentHash |",
        "|---|---|---|---|---|---|",
    ]
    for label, d in doc["questions"].items():
        L.append(f"| `{label}` | {d['exists']} | "
                 f"{d['resultFor(bytes32)'].get('label')} | {d['isFinalized(bytes32)']} | "
                 f"{d['getFinalizeTS(bytes32)'].get('utc') if isinstance(d['getFinalizeTS(bytes32)'], dict) else '—'} | "
                 f"{str(d['getContentHash(bytes32)'])[:20]}… |")
    L += ["", "## Logs trong cua so block %s → %s" % (FROM_BLOCK, head), "",
          f"Tong **{len(doc['logs'])}** log. "
          f"`ProposalExecuted`: **{len(exec_logs)}**. "
          f"`ExecutionSuccess` tu Safe: **{len(safe_exec)}**.", ""]
    if doc["logs"][:40]:
        L += ["| src | block | topic0 | tx |", "|---|---|---|---|"]
        for x in doc["logs"][:40]:
            L.append(f"| {x['source']} | {x['blockNumber']} | "
                     f"{(x['topics'] or [''])[0][:10]} | {str(x['txHash'])[:18]}… |")
    L += ["", "Raw: `rpc_oneinch_raw.json`.", "",
          "Gioi han: day la mot public RPC endpoint tai thoi diem chay, khong phai archive node "
          "da duoc doi chieu cheo. `eth_getLogs` chi quet tu block %s tro di." % FROM_BLOCK,
          ""]
    open(a.md, "w").write("\n".join(L) + "\n")
    print(f"wrote {a.out}, {a.md}", flush=True)


if __name__ == "__main__":
    main()
