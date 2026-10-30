# Bóc hợp đồng exploit KyberSwap Elastic (bản decompile)

Tài liệu này đọc bản decompile bạn đưa (library.dedaub, 2026-05-21, solc 0.8.6) và trả
lời hai câu: **nó setup thế nào** và **cái gì đáng học / cái gì tuyệt đối không copy**.
Cuối file là phần áp vào repo này, kèm PoC chạy được.

> Đây là **test harness** của một vụ tấn công, không phải contract production:
> nó phơi `IS_TEST()` (`0xfa7626d4`) và `failed()` (`0xba414fa6`) của DSTest, và
> log bằng `log_named_uint(...)`. Nó được thiết kế để một test Foundry gọi vào,
> bơm tham số, và xem log.

---

## 1. Nó đánh cái gì — xác định bằng selector, không phải bằng cảm giác

Tôi tính lại toàn bộ selector bằng `cast sig` (không đoán):

| selector | chữ ký | nghĩa |
| --- | --- | --- |
| `0xfa483e72` | `swapCallback(int256,int256,bytes)` | **KyberSwap Elastic pool** gọi lại (UniV3 là `0xfa461e33`) |
| `0x5ddb29d3` | `swap(address,uint256,bool,uint160,bytes)` | `swap(recipient, amount, isToken0, limitSqrtP, data)` của Elastic |
| `0x217ac237` | `getPoolState()` | trả `(sqrtP, currentTick, nearestCurrentTick, initialized)` |
| `0xab612f2b` | `getLiquidityState()` | trả `(reinvestLiquidity, reinvestL, …)` — đây là chỗ chứa "liquidity tái đầu tư" |
| `0xc0ac75cf` | `initializedTicks(int24)` | `(liquidityGross, liquidityNet)` |
| `0x5ec8f115` | `mint(address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,uint256,address)` | PositionManager của Elastic (NFT position, 11 tham số) |
| `0xa2416f74` | `removeLiquidity(uint256,uint128,uint256,uint256,uint256)` | rút theo `tokenId` |

Bốn đường flash loan (chính là 4 nhánh trong `0x2e8e`):

| selector | chữ ký | nguồn | callback tương ứng |
| --- | --- | --- | --- |
| `0x490e6cbc` | `flash(address,uint256,uint256,bytes)` | pool kiểu UniV3 | `uniswapV3FlashCallback` `0xe9cbafb0` |
| `0x5c38449e` | `flashLoan(address,address[],uint256[],bytes)` | Balancer Vault | `receiveFlashLoan` `0xf04f2707` |
| `0x5cffe9de` | `flashLoan(address,address,uint256,bytes)` | ERC-3156 | `onFlashLoan` `0x23e30c8b` |
| `0x1b11d0ff` | `executeOperation(address,uint256,uint256,address,bytes)` | Aave | chính nó |

Vậy: **hợp đồng này tấn công KyberSwap Elastic**, mượn tiền từ 4 họ provider khác
nhau, và mục tiêu là PositionManager + pool của Elastic.

---

## 2. Setup `0x7b408b03` — đọc từng tham số

```solidity
function setup(address pool, address flashProvider, uint8 a, uint8 b,
               uint256 flashAmount, uint8 kind, uint256 scale, uint8 providerId)
```

Auth: `msg.sender == _call || msg.sender == owner || msg.sender == this` — chỉ chủ sở hữu.

| # | tham số | ghi vào | nghĩa thật |
| --- | --- | --- | --- |
| 0 | `pool` | `stor_1_0_19` | pool Elastic mục tiêu. `token0()/token1()` được đọc ra thành `_swapCallback`/`stor_3_0_19` |
| 1 | `flashProvider` | `_onFlashLoan` | địa chỉ provider (Vault/ERC3156/pool/Aave) |
| 2 | `a` | `stor_5_20_20` | **bit chọn leg phí**: phí báo ở `fee0` hay `fee1` |
| 3 | `b` | `stor_5_21_21` | **bit chọn hướng/token**: `zeroForOne = !b`; đồng thời chọn cặp `(fee, token)` khi trả nợ |
| 4 | `flashAmount` | `_uniswapV3FlashCallback` | lượng vay — **và** lượng phải trả lại (xem mục 3) |
| 5 | `kind` | `stor_7_0_19 = 2**kind` | giá mục tiêu của swap đầu, biểu diễn bằng `2^kind` (kind = 96 ⇒ giá 1.0) |
| 6 | `scale` | `stor_8` | hệ số chia để có ước lượng L ban đầu |
| 7 | `providerId` | `stor_9_0_0` | chọn nhánh provider trong `0x2e8e` (0..3) |

Và `0x38f39e5c` là bản batch: một mảng, mỗi phần tử **288 byte = 9 word**
(8 word dùng, 1 word đệm), gọi `this.setup(...)` cho từng phần tử, lỗi thì log chứ
không revert. Dùng để bắn nhiều cấu hình trong một giao dịch.

**Chỗ đáng gọi là "thiên tài" trong setup:** ba dòng này.

```solidity
stor_7_0_19 = 2 ** kind;                                  // giá mục tiêu
pool.swap(this, flashAmount, !b, stor_7_0_19, "");        // swap đầu, limit = giá mục tiêu
require(stor_7_0_19 == stor_c, "First Swap Not Large Enough");  // đo lại giá sau swap
```

`limitSqrtP` không chỉ là chặn trượt giá: nó là **điểm dừng chính xác**. Swap với
`amount = flashAmount` (rất lớn) sẽ bị pool dừng đúng tại `limitSqrtP`, nên sau
swap giá **bằng** limit — và `require` đó biến "tôi muốn giá đứng đúng biên tick"
thành một điều kiện cứng, tự fail nếu không đạt. Toàn bộ phần còn lại của cuộc tấn
công chỉ đúng khi giá đứng *chính xác* trên biên; đây là cách ép điều đó.

**Chỗ dở:** `_uniswapV3FlashCallback` (slot 6) vừa là *lượng vay* vừa là *lượng
phải trả* (`fee + _uniswapV3FlashCallback` trong cả 4 callback). Nó chỉ đúng vì
harness luôn vay đúng lượng đó; một biến hai nghĩa như vậy không thể audit được và
sẽ vỡ ngay khi có ai đó gọi callback trực tiếp.

---

## 3. Luồng chạy

```
setup(0x7b408b03)                       đặt pool/token/provider/tham số
  └─ 0x2e8e()                           chọn 1 trong 4 nguồn vay
       ├─ UniV3   : pool.flash(receiver, amt, amt, data)
       ├─ Balancer: vault.flashLoan(receiver, tokens[], amounts[], data)
       ├─ ERC3156 : lender.flashLoan(receiver, token, amt, data)
       └─ Aave    : lender.flashLoan(receiver, assets[], amounts[], modes[], onBehalf, data, 0)
            ↓ (provider gọi lại)
  uniswapV3FlashCallback / receiveFlashLoan / onFlashLoan / executeOperation
     ├─ 0x161e()                        THÂN TẤN CÔNG (mục 4)
     ├─ trả nợ: transfer(fee_x + flashAmount) của token_y cho provider
     └─ 0x38c()  log trạng thái pool
  └─ 0x3379()                           gom TOÀN BỘ token0/token1 còn lại → stor_0_2_21 (ví của kẻ tấn công)
```

`0x3379` là bước "rút tiền": nó chuyển **toàn bộ** balance của contract về địa chỉ
hưởng lợi. Nghĩa là hợp đồng không giữ gì lại — mọi thứ kiếm được trong `0x161e`
được đẩy ra ngoài ngay trong cùng transaction.

---

## 4. Thân tấn công `0x161e`, 5 bước

Ký hiệu: `c` = `sqrtP` hiện tại, `b` = `stor_5_21_21` (hướng), `d` = một biên tick
kế cận, `e` = biên cách đó 400 tick.

**Bước 1 — đẩy giá lên đúng biên tick.** `swap(this, flashAmount, !b, 2^kind, "")`,
rồi `require(limit == sqrtP sau swap)`.

**Bước 2 — chọn hai mốc tick, sát biên và xa biên.** Đọc
`tickDistance()`, `swapFeeUnits()`, `getPoolState()`, rồi:

```solidity
tick  = getPoolState().currentTick
d     = tickDistance
firstBoundary = (tick / d) * d  (+ d nếu tick chưa nằm đúng biên)
farBoundary   = ((tick ± 400) / d) * d   // 400 tick: độ dày của range
stor_d = sqrtRatio(firstBoundary);  stor_e = sqrtRatio(farBoundary);
```
Hai biên này là **sát ngay trên (hoặc dưới) giá** và cách xa 400 tick — tức range
mà cuộc tấn công sẽ mint chỉ có một phía, và biên gần nằm đúng chỗ giá đang đứng.

**Bước 3 — tìm L chính xác, mint đúng lượng, rút phần dư.**
`0x3cab` là một vòng lặp: tăng dần L theo bước `200000` cho tới khi phần dư tương
đối `100 * (residue) / denominator` bằng 0 (tức sai số < 1%), rồi trả về L nhỏ nhất
"vừa đủ". Sau đó:

```solidity
L_target = estimateL(balances, c, d);            // 0x3cab
delta    = L_target - reinvestLiquidity - reinvestL;   // phần còn thiếu so với L đang active
(amount0, amount1) = amountsFor(delta) * 120 / 100;    // +20% đệm, 0x4070
tokenId  = positionManager.mint(pool, token0, fee, lower, upper, amount0, amount1, 0,0, this, deadline);
removeLiquidity(tokenId, (reinvestAlt + reinvestL_moi) - L_target);  // 0x419b: cắt đúng phần dư
```
Điểm cốt lõi: sau bước này **L đang active của pool bằng đúng `L_target` tính bằng
tay**, không hơn một wei. Bước 5 sẽ dựa vào con số đó.

**Bước 4 — tính lượng swap để vượt biên, trừ phí, trừ 1 wei.**

```solidity
num = 200000 * L_target * (d - c);
den = 200000 * c - swapFeeUnits * d;
amountIn = num * c / den / 2^96;      // nhánh b: đổi (c,d) và nhân/chia 2^96
swap(this, amountIn - 1, !b, extremeLimit, "");
```
`- 1` để chắc chắn **không** vượt quá phần cần thiết, và `extremeLimit` là
`MIN_SQRT_RATIO + 1` hoặc `MAX_SQRT_RATIO - 1`.

**Bước 5 — swap ngược lại đúng bằng lượng vừa nhận.** `swap(this, -balanceĐãNhận, ...)`.

Sau bước 5 giá quay về gần chỗ cũ, nhưng sổ sách của pool trong lúc **đi qua biên**
đã bị ghi theo `L` nhân tạo ở bước 3. Đó là chỗ tiền sinh ra: `removeLiquidity` ở
transaction sau (hoặc chính position vừa mint) được trả theo `L` mà pool tin, chứ
không theo lượng token pool thực có.

> Phần "vì sao đúng cơ chế" ở trên là **suy luận từ bytecode**: những gì đọc chắc
> chắn được là (i) giá bị ép đứng đúng biên, (ii) range mint nằm sát biên và chỉ một
> phía, (iii) L được căn chính xác bằng tay rồi mint, (iv) phần dư bị rút, (v) có
> một swap `amountIn - 1` để vượt biên và một swap ngược. Còn "reinvestL bị cộng
> nhầm vào L của range đang active" là kết luận khớp với các bài post-mortem của
> KyberSwap, không phải thứ tôi đọc trực tiếp trong bytecode này.

---

## 5. Đừng học cách nó viết — 5 lỗi thật trong chính harness này

Đây không phải lỗi của KyberSwap, mà là lỗi của hợp đồng exploit, và chúng nghiêm
trọng:

1. **`swapCallback(int256,int256,bytes)` không kiểm tra `msg.sender`.** Nó chuyển
   `amount0Delta` token0 và `amount1Delta` token1 cho `stor_1_0_19`. Ai cũng gọi
   được nó. Và ai cũng gọi được `pool.swap(recipient, …)` với `recipient = chính
   mình`: pool sẽ gọi `swapCallback` vào hợp đồng này, hợp đồng tự trả token, kẻ
   gọi nhận output. **Một drain hoàn toàn, không cần quyền gì.**
2. **`onFlashLoan` / `receiveFlashLoan` / `executeOperation` cũng không auth, và
   tham số `token`/`amount` do caller chọn.** `onFlashLoan(_, token, amount, fee, _)`
   chuyển `amount + fee` của **bất kỳ token nào** contract đang giữ cho
   `_onFlashLoan`. `executeOperation` còn `approve(asset, amount + premium)` cho
   `_onFlashLoan` với `asset`/`amount` tuỳ ý.
3. **`call(address,uint256,bytes)` (selector `0x6dbf2fa0`) là arbitrary call** từ
   owner/`_call` — biến owner thành god mode. Đây là thứ tuyệt đối không được có
   trong code thật.
4. **Magic number không tham số hoá:** bước nhảy `200000` của vòng lặp L, ngưỡng
   "sai số < 1%", biên `400` tick, đệm `120/100`, và hằng `200000` trong công thức
   `amountIn` — hằng cuối này **phải** khớp đơn vị của `swapFeeUnits()`; nếu pool có
   thang phí khác, lượng swap tính ra sai và cuộc tấn công hỏng âm thầm. Không có
   một dòng kiểm tra nào cho việc đó.
5. **Struct batch 9 word nhưng chỉ 8 word được dùng** (một word đệm ở offset 224):
   truyền sai một word là ghi sai `kind` hoặc `scale` mà không có validate nào.

Bài học rút ra (phần dùng được): **đúng đắn đến từng wei ở biên** là vũ khí thật.
Không phải "flash loan to", mà là *biết chính xác L, ép giá đứng đúng biên, và
swap đúng `amount - 1`*. Đó là thứ cần phòng thủ.

---

## 6. Áp vào repo này: 3 bất biến của KyberSwap và PoC tương ứng

Bất biến mà KyberSwap Elastic vi phạm, phát biểu theo cách kiểm được:

> **I1.** L đang active của pool phải bằng tổng L của các position thực có.
> **I2.** Thu nhập (phí) không bao giờ được trở thành principal.
> **I3.** Đường rút chỉ được trả theo sổ của pool, không theo sổ tự tính.

| bất biến | chỗ tương ứng trong repo | PoC | kết quả |
| --- | --- | --- | --- |
| I1 | `V2LiquidityVault`: 2 position trong 1 pool — full-range + single-sided "surplus" nằm sát spot (`V2SurplusLiquidity.plan`) | `KyberShapePoC.t.sol::testFuzz_roundTripThroughSurplusRangeLeaksNothing` | PASS 500 run: L active chỉ có thể là `L_seed` hoặc `L_seed + surplus`, không có L thứ ba |
| I2 | curve: phí stock được tách khỏi principal qua `_grossStock`; vault: token fee bị burn, stock fee chuyển treasury | `CurvePoC.t.sol` (7 test) + `KyberShapePoC::test_collectFeesIsBoundedByRealFeesAndIdempotent` | PASS: tổng thu về ≤ 0.3% × notional + 2 wei; gọi lần hai = 0 |
| I3 | vault không có đường rút principal; `collectFees` lấy delta từ `poolManager.modifyLiquidity(liquidityDelta: 0)` chứ không tự tính | `KyberShapePoC::testFuzz_donatedAssetsAreNotCollectable` + `testFuzz_repeatedCrossingsNeverAccumulateValue` | PASS: donation không thành fee; 8 lần vượt range liên tiếp, kẻ tấn công luôn lỗ |

Chạy:

```bash
cd /home/user/arc_hedgefun && export PATH=/home/user/bin:$PATH
FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=500 forge test --use /home/user/bin/solc --offline --force \
  --match-path 'audit/poc/harness/test/KyberShapePoC.t.sol'
```

Kết quả thật:

```
[PASS] testFuzz_donatedAssetsAreNotCollectable(uint256)                runs 500
[PASS] testFuzz_repeatedCrossingsNeverAccumulateValue(uint256,uint8)   runs 500
[PASS] testFuzz_roundTripThroughSurplusRangeLeaksNothing(uint256)      runs 500
[PASS] test_collectFeesIsBoundedByRealFeesAndIdempotent()              gas 541624
4 passed; 0 failed
```

**Vì sao vault này không dính hình KyberSwap:** nó không tự tính L hay phí. L là do
`PoolManager` giữ; thu nhập được hỏi bằng một lệnh `modifyLiquidity` với
`liquidityDelta = 0`, và kết quả bị buộc `delta == feeDelta` và `>= 0`. Không có
con số nội bộ nào để bơm phồng. Ngược lại, KyberSwap Elastic tự tính `reinvestL`
trong `SwapMath` — chính con số đó bị bơm.

**Chỗ còn hở, nói thẳng:** `HedgeFunHook` giữ ring TWAP và `pots` (write-down
index) theo cách thủ công hơn nhiều so với vault. Đó là nơi tiếp theo tôi sẽ đánh
nếu có thêm thời gian: cấy mẫu ring trong 1 giây rồi gọi `buyback`, và burn stock
của hook để bẻ `index`. Hiện chưa có PoC cho hai đường đó.
