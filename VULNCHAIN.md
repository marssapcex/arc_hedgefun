# VulnChain — gắn nhãn contract theo HÀM LỖI của 821 vụ hack

Sửa đúng chỗ mày chê. **Bỏ hết**:

| Bỏ | Lý do |
|---|---|
| 22% IOC + cluster | So địa chỉ ví độc hại / cụm contract giống hệt nhau không trả lời "hàm nào lỗi" |
| 10% Rules tĩnh (`CALL` trước `SSTORE`) | Luật chung dính mọi proxy, không phải hàm lỗi cụ thể |
| **0.32 whole-bytecode Jaccard + seed 102 contract đã bị hack** | **`ko ai deploy lại code bị hack đâu`** — so nguyên runtime bytecode của contract cũ là sai hướng, nên xóa luôn bước `seed-vulnerable-bytecode`, file `rules.js`, `vulnerableBytecode.json`, và mọi field IOC/cluster/verdict |

Còn lại đúng một việc: **tích hợp 2 repo → quét 1 chain EVM → gắn nhãn các contract có hàm lỗi giống 821 vụ hack**.

---

## Vẫn là 1 codebase duy nhất

```
vulnchain/
├── package.json                  ← 1 install point
├── incidents/                    ← 821 report + 25 vulns (DeFi-Security-Incident, nguyên)
├── scanners/ server/ contract/ docs/ SETUP.md   ← BugChainIndexer, nguyên
├── src/
│   ├── lightScanner.js            extends Scanner gốc, gọi LogFetcher + EOAFilter
│   ├── pipeline.js                discovery 1 chain → danh sách contract + source
│   ├── functions.js              ★ trích TỪNG HÀM (dispatcher + Solidity body)
│   ├── corpus.js                 ★ 821 bài → 2.485 hàm lỗi
│   ├── matcher.js                ★ FunctionLabeler: so hàm → gắn nhãn
│   └── hashing.js / source.js / bytecode.js / cli.js
├── data/corpus.json (2.485 hàm) · data/scan_result.json
└── test/ 15 unit test
```

`src/rules.js` đã xóa. `seed-vulnerable-bytecode` đã xóa khỏi CLI lẫn workflow. Không còn `REVIEW/INFO`, không còn `verdict`, không còn `knownAddressHits`, không còn `identicalBytecodeClusterSize`.

---

## Thuật toán: mức HÀM, không mức contract

**Corpus.** Với 821 bài, `snippets()` lấy các block `❌ Vulnerable`, rồi `extractSourceFunctions()` bóc **từng hàm** bằng brace matching. Kết quả **2.485 hàm lỗi từ 731 incident**. Mỗi hàm lưu:

- `selector` (Keccak của canonical signature), `name`, `signature`
- **29 feature ngữ nghĩa**: `callerCheck`, `usesMsgValue`, `callWithValue`, `stateWrite`, `balanceRead`, `getReserves`, `loop`, `userArrayParam`, `unchecked`, `reentrancyGuard`, `slippageGuard`, `delegatecall`…
- body token 3-gram → MinHash 64 perm + SimHash 64-bit + 16 LSH band
- nhãn = category của incident (`reentrancy`, `oracle-price-manipulation`, `access-control`…) + `incidentId` + `rootCause`

**Contract mới.** `splitBytecodeFunctions()` đọc dispatcher Solidity/Vyper (`PUSH4 sel; EQ; PUSH2 dest; JUMPI`), cắt runtime bytecode thành **một segment cho mỗi hàm** theo `JUMPDEST`. Có Sourcify thì merge thêm body Solidity vào đúng selector. EIP-1167 proxy được resolve sang implementation trước khi cắt.

**So khớp.** Với **mỗi hàm** của contract mới, LSH band + selector index lấy ứng viên hàm lỗi, rồi:

```
score = 0.50 × featureCosine      (hình dạng ngữ nghĩa của hàm)
      + 0.35 × bodySimilarity     (0.65 MinHash Jaccard + 0.35 SimHash)
      + 0.15 × selectorEqual      (cùng chữ ký hàm)

giữ nếu score ≥ 0.46, featureCos ≥ 0.55, ≥ 4 feature bật,
và (selector trùng HOẶC body > 0.10)
```

**Output = NHÃN**, không phải điểm contract:

```
0xabc…  functionCount 7
  labels: [ oracle-price-manipulation (0.71, 2 hàm, incidents: 2021-…, 2022-…),
            reentrancy (0.52, 1 hàm, …) ]
  matchedFunctions: [ {selector, name, score, featureCos, body, activeFeatures,
                        matchedVulnerableFunction, incidentId, rootCause} ]
```

`featureCosine` là chỗ "thông minh": nó bắt được *"hàm này cũng đọc reserve sống, lặp trên mảng do caller đưa, chuyển ETH rồi mới ghi state"* dù tên hàm, thứ tự biến, thậm chí selector khác hẳn. Đó là cái so nguyên bytecode không làm được.

---

## Kiểm

```
npm test 15/15 PASS
node src/cli.js selftest 19/19 PASS
corpus 821 incident → 2.485 hàm lỗi / 731 incident / 24 category
fixture: 1 contract được gắn nhãn reentrancy, contract rỗng KHÔNG bị dán nhãn
```

CI `vulnchain.yml`: `npm ci` → test → build-corpus → fixture + selftest → **scan live 1 chain EVM** → publish `VULNCHAIN_REPORT.md`.

**Kết quả live (2026-11-05 07:17 UTC, Ethereum blocks `26347036–26347075`):**

```
60 contract · 1.123 hàm được bóc tách · 23.998 logs · errors 0
labelledContracts 1 · labelsByCategory {"oracle-price-manipulation": 1}
```

Contract `0x0000000aa232…` (23 hàm) có **`withdraw(address,uint256)` `0xf3fef3a3`** trùng hàm lỗi trong `2023-07-25_Platypus02_PriceManipulation`: `score 0.5824`, `featureCos 0.739`, `body 0.18`, selector khớp, 11 feature bật (`externalCall, staticcall, stateWrite, stateRead, callerCheck, loop, math, division, timestamp, create, revert`). 59 contract còn lại **không bị dán nhãn** — không dán bừa.

---

## Giới hạn, nói thẳng

- 90/821 bài không trích được hàm (chỉ có pseudocode / mô tả) → thiếu mẫu cho category đó.
- Dispatcher decomposition là heuristic; Vyper / optimizer lạ / fallbackassembly có thể cắt sai → `decomposition: fallback` được ghi rõ.
- Feature vector là **hình dạng**, không phải ngữ nghĩa thật sự. Nhãn `reentrancy` nghĩa là "hàm này giống các hàm reentrancy trong corpus", **không** nghĩa là "đã chứng minh reentrancy".
- Chỉ đọc RPC. Không tx, không fork, không PoC, không `sweep`. `0 bug không cần quyền, 0 đô` vẫn đứng.

```bash
cd vulnchain && npm ci && npm test && node src/cli.js selftest
node src/cli.js scan --network ethereum --blocks 40 --mode hybrid --max-contracts 60 --sourcify
```

Đã push lên `arena/fbf9cf32-arc-hedgefun`.
