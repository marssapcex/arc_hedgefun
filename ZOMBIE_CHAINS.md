# Zombie-chain RPC census

Generated `2026-11-04T14:52:27.469612+00:00`. Read-only `eth_chainId` / `eth_blockNumber` / `eth_getBlockByNumber` / `eth_getCode` / `eth_getBalance`. No tx, no fork, no key.

Universe: 335 chains with DefiLlama `chainTvl <= $5m`; 106 non-EVM/unmapped skipped; **229 EVM chains actually probed**.

| Status | Count | Meaning |
|---|---|---|
| LIVE | 113 | last block < 1h |
| STALLED | 3 | last block 1h..30d |
| FROZEN | 8 | last block > 30d (zombie thật) |
| DEAD_RPC | 85 | không endpoint nào trả lời |
| CHAINID_MISMATCH | 1 | endpoint trả chain khác |
| SUSPECT_RPC | 19 | chỉ có endpoint testnet/sai mạng, loại |
| CLOCK_SKEW | 0 | block timestamp lệch > 5 phút |

## FROZEN / DEAD_RPC (chain chết thật)

| Chain | DefiLlama TVL | Status | Block cuối | Tuổi | RPC |
|---|---|---|---|---|---|
| GodwokenV1 | $0 | FROZEN | 2026-06-12T05:34:00 | 145.39d | https://v1.mainnet.godwoken.io/rpc |
| Polygon zkEVM | $0 | FROZEN | 2026-07-03T15:55:44 | 123.96d | https://zkevm-rpc.com |
| Moonriver | $0 | FROZEN | 2026-08-10T08:27:48 | 86.27d | https://moonriver.api.onfinality.io/public |
| Moonbeam | $0 | FROZEN | 2026-08-10T11:36:12 | 86.14d | https://moonbeam.api.onfinality.io/public |
| LaChain Network | $44,912 | FROZEN | 2026-09-01T12:36:34 | 64.09d | https://rpc1.mainnet.lachain.network |
| Eteria | $0 | FROZEN | 2026-09-03T16:54:25 | 61.92d | https://mainnet.eteria.io/v1 |
| Harmony | $0 | FROZEN | 2026-09-10T14:41:43 | 55.01d | https://api.harmony.one |
| K2 | $168 | FROZEN | 2026-09-17T03:53:57 | 48.46d | https://rpc.karak.network |
| Corn | $0 | DEAD_RPC | — | —d | — |
| TAC | $233,073 | DEAD_RPC | — | —d | — |
| Palm | $0 | DEAD_RPC | — | —d | — |
| Heco | $0 | DEAD_RPC | — | —d | — |
| Boba_Bnb | $0 | DEAD_RPC | — | —d | — |
| ThunderCore | $0 | DEAD_RPC | — | —d | — |
| Evmos | $0 | DEAD_RPC | — | —d | — |
| Canto | $0 | DEAD_RPC | — | —d | — |
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
| Astar zkEVM | $0 | DEAD_RPC | — | —d | — |
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
| Superseed | $0 | DEAD_RPC | — | —d | — |
| Form Network | $0 | DEAD_RPC | — | —d | — |
| Taraxa | $0 | DEAD_RPC | — | —d | — |
| Artela | $0 | DEAD_RPC | — | —d | — |
| Elysium | $369 | DEAD_RPC | — | —d | — |
| Degen | $0 | DEAD_RPC | — | —d | — |
| AB | $231,745 | DEAD_RPC | — | —d | — |
| Fluence | $0 | DEAD_RPC | — | —d | — |
| Areum Network | $12,874 | DEAD_RPC | — | —d | — |
| DeFiVerse | $0 | DEAD_RPC | — | —d | — |
| SatoshiVM | $0 | DEAD_RPC | — | —d | — |
| Planq | $0 | DEAD_RPC | — | —d | — |
| EOS EVM | $0 | DEAD_RPC | — | —d | — |
| Genesys | $0 | DEAD_RPC | — | —d | — |
| Ham | $0 | DEAD_RPC | — | —d | — |
| Dymension | $140,799 | DEAD_RPC | — | —d | — |
| XCHAIN | $0 | DEAD_RPC | — | —d | — |
| Polynomial | $0 | DEAD_RPC | — | —d | — |
| re.al | $0 | DEAD_RPC | — | —d | — |
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
| Eclipse | $38,781 | SUSPECT_RPC | — | —d | — |
| Hoo | $0 | SUSPECT_RPC | — | —d | — |
| Goerli | $0 | SUSPECT_RPC | — | —d | — |
| Cronos zkEVM | $632,966 | SUSPECT_RPC | — | —d | — |
| KUB | $4,908,276 | SUSPECT_RPC | — | —d | — |
| Nibiru | $382,175 | SUSPECT_RPC | — | —d | — |
| DuckChain | $0 | SUSPECT_RPC | — | —d | — |
| Mint | $0 | SUSPECT_RPC | — | —d | — |
| Bitlayer | $461,869 | SUSPECT_RPC | — | —d | — |
| Mayachain | $0 | SUSPECT_RPC | — | —d | — |
| BounceBit | $0 | CHAINID_MISMATCH | — | —d | — |
| Cyber | $2,483 | SUSPECT_RPC | — | —d | — |
| BEVM | $0 | SUSPECT_RPC | — | —d | — |
| AILayer | $95 | SUSPECT_RPC | — | —d | — |
| Mind Network | $0 | SUSPECT_RPC | — | —d | — |
| Saakuru | $0 | SUSPECT_RPC | — | —d | — |
| CrossFi | $0 | SUSPECT_RPC | — | —d | — |
| ZIG Chain | $4,693,915 | SUSPECT_RPC | — | —d | — |
| ADI | $2,015,556 | SUSPECT_RPC | — | —d | — |
| Xphere | $445,516 | SUSPECT_RPC | — | —d | — |

## LIVE nhưng DefiLlama báo TVL thấp / 0

| Chain | DefiLlama TVL | Block | Tuổi | Contract còn code | Native trên contract |
|---|---|---|---|---|---|
| Arbitrum Nova | $510 | 85289239 | 0.01d | 0/0 | 0.0000 |
| Syscoin | $0 | 1019578 | 0.01d | 0/0 | 0.0000 |
| Igra | $516,034 | 20937595 | 0.01d | 1/1 | 0.0000 |
| Ultron | $50,516 | 8262260 | 0.02d | 0/0 | 0.0000 |
| Onus | $0 | 18090 | 0.04d | 0/0 | 0.0000 |
| Fantom | $3,014,186 | 123951570 | 0.0d | 8/8 | 0.0000 |
| Aurora | $3,910,907 | 223031425 | 0.0d | 2/6 | 0.0000 |
| Taiko | $209,783 | 13580197 | 0.0d | 0/0 | 0.0000 |
| Plume Mainnet | $1,629,220 | 103675213 | 0.0d | 0/0 | 0.0000 |
| XDC | $2,023,221 | 109056807 | 0.0d | 1/1 | 0.0000 |
| Telos | $2,387,519 | 497560113 | -0.0d | 0/0 | 0.0000 |
| Boba | $2,304,021 | 41399553 | 0.0d | 1/1 | 0.0000 |
| Fuse | $374,830 | 44950851 | 0.0d | 1/1 | 0.0000 |
| Hemi | $1,199,080 | 5661436 | 0.0d | 0/0 | 0.0000 |
| HAQQ | $0 | 23086617 | 0.0d | 0/0 | 0.0000 |
| Metis | $1,868,482 | 23367789 | 0.0d | 5/5 | 0.0000 |
| Filecoin | $2,505,067 | 6516584 | 0.0d | 3/3 | 0.0000 |
| SKALE Europa | $56,434 | 28344163 | 0.0d | 0/0 | 0.0000 |
| CORE | $3,269,117 | 1705945 | 0.0d | 0/1 | 0.0000 |
| ZetaChain | $294,265 | 19960487 | 0.0d | 0/0 | 0.0000 |
| Velas | $197,626 | 70405331 | 0.0d | 1/1 | 0.0000 |
| Oasis Emerald | $212,080 | 22380788 | 0.0d | 0/0 | 0.0000 |
| HSK Chain | $1,393 | 29728406 | 0.0d | 0/0 | 0.0000 |
| Zircuit | $98,105 | 36933866 | 0.0d | 0/0 | 0.0000 |
| Manta | $2,820,934 | 9957998 | 0.0d | 1/1 | 0.0000 |
| EthereumClassic | $109,579 | 25669104 | 0.0d | 0/0 | 0.0000 |
| KCC | $784,034 | 57086092 | 0.0d | 1/1 | 0.0000 |
| IoTeX | $1,474,536 | 54097231 | 0.0d | 2/2 | 0.0000 |
| Wanchain | $1,741,227 | 47126057 | 0.0d | 0/0 | 0.0000 |
| Ontology | $4,710,948 | 20998315 | 0.0d | 0/0 | 0.0000 |
| OntologyEVM | $1,439 | 20998315 | 0.0d | 0/0 | 0.0000 |
| opBNB | $1,056,171 | 202748078 | 0.0d | 0/0 | 0.0000 |
| Energi | $36,561 | 3497529 | 0.0d | 0/0 | 0.0000 |
| Zilliqa | $120,185 | 39638625 | 0.0d | 0/0 | 0.0000 |
| REI | $0 | 42543299 | 0.0d | 0/0 | 0.0000 |
| Shibarium | $42,737 | 19716471 | 0.0d | 0/0 | 0.0000 |
| Q Protocol | $9,214 | 29083619 | 0.0d | 0/0 | 0.0000 |
| Bitgert | $1,167 | 9925592 | 0.0d | 0/0 | 0.0000 |
| Archway | $115,944 | 29515165 | 0.0d | 0/0 | 0.0000 |
| Karura | $629,394 | 12788446 | 0.0d | 0/0 | 0.0000 |
| Rollux | $48,397 | 53219354 | 0.0d | 0/0 | 0.0000 |
| Unit Zero | $10,601 | 15657863 | 0.0d | 0/0 | 0.0000 |
| EnergyWeb | $63,160 | 43472985 | 0.0d | 1/1 | 0.0000 |
| GoChain | $6,420 | 53368788 | 0.0d | 0/0 | 0.0000 |
| Viction | $87,332 | 115899346 | 0.0d | 0/0 | 0.0000 |
| VeChain | $325,250 | 26327131 | 0.0d | 0/0 | 0.0000 |
| ApeChain | $2,341,172 | 53916747 | 0.0d | 0/0 | 0.0000 |
| Lisk | $0 | 39537579 | 0.0d | 0/0 | 0.0000 |
| Somnia | $2,855,303 | 456494884 | 0.0d | 1/1 | 10.0000 |
| Theta | $296,342 | 36572888 | 0.0d | 1/1 | 13092695.2958 |
| zkLink Nova | $0 | 60305541 | 0.0d | 0/0 | 0.0000 |
| Gravity by Galxe | $0 | 63104248 | 0.0d | 0/0 | 0.0000 |
| Mode | $593,014 | 46818184 | 0.0d | 1/1 | 0.0000 |
| Abstract | $2,918,466 | 88723845 | 0.0d | 1/1 | 0.0000 |
| GOAT | $37,930 | 16600773 | 0.0d | 0/0 | 0.0000 |
| Zora | $40,745 | 53555056 | 0.0d | 0/0 | 0.0000 |
| MultiVAC | $3,268 | 56345019 | 0.0d | 0/0 | 0.0000 |
| Acala | $280,124 | 12359989 | 0.0d | 0/0 | 0.0000 |
| LUKSO | $0 | 8715728 | 0.0d | 0/0 | 0.0000 |
| WEMIX3.0 | $2,472,042 | 127570234 | 0.0d | 0/0 | 0.0000 |
| Omax | $0 | 12277051 | 0.0d | 0/0 | 0.0000 |
| LightLink | $21,130 | 60305542 | 0.0d | 0/0 | 0.0000 |
| Starcoin | $659,461 | 29515170 | 0.0d | 0/1 | 0.0000 |
| Bifrost | $3,363,184 | 39985608 | 0.0d | 0/0 | 0.0000 |
| Saga | $0 | 10728531 | 0.0d | 0/0 | 0.0000 |
| Lens | $39,382 | 6459911 | 0.0d | 0/0 | 0.0000 |
| 0G | $2,795,931 | 49268285 | 0.0d | 0/0 | 0.0000 |
| Rari | $0 | 88518 | 0.0d | 0/0 | 0.0000 |
| Xai | $6,332 | 138266625 | 0.0d | 0/0 | 0.0000 |
| MAP Protocol | $940,373 | 26914257 | 0.0d | 0/0 | 0.0000 |
| Zeniq | $15,955 | 41087422 | 0.0d | 0/0 | 0.0000 |
| Dexalot | $1,652,448 | 78082535 | 0.0d | 0/0 | 0.0000 |
| Darwinia | $1,708 | 13752904 | 0.0d | 0/0 | 0.0000 |
| Sophon | $14,039 | 29682301 | 0.0d | 0/0 | 0.0000 |
| IOTA EVM | $310,723 | 13071040 | 0.0d | 0/0 | 0.0000 |
| Oasys | $200,605 | 15293010 | 0.0d | 0/0 | 0.0000 |
| Coti | $78,859 | 10224558 | 0.0d | 0/0 | 0.0000 |
| Hydra | $0 | 16612485 | 0.0d | 0/0 | 0.0000 |
| Hydra Chain | $22,420 | 99775625 | 0.0d | 0/0 | 0.0000 |
| Plume | $0 | 103675230 | 0.0d | 0/0 | 0.0000 |
| Data Network | $59,077 | 24176828 | 0.0d | 0/0 | 0.0000 |
| Beam | $1,443,149 | 9835979 | 0.0d | 0/0 | 0.0000 |
| Bitnet | $0 | 7931353 | 0.0d | 0/0 | 0.0000 |
| Oasis Sapphire | $219,428 | 16489769 | 0.0d | 0/0 | 0.0000 |
| Prom | $719,231 | 10401268 | 0.0d | 0/0 | 0.0000 |
| Doma | $1,162,221 | 17917602 | 0.0d | 0/0 | 0.0000 |
| IOTA | $1,390,148 | 13071040 | 0.0d | 0/0 | 0.0000 |
| Neo X Mainnet | $3,916 | 8205927 | 0.0d | 0/0 | 0.0000 |
| Electroneum | $224,260 | 16739084 | 0.0d | 0/0 | 0.0000 |
| Matchain | $21,084 | 172746643 | 0.0d | 0/0 | 0.0000 |
| Shape | $136,241 | 36029743 | 0.0d | 0/0 | 0.0000 |
| Asset Chain | $145,109 | 2042797 | 0.0d | 0/0 | 0.0000 |
| Shido | $147,199 | 46905196 | 0.0d | 1/1 | 0.0000 |
| VinuChain | $6,384 | 15277861 | 0.0d | 0/0 | 0.0000 |
| Vana | $170,453 | 10864927 | 0.0d | 0/0 | 0.0000 |
| MANTRA | $517,637 | 19398296 | 0.0d | 0/0 | 0.0000 |
| Silicon zkEVM | $7,666 | 22018781 | 0.0d | 0/0 | 0.0000 |
| MTT Network | $3 | 22555607 | 0.0d | 0/0 | 0.0000 |
| OpenGPU | $24,750 | 26197048 | 0.0d | 0/0 | 0.0000 |
| Yominet | $136,630 | 35017524 | 0.0d | 0/0 | 0.0000 |
| soonBase | $0 | 53507306 | 0.0d | 0/0 | 0.0000 |
| Bitcichain | $684 | 14054941 | 0.0d | 0/0 | 0.0000 |
| ENI | $1,152,355 | 43378470 | 0.0d | 0/0 | 0.0000 |
| Peaq | $718,511 | 12251658 | 0.0d | 0/0 | 0.0000 |
| GateLayer | $3,052,112 | 35720763 | 0.0d | 0/0 | 0.0000 |
| GANchain | $14,470 | 10055358 | 0.0d | 0/0 | 0.0000 |
| VirBiCoin | $16,459 | 3296390 | 0.0d | 0/0 | 0.0000 |
| Etica | $9,738 | 11122446 | 0.0d | 0/0 | 0.0000 |
| Eden | $4,626 | 240008183 | 0.0d | 0/0 | 0.0000 |
| GGCHAIN | $1,223 | 943132 | 0.0d | 0/0 | 0.0000 |
| Rayls | $7,095 | 13840482 | 0.0d | 0/0 | 0.0000 |
| Pentagon Chain | $0 | 5188613 | 0.0d | 0/0 | 0.0000 |
| Bitcoin Swap | $207 | 737694 | 0.0d | 0/0 | 0.0000 |

Raw: `rpc_zombie_raw.json`.
