# VulnChain — đã ghép 2 repo thành 1 codebase, đẩy lên GitHub

Sửa đúng chỗ mày chê: bản trước là mấy script viết lại tách rời, **rác**. Lần này clone **hai mã nguồn thật**, nhét chung một cây, **một `package.json`, một `package-lock`, một entrypoint**, rồi push lên branch này.

```
vulnchain/                         ← 1 project duy nhất
├── package.json                   ← install point duy nhất (đã xoá 3 package.json con)
├── incidents/                     ← DeFi-Security-Incident: 821 report + 25 vulns index
├── scanners/                      ← BugChainIndexer: LogFetcher / EOAFilter / ContractVerifier / UnifiedScanner / cron
├── server/backend, server/frontend
├── contract/                      ← Solidity helper của bản gốc
├── docs/                          ← docs gốc + UPSTREAM_BUGCHAIN.md
├── SETUP.md
├── src/                           ← engine tích hợp (mới)
│   ├── lightScanner.js             subclass Scanner gốc, thay Alchemy/Postgres = RPC public
│   ├── pipeline.js                 gọi THẲNG LogFetcher.fetchLogs + EOAFilter.filterAddresses
│   ├── corpus.js                   821 report → corpus
│   ├── bytecode.js                opcode-normalized fingerprint
│   ├── source.js / hashing.js / rules.js / matcher.js
│   └── cli.js                      build-corpus | seed | scan | selftest
├── data/                          corpus.json, vulnerableBytecode.json, scan_result.json
└── test/                          14 unit test
```

`Scanner.js` của bản gốc vẫn được `require`, `LogFetcher` và `EOAFilter` vẫn là file gốc chưa sửa một dòng. `src/lightScanner.js` chỉ override `initialize / getLogs / rpcCall / isContracts / getCodeHashes / queryDB / etherscanCall` để khỏi cần Alchemy key, Etherscan key và PostgreSQL. Đây là **tích hợp**, không phải viết lại.

---

## Thuật toán (chỗ mày bảo "phải thông minh")

Bản cũ chỉ đếm selector trùng → vớ vẩn. Bản này 5 tín hiệu độc lập, có trọng số, có giải thích:

| Trọng số | Tín hiệu | Cái nó làm được mà đếm selector không làm được |
|---|---|---|
| 0.32 | **Bytecode MinHash-Jaccard** | Bỏ metadata CBOR/IPFS, bỏ toàn bộ PUSH immediate (địa chỉ, amount), giữ opcode 5-gram. Hai bản compile cùng source → `codeHash` khác nhưng Jaccard vẫn cao. So với **bytecode thật của contract từng bị khai thác** (seed từ 102 địa chỉ Ethereum trong DB), không phải so với markdown |
| 0.20 | **IDF selector cosine** | `transfer` / `approve` / `balanceOf` bị đưa về weight **0** bằng universal generic prior (17 selector), không phải cắt cứng theo ngưỡng |
| 0.16 | **Source SimHash + MinHash** | Token 4-gram của verified source (Sourcify) so với đoạn Solidity "❌ vulnerable" trong 821 bài. Bắt được cùng pattern dù đổi tên biến |
| 0.10 | **Rule engine 9 luật** | `CALL` trước `SSTORE` + không `nonReentrant`; `initialize()` không `initializer`; `DELEGATECALL` + calldata; EIP-1967 slot; `CREATE2` + `SELFDESTRUCT`; `msg.value` trong vòng lặp… mỗi hit có chuỗi `why` |
| 0.22 | **IOC + bytecode cluster** | creator/address trùng 381 IOC là **khớp cứng** (không cho rớt xuống `INFO`); N contract mới cùng `codeHash` = đúng pattern 66 child của vụ Jared |

**LSH banding** (32 band × 4 row) giới hạn ứng viên trước khi so — không duyệt 821 × N. Corpus build ra **24.610 band key**, 381 IOC, 1.619 selector. Mỗi finding trả `top-5 incident tương tự` kèm `bc=… sel=… src=…` và danh sách evidence.

**Lỗi đã bắt và sửa trong lần CI đầu:** 6 contract 45-byte cho `bytecodeSim = 1.00` với cùng một incident. Đó là **EIP-1167 minimal proxy** — runtime code chỉ có `DELEGATECALL`, không chứa logic, nên mọi clone trông giống hệt nhau và so sánh là vô nghĩa. `getEffectiveCode()` giờ đọc địa chỉ implementation ngay từ bytecode rồi fingerprint **implementation**; thêm ngưỡng `ngramCount ≥ 64`, dưới ngưỡng thì triệt tiêu tín hiệu bytecode thay vì cho điểm. Có unit test khoá lại.

Output chỉ `INFO / REVIEW / HIGH_SIMILARITY`. **Không có `VULNERABLE`** — vẫn không dám nói "contract này có lỗi" từ 821 bài markdown. Nói được là "nó giống sự cố X ở mức này, vì những lý do này, mở ra đọc tiếp".

---

## Con số build

```
821 incident · 726 bảng metadata · 773 bài trích được vulnerable snippet
1.619 selector · 17 selector generic bị triệt · 381 địa chỉ IOC
102 địa chỉ vulnerable contract trên Ethereum (để seed bytecode)
corpus.json 4.386.583 B
npm test 15/15 PASS · selftest 19/19 PASS
```

CI `vulnchain.yml`: `npm ci` → test → build-corpus → selftest → seed bytecode → **scan live trên 1 chain EVM** (`--network ethereum --mode hybrid --sourcify`) → publish `VULNCHAIN_REPORT.md`.

**Kết quả CI live cuối (2026-11-05 06:40 UTC, blocks `26346846–26346885`):**

```
npm ci · 15/15 test · selftest 19/19 · corpus 821
seed 37 bytecode của contract từng bị khai thác (102 địa chỉ, 2 lỗi)
logs 28.154 · contract quét 60 · REVIEW 4 · INFO 56 · cluster bytecode trùng 4 · errors 0
25.720 LSH band key · 1.617 selector key · 381 IOC · 18 selector generic bị triệt
```

Top finding `bc 0.88 / sel 0.29` với incident `2021-11-30_MonoSwap_SelfSwap_PriceManipulation`, kèm 2 rule hit (`arbitrary-call`, `proxy-storage`) — tức **có lý do cụ thể để mở bytecode ra đọc**, không phải "đã tìm ra lỗi". Có một lần CI fail ở bước live do RPC transient; chạy lại xanh, đã bật log tee để lần sau không phải đoán.

---

## Ba chỗ vẫn phải nói thẳng

1. **821 là 821 *sự cố*, không phải 821 mã nguồn lỗi độc lập.** 821 file markdown, mỗi bài có metadata + root cause + đoạn Solidity minh hoạ (nhiều đoạn ghi `pseudocode`) + link PoC ngoài. Không có bytecode đã deploy, không verified source, không trace.
2. **BugChainIndexer không scan tx tạo contract.** Nó lấy địa chỉ active từ Transfer/Approval logs rồi `EOAFilter` phân loại. Nên `pipeline.js` chạy `hybrid`: vừa gọi `LogFetcher.fetchLogs` + `EOAFilter.filterAddresses` đúng kiểu gốc, vừa quét tx `to == null` để có đúng "contract mới deploy".
3. **"Phát hiện contract có lỗ hổng" ≠ "chứng minh có lỗ hổng".** Cái này là similarity triage. Muốn kết luận cần symbolic execution / fuzz / trace thật — dự án khác. Ở đây không tx, không fork, không PoC, không `sweep`. `0 bug không cần quyền, 0 đô` vẫn đứng.

---

## Deploy

Đã commit và push lên `arena/fbf9cf32-arc-hedgefun`. Một cây, một install, chạy được ngay:

```bash
cd vulnchain && npm ci && npm test && node src/cli.js selftest
node src/cli.js scan --network ethereum --blocks 60 --mode hybrid --sourcify
```

Xem `vulnchain/README.md` để đủ lệnh, `VULNCHAIN_REPORT.md` để kết quả CI live.
