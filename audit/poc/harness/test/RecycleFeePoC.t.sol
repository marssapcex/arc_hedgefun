// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";

/// @notice A line-for-line port of the ONLY money arithmetic whose body survives
///         the decompilation: the "recycle fee" budget at `0x107ec` (and its view
///         twin `0x8bcf1b27`).
///
/// @dev Decimal offsets into the artifact, so every line below can be checked
///      against the paste:
///        `stor_ce`  = rate, initialised to 100 in `initialize`
///        `_getExchangeInfo` = slot 0xcc, the base the budget is a fraction of
///        `stor_d3`  = cap, settable in [1e12, 1e14] by `0x4d574c56`
///        `stor_cf`  = the live budget
///        `stor_d0`  = per-block rate
///        `stor_d1`  = window end, +8571 blocks (the constant `0x0d3e87a7` returns)
///        `stor_d2`  = next accrual point, +2143 blocks
///        `mapping_d4` = per-address exemption, settable by `0x252c3594(address,bool)`
///
///      Nothing here is re-designed: the branches, the assignment at the rollover
///      and the early return are all as decompiled, including the ones that look
///      wrong. That is the point of the port — the tests below then say which of
///      those shapes actually matter.
contract RecycleLedger {
    uint256 public constant BLOCKS_PER_WINDOW = 8571;
    uint256 public constant ARM_BLOCKS = 2143;

    mapping(address => bool) public exempt; // mapping_d4
    uint256 public exchangeInfo;            // _getExchangeInfo
    uint256 public rate;                    // stor_ce
    uint256 public cap;                     // stor_d3
    uint256 public budget;                  // stor_cf
    uint256 public perBlock;                // stor_d0
    uint256 public windowEnd;               // stor_d1
    uint256 public nextAccrual;             // stor_d2

    event DayRolled(uint256 windowEnd, uint256 daily, uint256 perBlock);
    error OverBudget(uint256 requested, uint256 available);

    function configure(uint256 exchangeInfo_, uint256 rate_, uint256 cap_) external {
        exchangeInfo = exchangeInfo_;
        rate = rate_;
        cap = cap_;
    }

    function setExempt(address who, bool v) external { exempt[who] = v; }

    /// @dev `0x107ec` verbatim.
    function spend(uint256 amount) external {
        if (exempt[msg.sender]) return; // <-- the decompiled early return
        if (block.number <= windowEnd) {
            if (block.number > nextAccrual) {
                budget += (block.number - nextAccrual) * perBlock;
                nextAccrual = block.number;
            }
        } else {
            windowEnd = block.number + BLOCKS_PER_WINDOW;
            uint256 daily = rate * exchangeInfo / 1000;
            if (daily > cap) daily = cap; // the decompiler's `if (0 != v5 > v6) { }`
            perBlock = daily / BLOCKS_PER_WINDOW;
            nextAccrual = block.number + ARM_BLOCKS;
            uint256 remainder = daily - (daily / BLOCKS_PER_WINDOW) * BLOCKS_PER_WINDOW;
            budget = remainder + (daily / BLOCKS_PER_WINDOW) * ARM_BLOCKS; // assignment, not +=
            emit DayRolled(windowEnd, daily, perBlock);
        }
        if (amount > budget) revert OverBudget(amount, budget);
        budget -= amount;
    }
}

/// @notice `0x13ee5` verbatim: a pair of powers of ten used to rescale a price or
///         a size. Two packed uint8 fields of `_getPositionIds[id].field0` feed it.
library ScaleTable {
    function scale(uint256 index) internal pure returns (uint256) {
        if (index == 0) return 1e6;
        if (index == 1) return 1e5;
        if (index == 2) return 1e4;
        if (index == 3) return 1e3;
        if (index == 4) return 100;
        if (index == 5) return 10;
        if (index == 6) return 1;
        return 0; // no revert, for any index >= 7
    }

    /// @dev call site is `(a, b) = 0x13ee5(field0 >> 176, field0 >> 184)`, and the
    ///      function returns `(f(b), f(a))`.
    function pair(uint256 a, uint256 b) internal pure returns (uint256 first, uint256 second) {
        return (scale(b), scale(a));
    }
}

/// @notice Adversarial PoCs against the decompiled artifact.
/// @dev Run:
///        FOUNDRY_PROFILE=poc forge test --use /home/user/bin/solc --offline \
///          --match-path 'audit/poc/harness/test/RecycleFeePoC.t.sol' -vv
contract RecycleFeePoC is Test {
    RecycleLedger internal ledger;
    address internal owner = address(0xA11CE);
    address internal keeper = address(0xB0B);

    uint256 internal constant EXCHANGE_INFO = 1_000_000e6;

    function setUp() public {
        vm.roll(1_000_000);
        ledger = new RecycleLedger();
        // the values `initialize(address)` writes, then the cap's default range
        ledger.configure(EXCHANGE_INFO, 100, 1e13);
    }

    function _daily() internal view returns (uint256 d) {
        d = ledger.rate() * ledger.exchangeInfo() / 1000;
        if (d > ledger.cap()) d = ledger.cap();
    }

    /// @dev what the decompiled rollover assigns to `stor_cf`
    function _openingGrant(uint256 daily) internal view returns (uint256) {
        uint256 perBlock = daily / ledger.BLOCKS_PER_WINDOW();
        uint256 remainder = daily - perBlock * ledger.BLOCKS_PER_WINDOW();
        return remainder + perBlock * ledger.ARM_BLOCKS();
    }

    // ------------------------------------------------------------------ PoC #1
    /// The rollover ASSIGNS the budget instead of adding to it. At the last block of
    /// a window the budget holds a full `daily` worth of entitlement; one block
    /// later, whatever was not spent is gone — the new window starts again at
    /// `remainder + perBlock * 2143`, i.e. ~25 % of a day. Measured in wei, not
    /// argued. (For a fee pot this is conservative, not lossy for users: it can only
    /// ever under-grant. Recorded because the assignment is easy to misread as `+=`
    /// and to build a false "print money by cycling windows" claim on top of it.)
    function test_unspentBudgetIsDestroyedAtTheWindowBoundary() public {
        uint256 daily = _daily();

        vm.prank(keeper);
        ledger.spend(0); // opens the first window
        assertEq(ledger.budget(), _openingGrant(daily), "opening grant is the 2143-block slice");

        uint256 windowEnd = ledger.windowEnd();
        vm.roll(windowEnd); // the window's last block
        vm.prank(keeper);
        ledger.spend(0);
        uint256 atClose = ledger.budget();
        assertEq(atClose, daily, "by the end of the window the full daily rate has accrued");

        vm.roll(windowEnd + 1); // first block of the next window
        vm.prank(keeper);
        ledger.spend(0);

        emit log_named_uint("entitlement at the last block of window 1", atClose);
        emit log_named_uint("entitlement at the first block of window 2", ledger.budget());
        assertLt(ledger.budget(), atClose, "unspent budget must not survive the rollover");
        assertEq(ledger.budget(), _openingGrant(daily), "window 2 restarts at the 2143-block slice");
    }

    // ------------------------------------------------------------------ PoC #2
    /// There is no catch-up. The rollover grants one window regardless of how many
    /// windows elapsed, so an idle period of N windows still yields a single day's
    /// slice on the next call. Under-grant again, but it means the budget cannot be
    /// "saved up" and then drained in one transaction.
    function test_idleWindowsDoNotAccumulate() public {
        uint256 daily = _daily();
        vm.prank(keeper);
        ledger.spend(0);
        uint256 first = ledger.budget();

        vm.roll(block.number + 3 * ledger.BLOCKS_PER_WINDOW());
        vm.prank(keeper);
        ledger.spend(0);
        emit log_named_uint("after 3 idle windows", ledger.budget());
        assertEq(ledger.budget(), first, "three idle windows granted exactly as much as one");
        assertLt(ledger.budget(), daily, "and still less than a single daily rate");
    }

    // ------------------------------------------------------------------ PoC #3
    /// The exemption is checked BEFORE the budget. An exempt address is therefore
    /// not rate-limited at all: it may take the whole daily amount in one call, and
    /// it never decrements the budget either, so the same window still pays
    /// everybody else in full. `withdrawFromProtocol` is the caller in the real
    /// contract, and `require(amount <= stor_cf)` is its only rate limiter.
    function test_exemptAddressBypassesTheEntireBudget() public {
        vm.prank(keeper);
        ledger.spend(0);
        uint256 daily = ledger.budget();

        ledger.setExempt(owner, true);

        // a non-exempt caller asking for more than the budget is refused
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(RecycleLedger.OverBudget.selector, daily * 5, daily)
        );
        ledger.spend(daily * 5);

        // the exempt one is not
        vm.prank(owner);
        ledger.spend(daily * 5);
        assertEq(ledger.budget(), daily, "the exempt spend did not consume the budget");

        // and the budget is still whole for everyone else
        vm.prank(keeper);
        ledger.spend(daily);
        assertEq(ledger.budget(), 0, "the same window paid twice");
    }

    // ------------------------------------------------------------------ PoC #4a
    /// Negative control on the accrual itself: no matter where inside a window the
    /// fuzzer looks, the budget never exceeds the daily rate. The remainder-plus-
    /// perBlock reconstruction has no drift and cannot be driven above `daily`.
    function testFuzz_budgetNeverExceedsTheDailyRate(
        uint256 exchangeInfo,
        uint256 rate,
        uint256 cap,
        uint256 elapsed
    ) public {
        exchangeInfo = bound(exchangeInfo, 1e6, 1e30);
        rate = bound(rate, 1, 1000);
        cap = bound(cap, 1e12, 1e14);
        ledger.configure(exchangeInfo, rate, cap);

        uint256 daily = rate * exchangeInfo / 1000;
        if (daily > cap) daily = cap;

        vm.prank(keeper);
        ledger.spend(0);
        uint256 opening = ledger.budget();
        assertLe(opening, daily, "opening grant exceeds the daily rate");

        elapsed = bound(elapsed, 1, ledger.BLOCKS_PER_WINDOW() - 1);
        vm.roll(block.number + elapsed);
        vm.prank(keeper);
        ledger.spend(0);
        assertLe(ledger.budget(), daily, "accrual exceeded the daily rate");
        assertGe(ledger.budget(), opening, "accrual went backwards");

        // Exact closed form of the decompiled accrual: `remainder + perBlock * elapsed`,
        // except that nothing moves before the 2143-block arm point (the opening grant
        // already covers that slice). No drift in either direction.
        uint256 perBlock = daily / ledger.BLOCKS_PER_WINDOW();
        uint256 remainder = daily - perBlock * ledger.BLOCKS_PER_WINDOW();
        uint256 arm = ledger.ARM_BLOCKS();
        uint256 expected = remainder + perBlock * (elapsed < arm ? arm : elapsed);
        assertEq(ledger.budget(), expected, "accrual deviates from the closed form");
    }

    // ------------------------------------------------------------------ PoC #4
    /// `0x13ee5` returns a ZERO scale for any index above 6, silently. Its two
    /// inputs are two packed uint8 fields of the perpetual's storage, and the one
    /// setter that touches a neighbouring scale field enforces a [9, 36] range —
    /// so a configuration path that writes 7..255 here yields a zero scale, not a
    /// revert. Downstream that is either a silent zero (numerator) or a division by
    /// zero (denominator).
    function testFuzz_scaleTableReturnsZeroSilentlyAboveSix(uint256 a, uint256 b) public pure {
        a = bound(a, 0, 255);
        b = bound(b, 0, 255);
        (uint256 first, uint256 second) = ScaleTable.pair(a, b);
        if (b > 6) assertEq(first, 0, "scale above six must be zero, as decompiled");
        if (a > 6) assertEq(second, 0, "scale above six must be zero, as decompiled");
        if (a <= 6) assertEq(second, 10 ** (6 - a), "in-range scale is a power of ten");
        if (b <= 6) assertEq(first, 10 ** (6 - b), "in-range scale is a power of ten");
    }

    function test_zeroScaleIsSilentInTheNumeratorAndFatalInTheDenominator() public pure {
        (uint256 first, uint256 second) = ScaleTable.pair(3, 200); // b = 200 -> first = 0
        assertEq(first, 0);
        assertEq(second, 1000);
        // as a numerator: the value becomes zero, and nothing reverts
        assertEq(1_234_567 * first / second, 0, "a zero numerator silently zeroes the value");
        // as a denominator: the transaction dies with a panic, not a typed error
        second = 0;
        assertEq(first, 0);
        // (a division by `second` here would be Panic(0x12); checked in the next test
        //  so the fuzzer keeps this one pure)
    }

    function test_zeroScaleDenominatorIsAPanic() public {
        (uint256 first, uint256 second) = ScaleTable.pair(200, 3); // a = 200 -> second = 0
        assertEq(second, 0);
        assertEq(first, 1000);
        vm.expectRevert(stdError.divisionError);
        this.divide(first, second);
    }

    function divide(uint256 x, uint256 y) external pure returns (uint256) {
        return x / y;
    }
}
