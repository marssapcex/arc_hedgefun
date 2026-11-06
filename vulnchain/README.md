# VulnChain — 1 codebase, gắn nhãn contract theo HÀM LỖI của 821 vụ hack

Ghép **hai mã nguồn thật**, một `package.json`, một entrypoint:

| | Nguồn | Vai trò |
|---|---|---|
| `scanners/`, `server/`, `contract/`, `docs/`, `SETUP.md` | [`kismp123/BugChainIndexer`](https://github.com/kismp123/BugChainIndexer) | `LogFetcher` (adaptive `eth_getLogs`), `EOAFilter`, `ContractVerifier`, `UnifiedScanner`, REST backend, cron |
| `incidents/` | [`kismp123/DeFi-Security-Incident`](https://github.com/kismp123/DeFi-Security-Incident) | 821 report + 25 `vulns/*.md` |
| `src/` | mới | engine **mức hàm**: trích hàm lỗi → so từng hàm → gắn nhãn |

`src/lightScanner.js` **subclass `scanners/common/Scanner.js`**, chỉ thay I/O (Alchemy/Postgres → RPC public). `pipeline.js` gọi thẳng `LogFetcher.fetchLogs()` và `EOAFilter.filterAddresses()` từ mã gốc. Không viết lại scanner.

## Không có

- ❌ IOC attacker address / identical-bytecode cluster
- ❌ rules tĩnh `CALL` trước `SSTORE`
- ❌ whole-contract bytecode Jaccard, ❌ seed bytecode contract đã bị hack (*không ai deploy lại code bị hack*)
- ❌ `REVIEW`/`INFO` verdict, ❌ `VULNERABLE`

## Thuật toán

```
incidents/*.md ──corpus.js──▶ 2.485 hàm lỗi / 731 incident / 24 category
   mỗi hàm: selector (Keccak canonical signature)
          + 29 feature ngữ nghĩa (callerCheck / usesMsgValue / callWithValue /
             stateWrite / balanceRead / getReserves / loop / userArrayParam /
             unchecked / reentrancyGuard / slippageGuard / delegatecall ...)
          + body 3-gram → MinHash 64 + SimHash 64 + 16 LSH band
          + nhãn category + incidentId + rootCause

RPC 1 chain EVM
   LogFetcher.fetchLogs + EOAFilter.filterAddresses  [mã gốc]
   + creation tx (to == null) → eth_getCode
   + Sourcify (optional) → verified source
   + EIP-1167 proxy → resolve implementation

functions.js
   splitBytecodeFunctions(): PUSH4 sel; EQ; PUSH2 dest; JUMPI
       → cắt runtime bytecode theo JUMPDEST thành 1 segment / hàm
   verified source → brace-matched body, merge theo selector

matcher.js  FunctionLabeler
   LSH band + selector index → ứng viên hàm lỗi
   score = 0.60 featureCosine + 0.40 body(MinHash+SimHash) + 0 selectorEqual
   ngưỡng: score ≥ 0.58 · featureCos ≥ 0.70 · ≥4 feature bật · body ≥ 0.30 (bắt buộc)
   HARD VETO: ownerGuard / selfCallGuard -> bỏ hàm ngay (không phải điểm vào
              của exploit không cần quyền). Chữ ký generic đòi body ≥ 0.45.
   → labels[] = {category, confidence, functionCount, incidents, examples}
   → matchedFunctions[] = {selector, score, activeFeatures, incidentId, rootCause}
```

`featureCosine` là chỗ bắt được "hàm này cũng đọc reserve sống, lặp mảng caller đưa, chuyển ETH rồi mới ghi state" dù tên hàm/selector khác. Đó là cái so nguyên bytecode không làm được.

## Chạy

```bash
cd vulnchain
npm ci                     # MỘT install point
npm test                   # 17 unit test
node src/cli.js build-corpus
node src/cli.js make-fixture
node src/cli.js selftest   # 19 check, hoàn toàn offline

node src/cli.js scan --network ethereum --blocks 40 --mode hybrid --max-contracts 60 --sourcify
node src/cli.js scan --network bsc --mode events --blocks 30
node src/cli.js scan --fixture
node src/cli.js full-scan --full --resume
node src/cli.js full-scan --from-block 0 --to-block 400 --chunk 100 --max-chunks 4 --resume
```

### Key RPC / key Etherscan theo chain mình muốn

```bash
cp .env.example .env        # RPC_URL_<CHAIN>, ETHERSCAN_API_KEY, ALCHEMY_API_KEY ...
node src/cli.js chains --network base                 # kiểm tra config (key bị che)
node src/cli.js scan --network base --blocks 40 --sourcify         # mặc định --min-usd 10000
node src/cli.js scan --network binance --mode creation --min-usd 10000
node src/cli.js full-scan --network binance --full --resume
node src/cli.js scan --network arbitrum --rpc https://.../<KEY> --etherscan-key <KEY>
RPC_URL_MYCHAIN=https://... CHAIN_ID_MYCHAIN=12345 node src/cli.js scan --network mychain
```

Thứ tự: `--rpc` → `RPC_URL_<CHAIN>` → `RPC_URL` → `ALCHEMY_API_KEY` / `INFURA_PROJECT_ID` → `VULNCHAIN_CHAINS` → public RPC. Etherscan V2 (`--etherscan-key` / `ETHERSCAN_API_KEY`) nối vào `ContractVerifier.verify()` để lấy verified source; `chainid` tự theo `--network`. Custom chain qua `VULNCHAIN_CHAINS` JSON hoặc cặp `RPC_URL_*` + `CHAIN_ID_*`. Key được redact khỏi report. Xem `src/chainConfig.js`.

**Chỉ contract giữ ≥ $10k trên chain mới được xét** (mặc định `--min-usd 10000`). Đo bằng RPC read-only: `eth_getBalance` + `balanceOf` stablecoin + giá `Chainlink.latestRoundData()` on-chain; feed lỗi thì chỉ đếm stablecoin (`priceSource: stables-only`), không bịa giá. `--min-usd 0` tắt, `--native-price <usd>` tự khai giá, `VULNCHAIN_TOKENS` override danh sách token. Discovery ưu tiên **creation tx** trước, events sau — không còn lấy 80 contract hạ tầng (Uniswap/Aave/1inch) từ logs.

`full-scan` là checkpointed range scanner: `data/full_scan_state.json` lưu `lastBlock` sau mỗi chunk, append contract có nhãn vào `data/full_scan_labels.jsonl`. Quét >26M block là job dài hạn, không phải một lệnh; dùng `--rpc` trỏ archive node riêng để chạy thật.

`mode`: `events` (đúng BugChainIndexer gốc), `creation` (tx tạo contract), `hybrid` (mặc định). Chain public RPC: `ethereum`, `bsc`, `arbitrum`, `base`, `optimism`, `polygon` (`PUBLIC_RPCS` trong `src/lightScanner.js`). Config `scanners/config/networks.js` của bản gốc vẫn được `Scanner` nạp.

Output: `data/corpus.json`, `data/scan_result.json`, `VULNCHAIN_REPORT.md` ở repository root.

## Backend / cron (mã gốc)

`server/backend/index.js`, `scanners/cron/` vẫn nguyên, dùng chung `node_modules` root, cần PostgreSQL + Alchemy key (`SETUP.md`, `.env.example`). `src/` không cần thứ đó.

## Giới hạn

- 90/821 bài không trích được hàm (pseudocode / chỉ mô tả).
- Dispatcher decomposition là heuristic; Vyper / assembly lạ ghi `decomposition: fallback`.
- Feature vector là **hình dạng**, không chứng minh ngữ nghĩa. Nhãn `reentrancy` = "giống các hàm reentrancy trong corpus", **không** = "đã chứng minh reentrancy".
- Không symbolic execution / fuzz / trace / đọc storage. Không thay audit. Chỉ đọc RPC; không tx, fork, PoC, `sweep`.

`docs/UPSTREAM_BUGCHAIN.md` là README gốc BugChainIndexer; `incidents/README.md` là README gốc DeFi-Security-Incident.
