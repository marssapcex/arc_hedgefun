# VulnChain — sửa đúng cái mày bắt được

Mày đúng, và chỗ sai cụ thể là đây: tool bóc được **21 hàm** của `0xe5c8…0d0f` (đúng), rồi gắn nhãn `reentrancy` / `oracle-price-manipulation` chỉ vì `withdraw(address,uint256)` = `0xf3fef3a3` trùng chữ ký với Lendf.Me / Platypus. Trong khi decompile cho thấy **`onlyOwner` hardcode `0x0121…5dd4`**, không có số dư người dùng, `withdraw` chỉ là owner gửi ETH ra. Đó là báo động giả, không phải phát hiện.

Đã sửa 3 chỗ, có regression test khoá lại.

---

## 1. Selector không còn là bằng chứng

Trước: `score = 0.50 featureCos + 0.35 body + 0.15 selectorEqual`, và `selectorEqual = 1` cho phép bỏ qua yêu cầu body. Kết quả: `featureCos 0.739`, `body 0.18`, selector trùng → **0.5824 → dán nhãn**.

Bây giờ:

```
score = 0.60 featureCos + 0.40 body        (0 cho selector)
MIN_SCORE 0.58 · MIN_FEATURE_COS 0.70 · MIN_BODY 0.30  (bắt buộc, không có ngoại lệ)
```

`selectorEqual` vẫn được lưu để hiển thị, và selector index vẫn dùng để **lấy ứng viên** — nhưng không cộng một điểm nào. Thêm `GENERIC_SIGNATURES` (`withdraw(address,uint256)`, `transfer`, `approve`, `deposit`, `wrapEth`, `withdrawToken`…): nếu là chữ ký phổ biến thì phải có `body ≥ 0.45` **và** `featureCos ≥ 0.85` mới được xét.

## 2. Hard veto cho hàm có guard (đúng case bot MEV của mày)

Thêm 3 feature: `ownerGuard`, `selfCallGuard`, `userBalanceAccounting`.

- `ownerGuard` từ bytecode: `CALLER (0x33) → PUSH20 <địa chỉ cố định> → EQ (0x14)`. Từ source: `onlyOwner` / `Ownable` / `NotOwner` / `require(msg.sender == owner)`.
- `selfCallGuard`: `msg.sender == address(this)` / `msg.sender - this` (đúng 2 hàm tự gọi trong decompile).
- `userBalanceAccounting`: `balances[msg.sender]` / mapping write (`KECCAK256 + SLOAD + SSTORE + CALLER`).

`FunctionLabeler` **bỏ hàm ngay từ đầu** nếu có `ownerGuard` hoặc `selfCallGuard`: một hàm chỉ owner hoặc chính contract gọi được **không thể là điểm vào của exploit không cần quyền**. Thêm đối kháng: hàm corpus có `userBalanceAccounting` mà hàm mới không có → loại ứng viên.

Regression test `REGRESSION: onlyOwner withdraw(address,uint256) is NOT labelled reentrancy` dựng đúng source + dispatcher bytecode `0xf3fef3a3` có `CALLER PUSH20<owner> EQ` → `labelled: false`, `vetoes: ["immutable owner guard"]`. Test thứ hai: selector trùng nhưng `body 0.22 < 0.30` → không nhãn.

`npm test 17/17`, `selftest 19/19`.

**Kết quả CI sau khi sửa (2026-11-05 08:35 UTC, 40 block, `26347424–26347463`):** `60` contract / `730` hàm / **0 nhãn** / `errors 0`. Cái `1 nhãn oracle-price-manipulation` ở bản cũ biến mất — đúng, vì nó là `withdraw(address,uint256)` onlyOwner. **0 nhãn trong 40 block không có nghĩa tool không tìm được gì; nó nghĩa là không còn dán bừa.**

## 3. Quét FULL CHAIN, không quét block gần nhất

`src/fullscan.js` — **checkpointed range scanner**:

```
node src/cli.js full-scan --full --resume
# = --from-block 0 --to-block latest --resume

node src/cli.js full-scan --from-block 0 --to-block 400 --chunk 100 --max-chunks 4 --resume
node src/cli.js full-scan --from-block 12000000 --to-block 13000000 --chunk 2000 \
  --rpc https://...archive-node...
```

- Chia lịch sử thành chunk (mặc định 2000 block), discovery `creation` (tx `to == null` → receipt → `eth_getCode`).
- `data/full_scan_state.json` ghi `lastBlock` sau **mỗi chunk**; `--resume` tiếp tục từ `lastBlock + 1` sau crash / rate-limit.
- Chỉ append contract **có nhãn** vào `data/full_scan_labels.jsonl`.
- Chunk lỗi **không** nhảy checkpoint (quét lại lần sau).
- CI có step `Full-chain checkpoint smoke` chạy 400 block đầu từ genesis: `4` chunk, `lastBlock 399`, checkpoint `data/full_scan_state.json`, `data/full_scan_labels.jsonl`. **Kết quả `contractsScanned 0`**: public full node prune receipt năm 2015 nên không lấy được `contractAddress`. Checkpoint vẫn ghi để `--resume` tiếp tục; quét thật lịch sử cần archive RPC riêng qua `--rpc`. Code ghi `zeroContractChunks` để không im lặng kiểu "0 contract nên 0 lỗi".

**Nói thẳng:** Ethereum >26 triệu block. Không có lệnh nào quét xong trong một CI run, và tao không giả vờ đã quét xong. Đây là job chạy dài hạn có checkpoint; muốn chạy thật toàn chain cần archive RPC riêng qua `--rpc` và để nó chạy nhiều giờ/ngày. `scan --blocks 40` vẫn giữ để kiểm nhanh, không còn là chế độ mặc định được coi là "kết quả".

---

## Lần test BSC ra rác: bản CŨ, không phải BSC

`git rev-parse HEAD` trả `2315651` → pull chưa thành công (`VULNCHAIN_REPORT.md` sửa local chặn merge), nên mày chạy bản cũ: `15 tests`, `featureKeys 29`, `etherscanHits undefined`, `commands: ... scan | selftest` (không có `full-scan`/`chains`). Bản cũ `PUBLIC_RPCS` **không có key `binance`** → `--network binance` fallback thẳng sang **Ethereum RPC**: block `26354521` là Ethereum, và 3 địa chỉ mày mở trên BscScan hiện `0 BNB / $0.00` vì chúng là địa chỉ Ethereum. Bản mới `chainConfig.js` có `binance: https://bsc-rpc.publicnode.com`, `chainId 56`.

3 nhãn `0.5824` / `0.5509` / `0.5378` đều là lỗi selector-driven **đã sửa** ở bản mới: `withdraw(address,uint256)` / `transfer` / `transferFrom` trùng chữ ký corpus. Bản mới bỏ 0.15 selector, yêu cầu `body ≥ 0.30`, generic signature `body ≥ 0.45 && featureCos ≥ 0.85`, và veto `ownerGuard`/`selfCallGuard`. `0x0000000aa232...` chính là contract từng bị dán nhãn sai hôm trước.

`215 EOAs, 185 smart contracts` là log của `EOAFilter`; pipeline chỉ giữ `res.contracts`. Nhưng bản cũ lấy **events trước** nên 80 slot toàn contract hạ tầng. Bản mới đưa **creation tx lên trước**, events sau.

Và database có thật: `vulnchain/incidents/` 821 report + `vulnchain/data/corpus.json` 9.6 MB / 2.485 hàm lỗi / 731 incident / 24 category. Đúng là đó là văn bản sự cố, không phải 821 bytecode lỗi — nên nhãn vẫn chỉ là "giống hình dạng", không phải "có bug đã chứng minh".

## Chỉ quét contract có ≥ $10k

Mặc định `--min-usd 10000`. Đo trên chain, không gọi API giá off-chain:

```
eth_getBalance(native) + balanceOf(USDT/USDC/WETH/WBNB)
giá native = Chainlink latestRoundData() trên chính chain đó
```

Feed lỗi → `priceSource: stables-only`, native/wrapped đóng góp 0, **không bịa giá**. Muốn tính BNB/ETH: `--native-price 690`. Override token: `VULNCHAIN_TOKENS`. Stats có `skippedBelowMinUsd`, `pricedContracts`, `priceSource`. `--min-usd 0` tắt hẳn.

## Tự gắn key RPC + key Etherscan, quét chain mình muốn

`src/chainConfig.js`. Vẫn chạy được **0 key**, nhưng giờ có thể tự gắn:

```bash
# 1. key RPC riêng từng chain + 1 key Etherscan V2 dùng cho mọi chain
cp vulnchain/.env.example vulnchain/.env
#   RPC_URL_BASE=https://base-mainnet.g.alchemy.com/v2/<KEY>
#   ETHERSCAN_API_KEY=<KEY>

node src/cli.js chains --network base        # xem config đã resolve (key bị che)
node src/cli.js scan --network base --blocks 40 --sourcify
node src/cli.js full-scan --network base --full --resume

# 2. không dùng .env, truyền thẳng CLI
node src/cli.js scan --network arbitrum --rpc https://arb-mainnet.g.alchemy.com/v2/<KEY> \
  --etherscan-key <KEY> --chain-id 42161

# 3. chain tự định nghĩa (không có trong 11 network của BugChainIndexer)
RPC_URL_MYCHAIN=https://rpc.mychain.example/<KEY> \
CHAIN_ID_MYCHAIN=12345 \
node src/cli.js scan --network mychain --etherscan-key <KEY>

# hoặc khai đầy đủ, kể cả explorer riêng:
VULNCHAIN_CHAINS='{"mychain":{"chainId":12345,"rpcUrls":["https://..."],"explorerApi":"https://.../api"}}' \
node src/cli.js full-scan --network mychain --full --resume
```

**Thứ tự ưu tiên RPC:** `--rpc` → `RPC_URL_<CHAIN>` → `RPC_URL` → `--rpc-key`/`ALCHEMY_API_KEY` → `INFURA_PROJECT_ID` → `VULNCHAIN_CHAINS` → public RPC. `chainId`: `--chain-id` → `CHAIN_ID_<CHAIN>` → `CHAIN_ID` → `VULNCHAIN_CHAINS` → config gốc.

**Key Etherscan giờ có tác dụng thật:** `LightScanner.etherscanCall()` gọi Etherscan V2 (`chainid` tự chọn theo network), nối vào `ContractVerifier.verify()` của BugChainIndexer để lấy `SourceCode` (kể cả bundle `{{...}}` nhiều file) → đưa vào `labelContract` giống Sourcify. Stats có `etherscanHits`, report có `explorerKeyConfigured`. Không có key → bỏ qua hoàn toàn, không chậm thêm.

**Bảo mật:** `redactRpc()` che `/v2/<key>`, `/v3/<key>`, `?apikey=` trước khi ghi `meta.rpc`. Không có key nào lọt vào `data/*.json` hay report. CI đọc `ETHERSCAN_API_KEY` / `ALCHEMY_API_KEY` / `RPC_URL_ETHEREUM` từ repo secrets nếu mày set; không set thì chạy public như cũ.

`npm test 34/34`.

**CI `42018924770` (2026-11-05 11:26 UTC):** success, `Unit tests 25`, `Key-backed scan` **skipped** vì repo chưa set secret (đúng thiết kế — không có key thì không chạy step đó), live report `chainId 1`, `rpcSource "public RPC (no key)"`, `explorerKeyConfigured false`, `etherscanHits 0`. Muốn bật: Settings → Secrets → `ETHERSCAN_API_KEY` (và tuỳ `ALCHEMY_API_KEY` / `RPC_URL_ETHEREUM`), push lại là step tự chạy và report có `etherscanHits > 0` nếu contract verified.

HEAD `19c767b` (data CI) / `9f09628` (code).

## Vẫn là 1 codebase

`incidents/` 821 report nguyên · `scanners/` BugChainIndexer nguyên · `lightScanner.js` subclass `Scanner` gốc, gọi `LogFetcher.fetchLogs` + `EOAFilter.filterAddresses`. Corpus **2.485 hàm lỗi / 731 incident / 24 category**, 32 feature. Không IOC, không cluster, không rules tĩnh, không seed bytecode contract đã hack, không `REVIEW/INFO`.

## Giới hạn

- Decompiler/verified source không phải lúc nào có; `sourcifyHits` trên CI live vẫn thường = 0. Khi chỉ có bytecode, `ownerGuard` bắt được qua opcode pattern nhưng có thể sót với optimizer lạ.
- Veto `ownerGuard` là âm tính giả có chủ đích: thà bỏ sót một hàm owner-only bị lỗi còn hơn dán nhãn bừa như vừa rồi.
- Nhãn = "hình dạng hàm giống hàm lỗi trong corpus", **không** = "đã chứng minh lỗ hổng". Không tx, fork, PoC, `sweep`. `0 bug không cần quyền, 0 đô` vẫn đứng.

```bash
cd vulnchain && npm ci && npm test && node src/cli.js selftest
node src/cli.js full-scan --full --resume
# production: trỏ archive node, để chạy nhiều giờ, resume khi bị rate-limit
node src/cli.js full-scan --full --resume --rpc https://<ARCHIVE_RPC> --chunk 5000
```

Branch `arena/fbf9cf32-arc-hedgefun`.
