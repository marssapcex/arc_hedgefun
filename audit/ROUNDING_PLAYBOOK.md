# Rounding playbook — Balancer / KyberSwap / Bunni, áp vào repo này

Ba vụ lớn nhất 2023-2025 đều không phải lỗi "toán sai". Cả ba là **một phép làm tròn
đúng chỗ này nhưng sai khi ghép nhiều lần**. Ghi lại đây để lần sau review không
phải đọc lại blog, kèm phần đối chiếu với code trong repo.

Nguồn đã đọc trực tiếp (không qua tóm tắt):

| Vụ | Bài | Dòng quyết định |
|---|---|---|
| Balancer V2, 2025-11-03, $128M | [unvariant](https://blog.unvariant.io/balancer-hack-explained/) | `BaseGeneralPool._swapGivenOut` dùng `_upscale()` = `FixedPoint.mulDown` cho **amountOut** |
| Bunni XYZ, 2025-09-02, $8.4M | [Bunni post-mortem](http://blog.bunni.xyz/posts/exploit-post-mortem/) | `BunniHubLogic.withdraw`: `balance - balance.mulDiv(shares, totalSupply)` |
| KyberSwap Elastic, 2023-11-22, $48M | [OAK](https://onchainattack.org/document/examples/2023-11-kyberswap/) | lỗi precision ở biên tick ⨯ accounting của active liquidity, **phải ghép cả hai mới rút được tiền** |

---

## 1. Balancer: làm tròn "an toàn" ở đầu vào, sai ở đầu ra

`_swapGivenOut` nhận `amountOut` người dùng muốn, **upscale xuống** rồi mới tính
`amountIn`, và trả về `amountIn` đã downscale. Trực giác: "làm tròn amountOut
xuống thì user nhận ít hơn, an toàn". Sai: amountOut thực tế vẫn đúng như user
yêu cầu, còn **amountIn bị tính thấp hơn**.

Vì pool stable dùng Newton-Raphson, khi balance về cực nhỏ (67000 → 18 → 1 wei)
phép tính ngược này mất độ chính xác. Swap #24 với `amountOut = 17` làm invariant
**giảm** 138955 → 112404, tức 19%. Lặp 121 swap → D giảm 98%, virtual_price còn
~2% giá trị ban đầu, BPT mua lại rẻ như cho.

Fix thật (1 dòng): `_upscale` → `mulUp` cho amountOut.

> Bài học: hướng làm tròn phải xét theo **cái gì người dùng nhận**, không theo
> "số nào to hơn". Với exact-output, amountIn là ẩn số — nó phải được làm tròn
> LÊN, mọi chỗ, kể cả các phép biến đổi trung gian (upscale) không ai để ý.

## 2. Bunni: mỗi phép làm tròn đều đúng, phép ghép thì không

`withdraw` giảm idle balance: `balance - balance.mulDiv(shares, currentTotalSupply)`
— `mulDiv` làm tròn xuống ⇒ idle giảm ít hơn ⇒ active (= balance − idle) giảm
**nhiều hơn** ⇒ "liquidity thấp hơn thì giá impact cao hơn, an toàn cho pool".

Đúng khi xét 1 lệnh. Sai khi xét chuỗi: 44 lệnh withdraw nhỏ kéo active balance
28 wei → 4 wei (−85.7%), tổng liquidity ước tính `5.83e16 → 9.114e15` (−84.4%).
Bước 3, một swap lớn đẩy giá, `totalDensity0X96` sập còn 1 wei ⇒ pool chuyển sang
dùng `totalLiquidityEstimate1` = `1.065e16` — **tăng** so với `9.114e15`. Chính cú
tăng đó bị sandwich. Tức: hướng làm tròn an toàn ở trạng thái tĩnh lại tạo ra
một **đường tăng** ở trạng thái động.

Fix: `mulDiv` → `mulDivUp` ở đúng dòng đó ⇒ tổng liquidity không còn giảm sau
bước 2 ⇒ hết lãi.

> Bài học: đừng hỏi "làm tròn hướng này có hại pool trong 1 lệnh không", hỏi
> "lặp N lần thì metric mà pool dùng để ra quyết định có **đơn điệu** theo hướng
> bất lợi** không". Ở đây metric là totalLiquidity ước tính từ balance nhỏ nhất.

## 3. KyberSwap: precision + accounting, thiếu một cái thì không khai thác được

`sqrtPriceX96` ngược ở biên tick bị lệch 1 đơn vị ⇒ active liquidity sau khi
cross không khớp lượng đã deposit. Riêng lỗi precision thì vô hại; riêng lỗi
accounting tick cũng vô hại. Ghép lại thành rút được nhiều hơn đã gửi, bằng
token khác loại.

> Bài học: với concentrated liquidity, precision và accounting phải review
> **cùng nhau**, không tách.

---

## 4. Đối chiếu với repo này — đã kiểm gì

Curve ở `src/v2/HedgeFunBondingCurve.sol` là chỗ có hình dạng giống Balancer
nhất (exact-output-ish, phí, làm tròn ở cả hai chiều). PoC:
[`poc/curve_rounding_check.py`](poc/curve_rounding_check.py) — dựng lại đúng
công thức quote bằng Python và chạy 6 kiểm tra:

```
1. fee inversion exact:            3040000/3040000  (mismatches: 0)
2. net charged == net credited:    20000 buys, mismatches 0, worst gap 0 wei
3. |Δk|/k per operation:           9.937e-25  (worst op: buy)
4. round-trip profit no fee :      best 0 wei, sum 0 wei
4. round-trip profit with 7%:      best 0 wei, sum -13207465570765 wei
5. graduation lands on minReserve: True
6. sells stay inside the reserve:  True
OK: no Balancer- or Bunni-shaped rounding drain found in the curve
```

Vì sao nó không dính:

- **Phí được nghịch đảo chính xác**, không phải xấp xỉ:
  `_grossStock(net) = mulDiv(net-1, 10000, 10000-tax) + 1` là nghịch đảo đúng của
  `gross - mulDiv(gross, tax, 10000)`. Đã kiểm cả 10.000 mức tax ⨯ 304 kích thước:
  0 lệch. Đây đúng là chỗ Balancer chết — và ở đây nó exact.
- **Chủ thể trả = chủ thể được ghi có**. `stockSpent` được tính lại từ
  `newReserve` (`_grossStock(ceil(k, newReserve) - y)`), nên phần stock book vào
  `realStockReserve` luôn bằng phần principal mà bước nhảy `tokenReserve` hàm ý.
  Kiểm 20.000 lệnh buy: lệch 0 wei. Balancer lệch đúng ở đây.
- **Không có "estimate chọn min"**. Bunni chết vì chọn ước lượng nhỏ hơn rồi bị
  đảo chiều. Curve này chỉ có một nguồn giá (`tokenReserve`), và `_solvent()` chặn
  tuyệt đối: `token.balanceOf(this) < tokenReserve` hoặc
  `stock.balanceOf(this) < realStockReserve + totalFees` là revert.
- **Graduation đóng đúng `minTokenReserve`** và không bao giờ rút quá
  `tokenReserve`; bán không bao giờ định giá vượt `realStockReserve`.

Phần đã tốt sẵn, đáng giữ khi refactor: `HedgeFunMath` đặt tên từng hướng làm
tròn (`reached` = ceil, `fellTo` = floor, `short` = ceil) và so sánh bằng
cross-multiply chứ không chia; `V2StakingIncome._rewardIndex` mang `remainder`
theo `mulmod` thay vì bỏ dust — đúng bài học Bunni ở dạng phòng thủ.

## 5. Chỗ còn phải soi tiếp (chưa kiểm)

| Chỗ | Hình dạng cần kiểm | Cách kiểm |
|---|---|---|
| `HedgeFunV2*Treasury` ⨯ V3/V4 pool | limit lấy từ oracle, nhưng **giá thực hiện trung bình** sau swap đã re-check chưa, và re-check đó có dùng cùng hướng làm tròn với limit không | fuzz 2 chiều: push spot sát limit rồi cho treasury trade, so average price với oracle |
| `_buybackLimitSqrtP` + hook ring | anchor chỉ cải thiện (`_noteTokenSpot`), nhưng ring sample do trader chọn thời điểm — có thể chọn mẫu để mở rộng allowance không | chèn swap nhỏ để ghi ring tại các mốc thời gian, đo allowance qua từng cooldown |
| `V2LiquidityVault` / `V2TreasuryDeployer` | tỉ lệ chia phần giữa nhiều treasury (nếu có `mulDiv(shares, total)`) | grep mọi `mulDiv` mà mẫu số là tổng thay đổi được |
| `TwapRing` | nội suy thời gian giữa 2 mẫu: làm tròn về phía nào, lặp lại có trôi không | kiểm đơn điệu khi chèn nhiều mẫu cùng giây |
| `quoteSell` biên | `gross > realStockReserve → Insolvent()` là chặn cuối; cần test trường hợp `tokenIn` cực lớn cộng dust | fuzz `tokenIn` sát `initialSupply - tokenReserve` |

## 6. Checklist rút gọn để dùng khi review

1. Mọi `mulDiv`/`mulDivUp`/`mulDivDown`: ghi ra **đại lượng nào bị làm tròn**, và
   **ai hưởng** phần lệch.
2. Với mỗi cặp (số user trả, số user nhận): phép nghịch đảo phí phải **exact**,
   chứng minh bằng vòng lặp qua toàn miền tax/size nhỏ, không bằng 1 test mẫu.
3. Tìm mọi chỗ code **chọn min/max giữa hai ước lượng** — đó là Bunni. Hỏi: nếu
   ước lượng A bị bóp xuống bởi thao tác nhỏ lặp lại, thì khi giá đổi, A và B có
   nhảy theo hướng bất lợi không?
4. Invariant test phải chạy **chuỗi**, không chỉ từng lệnh: 10k lệnh nhỏ xen kẽ
   buy/sell, đo PnL của kẻ tấn công theo wei.
5. Exact-output: làm tròn **lên** ở mọi bước dẫn tới amountIn, kể cả upscale.
6. Đơn vị: mọi chỗ trộn scale (rate token, oracle decimals) phải có test ở biên
   nơi scalingFactor = 1 hoặc balance = 1 wei — Balancer chết ở balance = 17.
