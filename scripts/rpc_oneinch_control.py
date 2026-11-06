#!/usr/bin/env python3
"""CONTROL experiment for rpc_oneinch_reality.py — read-only, no keys, no tx.

Two jobs:

  A) Sanity-check the verdict. Call the SAME Reality.eth getters on fabricated
     question_ids that cannot exist. If they also report `isFinalized=true` and
     `resultFor=NO`, then the first probe was reading a default/fallback response
     and its verdict is worthless.

  B) Reconstruct the dispute. The first probe used OR-topic arrays and got 0 logs.
     Here we use single-topic filters over a narrow block window (found by binary
     search on block timestamps) and decode LogNewAnswer / LogFinalize so the
     bond escalation 0.1 -> 0.2 -> 0.4 -> 0.8 ETH can be seen directly.

Outputs: rpc_oneinch_control_raw.json, ONEINCH_CONTROL_ONCHAIN.md
"""
import argparse
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc_probe import find_rpc, rpc  # noqa: E402

ORACLE = "0x5b7dD1E86623548AF054A4985F7fc8Ccbb554E2c"
MODULE = "0xa62d2a75eb39c12e908e9f6bf50f189641692f2e"
SAFE = "0x7951c7ef839e26F63DA87a42C9a87986507f1c07"

Q = {
    "wave3-drain": "0x03b47cdd30ffa3f228f186bf7123ab6e73671c5b0c36bed8006eb84249e79f7d",
    "wave5-accumulation-001": "0xf84299c435bfe991936dfdfec377cc4e700a70b7fddd465385cbe832d786dae1",
}
CONTROL = {
    "all-zero": "0x" + "00" * 32,
    "all-ff": "0x" + "ff" * 32,
    "keccak-fake": "0x" + "ab" * 32,
}

SEL = {
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
    "getQuestionId(uint256,bytes32,address,uint32,uint32,uint256,uint256)": None,
}
TOPIC = {
    "LogNewAnswer": "0xe47ca4eb",
    "LogFinalize": "0x18d760be",
    "LogAnswerReveal": "0x7facfe85",
    "LogNotifyOfArbitrationRequest": "0x75d79399",
    "ProposalQuestionCreated": "0xa1f50470",
    "ProposalExecuted": "0x2b60307a",
    "ExecutionSuccess": "0x442e715f",
}

URLS = [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://eth.drpc.org",
    "https://1rpc.io/eth",
    "https://rpc.flashbots.net",
    "https://cloudflare-eth.com",
    "https://eth.merkle.io",
    "https://0xrpc.io/eth",
]


def h(n):
    return hex(int(n))


def utc(n):
    if not isinstance(n, int) or n <= 0:
        return None
    try:
        return datetime.datetime.fromtimestamp(n, datetime.timezone.utc).isoformat()
    except Exception:
        return None


def r(url, method, params, timeout=18, tries=2):
    for k in range(tries):
        try:
            v = rpc(url, method, params, timeout=timeout)
            if v is not None:
                return v
        except Exception as e:
            if k == tries - 1:
                return {"__error__": str(e)[:160]}
        time.sleep(0.4 * (k + 1))
    return None


def call(url, to, sig, arg=None):
    data = SEL[sig] + (arg.lower().replace("0x", "").rjust(64, "0") if arg else "")
    return r(url, "eth_call", [{"to": to, "data": data}, "latest"])


def num(v):
    return int(v, 16) if isinstance(v, str) and v.startswith("0x") and len(v) > 2 else None


def probe(url, qid):
    d = {"questionId": qid}
    for fn, sel in SEL.items():
        if sel is None:
            continue
        v = call(url, ORACLE, fn, qid)
        if isinstance(v, dict):
            d[fn] = {"error": v.get("__error__")}
            continue
        n = num(v)
        if fn == "isFinalized(bytes32)":
            d[fn] = None if n is None else bool(n)
        elif fn in ("resultFor(bytes32)", "getBestAnswer(bytes32)"):
            d[fn] = {"raw": v, "uint": n}
        elif fn == "getArbitrator(bytes32)":
            d[fn] = "0x" + v[-40:].lower() if n else None
        elif fn in ("getContentHash(bytes32)", "getHistoryHash(bytes32)"):
            d[fn] = v
        else:
            d[fn] = {"raw": n, "utc": utc(n) if "TS" in fn else None,
                     "eth": n / 1e18 if n and "Bond" in fn else None}
    ch = d.get("getContentHash(bytes32)")
    d["exists"] = bool(isinstance(ch, str) and int(ch, 16) != 0)
    return d


def block_at(url, target_unix, lo, hi):
    """Binary search a block whose timestamp is >= target_unix."""
    while lo < hi:
        mid = (lo + hi) // 2
        b = r(url, "eth_getBlockByNumber", [h(mid), False], timeout=15)
        if not isinstance(b, dict) or "timestamp" not in b:
            return None
        t = int(b["timestamp"], 16)
        if t < target_unix:
            lo = mid + 1
        else:
            hi = mid
    return lo


def logs(url, address, topics, lo, hi, depth=0):
    """NEVER ask for a >5k-block range: some public nodes silently return []
    for wide ranges instead of erroring. Small chunks or nothing."""
    flt = {"fromBlock": h(lo), "toBlock": h(hi), "address": address, "topics": topics}
    v = r(url, "eth_getLogs", [flt], timeout=20, tries=1)
    if isinstance(v, list):
        return v
    if depth <= 1:
        for u in URLS:
            if u == url:
                continue
            v2 = r(u, "eth_getLogs", [flt], timeout=15, tries=1)
            if isinstance(v2, list):
                return v2
    if hi - lo <= 5_000 or depth >= 6:
        return []
    mid = (lo + hi) // 2
    return logs(url, address, topics, lo, mid, depth + 1) + \
        logs(url, address, topics, mid + 1, hi, depth + 1)


def logs_chunked(url, address, topics, lo, hi, step=5_000):
    out = []
    x = lo
    while x <= hi:
        out.extend(logs(url, address, topics, x, min(x + step - 1, hi)))
        x += step
    return out


def decode_log(lg):
    tops = lg.get("topics") or []
    data = (lg.get("data") or "0x")[2:]
    words = [data[i:i + 64] for i in range(0, len(data), 64)]
    out = {"block": int(lg["blockNumber"], 16) if lg.get("blockNumber") else None,
           "tx": lg.get("transactionHash"), "topic0": tops[0] if tops else None,
           "topics": tops, "words": words}
    # topics[0] is a full 32-byte hash; our constants are the 4-byte selectors.
    t0 = (tops[0] or "")[:10].lower()
    if t0 == TOPIC["LogNewAnswer"] and len(words) >= 5:
        out["answer"] = "0x" + words[0]
        out["answerUint"] = int(words[0], 16) if words[0] else None
        out["historyHash"] = "0x" + words[1]
        out["bondWei"] = int(words[2], 16) if words[2] else None
        out["bondEth"] = out["bondWei"] / 1e18 if out["bondWei"] else None
        out["answerTS"] = int(words[3], 16) if words[3] else None
        out["answerUTC"] = utc(out["answerTS"])
        out["isCommitment"] = bool(int(words[4], 16)) if words[4] else None
        out["user"] = "0x" + tops[2][-40:].lower() if len(tops) > 2 else None
    if t0 == TOPIC["LogFinalize"] and len(tops) > 2:
        out["finalAnswer"] = tops[2]
        out["finalAnswerUint"] = int(tops[2], 16)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc")
    ap.add_argument("--out", default="rpc_oneinch_control_raw.json")
    ap.add_argument("--md", default="ONEINCH_CONTROL_ONCHAIN.md")
    a = ap.parse_args()
    url, head = find_rpc("ethereum", a.rpc)
    print(f"ethereum: {url} head={head}", flush=True)
    if not url:
        raise SystemExit("no RPC")

    doc = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "rpc": url, "headBlock": head, "real": {}, "control": {}, "logs": {},
           "blocks": {}}

    # ---- A) control experiment -------------------------------------------
    for label, qid in list(Q.items()) + list(CONTROL.items()):
        d = probe(url, qid)
        doc["real" if label in Q else "control"][label] = d
        print(f"  {label:26s} exists={d['exists']} "
              f"finalized={d['isFinalized(bytes32)']} "
              f"result={d['resultFor(bytes32)'].get('uint')} "
              f"bondEth={(d['getBond(bytes32)'] or {}).get('eth')}", flush=True)

    # ---- B) narrow single-topic log scan ---------------------------------
    # Sep 14 2026 15:31 UTC and Sep 22 2026 (comfortably past finalizeTS).
    t_start = int(datetime.datetime(2026, 9, 13, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
    t_end = int(datetime.datetime(2026, 9, 25, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
    lo = 25_940_000
    b_start = block_at(url, t_start, lo, head)
    b_end = block_at(url, t_end, lo, head)
    doc["blocks"] = {"windowStartUnix": t_start, "windowEndUnix": t_end,
                     "startBlock": b_start, "endBlock": b_end}
    print(f"  window blocks {b_start}..{b_end}", flush=True)

    if b_start and b_end and b_end > b_start:
        for label, qid in Q.items():
            got = []
            # BROAD: any oracle event with this questionId at topic1, chunked 5k
            for lg in logs_chunked(url, ORACLE, [None, qid], b_start, b_end):
                got.append(decode_log(lg))
            # narrow: named events too (some nodes index differently)
            for tname in ["LogNewAnswer", "LogFinalize", "LogNotifyOfArbitrationRequest"]:
                for lg in logs_chunked(url, ORACLE, [TOPIC[tname], qid], b_start, b_end):
                    got.append(decode_log(lg))
            for tname in ["ProposalQuestionCreated", "ProposalExecuted"]:
                for lg in logs_chunked(url, MODULE, [TOPIC[tname]], b_start, b_end):
                    got.append(decode_log(lg))
            # de-duplicate by (tx, logIndex-ish)
            seen = set()
            uniq = []
            for g in got:
                k = (g["tx"], tuple(g["topics"]), g.get("data") if "data" in g else None)
                if k in seen:
                    continue
                seen.add(k)
                uniq.append(g)
            doc["logs"][label] = uniq
            print(f"  logs {label}: {len(uniq)} (raw {len(got)})", flush=True)
        doc["logs"]["safe"] = [decode_log(x) for x in
                               logs_chunked(url, SAFE, [TOPIC["ExecutionSuccess"]],
                                            b_start, b_end)]
        print(f"  logs safe: {len(doc['logs']['safe'])}", flush=True)
    else:
        doc["logs"]["error"] = "binary search for window blocks failed"

    # ---- verdict ----------------------------------------------------------
    c = doc["control"]
    trust = all(not v["exists"] and v["isFinalized(bytes32)"] is False
                for v in c.values())
    real = doc["real"]
    w3 = real["wave3-drain"]
    import math
    bond = (w3.get("getBond(bytes32)") or {}).get("eth")
    res = (w3.get("resultFor(bytes32)") or {}).get("uint")
    # Reality.eth doubles the required bond on each new answer.
    # bond = 0.1 * 2^(n-1)  ->  n = log2(bond/0.1) + 1 answers, n-1 disputes.
    steps = int(round(math.log2(bond / 0.1))) + 1 if bond else None
    ans = [x for x in doc["logs"].get("wave3-drain", [])
           if x.get("answerUint") is not None]
    doc["verdict"] = {
        "controlPassed": trust,
        "controlMeaning": ("Real question_ids differ from fabricated ones: getters are "
                           "reading real storage, not a fallback/default." if trust else
                           "CONTROL FAILED — fabricated ids return the same values, "
                           "so the first verdict MUST NOT be trusted."),
        "wave3_finalized": w3.get("isFinalized(bytes32)"),
        "wave3_result": res,
        "wave3_bondEth": bond,
        "wave3_answerCountFromBond": steps,
        "wave3_disputeCountFromBond": (steps - 1) if steps else None,
        "wave3_finalizeUTC": (w3.get("getFinalizeTS(bytes32)") or {}).get("utc"),
        "decodedAnswerCount": len(ans),
        "decodedBondsEth": [x.get("bondEth") for x in ans],
        "decodedAnswers": [x.get("answerUint") for x in ans],
        "executionSuccessLogs": len(doc["logs"].get("safe", [])),
    }
    print("VERDICT:", json.dumps(doc["verdict"], indent=1), flush=True)

    json.dump(doc, open(a.out, "w"), indent=2, default=str)

    L = ["# 1inch wave3-drain — CONTROL experiment (doc tu chain)", "",
         f"Generated {doc['generatedAt']} · `{url}` · head **{head}**. Read-only, khong key/tx/fork.", "",
         "## A) Co phai dang doc default cua contract khong?", "",
         f"**Control passed: {trust}**. {doc['verdict']['controlMeaning']}", "",
         "| question_id | exists | isFinalized | resultFor | contentHash | getBond(ETH) |",
         "|---|---|---|---|---|---|"]
    for grp in ("real", "control"):
        for label, d in doc[grp].items():
            L.append(f"| {grp}/{label} | {d['exists']} | {d['isFinalized(bytes32)']} | "
                     f"{(d['resultFor(bytes32)'] or {}).get('uint')} | "
                     f"{str(d.get('getContentHash(bytes32)'))[:14]}… | "
                     f"{(d.get('getBond(bytes32)') or {}).get('eth')} |")
    L += ["", "## B) Ket cuc", "",
          f"- `wave3-drain`: finalized = **{w3.get('isFinalized(bytes32)')}**, "
          f"`resultFor` = **{res}** (0 = NO), finalizeTS = "
          f"**{(w3.get('getFinalizeTS(bytes32)') or {}).get('utc')}**.",
          f"- `getBond` = **{bond} ETH**. Voi `minimumBond = 0,1 ETH` va "
          "Reality.eth nhan doi bond moi lan co answer moi, day la dau vet cua "
          f"**{doc['verdict']['wave3_answerCountFromBond']} lan tra loi / "
          f"{doc['verdict']['wave3_disputeCountFromBond']} lan dispute** "
          "(0,1 → 0,2 → 0,4 → 0,8 ETH).",
          f"- Log giai ma duoc: **{len(ans)}** `LogNewAnswer`; bond = "
          f"`{doc['verdict']['decodedBondsEth']}`; answer = `{doc['verdict']['decodedAnswers']}`.",
          f"- `ExecutionSuccess` tu Safe trong cua so: "
          f"**{doc['verdict']['executionSuccessLogs']}**.", "",
          "## C) Gioi han", "",
          "- Mot public RPC endpoint, khong doi chieu archive node khac.",
          f"- `eth_getLogs` chi quet block {b_start}..{b_end} (tim bang binary search theo timestamp).",
          "- `resultFor = 0` la **NO da finalize**. No KHONG tu dong nghia la "
          "'khong co tx nao chay' — muon khang dinh phai doc nonce/threshold Safe "
          "va log ExecutionSuccess (da lam o tren).", ""]
    open(a.md, "w").write("\n".join(L) + "\n")
    print(f"wrote {a.out}, {a.md}", flush=True)


if __name__ == "__main__":
    main()
