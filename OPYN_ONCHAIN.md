# Opyn Convexity v1 — read-only on-chain check

Generated 2026-11-04T15:27:48.915035+00:00 · block 26342343 · `https://ethereum-rpc.publicnode.com`. No tx, no fork, no key.

| Contract | Code | Native ETH | Note |
|---|---|---|---|
| OptionsFactory (v1 main) `0xcC5d905b9c2c8C9329Eb4e25dc086369D6C7777C` | 24551B | 0.000000 | owner=0x87887cf0e37d937f989ab76b99e4f4682da044c4 (code 170B) |
| OptionsFactory (second, DefiLlama adapter) `0xb529964f86fbf99a6aa67f72a27e59fa3fa4feac` | 24510B | 0.000000 | owner=0x9e68b67660c223b3e0634d851f5df821e0e17d84 (code 0B) |
| OptionsExchange `0x39246c4F3F6592C974EBC44F80bA6dC69b817c71` | 3394B | 0.000000 | no owner() view (exchange) |
| Compound oracle `0x7054e08461e3eCb7718B63540adDB3c3A1746415` | 1811B | 0.000000 | no owner() view (oracle) |

Factory `getNumberOfOptionsContracts()` = **157** across both factories, enumerated 157/157 (`codeBytesMissing=0`, `nativeWeiMissing=0`). **All 157 have `hasExpired()=1`**; latest `expiry()` = 2021-12-31 08:00 UTC. ETH still on oToken contracts: 225.567473.

ERC20 still on oToken contracts:

- DAI: 1.801998
- DPI: 4.102647
- DYDX: 1,554.660000
- UNI: 118.428909
- USDC: 25,094.400395
- WBTC: 0.001895
- WETH: 0.000000

Raw: `rpc_opyn_raw.json`.
