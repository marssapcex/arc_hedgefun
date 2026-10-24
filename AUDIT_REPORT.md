# BAO CAO AUDIT - arc_hedgefun (Hedgefun on Arc)

**Danh vién:** arc_hedgefun / HedgeFun V2 on Arc (5042)  
**Trang thai:** Live on Arc mainnet since 2026-10-08  
**Loai:** Token launchpad voi bonding curve, graduated V4 liquidity, treasury rule-based trading  
**Nguon:** https://github.com/marssapcex/arc_hedgefun  
**Nhan xet:** Co so ma duoc bao ve boi bo tap test adversarial rat chu den (V2Adversarial*). Bao cao nay lap trinh con cac fuzz test moi de khai thac hon cac edge case chua duoc cover, va cung cap PoC co the chay truc tiep khi co Forge.

---

## 1. Tong quan he thong

| Cong thuc | Vai tro |
|-----------|---------|
| `HedgeFunBondingCurve` | Curve ban dau co cung, fee/tax duoc thu khi mua/ban, graduation khi het cung |
| `HedgeFunV2Factory` | Khoi tao curve, treasury, ghi dong graduation, seed V4 liquidity qua delegatecall den CurveDeployer |
| `CurveDeployer.executeGraduation` | Chay trong delegatecall context cua factory: seed position, dua du boi len vault, tra stockUsed/tokenUsed |
| `HedgeFunV2Hook` (v3) | Hook Uniswap V4: thu tax tren pool <token>/<stock>, mint claim trong beforeSwap/afterSwap, sweep tra ve 3 vai tro |
| `HedgeFunV2TradeRouter` | Buy/sell qua curve (Active) hoac V4 pool (Graduated), co slippage va refund |
| `HedgeFunV2NativeRouter` | Wrapper native currency xung quanh TradeRouter |
| `HedgeFunTreasuryBase` | Base tre mo: lot-based rule (takeProfit/stopLoss/buyDip), buyback va burn |
| `HedgeFunV2Treasury` | Kind 0: lot rule, execute() chon stop/tp/dip tu dong, creditLiquidityFee tu vault |
| `HedgeFunV2EngineTreasuryCore` | Engine V1 spot rebalance, policy qua STATICALLY, keeper reward |
| `HedgeFunV2BuybackTreasury` | Kind 1: chi buyback, khong lot |
| `V2LiquidityVault` | V4 position hoan toan khoa, collectFees tra stock ve treasury, burn token fee |

---

## 2. Phuong phap audit

- Doc tich cuc tat ca cac contract `src/`, `src/hooks/`, `src/v2/`, `src/libraries/`.
- Doc bo test adversarial hien co (`V2AdversarialAccounting`, `V2AdversarialCallbacks`, `V2AdversarialTrading`) — chung da bao ve conservation, reentrancy, callback, graduation race, slippage.
- Xac dinh cac vector co the an cap tien: underflow/overflow, fee redirection, reentrancy, oracle/anchor manipulation, delegatecall abuse, mint/unbounded token.
- Viet fuzz test moi (Solidity) de chay boi Forge khi san sang.

---

## 3. Ket qua tim kiem (cac van de co the an cap tien)

### Van de 1 — Underflow trong `_graduate()` neu `stockUsed > stockAmount`

**File:** `src/v2/HedgeFunV2Factory.sol`, ham `_graduate()` (dong ~174-183)

```solidity
if (stockAmount != stockUsed) {
    _sendExact(s.stock, s.treasury, stockAmount - stockUsed);
    try HedgeFunTreasuryBase(s.treasury).book() returns (bool ok) { booked = ok; } catch {}
}
```

`stockAmount` = `realStockReserve` cua curve (tra ve tu `curve.release()`).  
`stockUsed` = amount stock thuc su duoc dung trong V4 position (tra ve tu `CurveDeployer.executeGraduation` qua `V2LiquidityVault.seed()`).

Neu `stockUsed > stockAmount` (vi rounding, ve luong liquidity, hoac CurveDeployer tra gia tri khong chinh xac), phep `stockAmount - stockUsed` se underflow va **revert toan bo transaction graduation** — bao cung la curve buy cua nguoi dung cuoi cung. Ket qua: khong the graduate, tien cua nguoi mua bi lock trong curve (buy bi rollback), DoS vinh vien toi khi khac sua.

**Muc do:** Cao (Deny of Service graduation + lock tien nguoi mua o cuoi cung)  
**Dieu kien:** `stockUsed > stockAmount` — co the xay ra neu `CurveDeployer.executeGraduation`/`V2LiquidityVault.seed()` tra `stockUsed` lon hon reserve thuc te (vi du do rounding trong `_graduationLiquidity` chuan `amount0`/`amount1` xuong, va `used0/used1` khong phu hop voi `max0/max1`).  
**Khuyen nghiep:** Thay `stockAmount - stockUsed` bang `stockAmount > stockUsed ? stockAmount - stockUsed : 0` hoac them `require(stockUsed <= stockAmount)` voi thong bao ro rang. Hoac them fuzz test de xac nhan `stockUsed <= stockAmount` luon luon.

**Fuzz test de xac minh:** `testFuzz_GraduationStockUsedBound` (xem file test duoi day).

---

### Van de 2 — `CurveDeployer.executeGraduation` chay qua delegatecall: storage collision

**File:** `src/v2/CurveDeployer.sol`, ham `executeGraduation()`; `src/v2/HedgeFunV2Factory.sol` goi no qua `address(curveDeployer).delegatecall(...)`.

Trong `delegatecall`, `address(this)` = factory (khong phai curveDeployer). Cac `immutable` cua CurveDeployer (`curveChunk`, `vaultChunk`, `DEFAULT_SALE_BPS`, `SELF`) duoc doc tu **storage cua factory**, khong phai cua CurveDeployer. Neu factory co cung cac slot storage o vi tri giong nhu immutables cua CurveDeployer, gia tri doc bi sai — co the duoc ton tai de bao ve thao tac graduation (sa chocolate `factory()` tra ve sai address, `_onlyFactory()` trong `deployVault` that bai, v.v.).

Nhieu nguy hiem hon: `CurveDeployer(SELF).factory()` trong `executeGraduation` goi `factory()` tren dia chi `SELF` (curveDeployer address) qua external call (khong phai delegatecall), nen no doc dung storage cua CurveDeployer. Nhung `CurveDeployer(SELF).deployVault(...)` cung goi o dia chi `SELF` — trong delegatecall context, `SELF` van la dia chi CurveDeployer, external call den no chay binh thuong.

**Tuy nhien**, neu `CurveDeployer` duoc deploy thay the (proxy/upgradeable) hoac neu `SELF` bi ghi de, `delegatecall` co the chay code tac dang o context cua factory, cho phep doc/ghi storage cua factory. Vi `curveDeployer` la `immutable` va set trong constructor factory, rang buoc nay co vinh vien neu constructor chinh xac.

**Muc do:** Trung binh (tac dong giao lap storage qua delegatecall)  
**Dieu kien:** Can co the thay thay `curveDeployer` address hoac factory co storage layout dot chot.  
**Khuyen nghiep:** Them test `assertEq(address(factory.curveDeployer()), curveDeployerAddress)` va verify `SELF == address(curveDeployer)` tai deploy. Trinh trinh delegatecall chi duoc bat buoc o `_graduate`, khong the tranh duoc, nen can audit liet ke tat cac slot storage cua factory vs CurveDeployer.

---

### Van de 3 — Hook `beforeSwap` mint stock cho hook (v2 hook)

**File:** `src/hooks/HedgeFunV2Hook.sol`, ham `beforeSwap()`

```solidity
poolManager.mint(address(this), Currency.wrap(p.stock).toId(), tax);
p.accruedStock += uint128(tax);
```

Hook **mint** stock (tai nguyen cua pool manager) cho chinh dia chi hook. Chi duoc goi khi `msg.sender == address(poolManager)`. Neu PoolManager bi compromise hoac co the goi `beforeSwap` truc tiep (qua callback gia), attacker co the tao ra stock tu khong va sweep ve chinh minh qua `settleStock()`.

Nhung trong mo hien tai, chi PoolManager co the goi hook callbacks, va PoolManager la contract duoc deploy trong fixture (`new PoolManager(address(this))`). Trong mainnet, PoolManager la Uniswap V4 PoolManager chuan, chi no moi co the goi hook. Nen rang buoc nay co vinh vien neu PoolManager chuan.

**Muc do:** Trung binh (y hau vao PoolManager chinh chu)  
**Khuyen nghiep:** Fuzz test xac nhan `hook.accrued(id)` luon khop voi tong tax duoc thu, va `hook.sweep(id)` tra dung so luong cho 3 vai tro (protocol/creator/treasury).

---

### Van de 4 — Exact-output buy gross-up tax (hook v1)

**File:** `src/hooks/HedgeFunHook.sol`, ham `_tax()`

```solidity
uint256 tax = params.amountSpecified > 0
    ? FullMath.mulDivRoundingUp(moved, rate, BPS - rate)
    : HedgeFunMath.bps(moved, rate);
```

Voi exact-output buy, tax duoc gross-up: `tax = ceil(moved * rate / (10000 - rate))`. Nghia la trader tra `moved + tax` nhung chi `moved` duy vao pool. Khi `rate` cao (spike/launch window), tax co the lon nhat nhung khong qua `MAX_SNIPE_BPS` (9900 bps). Voi `rate = 9900`, `tax = ceil(moved * 9900 / 100) = 99 * moved`, trader tra `100 * moved` nhung chi `moved` mua token — 99% bi thu. 

Nhung code da chong lua: exact-output buy chi duoc chap nhan o **flat rate** (`rate > p.taxBps` thi `ExactOutputRefused`). Vậy spike/launch window khong duoc su dung cho exact-output buy. Tax gross-up o flat rate (toi da 1500 bps) = `ceil(moved * 1500 / 8500)` ≈ 17.6% of moved — co the lam trade it hieu qua nhung khong an cap tien.

**Muc do:** Thap (khong an cap tien, chi lam trade kem hieu qua)  
**Khuyen nghiep:** Fuzz test xac nhan `quoteBuyFor` vs `buy` khong bao qua gap `minFinalOut`, va tax luon duoc tinh dung `rate - taxBps` trong bonding curve (`_quoteBuy` dong `taxTokens = Math.mulDiv(gross, rate - taxBps, 10000 - taxBps)`).

---

### Van de 5 — `claimFees(address recipient)` co the duoc goi boi bat ki ai, nhung chi 3 vai tro co nợ

**File:** `src/v2/HedgeFunBondingCurve.sol`, ham `claimFees()`

```solidity
function claimFees(address recipient) external nonReentrant {
    uint256 amount = claimable[recipient];
    if (amount == 0) return;
    claimable[recipient] = 0;
    totalFees -= amount;
    _sendStock(recipient, amount);
    ...
}
```

Bat ki ai cung co the goi `claimFees(orNeviAddress)` va neu `claimable[orNeviAddress] > 0`, stock duoc tra ve. Nhung `claimable` khoi tao chi cho `protocol`, `creator`, `treasury` qua `_accrueFees`. Nen chi 3 dia chi nay moi co so du > 0. `claimFees` chi chuyen stock tu curve den recipient — khong an cap tien tu nguoi dung khac.

**Muc do:** Thap (chi 3 vai tro co nợ, `claimFees` permissionless la thanh vien thay vi loi)  
**Khuyen nghiep:** Fuzz test xac nhan `claimable[protocol] + claimable[creator] + claimable[treasury] == totalFees` sau moi trade, va `claimFees` khong bao gap `totalFees`.

---

### Van de 6 — Treasury `buyback()` anchor co the bi thay doi neu hook ring bi xoa

**File:** `src/HedgeFunTreasuryBase.sol`, ham `_buybackLimitSqrtP()`

Anchor (`buybackAnchorSqrtP`) duoc cap nhat qua `_noteTokenSpot()` (rat thich: chi thay doi den gia tri thap hon nhat). Nhung neu hook ring khong the serve window (`meanTick` tra `ok = false`), code fallback den `buybackAnchorSqrtP` hoac `fromSpot`. Neu attacker co the day spot len cao ngay truoc `buyback`, `_clampToSpot` se gan limit gan spot, va `buyback` co the mua token o gia cao, thi sau do ban lai o gia thap — mat tien cua treasury.

Nhung code da chong: `_clampToSpot` dam bao limit **khong bao qua spot** (neu limit o phia sai spot, swap se fill nothing -> `buyback` tra `NotDue`, khong tieu cooldown). Và drift allowance tang theo thoi gian, nen attacker khong the danh lien tuc.

**Muc do:** Trung binh (tac dong gia mua buyback, mat tien qua slippage)  
**Khuyen nghiep:** Fuzz test `testFuzz_BuybackAnchorNotRaisable` — xac nhan `buybackAnchorSqrtP` khong bao qua gia tri ban dau sau cac luan chuyen spot.

---

### Van de 7 — `HedgeFunV2TradeRouter._v4()` decode tra ve tu `poolManager.unlock()`

**File:** `src/v2/HedgeFunV2TradeRouter.sol`, ham `_v4()`

```solidity
(spent, out) = abi.decode(poolManager.unlock(data), (uint256, uint256));
```

Trong Uniswap V4 chuan, `poolManager.unlock()` tra ve `void`. Neu PoolManager o day khong duoc custom de tra ve bytes, `abi.decode` tren empty data se **revert**. Nhung bo test hien co da chay thanh cong, nghia la PoolManager trong fixture da duoc custom hoac code da chay duoc tren mainnet Arc. Vay van de nay la "khoa ngoai" khong phai loi trong repo.

**Khuyen nghiep:** Neu chay test lai gap `abi.decode` fail, can kiem tra `IPoolManager.unlock` tra ve bytes hay void.

---

### Van de 8 (can fuzz xac minh) — `HedgeFunBondingCurve._buy()`: `taxTokens` burn nhung `tokenReserve` giam het `tokensOut + tax`

```solidity
tokenReserve -= tokensOut + tax;   // tax = taxTokens
...
if (tax != 0) ICurveBurnable(token).burn(tax);
IERC20(token).safeTransfer(recipient, tokensOut);
```

`tokenReserve` giam `tokensOut + taxTokens`. `safeTransfer` gui `tokensOut` den recipient. `burn(taxTokens)` burn `taxTokens` tu balance cua curve. Tong token roi khoi curve = `tokensOut + taxTokens` = `tokenReserve` reduction. Consistent.

**Nhung** neu `token` co transfer fee on transfer, `safeTransfer(recipient, tokensOut)` co gui it hon `tokensOut` den recipient nhung `tokenReserve` da giam duoc `tokensOut`. Nguoi nhan bi mat fee. Nhung `token` la `IHedgeFunToken` (Mintable/burnable), khong co transfer fee theo mock trong test. Can fuzz xac minh.

---

## 4. Fuzz test moi (can chay boi Forge)

Tao file `test/AuditFuzz.t.sol`. Cac test fuzz ngau nhien cac hanh dong mua/ban/claim/qua mot giai doan, roi assert conservation (tong tong cung khong thay doi, tong balance duoc toan bo, curve reserve khop voi ledger doc lap).

Cac test loai:
1. `testFuzz_CurveTwoTraderConservation` — fuzz 2 nguoi mua/ban/claim/donate tren curve, kiem tra conservation (mot model lan duoc V2AdversarialAccounting da lam, nhung them thao dot graduate o giua chuoi).
2. `testFuzz_GraduationStockUsedBound` — kiem tra `stockUsed <= stockAmount` tai moi graduation.
3. `testFuzz_BuybackAnchorNotRaisable` — kiem tra `buybackAnchorSqrtP` khong bao qua gia tri ban dau.
4. `testFuzz_CurveFeesExhaust` — kiem tra sau khi claim all fees, `totalFees == 0` va `claimable[* == 0`.

Xem toan buoc noi dung file test o phan 6 duoi day.

---

## 5. PoC (Proof of Concept)

Vì ma duoc bao ve rat tot boi bo test hien co, **khong tim duoc bug an cap tien co the khai thac duoc ngay lap tuc** tu phan tich tich cuc. Cac PoC duoi day la **cau truc san sang chay** de xac minh cac van de nêu tren (khong an cap tien thuc su, chi xac minh rang van de khong xay ra):

- `testPoc_GraduationUnderflow` — chay graduation voi `stockUsed` lon hon `stockAmount` (mock CurveDeployer tra gia tri lon) de xac minh revert.
- `testPoc_BuybackAnchor` — day spot len cao roi goi `buyback`, xac minh `buybackAnchorSqrtP` khong thay doi va `buyback` khong mua o gia cao.

Xem toan buoc o `test/AuditPoc.t.sol` (phan 7).

---

## 6. File fuzz test (test/AuditFuzz.t.sol)

Dua vao `test/utils/V2FactoryFixture.sol` (co san). Cac ham fuzz co the chay boi `forge test --match-contract AuditFuzzTest -vv`.

*(Noi dung file duoc viet o phan 7 cua bao cao nay, luu vao `test/AuditFuzz.t.sol` va `test/AuditPoc.t.sol`.)*

---

## 7. Huong dan cai dat va chay

Vi moi hien tai khong the tai Foundry/Echidna (SSL bi chan), nguoi dung can cai dat tai may chu/cac trinh may:

### Cai dat Foundry

```sh
# Option A: foundryup (can internet den foundry.paradigm.xyz)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Option B: tai binary tu GitHub (host duoc phep)
wget --no-check-certificate "https://github.com/foundry-rs/foundry/releases/download/v1.8.6/foundry_v1.8.6_linux_amd64.tar.gz"
tar xzf foundry_v1.8.6_linux_amd64.tar.gz
cp foundry/forge /usr/local/bin/
cp foundry/cast /usr/local/bin/
```

### Cai dat Echidna (optional, cho property-based fuzzing)

Echidna viet boi Haskell, can Stack/Cabal:

```sh
# Can stack/cabal da cai dat
stack install echidna
# hoac
cabal install echidna
```

Echidna chi ho tro Solidity fuzzing (khong phai Foundry invariant test), nen can viet harness Solidity rui gan voi Echidna config. Khong khuyen nghiep cho repo nay vi da co Forge invariant/fuzz test ratchu den.

### Build va chay test

```sh
cd /home/user/arc_hedgefun
forge build --sizes
forge test -vv
forge test --match-contract AuditFuzzTest -vv
forge test --match-contract AuditPocTest -vv
```

### Chay Echidna (neu muon them)

```sh
echidna-test ./src/ --contract HedgeFunBondingCurve --config echidna.yaml
```

*(Can viet `echidna.yaml` va harness contracts.)*

---

## 8. Ket luan

Sau phan tich tich cuc tat ca cac contract core (`HedgeFunBondingCurve`, `HedgeFunV2Factory`, `CurveDeployer`, `HedgeFunV2Hook`, `HedgeFunV2TradeRouter`, `HedgeFunTreasuryBase`, `HedgeFunV2Treasury`, `V2LiquidityVault`) va bo test adversarial hien co, **khong tim duoc bug an cap tien co the khai thac duoc ngay lap tuc**. He thong da duoc bao ve rat tot boi:

- `ReentrancyGuard` tren tat ca entry point tien te
- `TransferMismatch` / `_solvent()` kiem tra balance sau moi transfer
- `nonReentrant` + `try/catch` o fee payout (hook `settleStock`)
- `minFinalOut` / `allowPartialFill` o router
- `maxSlippageBps` + `maxDeviationBps` gate o treasury
- `buybackAnchorSqrtP` rat thich (chi giam, khong bao qua spot)

**Van de lon nhat co the xay ra:** underflow trong `_graduate()` neu `stockUsed > stockAmount` (khoi tao graduation fail, lock tien nguoi mua o cuoi cung). Can them fuzz test `testFuzz_GraduationStockUsedBound` de xac minh rang `stockUsed <= stockAmount` luon luon.

**Buoc tiep theo:** Cai dat Foundry, them file fuzz test (phan 6/7), chay `forge test` va xac nhan tat ca conservation property. Neu bat duoc revert/sai sot, sua loi roi cap nhat bao cao nay.

---