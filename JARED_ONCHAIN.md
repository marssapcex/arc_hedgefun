# JaredFromSubway drain — read-only on-chain check

Generated 2026-11-05T02:13:51.215353+00:00 · `https://ethereum-rpc.publicnode.com` · head 26345566. No tx, no fork, no key.

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

`0x1f2f10d1c40777ae1da742455c65828ff36df387` code: 13835 bytes. EIP-1967 implementation slot: `0x0000000000000000000000000000000000000000000000000000000000000000` → proxy = **False**. Operator `0xae2fc483527b8ef99eb5d9b44875f005ba1fae13` nonce: 6611478, code: 0 bytes.


## Recon evidence baked into a bait child

Child `0x052cb08c527c46a65647982d668d8084c980a784` storage at deploy time:

| Slot | Meaning | Address |
|---|---|---|
| 0 | owner/payout | `0x3e37f4a10d771ba9de44b6d301410b1bedea65d0` |
| 7 | real WETH target | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` |
| 10 | coordinator | `0xb84db016324e8f2bfdd8dd9c260338aee0a8df52` |
| 11 | bot operator (targeting marker) | `0xae2fc483527b8ef99eb5d9b44875f005ba1fae13` |

WETH `Approval` decode (spender is `topic2`, **not** the pool):

Arming tx `0xa2c9d0a13cc985e3fe445ad8d8bc2d156eec2580b8b6700ab057f5f1f881de3f` (`https://1rpc.io/eth`, status 0x1): **16** WETH `Approval` logs. Spender(s): `0x32ed8c7512a4766ac0aaab4a26a25519159d00a2` (92.161408 WETH), `0x155596a9be8942afd0f9d368fbf8089cf02fada3` (92.161408 WETH), `0x80ba9b35cf5db6c56af43d7925ce8098e32fead1` (92.161408 WETH), `0x45c4ae5cc9c8a0334fc18c75add87a866eba3255` (92.161408 WETH), `0x4ee0b6e9f9c4886beeef2ebd7fc27223169531ce` (92.161408 WETH), `0x0b52db096a26a1b8cfaab9d92184f289e3e5b0b3` (92.161408 WETH), `0x757230bd24489b8d8817f4ff8e5a35ebeb3dde39` (92.161408 WETH), `0x265ea50a6ded45299c7d8cfa112c125ee14f87fd` (92.161408 WETH), `0x69216c47c5aab95f0f90db3ffa8d16970506ad0e` (92.161408 WETH), `0x5b646681cf3d4ed2ed1d93d3627ab6f1374e22fc` (92.161408 WETH), `0x052cb08c527c46a65647982d668d8084c980a784` (92.161408 WETH), `0x2f34f74c3eb35426bb53c0328a54570cfa478f82` (92.161408 WETH), `0x2e32c187513e8296917c4c2e6b88bda7f3ad3fd9` (92.161408 WETH), `0x069eab79e3bbe25b4d9d6d3fbe9b1f911f4e90ca` (92.161408 WETH), `0xa61d15479e0aee1fca32fb0f4f9865102d13b7c8` (92.161408 WETH), `0x4556deb2280ca13e5e5109efc0ce5d89ca8ea183` (92.161408 WETH).

Raw: `rpc_jared_raw.json`.
