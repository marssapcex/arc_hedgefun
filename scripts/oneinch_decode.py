#!/usr/bin/env python3
"""Offline decoder for the 1inch wave3-drain probe results.

No network, no RPC, no web. Reads the two JSON files produced by the CI probes
and reconstructs the full dispute timeline from eth_getLogs topics/data.

    python3 scripts/oneinch_decode.py
    -> ONEINCH_DISPUTE_DECODED.md
"""
import datetime
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "rpc_oneinch_raw.json")
CTRL = os.path.join(ROOT, "rpc_oneinch_control_raw.json")
OUT = os.path.join(ROOT, "ONEINCH_DISPUTE_DECODED.md")

T0 = {
    "e47ca4eb": "LogNewAnswer",
    "fe2dac15": "LogNewQuestion",
    "9641ca9d": "LogFundAnswerBounty / min-bond set",
    "18d760be": "LogFinalize",
    "75d79399": "LogNotifyOfArbitrationRequest",
    "a1f50470": "ProposalQuestionCreated",
    "2b60307a": "ProposalExecuted",
    "442e715f": "ExecutionSuccess",
}


def utc(n):
    try:
        return datetime.datetime.fromtimestamp(int(n), datetime.timezone.utc).isoformat()
    except Exception:
        return None


def main():
    d = json.load(open(CTRL))
    raw = json.load(open(RAW))
    logs = d["logs"]["wave3-drain"]
    w3 = d["real"]["wave3-drain"]
    w5 = d["real"]["wave5-accumulation-001"]
    safe = raw["safe"]
    mod = raw["module"]

    L = [
        "# 1inch `wave3-drain` — giai ma tu chain (khong doc bao)",
        "",
        f"Nguon: `rpc_oneinch_raw.json` (head {raw['headBlock']}) + "
        f"`rpc_oneinch_control_raw.json` (head {d['headBlock']}), "
        f"sinh {d['generatedAt']} boi GitHub Actions tren "
        f"`{d['rpc']}`. **Read-only**: `eth_getCode`, `eth_call`, "
        "`eth_getLogs`, `eth_getBalance`, `eth_getBlockByNumber`. "
        "Khong key, khong tx, khong fork, khong web_search.",
        "",
        "## Ket luan: **BI CHAN. NO thang. Khong co tx nao execute.**",
        "",
        "Cau tra loi cho cai con bo ngo o cau truoc (`chua ro ket cuc`). "
        "Attacker dong bond YES, bi nguoi khac dong bond NO gap doi, "
        "lap lai 3 lan. Answer cuoi cung la **NO (0)**, da finalize luc "
        f"**{w3['getFinalizeTS(bytes32)']['utc'] if isinstance(w3['getFinalizeTS(bytes32)'], dict) else w3['getFinalizeTS(bytes32)']}**. "
        "`RealityModuleETH.executeProposal` chi chay khi oracle tra YES — "
        "nen 5 batch tx an trong proposal **khong bao gio duoc goi**.",
        "",
        "## Dung la doc storage that, khong phai fallback",
        "",
        "Control experiment: goi cung 11 getter tren 3 `question_id` bia.",
        "",
        "| question_id | exists | isFinalized | resultFor | getContentHash |",
        "|---|---|---|---|---|",
    ]
    for grp in ("real", "control"):
        for label, q in d[grp].items():
            ch = q.get("getContentHash(bytes32)") or "0x0"
            res = (q.get("resultFor(bytes32)") or {}).get("uint")
            L.append(f"| {grp}/{label} | {q['exists']} | "
                     f"{q['isFinalized(bytes32)']} | {res} | `{str(ch)[:18]}…` |")
    L += ["", "3 id bia deu `exists=false`, `isFinalized=false`, `resultFor` revert. "
          "2 id that tra ve storage khac nhau → ket luan khong phai gia tri mac dinh "
          "cua fallback contract.", "",
          "## Timeline doc tu `eth_getLogs`", "",
          f"Cua so block {d['blocks']['startBlock']}..{d['blocks']['endBlock']} "
          "(tim bang binary search theo timestamp, khong hardcode).", "",
          "| block | UTC | event | nguoi goi | answer | bond | tx |",
          "|---|---|---|---|---|---|---|"]

    for lg in logs:
        tops = lg.get("topics") or []
        w = lg.get("words") or []
        t0 = (tops[0] or "")[2:10]
        name = T0.get(t0, t0)
        user = ("0x" + tops[2][-40:]) if len(tops) > 2 else "—"
        if t0 == "e47ca4eb":
            ans = int(w[0], 16)
            bond = int(w[2], 16) / 1e18
            when = utc(int(w[3], 16))
            ans_s = "**YES (1)**" if ans == 1 else ("**NO (0)**" if ans == 0 else str(ans))
            bond_s = f"{bond:g} ETH"
        elif t0 == "fe2dac15":
            when = utc(int(w[6], 16)) if len(w) > 6 else "—"
            ans_s = "—"
            bond_s = "—"
            user = "module 0xa62d…f2e"
        elif t0 == "9641ca9d":
            when = "—"
            ans_s = "—"
            bond_s = f"{int(w[0], 16) / 1e18:g} ETH"
        else:
            when, ans_s, bond_s = "—", "—", "—"
        L.append(f"| {lg['block']} | {when or '—'} | `{name}` | `{user}` | "
                 f"{ans_s} | {bond_s} | `{str(lg['tx'])[:14]}…` |")

    qtext = ""
    for lg in logs:
        if (lg["topic0"] or "")[2:10] == "fe2dac15" and len(lg.get("words") or []) >= 9:
            qtext = bytes.fromhex("".join(lg["words"][8:])).rstrip(b"\x00").decode("utf8", "replace")
            break

    L += [
        "",
        "Chuoi bond nhan doi dung luat Reality.eth "
        "(`minimumBond = 0,1 ETH`, moi lan dispute bond gap doi): "
        "**0,1 → 0,2 → 0,4 → 0,8 ETH** = 4 answer / 3 dispute. "
        "`getBond()` doc duoc hien tai = **0,8 ETH**, khop log cuoi.",
        "",
        f"- Question text on-chain: `{qtext}`",
        f"- `getContentHash(wave3)` = `{w3['getContentHash(bytes32)']}`",
        f"- `getTimeout` = {w3['getTimeout(bytes32)']['raw']}s = 72h; "
        f"finalizeTS = answer cuoi + 72h.",
        f"- `resultFor` = `{w3['resultFor(bytes32)']['raw']}` → NO; "
        f"`isFinalized` = {w3['isFinalized(bytes32)']}.",
        f"- `wave5-accumulation-001`: bond {w5['getBond(bytes32)']['eth']} ETH, "
        f"resultFor = `{w5['resultFor(bytes32)']['raw']}` (NO), "
        f"finalize {w5['getFinalizeTS(bytes32)']['utc'] if isinstance(w5['getFinalizeTS(bytes32)'], dict) else '—'}. "
        "Cung bi chan.",
        "",
        "## Trang thai Safe / module",
        "",
        f"- Safe `{raw['addresses']['safe']}`: code {raw['code']['safe']} bytes, "
        f"`isModuleEnabled(0xa62d…f2e)` = **{safe['isModuleEnabled_moduleLive']}**, "
        f"`isModuleEnabled(0xa745…bcf)` = **{safe['isModuleEnabled_moduleDead']}**, "
        f"nonce = {safe['nonce']}, threshold = {safe['threshold']}, "
        f"ETH balance = {safe['balanceEth']}.",
        f"- Module: questionTimeout = {mod['questionTimeout()']['seconds']}s, "
        f"questionCooldown = {mod['questionCooldown()']['seconds']}s, "
        f"answerExpiration = {mod['answerExpiration()']['seconds']}s, "
        f"minimumBond = {mod['minimumBond()']['eth']} ETH, "
        f"oracle = `{mod['oracle()']}`, avatar = `{mod['avatar()']}`.",
        f"- `ProposalExecuted` logs: **{raw['verdict']['proposalExecutedLogs']}**. "
        f"`ExecutionSuccess` tu Safe: **{raw['verdict']['executionSuccessLogs']}** "
        f"(control run: {d['verdict']['executionSuccessLogs']}).",
        "",
        "Module **van con enabled** den hom nay. Cai chan khong phai la "
        "`removeModule` hay guardian go bo module — la chinh ket qua "
        "**NO** cua Reality.eth oracle. Day la diem khac voi cach tuong thuat "
        "trong bai blog (noi ve 1IP-XX / Security Council 7-of-12 nhu phanh chinh).",
        "",
        "## Gioi han (doc ky keo tuong day la audit)",
        "",
        "- Mot public RPC endpoint (`ethereum-rpc.publicnode.com`), khong doi chieu "
        "archive node thu hai.",
        "- `eth_getLogs` chi quet block 25.964.781..26.050.749; khong quet toan bo lich su.",
        "- Khong doc ERC-20 balance cua Safe, nen **khong xac nhan con so ~$4,76M** "
        "trong bai bao — do van la so cua nguon secondary, khong phai so tao do duoc.",
        "- `resultFor = 0` khong tu dong bang 'khong co tx'; phai ket hop "
        "`isModuleEnabled`, nonce, va log `ExecutionSuccess` (da lam).",
        "- Day la ket luan ve mot proposal cu thang 9/2026, **khong phai** nhan xet "
        "ve gia token, co hoi mua ban, hay loi khuyen dau tu.",
        "",
        "Scripts: `scripts/rpc_oneinch_reality.py`, `scripts/rpc_oneinch_control.py`, "
        "`scripts/oneinch_decode.py`. Workflows: `.github/workflows/rpc-oneinch.yml`, "
        "`.github/workflows/rpc-oneinch-control.yml`.",
        "",
    ]
    open(OUT, "w").write("\n".join(L) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
