# Audit vòng này: curve + staking (PoC Solidity, chạy thật)

Môi trường: xem `audit/poc/FOUNDRY.md`. Tất cả số liệu dưới đây là output của
`forge test` trên contract thật trong `src/`, không phải mô hình viết lại.

```bash
cd /home/user/arc_hedgefun && export PATH=/home/user/bin:$PATH
FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=1000 forge test --use /home/user/bin/solc --offline --force
# → 14 tests passed, 0 failed (CurvePoC 7, StakingPoC 6, Smoke 1)
```

---

## 1. `HedgeFunBondingCurve` — 7 PoC, 1000 fuzz run mỗi test, không vỡ

File: `audit/poc/harness/test/CurvePoC.t.sol`. Contract thật, token thật
(`HedgeFunToken`), stock là ERC20 mint được, factory giả chỉ để nhận `graduateCurve()`.

| PoC | bất biến | vùng code | kết quả |
| --- | --- | --- | --- |
| `testFuzz_quoteNeverChargesMoreThanOffered` | `quoteBuy(max).stockSpent <= max` với mọi `taxBps` 0…9999, `saleBps` 1000…9000, cả cửa sổ snipe | `HedgeFunBondingCurve.sol:126-151` | PASS 1000 |
| `testFuzz_capQuoteNeverChargesMoreThanOffered` | đúng tại biên `terminalStock`, và tại `capPayment-1` | `:132-146`, `:153` | PASS 1000 |
| `testFuzz_roundTripNeverProfits` | buy→sell cùng block không thể lãi; stock bảo toàn đúng từng wei | `:169`, `:200` | PASS 1000 |
| `test_dustCycleCannotDrainTheCurve` | 1500 vòng mua/bán 1 wei xen kẽ, trader không lãi, reserve của curve không giảm | `:153`, `:126` | PASS 1000 |
| `testFuzz_graduationIsExactAndLeavesFeesClaimable` | graduation rơi **đúng** `minTokenReserve`; factory nhận đúng chừng ấy; curve còn lại đúng `totalFees`; 3 claim trả hết về 0 | `:77-80`, `:169`, `:240` | PASS 1000 |
| `testFuzz_openingBurnOnlyInsideWindowAndNeverForExempt` | `taxBps <= buyRateBps() <= snipeBps`, đơn điệu giảm; creator (exempt) burn = 0; burn ngoài cửa sổ = 0; burn khớp quote | `:99-124`, `:147` | PASS 1000 |
| `testFuzz_saleNeverExceedsReserve` | bán ≤ `realStockReserve`, quote == thực thi | `:189-199` | PASS 1000 |

Điểm đáng chú ý về mặt kỹ thuật: hai lỗi điển hình của Balancer/Bunni đều không
áp dụng được ở đây, và PoC chứng minh chứ không chỉ nói:

- **Balancer (làm tròn input xuống khi output cố định):** curve không có đường
  exact-output. `_quoteBuy` chỉ nhận `maxStockIn`; `_grossStock(net) =
  floor((net-1)*10000/(10000-tax)) + 1` là nghịch đảo đúng của phí, và `stockSpent`
  được suy lại từ `newReserve` (tức từ chính giá đã cam kết), nên không có cặp
  (charge, credit) lệch nhau — test 1 và 2 ở trên quét toàn miền thuế để kiểm.
- **Bunni (đánh giá thấp một biến rồi bị nâng lại):** curve không dùng
  "min của hai estimate"; mọi cổng là so sánh tuyệt đối trên số dư
  (`_solvent`, `:273`), và `realStockReserve` được trừ đúng bằng `gross` đã trả
  (`:209`) nên `k = x*y` chỉ đi theo hướng bất lợi cho trader.

## 2. `V2StakingIncome` — 6 PoC, 1000 fuzz run, không vỡ

File: `audit/poc/harness/test/StakingPoC.t.sol`.

| PoC | bất biến | vùng code | kết quả |
| --- | --- | --- | --- |
| `testFuzz_claimsNeverExceedFunding` | 24 bước stake/withdraw/fund/warp ngẫu nhiên → tổng claim **≤** tổng fund, ledger khớp | `:85-116`, `:151` | PASS 1000 |
| `test_lateStakerCannotTakeEarlierStream` | vào ở 90% thời gian stream với stake 1000× chỉ nhận ≤ 30% quỹ | `:85-116` | PASS |
| `testFuzz_entitlementsAddUp` | tổng entitlement các account ≤ tổng fund, lệch < 10 wei | `:109` | PASS 1000 |
| `testFuzz_weiFundingCannotRestartTheClock` | fund 1 wei giữa stream không đẩy `periodFinish` quá 1 s; stream đã kết thúc thì được đúng 1 `duration` mới | `:185-199` | PASS 1000 |
| `test_manyTinyStakesDriftIsDust` | 40 staker × 1 wei, fund 40 000 000: **tổng 39 999 960, dư 40 raw unit** (đúng 1 unit/staker) | `:85-107` | PASS |
| `testFuzz_leaveAndReturnCannotMintRewards` | staker duy nhất rời đi (queue phần còn lại) rồi stake lại: claim = 999 999 999 999 999 999 999 ≤ 1000e18, không sinh thêm thưởng | `:131-149`, `:185` | PASS 1000 |

Con số "dư 40 raw unit trên 40e6" là mức thất thoát làm tròn lớn nhất mà tôi đo
được, và nó khớp với ghi chú ở `V2StakingIncome.sol:20-22`: phần dư toàn cục nhỏ
hơn `totalStaked/1e45`, không phải tiền của ai.

## 2b. Hình KyberSwap nhắm vào vault của pool đã tốt nghiệp — 4 PoC, không vỡ

Bóc hợp đồng exploit KyberSwap Elastic: `audit/poc/KYBER_TEARDOWN.md`. Bất biến của
vụ đó, áp lên `V2LiquidityVault` (2 position trong 1 pool, một full-range và một
single-sided sát spot), kiểm bằng `KyberShapePoC.t.sol` trên `PoolManager` thật:

| PoC | bất biến | kết quả |
| --- | --- | --- |
| `testFuzz_roundTripThroughSurplusRangeLeaksNothing` | đẩy giá qua range surplus rồi bán ngược: L active chỉ có thể là `L_seed` hoặc `L_seed + surplus`, không có L thứ ba; pool không mất token; idle balance của vault không đổi | PASS 500 |
| `testFuzz_repeatedCrossingsNeverAccumulateValue` | 8 lần vượt range liên tiếp: kẻ tấn công luôn lỗ cả hai token | PASS 500 |
| `test_collectFeesIsBoundedByRealFeesAndIdempotent` | thu về ≤ 0.3% × notional + 2 wei; gọi lần hai = 0 | PASS |
| `testFuzz_donatedAssetsAreNotCollectable` | donation vào vault không thành phí, không bị burn | PASS 500 |

Vì sao không dính: vault không tự tính L hay phí; thu nhập được hỏi bằng
`modifyLiquidity(liquidityDelta: 0)` và bị buộc `delta == feeDelta && >= 0`. Không
có con số nội bộ nào để bơm phồng, khác với `reinvestL` mà KyberSwap tự tính.

## 3. Suite có sẵn của repo chạy được trong harness (không phải công của vòng này, nhưng là bằng chứng môi trường)

| suite | kết quả |
| --- | --- |
| `test/BondingCurve.t.sol` | 20 passed |
| `test/V2CurveSecurity.t.sol` | 4 passed (2 suite) |
| `test/V2TradeRouter.t.sol` | 26 passed (2 suite) |
| `test/V2CurveDeployer.t.sol` | 6 passed |

## 4. Ghi chú thiết kế (KHÔNG phải lỗ hổng, không có PoC khai thác)

Ba điểm tôi đã kiểm tra tới nơi tới chốn và kết luận là hành vi có chủ ý; ghi lại
để người đọc không phải kiểm lại lần nữa:

1. **Mọi lệnh mua qua curve đều là partial fill.**
   `HedgeFunV2TradeRouter._checkFill` revert `PartialFill` khi `refund != 0`
   (`HedgeFunV2TradeRouter.sol:165-167`), mà mua curve thì luôn có refund vì
   `stockSpent < amountIn` (phí + làm tròn — chính PoC 1 ở trên đo được điều này).
   Hệ quả: `allowPartialFill` phải là `true` cho mọi lệnh mua curve; `minStockReceived`
   vì thế thường xuyên ở chế độ "cho phép thiếu". Không mất tiền (refund trả về
   người trả), nhưng integrator cần biết.
2. **Buy-back lần đầu không có anchor.** `_buybackLimitSqrtP` trả `fromSpot` khi
   `buybackAnchorSqrtP == 0` (`HedgeFunTreasuryBase.sol:594-613`): đúng một chunk
   đầu tiên chạy trên spot trần. Code đã ghi rõ đánh đổi này; nhắc lại vì nó là
   bề mặt duy nhất mà người nắm giá pool điều khiển được, một lần cho mỗi treasury.
3. **Thưởng đã fund nhưng chưa stream hết sẽ nằm chờ.** `_schedule` đẩy phần dư
   vào `queuedRewardsScaled` (`V2StakingIncome.sol:185-199`); nếu staker cuối rời
   đi giữa stream, phần còn lại chỉ chảy khi có người stake tiếp. Không ai lấy
   được nó ngoài staker tương lai, và PoC 6 xác nhận không bị nhân đôi.

## 5. Phần CHƯA kiểm được trong môi trường này (nói thẳng)

Đây là giới hạn của sandbox, không phải kết luận "an toàn":

- **`HedgeFunHook`** (thuế, cửa sổ snipe, ring TWAP, `pots` write-down index,
  split protocol/creator/treasury), `_swapTokenPool`/`_buybackLimitSqrtP`.
  `V2LiquidityVault` thì đã có PoC ở mục 2b. Cần `PoolManager` thật + suite lớn hơn
  trần 1.2 MB của solc-js. Các tấn công đáng thử ở đây: cấy mẫu ring rồi gọi
  `buyback`, và sandwich trong biên `maxBuybackImpactBps`.
- **Các suite dust/cycle** (`V2DustProgressFuzz`, `V2CycleDustFuzz`, 134 file):
  vượt trần bộ nhớ, chưa chạy lại được.
- **Fork test** (`*Fork.t.sol`): cần RPC.
- Đường native (`HedgeFunV2NativeRouter`, `HedgeFunV2LaunchNativeRouter`) và
  `HedgeFunV2ReserveTreasury.execute` mới đọc, chưa có PoC riêng.

Bước tiếp theo rẻ nhất và đáng làm nhất: bỏ bớt `test/utils` không dùng để kéo
`V2DustProgressFuzz` xuống dưới trần, rồi viết PoC cấy ring TWAP cho `buyback`.

## 6. Tái lập

```bash
cd /home/user/arc_hedgefun && export PATH=/home/user/bin:$PATH
FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=1000 forge test --use /home/user/bin/solc --offline --force
# từng suite của repo:
./audit/poc/import-test.sh V2TradeRouter.t.sol
FOUNDRY_PROFILE=poc forge test --use /home/user/bin/solc --offline --force \
  --match-path 'audit/poc/harness/test/repo_V2TradeRouter.t.sol'
```

Log của lần chạy dùng cho báo cáo: `audit/poc/runs/2026-10-30-poc.log`.
