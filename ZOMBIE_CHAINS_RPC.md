# Chain zombie — đo bằng RPC, không phải đọc TVL

`2026-11-04 14:57 UTC`. Nguồn: DefiLlama snapshot `git show 9fccbd9:screen.json` (335 chain có `chainTvl <= $5m`, trong đó 131 chain TVL = 0) + `ethereum-lists/chains` để lấy RPC/chainId. Bỏ 106 chain non-EVM/không map được và 5 tên map nhầm → **224 chain EVM được gọi RPC thật**.

Chỉ đọc: `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber('latest')`, `eth_getCode`, `eth_getBalance`, và `eth_getBlockByNumber(N+1)`. Không tx, không fork, không key. Script `scripts/rpc_zombie.py`, dữ liệu thô `rpc_zombie_raw.json`, bảng tự sinh `ZOMBIE_CHAINS.md`, CI `.github/workflows/rpc-zombie.yml`.

## Kết quả

| Trạng thái | Số chain | Ý nghĩa |
|---|---:|---|
| **FROZEN** | **8** | block cuối > 30 ngày, và `block N+1` không tồn tại → zombie thật |
| **DEAD_RPC** | **83** | không endpoint công khai nào trả lời |
| STALLED | 4 | block cách 0,04–0,5 ngày (có thể RPC cache, chưa đủ gọi chết) |
| **LIVE** | **111** | block mới < 1h dù DefiLlama TVL ≤ $5m hoặc = 0 |
| SUSPECT_RPC | 17 | chỉ có endpoint testnet/devnet/sai mạng → loại |
| CHAINID_MISMATCH | 1 | endpoint trả chain khác → loại |

## 8 chain FROZEN — có bằng chứng cứng

| Chain | Block cuối | Thời gian block (ICT) | Tuổi | `N+1` trả về |
|---|---:|---|---:|---|
| GodwokenV1 | 2.851.258 | 12/06/2026 12:34 | 145,4 ngày | `null` (1 endpoint) |
| Polygon zkEVM | 33.391.890 | 03/07/2026 22:55 | 124,0 ngày | `null` (2 endpoint) |
| **Moonriver** | **17.381.654** | **10/08/2026 15:27** | **86,3 ngày** | **`null` (2 endpoint độc lập)** |
| Moonbeam | 16.796.699 | 10/08/2026 18:36 | 86,1 ngày | `null` (2 endpoint) |
| LaChain Network | 23.472.941 | 01/09/2026 19:36 | 64,1 ngày | `null` (2 endpoint) |
| Eteria | 102.436 | 03/09/2026 23:54 | 61,9 ngày | `null` (1 endpoint) |
| Harmony | 93.624.315 | 10/09/2026 21:41 | 55,0 ngày | `null` (4 endpoint) |
| K2 | 43.110.911 | 17/09/2026 10:53 | 48,5 ngày | `null` (1 endpoint) |

Trong 8 chain này chỉ **Moonriver** có địa chỉ mẫu để đọc: 7/7 contract vẫn có code, `8.512,5877 MOVR` native vẫn nằm trong Unitroller. Các chain khác `0/0` nghĩa là không có address mẫu trong bộ dữ liệu, **không** có nghĩa là không còn contract.

## Đính chính bài trước — quan trọng nhất

`RPC_ONCHAIN_TARGETS.md` viết "Moonriver vẫn sống, quyền vẫn khép kín, tiền vẫn còn". **Câu đó sai một nửa.**

- `moonriver.api.onfinality.io/public` và `moonriver.drpc.org` — hai endpoint độc lập — cùng trả `chainId 1285`, cùng block `17381654`, cùng timestamp `1786350468` (10/08/2026 15:27 ICT).
- Cả hai đều trả `null` khi hỏi block `17381655`.
- Năm lần probe hôm nay, từ `10:29 UTC` đến `14:57 UTC`, block vẫn đứng yên `17381654`.

Nghĩa là mọi `eth_call` ở 4 vòng trước (governor, timelock, Unitroller, `getCash`, `getVotes`) đọc ra **state đóng băng ngày 10/08/2026**, không phải state đang chạy. Chain không sản xuất block thì không thể `propose`, không thể vote, không thể `execute`, không thể `sweep`. Chuỗi quyền governor → timelock → market vẫn đúng trên giấy, nhưng **không thực thi được**. Moonwell Apollo là xác có tiền, không phải mục tiêu sống. `0 bug không cần quyền, 0 đô` vẫn đứng — giờ còn có lý do cứng hơn.

## 83 DEAD_RPC — không endpoint công khai nào trả lời

Tên quen thuộc: `Heco`, `Canto`, `ThunderCore`, `Evmos`, `Astar`, `Meter`, `DFK`, `Dogechain`, `Kroma`, `Milkomeda C1`, `Milkomeda A1`, `ShimmerEVM`, `Palm`, `Corn`, `TAC`, `Boba_Bnb`, `Boba_Avax`, `Nahmii`, `Callisto`, `Step`, `Empire`, `Findora`, `REIchain`, `SX Network`, `SX Rollup`, `Odyssey`, `Nova Network`, `Dexit`, `DChain`, `Ancient8`, `Tombchain`, `Pego`, `Cube`, `Botanix`, `Astar zkEVM`, `Superposition`, `EDU Chain`, `Oraichain`, `inEVM`, `Crab`, `XPLA`, `Swellchain`, `Tenet`, `Superseed`, `Form Network`, `Taraxa`, `Artela`, `Elysium`, `Degen`, `Fluence`, `SatoshiVM`, `Planq`, `EOS EVM`, `Dymension`, `XCHAIN`, `Polynomial`, `re.al`, `Zero Network`, `Redstone`, `XION`, `Camp Network`, `Haven1`, `Ethereal`, `Capx Chain`, `Strat`, `Xphere`, v.v. (danh sách đủ trong JSON).

**Giới hạn, không nói quá:** đây là "RPC công khai không trả lời từ CI runner", có thể do endpoint tắt, chặn IP, hoặc chain dừng. Chưa chứng minh được chain chết vĩnh viễn. Khác với 8 chain FROZEN — ở đó có cả timestamp lẫn `N+1 = null`.

## 111 LIVE — DefiLlama gọi zombie nhưng chain vẫn chạy

`Fantom $3,01m`, `Aurora $3,91m`, `Ontology $4,71m`, `Metis $1,87m`, `Telos $2,39m`, `Boba $2,30m`, `Wanchain $1,74m`, `IoTeX $1,47m`, `Fuse $375k`, `Velas $198k` … đều có block mới trong vòng 1 giờ.

14 chain DefiLlama TVL = **0** nhưng vẫn đẻ block: `REI`, `Lisk`, `Syscoin`, `zkLink Nova`, `Gravity by Galxe`, `LUKSO`, `Omax`, `Saga`, `Rari`, `Hydra`, `Plume`, `Bitnet`, `soonBase`, `Pentagon Chain`.

Đây mới là nhóm đáng soi tiếp: adapter DefiLlama ngừng track, không phải chain ngừng chạy. `Aurora` 6/6 contract mẫu còn code, `Fantom` 8/8, `Metis` 5/5.

## Cái khó

Danh sách 335 của DefiLlama là **TVL**, không phải **liveness**. Muốn biết zombie thật phải đọc timestamp block cuối và hỏi block kế tiếp. Sau khi đo: 8 chain chết có bằng chứng, 111 chain "chết trên giấy" vẫn chạy, và chính cái mục tiêu mình vừa chốt nằm trong 8 chain chết.

STALLED: `Blast` 0,50 ngày, `Zkfair` 0,42, `Waterfall` 0,24, `Onus` 0,04 — chưa đủ để kết luận.

## Chạy lại

```bash
python3 scripts/rpc_zombie.py --workers 32 --out rpc_zombie_raw.json --md ZOMBIE_CHAINS.md
```

Sandbox chặn host RPC nên lệnh trên chạy qua CI `.github/workflows/rpc-zombie.yml`. Dữ liệu chain/địa chỉ ở `scripts/zombie_data.json`.
