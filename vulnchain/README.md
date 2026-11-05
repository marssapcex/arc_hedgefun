# VulnChain — một codebase duy nhất

Ghép **hai mã nguồn thật** vào một repo, một `package.json`, một entrypoint:

| Thành phần | Nguồn | Vai trò |
|---|---|---|
| `scanners/`, `server/`, `contract/`, `docs/`, `SETUP.md` | [`kismp123/BugChainIndexer`](https://github.com/kismp123/BugChainIndexer) | engine quét địa chỉ/contract: `LogFetcher` (adaptive `eth_getLogs`), `EOAFilter` (EOA vs contract + code hash), `ContractVerifier`, `UnifiedScanner`, REST backend, cron, contract helper |
| `incidents/` (821 report + 25 `vulns/*.md`) | [`kismp123/DeFi-Security-Incident`](https://github.com/kismp123/DeFi-Security-Incident) | database sự cố thật 2020–2026 |
| `src/` | mới | engine đối chiếu: MinHash/LSH bytecode, SimHash source, IDF selector, rule engine, IOC, ranking |

Không viết lại scanner. `src/lightScanner.js` **subclass `scanners/common/Scanner.js`** và chỉ thay phần I/O (Alchemy/Postgres → RPC public). `pipeline.js` gọi thẳng `LogFetcher.fetchLogs()` và `EOAFilter.filterAddresses()` từ mã gốc. `ContractVerifier.verify()` được nối sẵn, tự bật khi có `DEFAULT_ETHERSCAN_KEYS`.

---

## Thuật toán

```
incidents/*.md  ──corpus.js──▶ 821 record
                                ├ metadata / IOC / category / root cause
                                ├ vulnerable Solidity snippet → token 4-gram
                                │        → 128-perm MinHash + 64-bit SimHash
                                └ function declarations → Keccak selector (ethers.id)
                                          → IDF (generic ERC20 selector = 0)

RPC (1 chain EVM)
  ├ LogFetcher.fetchLogs(scanner,...)        [mã BugChainIndexer gốc]
  ├ EOAFilter.filterAddresses(scanner,...)  [mã BugChainIndexer gốc]
  ├ creation tx (to == null) → receipt.contractAddress → eth_getCode
  ├ Sourcify (optional) → verified source
  └ bytecode.js: strip CBOR metadata + PUSH immediates → opcode 5-gram
                 → MinHash + LSH bands + PUSH4 selector + static flags

matcher.js
  LSH banding lấy ứng viên (không so 821 × N)
  0.32 bytecode Jaccard   (so với bytecode contract ĐÃ BỊ KHAI THÁC, seed từ 102 địa chỉ Ethereum)
  0.20 IDF selector cosine
  0.16 source SimHash/MinHash
  0.10 rule engine (9 rule có giải thích)
  0.22 IOC exact + identical-bytecode cluster
  → INFO / REVIEW / HIGH_SIMILARITY + top-5 incident tương tự + evidence
```

**Không bao giờ** xuất `VULNERABLE`. Selector trùng ≠ lỗi; đây là xếp hạng để mở bytecode/source ra đọc tiếp.

`seed-vulnerable-bytecode` là điểm khác biệt lớn nhất so với bản chỉ đọc markdown: nó **lấy bytecode thật của các contract từng bị khai thác** trên Ethereum, fingerprint lại, rồi so opcode-normalized với contract mới. Hai bản compile cùng một source (khác địa chỉ, khác metadata hash) vẫn có Jaccard cao dù `codeHash` khác hẳn.

---

## Chạy

```bash
cd vulnchain
npm ci                     # MỘT install point, MỘT package-lock

npm test                   # 15 unit test
node src/cli.js build-corpus
node src/cli.js make-fixture
node src/cli.js selftest

# nạp bytecode của contract từng bị khai thác (read-only RPC)
node src/cli.js seed-vulnerable-bytecode --max 40

# quét 1 chain EVM
node src/cli.js scan --network ethereum --blocks 60 --mode hybrid --max-contracts 60 --sourcify
node src/cli.js scan --network bsc --mode events --blocks 30
node src/cli.js scan --fixture          # hoàn toàn offline
```

`mode`: `events` (đúng BugChainIndexer gốc), `creation` (tx tạo contract), `hybrid` (cả hai, mặc định).
Chain hỗ trợ RPC public: `ethereum`, `bsc`, `arbitrum`, `base`, `optimism`, `polygon`. Thêm chain bằng cách sửa `PUBLIC_RPCS` trong `src/lightScanner.js` — config `scanners/config/networks.js` của bản gốc vẫn được `Scanner` nạp.

Output: `data/corpus.json` (821 record), `data/vulnerableBytecode.json`, `data/scan_result.json`, `VULNCHAIN_REPORT.md` ở repository root.

## REST backend & cron (từ mã gốc)

`server/backend/index.js` và `scanners/cron/` vẫn còn nguyên, dùng chung `node_modules` ở root. Chúng cần PostgreSQL + Alchemy key (xem `SETUP.md`, `.env.example`). `src/` không cần thứ đó — chạy được trên CI không credentials.

## Giới hạn

- `PUSH4` selector là heuristic; PUSH4 cũng dùng để đẩy hằng số. IDF + giao với corpus triệt phần lớn nhiễu, không triệt hết.
- 95/821 report không có bảng metadata; 48 report không trích được vulnerable snippet. `hasMetadataTable` / `vulnerableSnippetCount` có trong từng record.
- Nhiều report dùng `pseudocode` → selector suy ra best-effort.
- EIP-1167 minimal proxy được resolve sang implementation trước khi fingerprint; bytecode dưới 64 opcode n-gram không tính similarity (tránh mọi clone 45-byte đều "giống hệt" nhau).
- Không symbolic execution, không fuzz, không trace, không đọc storage. **Không thay audit.**
- Chỉ đọc RPC. Không tx, không fork, không PoC, không claim rút được tiền.

`docs/UPSTREAM_BUGCHAIN.md` là README gốc của BugChainIndexer; `incidents/README.md` là README gốc của DeFi-Security-Incident.
