# RPC follow-up: ownership chain, verified on-chain

Generated 2026-11-04T10:26:55.999127+00:00. Read-only: `eth_call`, `eth_getCode`, `eth_getStorageAt`, `eth_getBalance`. No tx, no fork, no key.

Addresses probed here were returned by on-chain calls in `rpc_probe_raw.json`, or taken from the protocol's own deployed-address config in its public repo. Every value below is what the chain returned at the block numbers in that file.

| Chain | Contract | Code | Calls that answered |
|---|---|---|---|
| ethereum | Hop timelock | 11395B | getMinDelay() |
| ethereum | Hop governor | 19793B | timelock(), token(), proposalThreshold(), quorumNumerator(), quorumDenominator(), votingDelay(), votingPeriod() |
| ethereum | Hop L1 bridge USDC | 19299B | — |
| ethereum | Hop L1 bridge DAI | 19373B | — |
| ethereum | Hop L1 bridge ETH | 19373B | — |
| ethereum | Hop L1 bridge USDT | 19373B | — |
| ethereum | Angle timelock | 8542B | getMinDelay() |
| ethereum | Angle governor | 2673B | timelock(), token(), proposalThreshold(), votingDelay(), votingPeriod() |
| ethereum | BiFi timelock | 7285B | getMinDelay() |
| ethereum | BiFi governor | 12349B | owner(), timelock(), token(), proposalThreshold(), quorumNumerator(), quorumDenominator(), votingDelay(), votingPeriod() |
| ethereum | Flux timelock/admin | 5939B | admin(), delay() |
| ethereum | Flux governor | 1065B | admin(), timelock(), implementation(), proposalCount(), proposalThreshold(), quorumVotes(), votingDelay(), votingPeriod() |
| ethereum | PEAKDEFI timelock | 5866B | — |
| ethereum | Rari timelock | 5955B | admin() |
| ethereum | Easedefi timelock/admin | 4076B | delay() |
| ethereum | Concentrator multisig | 171B | — |
| ethereum | Concentrator ProxyAdmin | 2171B | owner() |
| ethereum | Concentrator vault impl | 19535B | totalSupply(), symbol() |
| ethereum | Concentrator vault proxy | 2091B | owner(), totalSupply(), decimals(), symbol() |
| ethereum | Angle governor impl | 15915B | proposalThreshold(), votingPeriod() |
| ethereum | Flux governor impl | 18096B | quorumVotes(), votingDelay(), votingPeriod() |
| ethereum | Rari governor impl | 16932B | votingDelay(), votingPeriod() |
| moonriver | Moonwell Apollo governor | 22521B | timelock(), proposalCount(), proposalThreshold(), votingDelay(), votingPeriod() |
| moonriver | Moonwell Apollo timelock | 7486B | admin(), delay() |
| moonriver | Moonwell Apollo comptroller | 1508B | admin(), oracle() |
| moonriver | Moonwell Apollo oracle | 3985B | admin() |
| moonriver | MFAM token | 8186B | totalSupply(), decimals(), symbol() |
| flare | Kinetic Unitroller admin | 10302B | getMinDelay() |
| flare | Kinetic oracle | 7791B | owner() |
| linea | Mendi timelock proposer A | 171B | getOwners(), getThreshold() |
| monad | Neverland owner | 171B | getOwners(), getThreshold() |
| ethereum | HOP token (owner=timelock) | 19146B | owner(), decimals() |
| ethereum | ANGLE token | 10122B | totalSupply(), decimals(), symbol() |
| ethereum | BiFi vote token (governor.token) | 9215B | totalSupply(), decimals(), symbol() |
| ethereum | RGT token | 2261B | totalSupply(), decimals(), symbol(), paused() |
| ethereum | PEAK token | 6034B | totalSupply(), decimals(), symbol(), paused(), getRoleMemberCount(PROPOSER_ROLE), getRoleMemberCount(EXECUTOR_ROLE), getRoleMemberCount(ADMIN_ROLE) |
| ethereum | veCTR | 9763B | totalSupply(), symbol() |
| moonriver | Moonwell MFAM token | 8186B | totalSupply(), decimals(), symbol() |
| fantom | TAROT token | 13370B | owner(), token(), totalSupply(), decimals(), symbol() |
| aurora | Aurigami PLY token | 5162B | admin(), totalSupply(), decimals(), symbol(), paused() |
| aurora | TRI token | 8556B | totalSupply(), decimals(), symbol() |
| flare | Kinetic JOULE token | 2227B | totalSupply(), decimals(), symbol() |
| linea | MENDI token | 2141B | totalSupply(), decimals(), symbol() |
| monad | Neverland DUST token | 2227B | owner(), totalSupply(), decimals(), symbol(), paused() |
| flare | Kinetic oracle admin (slot0) | 7717B | getMinDelay() |
| moonriver | Moonwell comptroller impl (slot2) | 24241B | admin() |
| linea | Mendi/Neverland Safe singleton | 24421B | getThreshold() |

## Raw

See `rpc_follow_raw.json`.
