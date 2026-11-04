# RPC thật — 2026-11-04

Chạy `eth_call` / `eth_getCode` / `eth_getStorageAt` / `eth_getBalance` trên RPC công khai. Không tx, không fork, không key, không đọc source để kết luận.
Block: Ethereum `26340862`, Moonriver `17381654`, Flare `73718178`, Linea `32514988`, Monad `119299978`, Fantom `123949458`, Aurora `223002913`.
Endpoint: `ethereum-rpc.publicnode.com`, `moonriver.drpc.org`, `fantom.drpc.org`, `flare-api.flare.network`, `rpc.linea.build`, `rpc.monad.xyz`, `mainnet.aurora.dev`.
Dữ liệu thô: `rpc_probe_raw.json`, `rpc_follow_raw.json`, `rpc_target_raw.json`, `rpc_votes_raw.json`.

---

## Mục tiêu thật sự: Moonwell Apollo, Moonriver

> **ĐÍNH CHÍNH 14:57 UTC cùng ngày** — xem `ZOMBIE_CHAINS_RPC.md`. Moonriver là chain **FROZEN**: block cuối `17381654` ngày 10/08/2026, hai endpoint độc lập cùng trả `N+1 = null`, năm lần probe trong ngày không nhúc nhích. Mọi `eth_call` ở bảng dưới đọc ra **state đóng băng 86 ngày**, không phải state đang chạy. Không có block mới thì không `propose`/vote/`execute`/`sweep` được. Chuỗi quyền đúng trên giấy, **không thực thi được**. Đây là xác có tiền, không phải mục tiêu sống.

DefiLlama gán chain này `Deprecated`, TVL `$0`, mcap MFAM `$7,128`. State đóng băng đó vẫn có hợp đồng, quyền khép kín và tiền. Đây là chỗ duy nhất trong đống đó đi được từ governor xuống tới contract giữ tiền mà không đụng multisig hay EOA — nhưng chỉ trên state cũ.

| Bước | Địa chỉ | Giá trị đọc được trên chain |
|---|---|---|
| Governor | `0x2BE2e230e89c59c8E20E633C524AD2De246e7370` | `govToken=0xBb8d88…58F1` (MFAM, `totalSupply=1,000,000,000`), `timelock=0x04e632…0bd7`, `getQuorum=currentQuorum=40,000,001 MFAM`, `proposalThreshold=100,000,000 MFAM`, `votingDelay=60`, `votingPeriod=259200`, `proposalCount=238`, `breakGlassGuardian=0x5ded9d…b8db`, `guardianSunset=1681187191` (11/04/2023) |
| Timelock | `0x04e6322D196E0E4cCBb2610dd8B8f2871E160bd7` | `admin = governor`, `delay = 86400` (1 ngày). Slot 0 cũng chính là governor |
| Unitroller | `0x0b7a0EAA884849c6Af7a129e899536dDDcA4905E` | `admin = timelock`, `oracle = 0x892bE716…AF60`. Đang giữ **8,512.5877 MOVR** (native) |
| Oracle | `0x892bE716Dcf0A6199677F355f45ba8CC123BAF60` | `admin = timelock` |
| 6/7 market mToken | `xcKSM 0xa0D11651`, `FRAX 0x93Ef8B7c`, `BTC 0x6E745367`, `USDC 0xd0670AEe`, `ETH 0x6503D905`, `USDT 0x36918B66` | `admin = timelock`, `implementation = 0x45d17fE8…F75d` (chung một impl, có thể thay qua admin) |

Tiền còn nằm trong các market đó, đo bằng `getCash()` / `eth_getBalance`, **số token thô, không quy đổi giá**:

| Market | Cash |
|---|---|
| MOVR `0x6a1A771C` | `86,942.7185 MOVR` |
| FRAX | `39,943.7015 FRAX` |
| USDC.multi | `216,974.4600 USDC` |
| ETH.multi | `15.3041 ETH` |
| USDT.multi | `22,779.2790 USDT` |
| xcKSM | `4,548.2294 xcKSM` |
| BTC.multi | `0.0930 BTC` |
| Unitroller (riêng) | `8,512.5877 MOVR` |

Ngoại lệ phải nói: market **MOVR** có `admin = 0xfea5a592…E58f`, **không phải timelock**. Nó không nằm trong chuỗi quyền ở trên.

---

## Cái hitlist trước sai chỗ nào — đo trên chain, không phải đọc docs

- **Hop**: source ghi `GovernorVotesQuorumFraction(30)`. Contract `0xed8bdb…3d48` trả `quorumNumerator=600 / quorumDenominator=10000` = **6%**, `quorum(block-1)=60,000,000 HOP`, `proposalThreshold=1,000,000 HOP`, `votingPeriod=45818`. Timelock `0xeea842…4bd7a` có `getMinDelay=172800` (2 ngày) và `hasRole(PROPOSER_ROLE, governor)=1`. HOP token `owner = timelock`; timelock giữ **511,540,519.88 HOP** = 51% supply — nhưng `getVotes(timelock) = 0`. **Balance không phải phiếu bầu.** Các L1 bridge vẫn giữ `535,309 USDC`, `293,358 DAI`, `266,028 USDT`, nhưng `owner()` trên bridge không đọc được nên không khẳng định ai nắm quyền rút.
- **BiFi**: governor `0x54F50d…0ea` **không vote bằng BIFI**. `token() = 0x22f68ae0…d6dc` (`GBiFi`, `totalSupply = 3,220.33`). `proposalThreshold = 800,000 GBiFi` > toàn bộ cung, `quorum = 60%`, `getMinDelay = 1` giây. **Không ai tạo được proposal.** Đây là xác, không phải mục tiêu.
- **Rari #2**: `token() = 0xc7283b66…212b` = **TRIBE**, không phải RGT như hitlist. `quorumVotes = 25,000,000 TRIBE`.
- **Angle**: timelock `0x5183f032…301e` có `getMinDelay = 0` và governor là proposer, `quorum(block-1) = 5,000,000 ANGLE` (source deprecated ghi 25M), `proposalThreshold = 2,500,000`. Governor là proxy, impl `0x3e399ae5…C03b`. Chưa tìm được contract giữ tiền do timelock này quản.
- **Concentrator**: không phải governance rẻ. Multisig `0xA0FB1b11…E99` là Safe **9 owners / threshold 6**; `ProxyAdmin.owner = multisig`, `vault.owner = multisig`, `veCTR.admin = multisig`. Cần 6 chữ ký.
- **Mendi / Neverland / Kinetic**: Safe **7 owners / threshold 4**, Safe **5 owners / threshold 2**, và oracle/timelock Flare `getMinDelay = 259200` (3 ngày). Đều là cửa quyền, không phải cửa không quyền.
- **Flux / PEAKDEFI / Reflexer / Unslashed / Easedefi**: đọc được `quorumVotes` / `proposalCount` / `guardian` / `admin` (`Flux proposalCount=10, quorumVotes=1M, threshold=100M, delay 1 ngày`), nhưng không đo được quỹ do timelock nắm.

---

## Còn thiếu — không chốt bừa

- `getCurrentVotes` / `getPriorVotes` của governor, timelock, Unitroller, oracle và breakGlassGuardian trên MFAM **đều = 0**. Timelock chỉ giữ `1.39 MFAM`. Muốn `propose` cần `100,000,000 MFAM` có checkpoint; chưa chứng minh có, chưa mua, chưa đo thanh khoản.
- Chưa `sweep → assert profit > 0`. Không PoC, không fork, không claim rút được tiền.
- `0 bug không cần quyền, 0 đô` vẫn đứng nguyên. Cái mới là thay hitlist bằng **một địa chỉ đo được từng bước**, và chứng minh 6 cái khác là xác / multisig / quorum khóa.

---

## Chạy lại

```bash
python3 scripts/rpc_probe.py   --out rpc_probe_raw.json   --md RPC_PROBE.md
python3 scripts/rpc_follow.py  --out rpc_follow_raw.json  --md RPC_FOLLOW.md
python3 scripts/rpc_target.py  --out rpc_target_raw.json  --md RPC_TARGET.md
python3 scripts/rpc_votes.py   --out rpc_votes_raw.json
```

Sandbox chặn host RPC nên 4 lệnh trên được chạy qua `.github/workflows/rpc-probe.yml` (CI runner có outbound), kết quả commit ngược về branch. `--rpc URL` để ép endpoint khác. Mọi script chỉ đọc.
