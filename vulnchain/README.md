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
   score = 0.50 featureCosine + 0.35 body(MinHash+SimHash) + 0.15 selectorEqual
   ngưỡng: score ≥ 0.46 · featureCos ≥ 0.55 · ≥4 feature bật
           · (selector trùng hoặc body > 0.10)
   → labels[] = {category, confidence, functionCount, incidents, examples}
   → matchedFunctions[] = {selector, score, activeFeatures, incidentId, rootCause}
```

`featureCosine` là chỗ bắt được "hàm này cũng đọc reserve sống, lặp mảng caller đưa, chuyển ETH rồi mới ghi state" dù tên hàm/selector khác. Đó là cái so nguyên bytecode không làm được.

## Chạy

```bash
cd vulnchain
npm ci                     # MỘT install point
npm test                   # 15 unit test
node src/cli.js build-corpus
node src/cli.js make-fixture
node src/cli.js selftest   # 19 check, hoàn toàn offline

node src/cli.js scan --network ethereum --blocks 40 --mode hybrid --max-contracts 60 --sourcify
node src/cli.js scan --network bsc --mode events --blocks 30
node src/cli.js scan --fixture
```

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
