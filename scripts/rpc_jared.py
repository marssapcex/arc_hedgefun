#!/usr/bin/env python3
"""Read-only on-chain verification of the 2026-06-20 JaredFromSubway drain.

No keys, no tx, no fork. Uses eth_getBlockByNumber / eth_getTransactionByHash /
eth_getTransactionReceipt / eth_getCode / eth_call only.

Checks the drain block timestamp, locates the coordinator sweep tx, sums the
real WETH/USDC/USDT Transfer logs out of the bot, confirms the coordinator still
has code, and decodes the operator's on-chain bounty message.
"""
import argparse
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc_probe import find_rpc, rpc  # noqa: E402

URLS = [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
    "https://eth.drpc.org",
    "https://rpc.flashbots.net",
    "https://cloudflare-eth.com",
]
DRAIN_BLOCK = 25360696
BOUNTY_BLOCK = 25370085
OPERATOR = "0xae2fc483527b8ef99eb5d9b44875f005ba1fae13"
IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"  # EIP-1967
APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
FIRST_BAIT = 25354425
ARM_TX = "0xa2c9d0a13cc985e3fe445ad8d8bc2d156eec2580b8b6700ab057f5f1f881de3f"
CHILD_SLOTS = {"0": "owner/payout", "7": "real WETH target",
               "10": "coordinator", "11": "bot operator (targeting marker)"}
DRAIN_TX = "0x2be8704f5a59b69e0b71f64aefdb99eb0e8ae9fb3926147c581910d71bcf3e65"
BOUNTY_TX = "0x3d30d74d8e9c625b44e5ce9b15ea8301d69f0a405e9267c0cf618e2ecd674ab3"
BOT = "0x1f2f10d1c40777ae1da742455c65828ff36df387"
ATTACKER = "0x3e37f4a10d771ba9de44b6d301410b1bedea65d0"
COORDINATOR = "0xb84db016324e8f2bfdd8dd9c260338aee0a8df52"
CHILD = "0x052cb08c527c46a65647982d668d8084c980a784"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
TOKENS = {
    "WETH": ("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 18),
    "USDC": ("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6),
    "USDT": ("0xdac17f958d2ee523a2206206994597c13d831ec7", 6),
}


def h(n):
    return hex(n)


def r(url, method, params, timeout=20, tries=4):
    for k in range(tries):
        try:
            v = rpc(url, method, params, timeout=timeout)
            if v is not None:
                return v
        except Exception as e:
            if k == tries - 1:
                print(f"  {method} failed: {str(e)[:100]}", flush=True)
        time.sleep(0.6 * (k + 1))
    return None


def r_any(method, params, timeout=20):
    """Try several public Ethereum endpoints; return (value, url) or (None, None)."""
    for u in URLS:
        v = r(u, method, params, timeout=timeout, tries=2)
        if v is not None:
            return v, u
    return None, None


def ts(b):
    if not b:
        return None
    t = int(b["timestamp"], 16)
    return {"unix": t, "utc": datetime.datetime.fromtimestamp(t, datetime.timezone.utc).isoformat()}


def addr(topic):
    return "0x" + topic[-40:]


def decode_text(data):
    try:
        raw = bytes.fromhex(data.replace("0x", ""))
        return "".join(chr(c) if 32 <= c < 127 else "" for c in raw)
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc")
    ap.add_argument("--out", default="rpc_jared_raw.json")
    ap.add_argument("--md", default="JARED_ONCHAIN.md")
    a = ap.parse_args()
    url, head = find_rpc("ethereum", a.rpc)
    print(f"ethereum: {url} head={head}", flush=True)
    if not url:
        raise SystemExit("no RPC")

    doc = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "rpc": url, "headBlock": head, "blocks": {}, "drain": {}, "bounty": {}, "allowances": {}}

    # 1) drain block header
    b = r(url, "eth_getBlockByNumber", [h(DRAIN_BLOCK), False])
    doc["blocks"]["drain"] = {"number": DRAIN_BLOCK, "timestamp": ts(b),
                              "txCount": len(b.get("transactions", [])) if b else None,
                              "hash": b.get("hash") if b else None}
    print("drain block", doc["blocks"]["drain"], flush=True)

    # 2) the sweep tx
    tx = r(url, "eth_getTransactionByHash", [DRAIN_TX])
    if tx:
        doc["drain"] = {"hash": DRAIN_TX, "from": tx.get("from"), "to": tx.get("to"),
                        "blockNumber": int(tx["blockNumber"], 16) if tx.get("blockNumber") else None,
                        "inputSelector": (tx.get("input") or "")[:10],
                        "inputBytes": (len(tx.get("input") or "") - 2) // 2,
                        "valueWei": int(tx.get("value", "0x0"), 16)}
    print("drain tx", doc["drain"], flush=True)

    # 3) receipt / logs: count and sum real-token Transfers out of the bot
    rc, rc_url = r_any("eth_getTransactionReceipt", [DRAIN_TX])
    logs = rc.get("logs", []) if isinstance(rc, dict) else []
    source = f"eth_getTransactionReceipt@{rc_url}" if logs else None
    if isinstance(rc, dict):
        doc["drain"]["status"] = rc.get("status")
        doc["drain"]["gasUsed"] = int(rc.get("gasUsed", "0x0"), 16) if rc.get("gasUsed") else None
    if not logs:
        flt = {"fromBlock": h(DRAIN_BLOCK), "toBlock": h(DRAIN_BLOCK),
               "address": [a for a, _ in TOKENS.values()],
               "topics": [TRANSFER, "0x" + BOT.lower().replace("0x", "").rjust(64, "0")]}
        gl, gl_url = r_any("eth_getLogs", [flt])
        if isinstance(gl, list):
            logs = gl
            source = f"eth_getLogs@{gl_url}"
            print(f"eth_getLogs returned {len(logs)} logs", flush=True)
    sums = {s: {"count": 0, "raw": 0, "human": 0.0, "amounts": []} for s in TOKENS}
    totals = {"logs": len(logs), "source": source}
    byaddr = {a.lower(): s for s, (a, _) in TOKENS.items()}
    for lg in logs:
        if (lg.get("transactionHash") or DRAIN_TX).lower() != DRAIN_TX.lower():
            continue
        sym = byaddr.get((lg.get("address") or "").lower())
        if not sym or not lg.get("topics") or lg["topics"][0].lower() != TRANSFER:
            continue
        if len(lg["topics"]) < 3:
            continue
        frm, to = addr(lg["topics"][1]).lower(), addr(lg["topics"][2]).lower()
        if frm != BOT.lower():
            continue
        amt = int(lg.get("data", "0x0"), 16)
        if amt == 0:
            continue
        dec = TOKENS[sym][1]
        sums[sym]["count"] += 1
        sums[sym]["raw"] += amt
        sums[sym]["human"] += amt / 10 ** dec
        sums[sym]["amounts"].append(amt / 10 ** dec)
        sums[sym].setdefault("recipients", {}).setdefault(to, 0)
        sums[sym]["recipients"][to] += 1
    totals["logsFromBot"] = sum(v["count"] for v in sums.values())
    totals["attackerRecipient"] = ATTACKER.lower()
    doc["drain"]["transfers"] = sums
    doc["drain"]["logTotals"] = totals
    print("transfer sums", {s: (v["count"], round(v["human"], 6)) for s, v in sums.items()}, flush=True)

    # 4) coordinator code still deployed
    c = r(url, "eth_getCode", [COORDINATOR, "latest"])
    doc["coordinator"] = {"address": COORDINATOR,
                          "codeBytes": (len(c) - 2) // 2 if isinstance(c, str) else None}

    # 5) bounty block + message
    bb = r(url, "eth_getBlockByNumber", [h(BOUNTY_BLOCK), False])
    doc["blocks"]["bounty"] = {"number": BOUNTY_BLOCK, "timestamp": ts(bb)}
    bt = r(url, "eth_getTransactionByHash", [BOUNTY_TX])
    if bt:
        doc["bounty"] = {"hash": BOUNTY_TX, "from": bt.get("from"), "to": bt.get("to"),
                         "blockNumber": int(bt["blockNumber"], 16) if bt.get("blockNumber") else None,
                         "valueWei": int(bt.get("value", "0x0"), 16),
                         "inputText": decode_text(bt.get("input") or "")}
    print("bounty", doc["bounty"], flush=True)

    # 6) allowance to a representative child, now and at the block before the drain
    data = "0xdd62ed3e" + BOT.lower().replace("0x", "").rjust(64, "0") + \
        CHILD.lower().replace("0x", "").rjust(64, "0")
    for label, blk in [("latest", "latest"), ("preDrain", h(DRAIN_BLOCK - 1)),
                       ("postDrain", h(DRAIN_BLOCK))]:
        v = r(url, "eth_call", [{"to": TOKENS["WETH"][0], "data": data}, blk])
        doc["allowances"][label] = {
            "block": blk,
            "raw": int(v, 16) if isinstance(v, str) and v.startswith("0x") else None,
            "human": (int(v, 16) / 1e18) if isinstance(v, str) and v.startswith("0x") else None,
            "error": None if isinstance(v, str) else "historical state unavailable on public RPC",
        }
    print("allowances", doc["allowances"], flush=True)

    # 7) is the drained bot contract upgradeable at all? If not, any "fix" is off-chain.
    post = {"bot": BOT, "operator": OPERATOR}
    c = r(url, "eth_getCode", [BOT, "latest"])
    post["botCodeBytes"] = (len(c) - 2) // 2 if isinstance(c, str) else None
    st = r(url, "eth_getStorageAt", [BOT, IMPL_SLOT, "latest"])
    post["eip1967ImplSlot"] = st
    post["looksLikeProxy"] = bool(st) and int(st, 16) != 0 if isinstance(st, str) else None
    n = r(url, "eth_getTransactionCount", [OPERATOR, "latest"])
    post["operatorNonce"] = int(n, 16) if isinstance(n, str) else None
    c2 = r(url, "eth_getCode", [OPERATOR, "latest"])
    post["operatorCodeBytes"] = (len(c2) - 2) // 2 if isinstance(c2, str) else None
    doc["postFix"] = post
    print("postFix", post, flush=True)

    # 8) what did the attacker bake into a bait child at DEPLOY time?
    slots = {}
    for k, label in CHILD_SLOTS.items():
        v = r(url, "eth_getStorageAt", [CHILD, h(int(k)), "latest"])
        slots[k] = {"label": label, "raw": v,
                    "address": ("0x" + v[-40:]) if isinstance(v, str) else None}
    doc["childStorage"] = slots
    print("childStorage", {k: v["address"] for k, v in slots.items()}, flush=True)

    # 9) the arming round's receipt: who did the bot actually approve?
    arc, arc_url = r_any("eth_getTransactionReceipt", [ARM_TX])
    aps = []
    if isinstance(arc, dict):
        for lg in arc.get("logs", []):
            t = lg.get("topics") or []
            if ((lg.get("address") or "").lower() != TOKENS["WETH"][0]
                    or len(t) < 3 or t[0].lower() != APPROVAL):
                continue
            aps.append({"owner": "0x" + t[1][-40:], "spender": "0x" + t[2][-40:],
                        "amountWETH": int(lg.get("data", "0x0"), 16) / 1e18})
    doc["armingApproval"] = {"tx": ARM_TX, "source": arc_url,
                             "status": arc.get("status") if isinstance(arc, dict) else None,
                             "count": len(aps), "approvals": aps}
    print("armingApproval", doc["armingApproval"], flush=True)

    arm = doc["armingApproval"]
    bits = ", ".join("`" + a["spender"] + "` (" + str(round(a["amountWETH"], 6))
                     + " WETH)" for a in arm["approvals"])
    sample_line = (f"Arming tx `{ARM_TX}` (`{arm['source']}`, status {arm['status']}): "
                   f"**{arm['count']}** WETH `Approval` logs. Spender(s): "
                   + (bits if bits else "—") + ".")

    json.dump(doc, open(a.out, "w"), indent=2, default=str)
    d = doc["drain"]
    L = ["# JaredFromSubway drain — read-only on-chain check", "",
         f"Generated {doc['generatedAt']} · `{url}` · head {head}. No tx, no fork, no key.", "",
         f"Drain block **{DRAIN_BLOCK}** = {doc['blocks']['drain']['timestamp']['utc']}. " +
         f"Sweep tx `{DRAIN_TX}` → `{d.get('to')}`, selector `{d.get('inputSelector')}`, " +
         f"status `{d.get('status')}`, gas `{d.get('gasUsed')}`.", "",
         "Real ERC-20 `Transfer` logs with `from` = bot `0x1f2f…f387`, summed from the receipt:", "",
         "| Token | Transfer legs | Amount |", "|---|---|---|"]
    for s, v in d.get("transfers", {}).items():
        L.append(f"| {s} | {v['count']} | {v['human']:,.6f} |")
    L += ["", f"Log source: `{d.get('logTotals',{}).get('source','—')}`. Total logs: {d.get('logTotals',{}).get('logs','—')}; " +
          f"real-token legs out of bot: {d.get('logTotals',{}).get('logsFromBot','—')}.",
          "", f"Coordinator `{COORDINATOR}` code today: {doc['coordinator']['codeBytes']} bytes.", "",
          f"Bounty block {BOUNTY_BLOCK}: {doc['blocks']['bounty']['timestamp']['utc']}. " +
          f"Tx `{BOUNTY_TX}` from `{doc['bounty'].get('from')}`:", "",
          "> " + doc["bounty"].get("inputText", "(not decoded)"), "",
          "Historical `allowance()` reads: " + json.dumps(doc["allowances"]), "",
          "", "## Bot contract today",
          "",
          f"`{BOT}` code: {doc['postFix']['botCodeBytes']} bytes. " +
          f"EIP-1967 implementation slot: `{doc['postFix']['eip1967ImplSlot']}` → " +
          f"proxy = **{doc['postFix']['looksLikeProxy']}**. " +
          f"Operator `{OPERATOR}` nonce: {doc['postFix']['operatorNonce']}, " +
          f"code: {doc['postFix']['operatorCodeBytes']} bytes.", "",
          "", "## Recon evidence baked into a bait child", "",
          f"Child `{CHILD}` storage at deploy time:", "",
          "| Slot | Meaning | Address |", "|---|---|---|"] + [
          f"| {k} | {v['label']} | `{v['address']}` |" for k, v in doc["childStorage"].items()
    ] + ["", "WETH `Approval` decode (spender is `topic2`, **not** the pool):", "",
          sample_line, "", "Raw: `rpc_jared_raw.json`."]
    open(a.md, "w").write("\n".join(L) + "\n")
    print(f"wrote {a.out}, {a.md}", flush=True)


if __name__ == "__main__":
    main()
