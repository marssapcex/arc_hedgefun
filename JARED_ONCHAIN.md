# JaredFromSubway drain — read-only on-chain check

Generated 2026-11-04T16:20:35.624340+00:00 · `https://ethereum-rpc.publicnode.com` · head 26342606. No tx, no fork, no key.

Drain block **25360696** = 2026-06-20T18:49:11+00:00. Sweep tx `0x2be8704f5a59b69e0b71f64aefdb99eb0e8ae9fb3926147c581910d71bcf3e65` → `0xb84db016324e8f2bfdd8dd9c260338aee0a8df52`, selector `0xc269a509`, status `None`, gas `None`.

Real ERC-20 `Transfer` logs with `from` = bot `0x1f2f…f387`, summed from the receipt:

| Token | Transfer legs | Amount |
|---|---|---|
| WETH | 0 | 0.000000 |
| USDC | 0 | 0.000000 |
| USDT | 0 | 0.000000 |

Total logs in receipt: 0; real-token legs out of bot: —.

Coordinator `0xb84db016324e8f2bfdd8dd9c260338aee0a8df52` code today: 2537 bytes.

Bounty block 25370085: 2026-06-22T02:15:35+00:00. Tx `0x3d30d74d8e9c625b44e5ce9b15ea8301d69f0a405e9267c0cf618e2ecd674ab3` from `0xae2fc483527b8ef99eb5d9b44875f005ba1fae13`:

> Well played. We are willing to offer a 50% white hat bounty if you return 2150 ETH to this address in the next 48 hours, otherwise we will pursue all available legal and law-enforcement remedies.

Historical `allowance()` reads: {"latest": {"block": "latest", "raw": 0, "human": 0.0, "error": null}, "preDrain": {"block": "0x182f937", "raw": null, "human": null, "error": "historical state unavailable on public RPC"}, "postDrain": {"block": "0x182f938", "raw": null, "human": null, "error": "historical state unavailable on public RPC"}}

Raw: `rpc_jared_raw.json`.
