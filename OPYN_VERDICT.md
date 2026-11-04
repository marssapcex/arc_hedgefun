# Opyn Convexity v1 — kiểm lại đoạn tóm tắt

Kiểm bằng GitHub API, bài audit OpenZeppelin, adapter DefiLlama, source imports, và `eth_call` đọc trên Ethereum block `26342343` (`https://ethereum-rpc.publicnode.com`, 2026-11-04 15:27 UTC). Không tx, không fork, không key, không PoC.

**Kết luận ngắn: số thì đúng, nhãn thì sai. Đây là một kho collateral của 157 series đã hết hạn gần 5 năm, không phải giao thức đang chạy, cũng không phải mục tiêu.** Bản tóm tắt gom lẫn Convexity v1 / Gamma / Squeeth, gom lẫn repo đang mở với repo archived, và đọc `audits: "0"` của DefiLlama thành "chưa audit".

## Từng ý

| Ý trong tóm tắt | Verdict | Bằng chứng |
|---|---|---|
| Audit ngày 10/02/2020 | **ĐÚNG** | [OpenZeppelin: Opyn Contracts Audit](https://blog.openzeppelin.com/opyn-contracts-audit/). Audit commit `c34598565cba2bfcf824eb2da63d95c7f5dda4fa` (2019-12-07), fix commit `3adfd9afa6d463869d9e0a78cc7f316ae34eb89e` (2020-01-23). |
| "1 lỗ hổng, đã fix" | **SAI** | 1 Critical `[C01][Fixed]` (SafeMath underflow `expiry - windowSize` trong `exercise`), **2 High**, 2 Medium, 10 Low, 17 Notes. `H01` = insolvency lúc thanh lý → khuyến nghị bot thanh lý; `H02` = malicious admin → **Partially Fixed**, multisig còn WIP. OZ kết luận: critical đã fix, high chỉ fix một phần / cần giám sát. |
| "Audit đầy đủ toàn bộ code" | **SAI** | Scope chỉ `OptionsContract.sol`, `OptionsUtils.sol`, `OptionsFactory.sol`. **Loại** `lib/`, `Migrations.sol`, `OptionsExchange.sol`. Giả định admin honest/available/không bị compromise. Chỉ review các patch cụ thể; thay đổi khác sau fix commit **không được audit lại**. |
| "Link audit nằm ngay trong repo" | **SAI** | README của `opynfinance/ConvexityProtocol` trỏ `blog.openzeppelin.com/private-report-jan-6/` → **404**. Link OZ hợp lệ chỉ có trong README của `opynfinance/Convexity-Protocol-Archived`. |
| "Repo đã archived / dự án đóng từ 2020" | **SAI, nhầm repo** | `opynfinance/ConvexityProtocol`: `archived:false`, `pushed_at 2023-01-24`, commit cuối nhánh `dev` là `7ca7544884` ngày 2021-05-18 (`permissionless-factory`). Cái `archived:true` là **`Convexity-Protocol-Archived`**, dừng 2020-09-04. `repos/opynfinance/Convexity-Protocol` redirect sang repo archived đó — dễ gây nhầm. |
| "Tự code hoàn toàn / fork của protocol khác" | **NỬA ĐÚNG** | `OptionsContract.sol` là core tự viết, không fork một options protocol khác. Nhưng import `@openzeppelin/contracts` (`ERC20`, `IERC20`, `ERC20Detailed`, `Ownable`, `SafeMath`) + `OptionsExchange.sol`, `OptionsUtils.sol`, `CompoundOracleInterface.sol`, `UniswapFactoryInterface.sol`, `UniswapExchangeInterface.sol`. Không phải dependency-free. |
| "Chạy trên Ethereum / Avalanche / Polygon" | **SAI cho Convexity** | DefiLlama `opyn-convexity`: `chains: ["Ethereum"]`. Avalanche + Polygon + Ethereum là **`opyn-gamma`** (`audits: "2"`, Chainlink oracle). `OSQTH` là token Squeeth power perpetual (`0xf1b99e3e573a1a9c5e6b2ce818b617f0e664e86b`), sản phẩm sau, **không phải Convexity v1**. Bất kỳ nhãn CertiK / trạng thái token nào của OSQTH không phải audit cho bộ contract Convexity. |
| "DefiLlama ghi `audits: 0` nên chưa audit" | **SAI** | `audits: "0"` là metadata của adapter/protocol page, không phủ định bài OZ tháng 02/2020. Ngược lại cũng đừng dùng bài OZ 2020 để bảo chứng code deploy sau này. |
| "$542,850.84 TVL, đỉnh $4,160,803" | **ĐÚNG SỐ, SAI Ý NGHĨA** | `currentChainTvls.Ethereum = 542850.84163`; đỉnh `4,160,803` tại `1608854400` = 25/12/2020. Adapter `projects/opyn-convexity/index.js` lấy `getNumberOfOptionsContracts()` từ **2 factory**, rồi `sumTokens2({ tokensAndOwners: [collateral(), oToken] })`. Nó cộng **số dư collateral trên mọi oToken**, không đo thanh khoản đang active, không đo volume, không đo option còn giao dịch. |
| "Rủi ro thanh khoản / thiếu bảo trì" | **ĐÚNG NHƯNG PHẢI NÓI CỤ THỂ** | RPC đủ 157/157 series, `codeBytesMissing=0`, `nativeWeiMissing=0`. **Cả 157 trả `hasExpired()=1`**, `expiry()` muộn nhất `1640937600` = 31/12/2021 08:00 UTC. Tiền vẫn nằm đấy: `225.567473 ETH`, `25,094.400395 USDC`, `1,554.66 DYDX`, `118.428909 UNI`, `4.102647 DPI`, `1.801998 DAI`, `0.001895 WBTC`, `0 WETH`. Riêng `Opyn aUSDC insurance` giữ `190.0503 ETH`. Đây là collateral chưa redeem của option hết hạn, **không phải pool đang sống**. |
| "Owner không còn / permissionless" | **SAI — cái sai nguy hiểm nhất** | Factory chính `0xcC5d…7777C`: code 24,551B, `owner()=0x87887cf0e37d937f989ab76b99e4f4682da044c4`, **owner có 170B code (contract/proxy)**. Factory thứ hai `0xb529…FEaC`: code 24,510B, `owner()=0x9e68b67660c223b3e0634d851f5df821e0e17d84`, code 0B (EOA), 9 series. `isOwner()=0` trong `eth_call` chỉ vì caller mặc định là zero-address — **không phải bằng chứng owner đã bỏ quyền**. v1 có `Ownable`. |

## Đối chiếu $542,850.84163

225.5675 ETH × ~$2,295–2,438 + ~25,094 USDC + token lẻ ≈ **$543k–$571k**. DefiLlama ghi `$542,850.84163`. Chênh ~5% là giá/snapshot (giá ETH lấy lúc 15:35 UTC là `$2,438.157244`, USDC `$0.999844`; implicit price của snapshot DefiLlama ≈ `$2,295`). Không phải thiếu hợp đồng: enumerate đủ 157, 148 từ factory chính + 9 từ factory thứ hai, không address trùng. Thành phần thì rõ: **phần lớn là ETH kẹt trong mấy contract insurance đã hết hạn từ 2021**, không phải "TVL của một giao thức options đang hoạt động".

## Cái cần nhớ

- Đây **không phải mục tiêu**. Không có tx, không fork, không PoC, không claim rút được tiền không cần quyền. Tiền nằm trong oToken hết hạn ≠ lỗ hổng; đi ra theo cơ chế redeem/exercise của v1 với điều kiện riêng, và vẫn có owner trên cả hai factory.
- Đây cũng **không phải chain zombie**: Ethereum block `26342343` còn chạy. Khác với Moonriver/Moonbeam ở `ZOMBIE_CHAINS_RPC.md` (FROZEN, `N+1=null`). Ở đây chain sống, hợp đồng thì cũ.
- `0 bug không cần quyền, 0 đô` vẫn đứng.

## Artifact

- `OPYN_ONCHAIN.md` / `rpc_opyn_raw.json` — 157 series, owner, code, expiry, native + ERC20 balances, block `26342343`.
- `scripts/rpc_opyn.py` + `.github/workflows/rpc-opyn.yml` — script đọc-only, chạy trên CI (runner có outbound RPC; sandbox thì không).
- `ZOMBIE_CHAINS_RPC.md`, `RPC_ONCHAIN_TARGETS.md` — các kết luận cũ, không mở lại.
