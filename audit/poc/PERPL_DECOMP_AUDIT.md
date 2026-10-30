# Audit Perpl (Monad) — bản decompile `unknown` (solc 0.8.30)

Ngày: 2026-10-30 · Phạm vi: **chỉ tìm lỗi làm mất tiền** (trộm/rút sai), không báo style, không báo gas.
Trạng thái: **không tìm thấy bug nào.** Không có lỗ hổng trộm tiền nào được xác nhận; phần dưới chỉ là chỗ đáng ngờ + cái cần để kiểm chứng. Tài liệu này phân loại rõ cái gì đã chứng minh được, cái gì là giả thuyết, và vì sao phần lớn toán của Perpl không thể kiểm chứng từ artifact này.

---

## 1. Kết luận ngắn

**Không có bug. Hết.** Bốn ý dưới là lý do, không phải finding.

1. ABI trong artifact là **thật**: 8 selector kiểm lại bằng `cast sig` khớp 1:1 với bảng dispatch.
2. Hợp đồng là **perp DEX kiểu dYdX-v3** (account + perpetual, CLOB on-chain), UUPS proxy, version 1.7.5, collateral 6 decimals (AUSD), giá scale `1e8`, tối đa ~1022 perpetual.
3. Phần **duy nhất** còn nguyên vẹn để kiểm chứng bằng PoC là quỹ "recycle fee" (`0x107ec` + `0x8bcf1b27`). Tôi đã port 1:1 và viết PoC: **7/7 pass, 5000 runs**. Kết quả: phần kế toán **đúng**, nhưng **địa chỉ nằm trong `mapping_d4` bỏ qua toàn bộ hạn mức** — và đó là hạn mức duy nhất bảo vệ `withdrawFromProtocol`.
4. Toán CLOB/matching, funding, IM/MM, thanh lý **không tồn tại trong artifact** (dedaub báo 66 % dead code, thân hàm thay bằng `Unknown jump`). Mọi kết luận "CLOB tính sai" rút ra từ bản này sẽ là bịa. Không có PoC cho phần đó cho tới khi có bytecode.

---

## 2. ABI đã kiểm chứng

Mỗi dòng dưới đây là `cast sig` chạy lại trong sandbox, khớp đúng 4 byte trong bảng dispatch của artifact:

| Chữ ký | Selector | Ý nghĩa |
|---|---|---|
| `getExchangeInfo()` | `0x8bc5b3c5` | tham số toàn sàn, đồng thời là cơ số của hạn mức recycle |
| `getPerpetualInfo(uint256)` | `0x00092cce` | tham số từng perp (kèm `mapping_e5` bit-field) |
| `getOrder(uint256,uint256)` | `0x5e1a3573` | tra order theo **(perpetualId, orderId)** — O(1), đúng kiểu CLOB |
| `getLiquidationInfo(uint256)` | `0x50ef5c35` | trạng thái thanh lý của perp |
| `withdrawFromProtocol(uint256)` | `0x8a924640` | rút quỹ protocol, **chỉ bị chặn bởi `stor_cf`** |
| `setRecycleFee(uint256)` | `0xbe0783f5` | ghi word bit-field có chứa **bit 241 = cờ halt** |
| `isHalted()` | `0xc7ff1584` | đọc bit 241 của chính word đó |
| `setFeeParams(uint256,uint256)` | `0x9d2ec188` | tham số đầu là **perpetualId**, đầu sau là fee ≤ `1e5` |

Ghi chú: `getOrder(uint256)` (một tham số) ra `0xd09ef241`, **không** khớp — nên chữ ký đúng là bản 2 tham số ở trên. Đây là ví dụ cho thấy tên hàm trong artifact phải verify từng cái, không đoán.

Đuôi của dispatch khớp UUPS + OZ: `proxiableUUID() 0x52d1902d`, `upgradeTo 0x3659cfe6`, `upgradeToAndCall 0x4f1ef286`, `owner 0x8da5cb5b`, `transferOwnership 0xf2fde38b`, `acceptOwnership 0x79ba5097` (`Ownable2Step`), `pauseContract 0x439766ce`, `unpauseContract 0xb33712c5`.

---

## 3. Bằng chứng chạy được (không phải lý thuyết)

File: `audit/poc/harness/test/RecycleFeePoC.t.sol`
Port dòng-theo-dòng `0x107ec` + `0x8bcf1b27` + bảng scale `0x13ee5`, giữ nguyên cả những chỗ *trông sai* trong bản decompile (gán thay vì cộng, return sớm, nhánh `if (0 != v5 > v6)`).

```
FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=5000 forge test --use /home/user/bin/solc \
  --offline --force --match-path 'audit/poc/harness/test/RecycleFeePoC.t.sol'
→ 7 passed; 0 failed  (fuzz 5000 runs)
```

### 3.1 Đã tìm ra một lỗ hổng về quyền — không phải về toán

`spend()` của bản decompile kiểm tra **exemption trước** khi kiểm tra hạn mức:

```solidity
if (exempt[msg.sender]) return;   // thoát luôn, không trừ budget
```

PoC `test_exemptAddressBypassesTheEntireBudget` đo được:

- caller thường xin `daily * 5` → revert `OverBudget`;
- caller exempt xin `daily * 5` → **thành công**, và `budget` **không giảm một wei**;
- cùng cửa sổ đó caller thường vẫn rút được đủ `daily` → **cùng một ngày trả hai lần**.

Trong bản thật, `withdrawFromProtocol` là caller của hàm này và `require(amount <= stor_cf)` là **hạn mức duy nhất**. Vậy: một địa chỉ được `0x252c3594(address,bool)` bật exempt rút được **không giới hạn**, đồng thời không làm giảm hạn mức của người khác.

Mức độ: **cần xác minh trên bytecode** (xem §5, lead 1+2). Điều kiện để thành lỗi trộm tiền: (a) exemption do owner bật và (b) `withdrawFromProtocol` thực sự là đường rút tiền ra ngoài contract. Nếu exemption chỉ dùng cho địa chỉ hệ thống tự gọi (`address(this)`, router) thì đây chỉ là thiết kế.

### 3.2 Hai negative control (để lần sau khỏi mất thời gian)

- `test_unspentBudgetIsDestroyedAtTheWindowBoundary`: rollover **gán** `budget = remainder + perBlock*2143` chứ không cộng dồn → phần chưa tiêu của cửa sổ cũ **mất**, cửa sổ mới chỉ mở màn với ~25 % một ngày rồi cộng `perBlock` mỗi block tới đúng `daily`. Chiều lỗi là **cấp thiếu**, không phải cấp thừa ⇒ không thể "quay vòng cửa sổ để in tiền". Ai đọc `+=` ở đó rồi kết luận lỗi là đọc sai.
- `testFuzz_budgetNeverExceedsTheDailyRate` (5000 runs): budget luôn bằng **đúng** công thức đóng `remainder + perBlock*max(elapsed, 2143)`, không trôi, không vượt `daily`, cap `[1e12,1e14]` tôn trọng đúng.
- `0x13ee5`: trả scale `0` **im lặng** cho mọi index ≥ 7 (không revert). Hai input là hai trường uint8 packed của perp. Hệ quả: nếu có đường cấu hình ghi 7..255 vào đó thì giá trị thành 0 (tử số → giá 0 im lặng; mẫu số → Panic 0x12). PoC `testFuzz_scaleTableReturnsZeroSilentlyAboveSix` + `test_zeroScaleDenominatorIsAPanic`. **Chưa** chứng minh được có đường ghi nào như vậy — setter duy nhất thấy trong artifact ép range `[9,36]` cho trường bên cạnh.

---

## 4. Năm lead trộm tiền, xếp theo mức đáng đuổi

| # | Đường code | Điều kiện thành lỗi | Cách xác minh | Trạng thái |
|---|---|---|---|---|
| 1 | `withdrawFromProtocol` `0x8a924640` → `0x107ec` | exemption bật cho địa chỉ không phải hệ thống ⇒ rút vô hạn | đọc `mapping_d4` trên chain + thử `eth_call` với địa chỉ exempt | **PoC cơ chế xong**, cần bytecode để xác nhận instance |
| 2 | `setRecycleFee` `0xbe0783f5` vs `0x279289e9` cùng ghi 1 word, `isHalted` = bit 241 | mask của setter fee **không** loại bit 241 ⇒ một tx set fee tự bỏ halt | disassemble 2 hàm, so mask bit 241 | giả thuyết, cần mask thật (bản paste bị cắt mất chữ số) |
| 3 | `withdrawFromProtocol` kiểm `≤ uint112(_setRecycleFee)` **và** `≤ _getExchangeInfo` rồi trừ cả hai | hai biến này lệch nhau ở bất kỳ đường ghi nào ⇒ trừ nhầm quỹ | đọc storage trước/sau 1 lần rút trên fork | giả thuyết |
| 4 | `0xe68073c3`, `0x229c2492`, `0x586d92ca`, `0x1df87ade` (rút margin) | chỉ thấy check tồn tại + enum + word recycle, **không thấy check IM** ⇒ rút quá free margin | so `getMargin` với IM trước/sau khi rút | thân hàm bị cắt, **không kết luận được** |
| 5 | `setFeeParams(a,b)` — `a` bị đem đi validate như perpetualId (`fullExit(a)`), `b` mới là fee | gọi nhầm thứ tự ⇒ set fee bằng id perp, hoặc set perp bằng fee | đọc `getPerpetualInfo` sau 1 lần set | lỗi đặt tên/kiểu, tác động chưa rõ |

---

## 5. Phần KHÔNG có trong artifact ⇒ không thể PoC

Đây là phần quan trọng nhất của tài liệu này, để không ai (kể cả tôi) viết báo cáo dựa trên chỗ trống:

- **Matching CLOB**: không có thân hàm nào so giá/lệnh, không có vòng khớp, không có partial fill.
- **Funding**: không có accrual rate, không có index, không có thanh toán định kỳ.
- **IM/MM và liquidation**: không có công thức margin, không có penalty, không có socialized loss / ADL / insurance fund.
- **Order book state**: chỉ có `getOrder(uint256,uint256)` và bitfield `_getPositionIds` (≈19 word + nibble trie) — biết *hình dạng* lưu trữ, không biết *luật cập nhật*.

Vì vậy: nếu cần một kết luận kiểu "funding bị tính hai lần" hay "thanh lý trả thưởng vượt penalty", **không thể** lấy nó từ bản decompile này. Cần một trong hai:

1. `eth_getCode` của implementation (hex) — tôi disassemble/khớp lại được từng hàm và chạy lại toàn bộ PoC trên bytecode thật; hoặc
2. repo nguồn / bản verified trên explorer.

Lưu ý môi trường: sandbox này **không gọi được** `rpc.monad.xyz` và `testnet-rpc.monad.xyz` (chặn TLS), nên tôi không tự `eth_getCode` được. Cần hex dán vào hoặc file trong workspace.

---

## 6. Bài học từ harness Kyber — áp cho Perpl

Trong `audit/poc/KYBER_TEARDOWN.md` tôi đã chỉ ra harness mô phỏng tấn công có 5 lỗi, nặng nhất là `swapCallback` không kiểm `msg.sender` + `recipient` do người gọi chọn ⇒ *bất kỳ ai* hút được pool. Khi đọc Perpl, cần kiểm đúng các điểm tương ứng:

- mọi callback (nếu có) phải `require(msg.sender == pool)`;
- mọi hàm nhận `address to` phải kiểm `to == msg.sender` hoặc có allowance;
- hàm `settle`/`liquidate` phải kiểm người gọi có quyền, không chỉ kiểm trạng thái.

Chưa thấy callback nào trong ABI Perpl (không có `*Callback` trong dispatch) → khả năng không có lỗ hổng dạng này. Ghi lại để khỏi thử lại.

---

## 7. Chạy lại

```bash
cd /home/user/arc_hedgefun
export PATH=/home/user/bin:$PATH
FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=5000 forge test --use /home/user/bin/solc \
  --offline --force --match-path 'audit/poc/harness/test/RecycleFeePoC.t.sol'
```

Toàn bộ PoC của repo (18 test, gồm curve/staking/Kyber-shape): bỏ `--match-path`.
