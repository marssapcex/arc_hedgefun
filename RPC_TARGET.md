# Pass 3 — money behind the ownership chain

Generated 2026-11-04T10:30:25.134203+00:00. Read-only RPC. No tx, no fork, no key.

| Chain | Contract | Code | Views that answered |
|---|---|---|---|
| moonriver | Moonwell Apollo governor | 22521B | getQuorum(), currentQuorum(), breakGlassGuardian(), guardianSunset(), govToken(), proposalCount() |
| moonriver | Moonwell Apollo timelock | 7486B | admin(), delay() |
| moonriver | Moonwell Apollo Unitroller | 1508B | admin(), oracle() |
| moonriver | Moonwell Apollo oracle | 3985B | admin() |
| moonriver | MFAM token | 8186B | totalSupply(), decimals(), symbol() |
| moonriver | Moonwell comptroller impl | 24241B | admin() |
| ethereum | Hop timelock | 11395B | getMinDelay(), PROPOSER_ROLE(), EXECUTOR_ROLE() |
| ethereum | Hop governor | 19793B | proposalThreshold(), votingDelay(), votingPeriod(), timelock(), token() |
| ethereum | HOP token | 19146B | owner() |
| ethereum | Hop L1 bridge USDC | 19299B | — |
| ethereum | Hop L1 bridge DAI | 19373B | — |
| ethereum | Hop L1 bridge ETH | 19373B | — |
| ethereum | Angle timelock | 8542B | getMinDelay(), PROPOSER_ROLE(), EXECUTOR_ROLE() |
| ethereum | Angle governor | 2673B | proposalThreshold(), votingPeriod(), timelock(), token() |
| ethereum | ANGLE token | 10122B | totalSupply(), decimals(), symbol() |
| ethereum | Flux timelock | 5939B | admin(), delay() |
| ethereum | GBiFi vote token | 9215B | underlying(), totalSupply(), decimals(), symbol() |
| ethereum | Concentrator multisig | 171B | — |
| ethereum | Concentrator ProxyAdmin | 2171B | owner() |
| moonriver | Moonwell market MOVR (0x6a1A771C) | 21171B | admin(), getCash(), totalBorrows(), totalReserves(), totalSupply(), decimals() |
| moonriver | Moonwell market xcKSM (0xa0D11651) | 7959B | admin(), implementation(), getCash(), totalBorrows(), totalReserves(), underlying() |
| moonriver | Moonwell market FRAX (0x93Ef8B7c) | 7959B | admin(), implementation(), getCash(), totalBorrows(), totalReserves(), underlying() |
| moonriver | Moonwell market BTC.multi (0x6E745367) | 7959B | admin(), implementation(), getCash(), totalBorrows(), totalReserves(), underlying() |
| moonriver | Moonwell market USDC.multi (0xd0670AEe) | 7959B | admin(), implementation(), getCash(), totalBorrows(), totalReserves(), underlying() |
| moonriver | Moonwell market ETH.multi (0x6503D905) | 7959B | admin(), implementation(), getCash(), totalBorrows(), totalReserves(), underlying() |
| moonriver | Moonwell market USDT.multi (0x36918B66) | 7959B | admin(), implementation(), getCash(), totalBorrows(), totalReserves(), underlying() |

Raw: `rpc_target_raw.json`.
