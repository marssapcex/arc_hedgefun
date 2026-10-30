// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {HedgeFunToken} from "hedgefun/HedgeFunToken.sol";
import {V2LiquidityVault} from "hedgefun/v2/V2LiquidityVault.sol";

contract PoCStock is ERC20 {
    constructor() ERC20("STOCK", "STK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract PoCFeeSink {
    IERC20 public immutable stock;
    uint256 public credited;
    constructor(IERC20 stock_) { stock = stock_; }
    function creditLiquidityFee(uint256 amount) external {
        stock.transferFrom(msg.sender, address(this), amount);
        credited += amount;
    }
}

contract PoCInitHook {
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }
}

/// @notice The KyberSwap-Elastic shape, aimed at this repo's graduated-pool vault.
///
/// KyberSwap lost ~$48M because a pool credited a position with liquidity it did not
/// hold: the attacker pushed the price onto a tick boundary, minted a position, and
/// then made the pool fold the fees-derived "reinvest" liquidity into the active
/// liquidity of the range it was about to cross. The range then paid out more
/// principal than it had, and `removeLiquidity` took the pool's other tokens.
///
/// The generic form of the bug is: *income folded into principal* + *a rounding
/// boundary that can be approached for free* + *a withdraw path that trusts the
/// pool's own number*. This file attacks this repo's `V2LiquidityVault` with that
/// shape, on a real V4 `PoolManager`, because the vault holds two positions in one
/// pool — a full-range one and a single-sided "surplus" one whose floor sits one
/// tick spacing from spot — and `collectFees` reads its income from the pool rather
/// than from its own ledger.
///
/// Run: FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=200 \
///        forge test --offline --match-path 'audit/poc/harness/test/KyberShapePoC.t.sol' -vv
contract KyberShapePoC is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint160 internal constant P0 = 1 << 96;      // seed price: 1 token per stock
    IPoolManager internal pm;
    PoolSwapTest internal router;
    HedgeFunToken internal fun_;
    PoCStock internal stock;
    PoCFeeSink internal sink;
    V2LiquidityVault internal vault;
    PoolKey internal key;
    bool internal funIs0;

    function setUp() public {
        pm = IPoolManager(address(new PoolManager(address(this))));
        router = new PoolSwapTest(pm);
        fun_ = new HedgeFunToken("FUN", "FUN", 1_000_000e18, address(this), address(this));
        stock = new PoCStock();
        stock.mint(address(this), 1_000_000e18);
        sink = new PoCFeeSink(IERC20(address(stock)));

        address hook = address(0x102000);
        vm.etch(hook, address(new PoCInitHook()).code);
        address c0 = address(fun_) < address(stock) ? address(fun_) : address(stock);
        address c1 = address(fun_) < address(stock) ? address(stock) : address(fun_);
        funIs0 = c0 == address(fun_);
        key = PoolKey(Currency.wrap(c0), Currency.wrap(c1), 3000, 60, IHooks(hook));

        vault = new V2LiquidityVault(address(this), pm, key, address(fun_), address(stock), address(sink));
        fun_.transfer(address(vault), 1_000e18);
        stock.transfer(address(vault), 1_000e18);
        fun_.approve(address(router), type(uint256).max);
        stock.approve(address(router), type(uint256).max);
        vault.seed(P0, 500e18, 1_000e18, 1_000e18);
    }

    function clamp(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (x % (hi - lo + 1));
    }

    /// @dev the direction that walks the price INTO the surplus range.
    ///      token as currency0 -> the surplus position sits ABOVE spot, so it needs price up,
    ///      which on this pool means selling currency1 in (zeroForOne = false). token as
    ///      currency1 -> it sits BELOW spot, so it needs price down (zeroForOne = true).
    function _intoSurplus() internal view returns (bool zeroForOne) {
        return !funIs0;
    }

    function _swap(bool zeroForOne, uint256 amountIn) internal returns (uint256 spent, uint256 out) {
        BalanceDelta delta = router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        (int256 dIn, int256 dOut) = zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        spent = uint256(-dIn);
        out = uint256(dOut);
    }

    // ------------------------------------------------------------------ PoC #1
    /// Push the price through the vault's single-sided position and back out in the
    /// same transaction pair. The vault must keep its idle balance, the pool must
    /// end holding at least what it started with, and the attacker must end down.
    function testFuzz_roundTripThroughSurplusRangeLeaksNothing(uint256 rawAmount) public {
        uint256 amountIn = clamp(rawAmount, 1e15, 300e18);
        bool zeroForOneIn = _intoSurplus();

        uint256 poolFunBefore = fun_.balanceOf(address(pm));
        uint256 poolStockBefore = stock.balanceOf(address(pm));
        uint256 attackerFunBefore = fun_.balanceOf(address(this));
        uint256 attackerStockBefore = stock.balanceOf(address(this));
        uint256 lockedBefore = vault.lockedSeedTokens();
        uint128 activeBefore = pm.getLiquidity(key.toId());
        uint128 surplusBefore = vault.surplusLiquidity();
        assertGt(surplusBefore, 0, "no surplus position to attack");

        // buy into the surplus range
        (, uint256 got) = _swap(zeroForOneIn, amountIn);
        assertGt(got, 0, "the surplus position did not fill");
        // and sell the same amount of the token straight back out of it
        if (got != 0) _swap(!zeroForOneIn, got);

        // the attacker may not profit from crossing the vault's position
        assertLe(fun_.balanceOf(address(this)), attackerFunBefore, "attack ended with more FUN");
        assertLe(stock.balanceOf(address(this)), attackerStockBefore, "attack ended with more stock");

        // every wei of fee the crossings paid stays in the pool, so the pool cannot shrink
        assertGe(fun_.balanceOf(address(pm)), poolFunBefore, "pool lost FUN to the attacker");
        assertGe(stock.balanceOf(address(pm)), poolStockBefore, "pool lost stock to the attacker");

        // the vault's idle balance is not part of the position and cannot move
        assertEq(fun_.balanceOf(address(vault)), lockedBefore, "vault idle FUN changed");
        assertEq(stock.balanceOf(address(vault)), 0, "vault idle stock appeared");

        // Active liquidity may only ever be the seeded range, or that range plus the vault's
        // own surplus position while the price sits inside it. Anything else is liquidity
        // that nobody deposited -- the KyberSwap shape.
        uint128 activeNow = pm.getLiquidity(key.toId());
        assertTrue(activeNow == activeBefore || activeNow == activeBefore + surplusBefore,
            "in-range liquidity was invented");
        assertEq(vault.surplusLiquidity(), surplusBefore, "the surplus position changed size");
    }

    // ------------------------------------------------------------------ PoC #2
    /// The same crossing repeated many times, which is what a KyberSwap-shaped
    /// attack does to grind a rounding fault: each pass must be a loss.
    function testFuzz_repeatedCrossingsNeverAccumulateValue(uint256 rawAmount, uint8 rawRounds) public {
        uint256 amountIn = clamp(rawAmount, 1e18, 100e18);
        uint256 rounds = clamp(rawRounds, 1, 8);
        bool zeroForOneIn = _intoSurplus();

        uint256 funBefore = fun_.balanceOf(address(this));
        uint256 stockBefore = stock.balanceOf(address(this));
        for (uint256 i; i < rounds; ++i) {
            (, uint256 got) = _swap(zeroForOneIn, amountIn);
            if (got == 0) break;
            _swap(!zeroForOneIn, got);
        }
        assertLe(fun_.balanceOf(address(this)), funBefore, "FUN balance grew over the crossings");
        assertLe(stock.balanceOf(address(this)), stockBefore, "stock balance grew over the crossings");
        assertEq(stock.balanceOf(address(vault)), 0, "vault idle stock appeared");
    }

    // ------------------------------------------------------------------ PoC #3
    /// The vault may only ever pay out what the pool says it earned, and only once:
    /// after a crossing the collection must be bounded by the fee the pool actually
    /// charged (0.3% of the traded notional on this pool), and a second collection
    /// must be zero. KyberSwap's drain was a collection larger than the fees.
    function test_collectFeesIsBoundedByRealFeesAndIdempotent() public {
        bool zeroForOneIn = _intoSurplus();
        uint256 traded;
        (, uint256 got) = _swap(zeroForOneIn, 20e18);
        traded += 20e18;
        if (got != 0) {
            _swap(!zeroForOneIn, got);
            traded += got;
        }

        uint256 supplyBefore = fun_.totalSupply();
        uint256 sinkBefore = stock.balanceOf(address(sink));
        (uint256 stockFee, uint256 burned) = vault.collectFees();

        assertEq(stock.balanceOf(address(sink)) - sinkBefore, stockFee, "stock fee did not reach the treasury");
        assertEq(sink.credited(), stockFee, "treasury credit differs from delivery");
        assertEq(supplyBefore - fun_.totalSupply(), burned, "burned FUN differs from what was collected");
        assertGt(stockFee + burned, 0, "no fee was collected from a taxed crossing");

        uint256 bound = traded * 30 / 10_000 + 2; // 0.3% pool fee, plus rounding
        assertLe(stockFee + burned, bound, "vault paid out more than the pool charged");

        (uint256 againStock, uint256 againBurned) = vault.collectFees();
        assertEq(againStock, 0, "a second collection paid again");
        assertEq(againBurned, 0, "a second collection burned again");
    }

    // ------------------------------------------------------------------ PoC #4
    /// A donation to the vault must not become collectable. The vault's payout is
    /// read from the pool's fee growth, never from its own balance.
    function testFuzz_donatedAssetsAreNotCollectable(uint256 donation) public {
        donation = clamp(donation, 1, 1_000e18);
        stock.mint(address(vault), donation);
        fun_.transfer(address(vault), donation);

        (uint256 stockFee, uint256 burned) = vault.collectFees();
        assertEq(stockFee, 0, "a donation was credited as a fee");
        assertEq(burned, 0, "a donation was burned as a fee");
        assertGe(stock.balanceOf(address(vault)), donation, "donated stock was taken");
    }
}
