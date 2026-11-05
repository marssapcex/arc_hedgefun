# BugChain — 2 công cụ tích hợp: incident database × new-contract indexer

Làm thật, chạy được, không dependency ngoài stdlib Python 3.11+. Không key, không tx, không fork, không PoC exploit, không claim "có lỗ hổng".

Hai nguồn:
- [`kismp123/DeFi-Security-Incident`](https://github.com/kismp123/DeFi-Security-Incident) → **Tool A**
- [`kismp123/BugChainIndexer`](https://github.com/kismp123/BugChainIndexer) → **Tool B**

---

## 0. Ba chỗ phải đính chính trước khi dùng

**1. `821` là 821 *sự cố*, không phải 821 mã lỗ hổng độc lập.**
README gốc: *"A comprehensive reference of **821** real-world DeFi security incidents (2020–2026)"*. Clone về đếm được đúng **821 file** `YYYY-MM-DD_*.md` trong 7 thư mục năm (2020: 9, 2021: 35, 2022: 135, 2023: 230, 2024: 234, 2025: 119, 2026: 59), cộng 7 README năm và 25 file `vulns/*.md` → 854 `.md` tổng cộng. Tool A parse được **821/821**, trong đó **726** có bảng metadata đầy đủ, 95 bài chỉ còn tiêu đề + nội dung. Nhiều bài chia cùng một root cause (reentrancy, oracle spot price...). Nên đừng đọc "821 bug" thành 821 signature khác nhau.

**2. BugChainIndexer không hề scan transaction tạo contract.**
README của nó: *"Unified Event Pipeline — Discover active addresses and track ERC20 approvals from Transfer + Approval events in a single `eth_getLogs` call"*, rồi `EOAFilter.js` gọi `isContracts()` / `getCodeHashes()` để phân loại EOA vs contract và lưu PostgreSQL. Nó tìm **địa chỉ active mới**; "contract mới deploy" là hệ quả của bước lọc, không phải đầu vào. Vì vậy Tool B có **2 mode**:

| Mode | Cách | Đúng với |
|---|---|---|
| `creation` | `eth_getBlockByNumber(n, true)` → tx có `to == null` → `receipt.contractAddress` → `eth_getCode` | đúng nghĩa "contract vừa deploy" |
| `events` | Transfer + Approval logs từng chunk 50 block → addresses trong `topic1/2` → `eth_getCode` | đúng kiểu BugChainIndexer gốc |

Tool B của repo gốc cần Node + PostgreSQL + Alchemy key + Etherscan key. Bản này chỉ dùng `urllib` + JSON-RPC public, chạy trên CI không credentials.

**3. "Tự động quét toàn bộ mã có lỗ hổng như 821 bug kia" — không làm được trung thực, nên tao không giả vờ.**
821 bài là **markdown**: metadata, root cause, đoạn Solidity minh hoạ (nhiều đoạn ghi rõ `pseudocode`), link PoC ngoài. **Không có bytecode đã deploy của 821 contract**, không có verified source, không có trace. Không thứ gì cho phép kết luận "contract mới này có lỗi" chỉ từ mấy bài đó.

Cái làm được là **triage có căn cứ**: xếp contract mới theo mức liên quan tới lịch sử sự cố, để người/audit đọc tiếp. Output chỉ có `INFO` / `REVIEW` / `KNOWN_ACTOR` — **không bao giờ** `VULNERABLE`.

---

## 1. Kiến trúc

```
DeFi-Security-Incident/ (821 .md + 25 vulns/)
        │
        ▼  Tool A: bugchain/incident_db.py
  incident_db.json          821 records: date/protocol/chain/loss/root cause/
                            vulnerable contract/attacker/attack tx/categories
  incident_signatures.json  2.234 selector + 381 known address IOC + keyword hints
        │
        │                       ┌─ Tool B: bugchain/indexer.py
        │                       │   creation | events → runtime bytecode →
        │                       │   codeHash + candidate PUSH4 selectors
        │                       ▼
        │                  new_contracts.json + identical-code clusters
        └──────────►  bugchain/scanner.py  ◄────────┘
                              │
                              ▼
                   bugchain_findings.json + BUGCHAIN_REPORT.md
```

`bugchain/keccak.py` là Keccak-256 tự viết (padding domain `0x01`), vì `hashlib.sha3_256` là NIST SHA3 (domain `0x06`) và sẽ cho ra **selector sai**. Đã verify: `transfer(address,uint256) → 0xa9059cbb`, `approve → 0x095ea7b3`, `balanceOf → 0x70a08231`, `keccak256("") → c5d246…a470`.

---

## 2. Ba lớp đối chiếu (và trọng số)

| Lớp | Tín hiệu | Điểm | Ý nghĩa |
|---|---|---|---|
| **IOC exact** | `creator` hoặc `address` của contract mới trùng địa chỉ attacker / attack contract / vulnerable contract trong 821 bài | creator +60, address +40 | Duy nhất lớp này là **khớp cứng**, không phải heuristic |
| **Selector overlap** | `PUSH4` trong 2 KiB đầu runtime bytecode ∩ selector suy ra từ code snippets của các bài | +10 mỗi cái, cap 30 | **Yếu**. Chỉ báo "có hàm từng xuất hiện trong bài sự cố" |
| **Bytecode cluster** | nhiều contract mới có cùng `codeHash` | +15 nếu ≥5 | Bắt đúng pattern **66 child contract giống hệt nhau** của vụ Jared 20/06/2026 |

**Bộ lọc quan trọng nhất:** selector xuất hiện trong ≥ `10% × 821 = 82` bài bị coi là *generic* và **loại hoàn toàn**. Không có bộ lọc này thì mọi ERC20 mới deploy đều dính `transfer` + `approve` + `balanceOf` → 100% false positive. Build hiện tại loại **7 selector generic**. Có unit test `test_generic_filter_removes_erc20_noise` để khoá cái này lại.

---

## 3. Kết quả build thật

```
built 821 incidents, 726 with metadata tables, 2234 derived selectors
incident_db.json          1.012.380 B
incident_signatures.json    511.762 B
known IOC addresses             381
category index                   24 slug (flash-loan 116, business-logic 137,
                                  access-control 96, oracle 96, reentrancy 61 ...)
```

`python3 -m unittest discover -s tests -v` → **10/10 PASS**. `python3 -m bugchain.cli selftest` → **12/12 PASS**, gồm end-to-end offline: fixture 3 contract → 1 cluster bytecode trùng → 1 `KNOWN_ACTOR` (creator nằm trong IOC thật) + 2 `REVIEW`.

**CI live 2026-11-05 06:03 UTC** (`bugchain.yml`, Ethereum head, `--mode creation --blocks 60`):

```
blocksScanned 60 · txSeen 16.209 · creationTxSeen 18 · hashOnlyTx 0
contracts with runtime code 11 · indexerErrors 7 (self-destruct / transient)
verdicts REVIEW 9, INFO 2, KNOWN_ACTOR 0 · identical-code clusters 0
blockRange 26346656–26346715
```

Đọc đúng cái `REVIEW 9`: **không phải 9 contract có lỗi.** Đó là 9 contract có ít nhất một `PUSH4` trùng selector hiếm trong DB — và PUSH4 cũng dùng để đẩy hằng số. Đây là nhiễu đã biết, là lý do có mục 5 bên dưới. `KNOWN_ACTOR 0` mới là kết luận đáng tin: không creator nào trong 60 block đó trùng 381 địa chỉ IOC.

---

## 4. Chạy

```bash
# A. build lại database từ clone của repo gốc
python3 -m bugchain.cli build-db \
  --source /path/to/DeFi-Security-Incident \
  --out bugchain/data/incident_db.json \
  --signatures bugchain/data/incident_signatures.json

# B. index contract mới (read-only public RPC)
python3 -m bugchain.cli index --mode creation --blocks 60 \
  --out bugchain/data/new_contracts.json
python3 -m bugchain.cli index --mode events --from-block 26342000 --to-block 26342050 \
  --out bugchain/data/events_contracts.json

# offline, không cần RPC (dùng giá trị thật trích từ DB)
python3 -m bugchain.cli make-fixture
python3 -m bugchain.cli index --fixture bugchain/data/fixture_blocks.json \
  --out bugchain/data/fixture_contracts.json

# C. đối chiếu
python3 -m bugchain.cli scan --contracts bugchain/data/new_contracts.json \
  --out bugchain/data/bugchain_findings.json --md BUGCHAIN_REPORT.md

# kiểm
python3 -m unittest discover -s tests -v
python3 -m bugchain.cli selftest
```

`.github/workflows/bugchain.yml` chạy đúng chuỗi này trên CI: unit test → selftest → `index --mode creation --blocks 3` trên Ethereum head → `scan` → publish `new_contracts.json` / `bugchain_findings.json` / `BUGCHAIN_REPORT.md` với `[skip ci]`.

---

## 5. Giới hạn, nói thẳng

- `PUSH4` cũng dùng để đẩy hằng số → `candidateSelectors` là **ứng viên**, không phải ABI. Việc giao với 2.234 selector thật sẽ triệt phần lớn nhiễu, **vẫn còn sót** — chính là 9 `REVIEW` ở lần CI live. Đừng đọc `REVIEW` thành "có bug"; đọc thành "có lý do để mở bytecode ra xem". Muốn giảm nhiễu hơn nữa phải đọc verified ABI / Sourcify, không phải chỉ PUSH4.
- Selector suy ra từ Solidity snippets **best-effort**: nhiều bài dùng pseudocode, param có tên biến, tuple, `@override`; parser bỏ qua cái không canonical hoá được. Không có nghĩa là thiếu selector ⇒ an toàn.
- 95/821 bài không có bảng metadata → thiếu IOC cho những bài đó. `hasMetadataTable` có trong từng record để biết chỗ nào mỏng.
- Không phân tích control flow, không symbolic execution, không fuzz, không đọc storage, không so sánh implementation/proxy, không kiểm tra `msg.sender`/modifier. **Không thay được audit.**
- Không có tx, không fork, không PoC, không `sweep`, không kết luận rút được tiền. `0 bug không cần quyền, 0 đô` vẫn đứng nguyên cho toàn bộ đống target đã quét trong repo này.

---

## 6. Cái nó thực sự có ích

Không phải "tìm ra bug". Là **giảm từ hàng trăm contract mới mỗi block xuống một danh sách có thứ tự**: địa chỉ do attacker cũ deploy → đọc đầu; 20 contract cùng một bytecode vừa xuất hiện → đọc tiếp (đây chính là dạng 66 child của Jared); còn lại để `INFO`. Và nó làm được hoàn toàn offline với `fixture`, nên có thể đem đi dạy / test mà không cần RPC hay key.

Muốn nâng lên mức "kết luận được lỗi" thì cần thêm verified source (Sourcify/Etherscan), trace thật của 450 attack tx, và một engine phân tích — đó là dự án khác, không phải cái đang có trong 821 file markdown.
