# Sàng lọc định tính: token rẻ / TVL cao / có đường propose → execute

Snapshot `api.llama.fi` ngày **2026-11-04** (4 endpoint: `/protocols`, `/lite/protocols2`, `/v2/chains`, `/config/smol/appMetadata-protocols.json`). Không dùng 30 dòng ông dán, kéo toàn bộ.

## Sửa lại con số

- 762 protocol có `mcap` dạng số; **208 dòng** khớp `TVL ≥ 100k, mcap ≤ 1.01m, mcap/TVL ≤ 1`, trong đó **142 dòng có `mcap > 0`** (66 dòng `mcap = 0`: DefiLlama không có giá/token chết, không mua được phiếu → vô dụng).
- Con số **156 / 558** của ông là snapshot khác thời điểm / khác cách xử lý `mcap` null. Bản hôm nay 142 (hoặc 161 nếu bỏ điều kiện tỉ lệ). Không khớp, mình không ép cho khớp.
- 11/30 tên ông dán **không còn nằm trong ngưỡng hôm nay** (`mcap` null hoặc > 1.01m): KittyPunch, Alpaca Finance, Blend, UNCX Network, Kuma, Nile Exchange, SparkDEX, PoolTogether, ApeBond, Yield Yak, Bifrost Protocol, Kriya, Biswap. Cái tên "Yield Yak" nay là "Yield Yak Aggregator" ($13.43m / $337.6k).
- Trong 142: **120 không có `governanceID`**, 16 chỉ có `snapshot:`, **6 có governor on-chain** (`compound:` / `eip155:`). Đây là con số quyết định.

## Nhóm A — đúng 4 điều kiện cấu trúc

Governor on-chain propose + đa số phiếu → Timelock → execute; setter nâng cấp / oracle / rút tiền nằm trong tầm tay; pool còn tiền; mcap nhỏ hơn TVL rất xa. **Đọc từ source công khai, chưa đọc `owner()`/`quorum()`/`delay()` trên chain.**

| Protocol | Chain | TVL / mcap | Governor | Đường setter |
|---|---|---|---|---|
| **Hop Protocol** | Ethereum + OP/Arb/Polygon/Gnosis | $3.53m / $82.8k | `HOPGovernor` (OZ): quorum 0.3% supply, threshold 1M HOP, votingDelay 1 block, votingPeriod 1 tuần; `TimelockController` minDelay 172800s; deploy script trao `PROPOSER_ROLE` cho governor rồi revoke admin deployer | `L1_Bridge`: `setXDomainConnector`, `setChainIdDepositsPaused`, `setChallengePeriod`, `setMinTransferRootBondDelay`, `rescueTransferRoot`, `setHopBridgeTokenOwner`; `Bridge.withdraw`. Có thêm `Timelock.sol` riêng (1–30 ngày) — 2 bộ, chưa đối chiếu địa chỉ deployed |
| **Angle** | Ethereum/Arb/Polygon | $1.70m / $52.8k | `Governor.sol` (OZ upgradeable): quorum 25M ANGLE, threshold 2.5M, delay 545 block (~2h), period ~3 ngày, `GovernorTimelockControl`. DefiLlama còn gắn `compound:ethereum:0x59153e…` | `StableMaster.setOracle` (`GOVERNOR_ROLE`), `PerpetualManager.setOracle`, `ProxyAdmin.upgrade/upgradeToAndCall`, `emergencyWithdraw`. **Nhưng file nằm trong `contracts/deprecated/dao/`** → có thể đã bị thay |
| **BiFi** | Bifrost Network/BSC/Ethereum | $8.09m / $209k | `eip155:1:0x54F50d2f…` (Tally). Không tìm thấy source Governor trong repo công khai | `IMarketManager.setOracleProxy`, `CallProxy.setManager/setTokenInfo`, `XFactoryExternal.setStrategy/setImplements/setOwner`, `StrategyLogic.endStrategyWithTransfer`. Toàn `onlyOwner`; governor ở Ethereum, market ở chain khác |
| **Reflexer (RAI)** | Ethereum | $2.42m / $835.7k | `eip155:1:0x7a6BBe7f…`; GEB dùng `DSPause` + `isAuthorized` | `modifyParameters` trên oracle/accounting/auction, `geb-fsm-governance-interface`, `ds-pause` |
| **Rari Capital** | Ethereum/Arbitrum | $956.8k / $272.2k | 2 × `eip155:1:…` | Fuse Comptroller `admin`/`_setPriceOracle`, pool per-market. **Đã hack, deprecated** |
| **PEAKDEFI** | Ethereum/Binance | $110.2k / $106.9k | `compound:ethereum:0x1a76ff40…` | Yield vault. Tỉ lệ gần 1:1 → không còn "rẻ hơn nhiều" |

Ngoài 142 nhưng cùng dạng, **mcap = 0** nên không mua được phiếu: Flux Finance ($43.7m TVL, `compound:ethereum:0x3365…`), Easedefi ($3.8m), Unslashed ($3.43m), Yam ($116k), Hundred Finance, PowerPool, Ooki, Strike, Armor, Fei.

## Nhóm B — chain zombie: "TVL $0" là adapter chết, không phải hợp đồng cạn

DefiLlama gắn nhãn **Deprecated** và TVL $0, nhưng vẫn liệt kê protocol: Moonbeam **76**, Moonriver **68**, Harmony **65**, Heco **50**, OKTChain **41**, Canto **27**, cùng ThunderCore, Blast, Polygon zkEVM, Palm, Boba_Bnb, Evmos, Kujira, Nahmii. Chỗ này đúng ý ông: ngừng track ≠ rút hết tiền. **Không có RPC nên mình không xác nhận được số dư on-chain còn lại.**

Chain gần chết mà vẫn đo được TVL thật: Fantom $3.01m (Curve $914k, SpookySwap $753k, Multichain $422k, SpiritSwap $328k, Beets $294k, Stargate V1 $161k, Liquid Driver $160k, Yearn $88k, Tarot $76k), Aurora $3.91m (Aurora Plus $2.5m, Trisolaris $1.92m, Bastion $835k, Aurigami $638k), Ontology $4.71m, Boba $2.30m, Telos $2.39m, Wanchain $1.74m, Metis $1.87m, IoTeX $1.47m, XDC $2.02m, Astar $1.14m, Fuse $375k, Ergo $950k, Velas $198k.

| Zombie candidate | Vì sao đáng đọc |
|---|---|
| **Wing Finance / Ontology** — $5.03m / $20.7k | DAO on-chain theo docs: 1 WING = 1 phiếu, quorum cố định 20.000 WING, 1.000 WING để đề xuất, **token không bị khóa lúc vote**, kết quả tính ở block cuối phiếu, "approved proposal will be implemented automatically"; có Supply/Borrow/Insurance pool, `Borrow Limit`, `Liquidation` theo giá. Docs, không phải Solidity đã verify ([glossary](https://docs.wing.finance/glossary), [FAQ](https://docs.wing.finance/faqs)) |
| **Moonwell Apollo / Moonriver** — chain Deprecated, mcap $7.1k | Có Governor thật (`MoonwellApolloGovernor`: threshold 400k WELL, delay 60s, period 3 ngày, quorum thả nổi, `breakGlassGuardian`), `ChainlinkOracle.setDirectPrice/setUnderlyingPrice/setFeed` (`onlyAdmin`), `Comptroller._setPriceOracle`, `MErc20Delegator._setImplementation`, `Unitroller._setPendingAdmin`, Timelock 1–30 ngày. **Đã xảy ra MIP-R39 2026-03, bị chặn bởi no-vote + Break Glass Guardian** — đã có trong `GOVERNANCE_TAKEOVERS.md`, không phải finding mới |
| **Aurigami ($638k/$139k), Bastion ($835k)** / Aurora | Lending fork Compound: `_setPriceOracle`, `_setImplementation`, `admin`. Chưa có source Governor on-chain trong danh sách `governanceID` → cần kiểm tra ai giữ admin |
| **Trisolaris ($1.92m/$91.9k), Tarot ($486k/$1.35m), Liquid Driver ($160k), Scream, Dfyn ($375k/$26.5k), 88mph ($406k/$19.4k)** | Toàn `snapshot:` → không tự execute |

## Nhóm C — loại, nói rõ để khỏi lẫn

- **Chỉ Snapshot** (phần lớn 156 + 171/178 `governanceID`): Concentrator $78.9m/$90k, ACryptoS $10.5m/$180k, Pickle $4.67m/$27.5k, Bunny $3.67m/$9.5k, CLever $5.87m/$275k, Hakka, QiDao, Plutus, OnX, Iron Bank, BoringDAO, Siren, Trisolaris… Vote off-chain, thực thi cần multisig → **không phải mua >50% token là xong**.
- **Có setter nhưng chỉ admin/timelock, không có Governor token**: Kinetic (Flare, $31.96m/$305k — `UnitrollerTimelockUpgrader`: TimelockController 3 ngày + `NO_DELAY_ROLE`, `Comptroller._setPriceOracle` require `msg.sender == admin`), Mendi Finance (Linea, $1.03m/$17.9k), Neverland (Monad, $5.35m/$52.7k — Aave V3 fork, `PoolAddressesProvider.setPriceOracle/setPoolImpl` `onlyOwner`, `ACLManager` roles). Đây là **cần quyền**, đúng thứ ông đã bảo mình tự dựng ra trước đây.
- **mcap = 0**: không có giá → không mua được phiếu bằng tiền thật.
- **CEX / canonical bridge / staking pool / LST**: Obol, xDAI Bridge, Biconomy.com, Stride, Kyros, Saber… TVL không phải pool mà governor có thể gọi `withdraw`.
- **Đã deprecated / đã hack**: Scream, Rari, Hundred, Belt, Exactly, Astroport, 88mph, DFYN.

## Ranh giới

100% từ metadata DefiLlama + repo công khai + docs. **Không có RPC nên không đọc được on-chain owner, quorum hiện tại, timelock delay thực tế, cũng không đối chiếu bytecode deployed.** Không fork, không PoC, không chứng minh dòng tiền rút được, không khẳng định mua phiếu rẻ hơn số tiền lấy được — chỉ là danh sách cấu trúc để đọc tiếp. Không mở lại audit.

Nguồn: `api.llama.fi/protocols`, `api.llama.fi/lite/protocols2`, `api.llama.fi/v2/chains`, `api.llama.fi/config/smol/appMetadata-protocols.json`, `api.llama.fi/config` (`deadFrom`, `governanceID`, `oraclesBreakdown`); repo `hop-protocol/governance`, `hop-protocol/contracts`, `AngleProtocol/angle-core`, `bifrost-platform/BiFi-X`, `reflexer-labs/geb`, `moonwell-fi/contracts-open-source`, `kinetic-market/public-money-market-contracts`, `mendi-finance/lending-protocol`, `Neverland-Money/neverland-lending`; trang chain Deprecated trên DefiLlama.
