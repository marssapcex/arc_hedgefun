# Zombie-chain RPC census

Generated `2026-11-04T14:50:13.286410+00:00`. Read-only `eth_chainId` / `eth_blockNumber` / `eth_getBlockByNumber` / `eth_getCode` / `eth_getBalance`. No tx, no fork, no key.

Universe: 335 chains with DefiLlama `chainTvl <= $5m`; 106 non-EVM/unmapped skipped; **229 EVM chains actually probed**.

| Status | Count | Meaning |
|---|---|---|
| LIVE | 70 | last block < 1h |
| STALLED | 5 | last block 1h..30d |
| FROZEN | 8 | last block > 30d (zombie thật) |
| DEAD_RPC | 99 | không endpoint nào trả lời |
| CHAINID_MISMATCH | 1 | endpoint trả chain khác |

## FROZEN / DEAD_RPC (chain chết thật)

| Chain | DefiLlama TVL | Status | Block cuối | Tuổi | RPC |
|---|---|---|---|---|---|
| GodwokenV1 | $0 | FROZEN | 2026-06-12T05:34:00 | 145.39d | https://v1.mainnet.godwoken.io/rpc |
| Polygon zkEVM | $0 | FROZEN | 2026-07-03T15:55:44 | 123.95d | https://zkevm-rpc.com |
| Moonriver | $0 | FROZEN | 2026-08-10T08:27:48 | 86.27d | https://moonriver.api.onfinality.io/public |
| Moonbeam | $0 | FROZEN | 2026-08-10T11:36:12 | 86.13d | https://moonbeam.api.onfinality.io/public |
| LaChain Network | $44,912 | FROZEN | 2026-09-01T12:36:34 | 64.09d | https://rpc1.mainnet.lachain.network |
| Eteria | $0 | FROZEN | 2026-09-03T16:54:25 | 61.91d | https://mainnet.eteria.io/v1 |
| Harmony | $0 | FROZEN | 2026-09-10T14:41:43 | 55.01d | https://api.harmony.one |
| K2 | $168 | FROZEN | 2026-09-17T03:53:57 | 48.46d | https://rpc.karak.network |
| Corn | $0 | DEAD_RPC | — | —d | — |
| TAC | $233,073 | DEAD_RPC | — | —d | — |
| Palm | $0 | DEAD_RPC | — | —d | — |
| Heco | $0 | DEAD_RPC | — | —d | — |
| Boba_Bnb | $0 | DEAD_RPC | — | —d | — |
| ThunderCore | $0 | DEAD_RPC | — | —d | — |
| Evmos | $0 | DEAD_RPC | — | —d | — |
| Eclipse | $38,781 | DEAD_RPC | — | —d | — |
| Canto | $0 | DEAD_RPC | — | —d | — |
| Hoo | $0 | DEAD_RPC | — | —d | — |
| Astar | $1,140,123 | DEAD_RPC | — | —d | — |
| Meter | $0 | DEAD_RPC | — | —d | — |
| Shiden | $0 | DEAD_RPC | — | —d | — |
| Milkomeda C1 | $0 | DEAD_RPC | — | —d | — |
| Empire | $0 | DEAD_RPC | — | —d | — |
| Step | $0 | DEAD_RPC | — | —d | — |
| Callisto | $0 | DEAD_RPC | — | —d | — |
| CSC | $0 | DEAD_RPC | — | —d | — |
| Ergo | $950,531 | DEAD_RPC | — | —d | — |
| Nahmii | $0 | DEAD_RPC | — | —d | — |
| Goerli | $0 | DEAD_RPC | — | —d | — |
| Bahamut | $0 | DEAD_RPC | — | —d | — |
| Boba_Avax | $0 | DEAD_RPC | — | —d | — |
| DFK | $0 | DEAD_RPC | — | —d | — |
| Dogechain | $0 | DEAD_RPC | — | —d | — |
| Milkomeda A1 | $0 | DEAD_RPC | — | —d | — |
| Findora | $0 | DEAD_RPC | — | —d | — |
| REIchain | $0 | DEAD_RPC | — | —d | — |
| SX Network | $0 | DEAD_RPC | — | —d | — |
| SX Rollup | $0 | DEAD_RPC | — | —d | — |
| Odyssey | $0 | DEAD_RPC | — | —d | — |
| Nova Network | $0 | DEAD_RPC | — | —d | — |
| Kroma | $0 | DEAD_RPC | — | —d | — |
| Dexit | $0 | DEAD_RPC | — | —d | — |
| DChain | $0 | DEAD_RPC | — | —d | — |
| Ancient8 | $0 | DEAD_RPC | — | —d | — |
| ShimmerEVM | $0 | DEAD_RPC | — | —d | — |
| Tombchain | $0 | DEAD_RPC | — | —d | — |
| Pego | $0 | DEAD_RPC | — | —d | — |
| Cube | $0 | DEAD_RPC | — | —d | — |
| Botanix | $0 | DEAD_RPC | — | —d | — |
| Nibiru | $382,175 | DEAD_RPC | — | —d | — |
| Astar zkEVM | $0 | DEAD_RPC | — | —d | — |
| DuckChain | $0 | DEAD_RPC | — | —d | — |
| Superposition | $0 | DEAD_RPC | — | —d | — |
| EDU Chain | $703 | DEAD_RPC | — | —d | — |
| UX | $0 | DEAD_RPC | — | —d | — |
| Optimism | $0 | DEAD_RPC | — | —d | — |
| Oraichain | $79,174 | DEAD_RPC | — | —d | — |
| inEVM | $0 | DEAD_RPC | — | —d | — |
| Crab | $0 | DEAD_RPC | — | —d | — |
| ENULS | $0 | DEAD_RPC | — | —d | — |
| XPLA | $115,482 | DEAD_RPC | — | —d | — |
| Swellchain | $0 | DEAD_RPC | — | —d | — |
| Tenet | $0 | DEAD_RPC | — | —d | — |
| Mint | $0 | DEAD_RPC | — | —d | — |
| Bitlayer | $461,869 | DEAD_RPC | — | —d | — |
| Superseed | $0 | DEAD_RPC | — | —d | — |
| Form Network | $0 | DEAD_RPC | — | —d | — |
| Taraxa | $0 | DEAD_RPC | — | —d | — |
| Artela | $0 | DEAD_RPC | — | —d | — |
| Elysium | $369 | DEAD_RPC | — | —d | — |
| Degen | $0 | DEAD_RPC | — | —d | — |
| AB | $231,745 | DEAD_RPC | — | —d | — |
| Cyber | $2,483 | DEAD_RPC | — | —d | — |
| Fluence | $0 | DEAD_RPC | — | —d | — |
| BEVM | $0 | DEAD_RPC | — | —d | — |
| Areum Network | $12,874 | DEAD_RPC | — | —d | — |
| DeFiVerse | $0 | DEAD_RPC | — | —d | — |
| SatoshiVM | $0 | DEAD_RPC | — | —d | — |
| Planq | $0 | DEAD_RPC | — | —d | — |
| EOS EVM | $0 | DEAD_RPC | — | —d | — |
| Genesys | $0 | DEAD_RPC | — | —d | — |
| AILayer | $95 | DEAD_RPC | — | —d | — |
| Ham | $0 | DEAD_RPC | — | —d | — |
| Mind Network | $0 | DEAD_RPC | — | —d | — |
| Saakuru | $0 | DEAD_RPC | — | —d | — |
| Dymension | $140,799 | DEAD_RPC | — | —d | — |
| XCHAIN | $0 | DEAD_RPC | — | —d | — |
| Polynomial | $0 | DEAD_RPC | — | —d | — |
| re.al | $0 | DEAD_RPC | — | —d | — |
| CrossFi | $0 | DEAD_RPC | — | —d | — |
| Zero Network | $0 | DEAD_RPC | — | —d | — |
| Redstone | $0 | DEAD_RPC | — | —d | — |
| Parex | $0 | DEAD_RPC | — | —d | — |
| Aleph Zero EVM | $0 | DEAD_RPC | — | —d | — |
| Inertia | $286,508 | DEAD_RPC | — | —d | — |
| XION | $3,875 | DEAD_RPC | — | —d | — |
| Eventum | $0 | DEAD_RPC | — | —d | — |
| Camp Network | $82 | DEAD_RPC | — | —d | — |
| Haven1 | $0 | DEAD_RPC | — | —d | — |
| Ethereal | $1,548,944 | DEAD_RPC | — | —d | — |
| Capx Chain | $0 | DEAD_RPC | — | —d | — |
| GRX Chain | $0 | DEAD_RPC | — | —d | — |
| Open | $0 | DEAD_RPC | — | —d | — |
| Sentrix | $0 | DEAD_RPC | — | —d | — |
| XO | $126,546 | DEAD_RPC | — | —d | — |
| Strat | $1,202,478 | DEAD_RPC | — | —d | — |
| Xphere | $445,516 | DEAD_RPC | — | —d | — |
| BounceBit | $0 | CHAINID_MISMATCH | — | —d | — |

## LIVE nhưng DefiLlama báo TVL thấp / 0

| Chain | DefiLlama TVL | Block | Tuổi | Contract còn code | Native trên contract |
|---|---|---|---|---|---|
| Arbitrum Nova | $510 | 85289239 | 0.01d | 0/0 | 0.0000 |
| Syscoin | $0 | 1019577 | 0.01d | 0/0 | 0.0000 |
| Igra | $516,034 | 20937467 | 0.01d | 1/1 | 0.0000 |
| Ultron | $50,516 | 8262260 | 0.02d | 0/0 | 0.0000 |
| Oasis Emerald | $212,080 | 22380787 | 0.04d | 0/0 | 0.0000 |
| Onus | $0 | 18090 | 0.04d | 0/0 | 0.0000 |
| Fantom | $3,014,186 | 123951549 | 0.0d | 8/8 | 0.0000 |
| Aurora | $3,910,907 | 223031206 | 0.0d | 6/6 | 0.0010 |
| Taiko | $209,783 | 13580130 | 0.0d | 0/0 | 0.0000 |
| Telos | $2,387,519 | 497559891 | 0.0d | 0/0 | 0.0000 |
| Boba | $2,304,021 | 41399485 | 0.0d | 1/1 | 0.0000 |
| Fuse | $374,830 | 44950824 | 0.0d | 1/1 | 0.0000 |
| Hemi | $1,199,080 | 5661425 | 0.0d | 0/0 | 0.0000 |
| HAQQ | $0 | 23086594 | 0.0d | 0/0 | 0.0000 |
| Metis | $1,868,482 | 23367783 | 0.0d | 5/5 | 0.0000 |
| Filecoin | $2,505,067 | 6516579 | 0.0d | 3/3 | 0.0000 |
| SKALE Europa | $56,434 | 28344150 | 0.0d | 0/0 | 0.0000 |
| ZetaChain | $294,265 | 19960452 | 0.0d | 0/0 | 0.0000 |
| Velas | $197,626 | 70405330 | 0.0d | 1/1 | 0.0000 |
| HSK Chain | $1,393 | 29728339 | 0.0d | 0/0 | 0.0000 |
| Zircuit | $98,105 | 36933799 | 0.0d | 0/0 | 0.0000 |
| Manta | $2,820,934 | 9957985 | 0.0d | 1/1 | 0.0000 |
| EthereumClassic | $109,579 | 25669102 | 0.0d | 0/0 | 0.0000 |
| KCC | $784,034 | 57086047 | 0.0d | 1/1 | 0.0000 |
| IoTeX | $1,474,536 | 54097179 | 0.0d | 2/2 | 0.0000 |
| Wanchain | $1,741,227 | 47126031 | 0.0d | 0/0 | 0.0000 |
| Ontology | $4,710,948 | 20998306 | 0.0d | 0/0 | 0.0000 |
| OntologyEVM | $1,439 | 20998306 | 0.0d | 0/0 | 0.0000 |
| opBNB | $1,056,171 | 202747532 | 0.0d | 0/0 | 0.0000 |
| Energi | $36,561 | 3497526 | 0.0d | 0/0 | 0.0000 |
| Q Protocol | $9,214 | 29083592 | 0.0d | 0/0 | 0.0000 |
| Bitgert | $1,167 | 9925583 | 0.0d | 0/0 | 0.0000 |
| Karura | $629,394 | 12788435 | 0.0d | 0/0 | 0.0000 |
| Unit Zero | $10,601 | 15657843 | 0.0d | 0/0 | 0.0000 |
| EnergyWeb | $63,160 | 43472957 | 0.0d | 1/1 | 0.0000 |
| Viction | $87,332 | 115899302 | 0.0d | 0/0 | 0.0000 |
| VeChain | $325,250 | 26327117 | 0.0d | 0/0 | 0.0000 |
| ApeChain | $2,341,172 | 53916584 | 0.0d | 0/0 | 0.0000 |
| Lisk | $0 | 39537511 | 0.0d | 0/0 | 0.0000 |
| Theta | $296,342 | 36572869 | 0.0d | 1/1 | 13092695.2958 |
| GOAT | $37,930 | 16600734 | 0.0d | 0/0 | 0.0000 |
| Acala | $280,124 | 12359977 | 0.0d | 0/0 | 0.0000 |
| LUKSO | $0 | 8715718 | 0.0d | 0/0 | 0.0000 |
| Omax | $0 | 12277044 | 0.0d | 0/0 | 0.0000 |
| Saga | $0 | 10728506 | 0.0d | 0/0 | 0.0000 |
| Lens | $39,382 | 6459906 | 0.0d | 0/0 | 0.0000 |
| Rari | $0 | 88516 | 0.0d | 0/0 | 0.0000 |
| Xai | $6,332 | 138266545 | 0.0d | 0/0 | 0.0000 |
| Zeniq | $15,955 | 41087381 | 0.0d | 0/0 | 0.0000 |
| Darwinia | $1,708 | 13752883 | 0.0d | 0/0 | 0.0000 |
| Sophon | $14,039 | 29682301 | 0.0d | 0/0 | 0.0000 |
| IOTA EVM | $310,723 | 13071036 | 0.0d | 0/0 | 0.0000 |
| Coti | $78,859 | 10224530 | 0.0d | 0/0 | 0.0000 |
| Hydra | $0 | 16612430 | 0.0d | 0/0 | 0.0000 |
| Data Network | $59,077 | 24176764 | 0.0d | 0/0 | 0.0000 |
| Beam | $1,443,149 | 9835970 | 0.0d | 0/0 | 0.0000 |
| Bitnet | $0 | 7931346 | 0.0d | 0/0 | 0.0000 |
| Oasis Sapphire | $219,428 | 16489746 | 0.0d | 0/0 | 0.0000 |
| Prom | $719,231 | 10401245 | 0.0d | 0/0 | 0.0000 |
| IOTA | $1,390,148 | 13071036 | 0.0d | 0/0 | 0.0000 |
| Asset Chain | $145,109 | 2042791 | 0.0d | 0/0 | 0.0000 |
| VinuChain | $6,384 | 15277851 | 0.0d | 0/0 | 0.0000 |
| Yominet | $136,630 | 35017430 | 0.0d | 0/0 | 0.0000 |
| Bitcichain | $684 | 14054932 | 0.0d | 0/0 | 0.0000 |
| Peaq | $718,511 | 12251638 | 0.0d | 0/0 | 0.0000 |
| ZIG Chain | $4,693,915 | 8549859 | 0.0d | 0/0 | 0.0000 |
| VirBiCoin | $16,459 | 3296384 | 0.0d | 0/0 | 0.0000 |
| Etica | $9,738 | 11122434 | 0.0d | 0/0 | 0.0000 |
| GGCHAIN | $1,223 | 943121 | 0.0d | 0/0 | 0.0000 |
| Pentagon Chain | $0 | 5188599 | 0.0d | 0/0 | 0.0000 |

Raw: `rpc_zombie_raw.json`.
