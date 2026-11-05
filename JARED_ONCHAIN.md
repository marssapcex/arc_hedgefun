# JaredFromSubway drain — read-only on-chain check

Generated 2026-11-05T02:06:37.804166+00:00 · `https://ethereum-rpc.publicnode.com` · head 26345529. No tx, no fork, no key.

Drain block **25360696** = 2026-06-20T18:49:11+00:00. Sweep tx `0x2be8704f5a59b69e0b71f64aefdb99eb0e8ae9fb3926147c581910d71bcf3e65` → `0xb84db016324e8f2bfdd8dd9c260338aee0a8df52`, selector `0xc269a509`, status `0x1`, gas `1378524`.

Real ERC-20 `Transfer` logs with `from` = bot `0x1f2f…f387`, summed from the receipt:

| Token | Transfer legs | Amount |
|---|---|---|
| WETH | 16 | 1,474.582523 |
| USDC | 20 | 2,870,573.127680 |
| USDT | 14 | 2,035,760.155871 |

Log source: `eth_getTransactionReceipt@https://1rpc.io/eth`. Total logs: 50; real-token legs out of bot: 50.

Coordinator `0xb84db016324e8f2bfdd8dd9c260338aee0a8df52` code today: 2537 bytes.

Bounty block 25370085: 2026-06-22T02:15:35+00:00. Tx `0x3d30d74d8e9c625b44e5ce9b15ea8301d69f0a405e9267c0cf618e2ecd674ab3` from `0xae2fc483527b8ef99eb5d9b44875f005ba1fae13`:

> Well played. We are willing to offer a 50% white hat bounty if you return 2150 ETH to this address in the next 48 hours, otherwise we will pursue all available legal and law-enforcement remedies.

Historical `allowance()` reads: {"latest": {"block": "latest", "raw": 0, "human": 0.0, "error": null}, "preDrain": {"block": "0x182f937", "raw": null, "human": null, "error": "historical state unavailable on public RPC"}, "postDrain": {"block": "0x182f938", "raw": null, "human": null, "error": "historical state unavailable on public RPC"}}


## Bot contract today

`0x1f2f10d1c40777ae1da742455c65828ff36df387` code: 13835 bytes. EIP-1967 implementation slot: `0x0000000000000000000000000000000000000000000000000000000000000000` → proxy = **False**. Operator `0xae2fc483527b8ef99eb5d9b44875f005ba1fae13` nonce: 6611474, code: 0 bytes.


## Recon evidence baked into a bait child

Child `0x052cb08c527c46a65647982d668d8084c980a784` storage at deploy time:

| Slot | Meaning | Address |
|---|---|---|
| 0 | owner/payout | `0x3e37f4a10d771ba9de44b6d301410b1bedea65d0` |
| 7 | real WETH target | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` |
| 10 | coordinator | `0xb84db016324e8f2bfdd8dd9c260338aee0a8df52` |
| 11 | bot operator (targeting marker) | `0xae2fc483527b8ef99eb5d9b44875f005ba1fae13` |

WETH `Approval` logs with `owner` = bot in blocks 25354425–25354925: 0 (via `https://rpc.flashbots.net`).

Raw: `rpc_jared_raw.json`.
