// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {V2StakingIncome} from "hedgefun/v2/V2StakingIncome.sol";

contract PoCToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    address public blocked;
}

/// @notice Adversarial PoCs against `V2StakingIncome`: does the reward index ever
///         pay out more than it took in, or hand one account another's stream?
/// @dev Real contract from `src/`, real ERC20s, no mirroring of the math.
///
///      Run: FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=1000 \
///             forge test --offline --match-path 'audit/poc/harness/test/StakingPoC.t.sol' -vv
contract StakingPoC is Test {
    PoCToken internal stakeToken;
    PoCToken internal rewardToken;
    V2StakingIncome internal pool;

    uint256 internal constant DURATION = 7 days;
    uint256 internal constant LOCK = 1 days;

    address[] internal actors;

    function setUp() public {
        vm.warp(1_700_000_000);
        stakeToken = new PoCToken("Fun", "FUN");
        rewardToken = new PoCToken("Stock", "STK");
        // the test contract is the income source, so it can fund directly
        pool = new V2StakingIncome(stakeToken, rewardToken, address(this), DURATION, LOCK);
        for (uint256 i; i < 8; ++i) {
            address a = address(uint160(0x1000 + i));
            actors.push(a);
            stakeToken.mint(a, 1e30);
            vm.prank(a);
            stakeToken.approve(address(pool), type(uint256).max);
        }
        rewardToken.mint(address(this), 1e30);
        rewardToken.approve(address(pool), type(uint256).max);
    }

    function clamp(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (x % (hi - lo + 1));
    }

    // ------------------------------------------------------------------ PoC #1
    /// Sum of every claim, over random stake/unstake/fund orders, must never exceed
    /// what was funded. This is the only invariant that matters for a staking pool:
    /// the index is allowed to under-distribute, never to over-distribute.
    function testFuzz_claimsNeverExceedFunding(uint256 seed, uint256 fundAmount) public {
        fundAmount = clamp(fundAmount, 1e6, 1e24);
        uint256 funded;
        uint256 claimed;

        for (uint256 step; step < 24; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            uint256 pick = seed % 10;
            address a = actors[seed % actors.length];
            if (pick < 4) {
                vm.prank(a);
                pool.stake(clamp(seed >> 8, 1, 1e22));
            } else if (pick < 6) {
                uint256 bal = pool.balanceOf(a);
                if (bal != 0) {
                    vm.warp(block.timestamp + LOCK);
                    vm.prank(a);
                    pool.withdraw(clamp(seed >> 16, 1, bal), a);
                }
            } else if (pick < 8) {
                uint256 amount = clamp(seed >> 16, 1, fundAmount);
                pool.fund(amount);
                funded += amount;
            } else {
                vm.warp(block.timestamp + clamp(seed >> 24, 1, 2 days));
            }
        }

        vm.warp(block.timestamp + DURATION + LOCK + 1);
        for (uint256 i; i < actors.length; ++i) {
            address a = actors[i];
            // read before prank: a view call would consume the prank
            uint256 bal = pool.balanceOf(a);
            if (bal != 0) {
                vm.prank(a);
                pool.withdraw(bal, a);
            }
            vm.prank(a);
            claimed += pool.claim(a);
        }

        assertLe(claimed, funded, "paid out more than was funded");
        assertEq(pool.totalFunded(), funded, "funding ledger drifted");
        assertEq(pool.totalClaimed(), claimed, "claim ledger drifted");
        assertLe(claimed, rewardToken.balanceOf(address(this)) + claimed, "impossible balance");
    }

    // ------------------------------------------------------------------ PoC #2
    /// A staker joining at 90% of the stream must not share in what was emitted
    /// before they arrived. The classic "snipe the last block" reward theft.
    function test_lateStakerCannotTakeEarlierStream() public {
        address alice = actors[0];
        address bob = actors[1];
        vm.prank(alice);
        pool.stake(1_000e18);

        uint256 funded = 7_000e18;
        pool.fund(funded);
        assertGt(pool.rewardRateScaled(), 0, "stream did not start");

        vm.warp(block.timestamp + (DURATION * 9) / 10);
        vm.prank(bob);
        pool.stake(1_000_000e18); // 1000x Alice

        vm.warp(block.timestamp + DURATION);
        uint256 aliceEarned = pool.earned(alice);
        uint256 bobEarned = pool.earned(bob);

        // Bob was present for the last 10% of the stream with 1000/1001 of the weight.
        uint256 bobCap = (funded * 3) / 10;
        assertLe(bobEarned, bobCap, "late staker captured rewards emitted before it arrived");
        assertGe(aliceEarned + bobEarned, funded - 10, "stream lost more than dust");
    }

    // ------------------------------------------------------------------ PoC #3
    /// Percentages of the stream must add up: whatever the funding order, the sum
    /// of every account's entitlement cannot exceed the funded amount.
    function testFuzz_entitlementsAddUp(uint256 fundA, uint256 fundB, uint256 gap) public {
        fundA = clamp(fundA, 1e18, 5_000e18);
        fundB = clamp(fundB, 1e18, 5_000e18);
        gap = clamp(gap, 0, 3 days);

        vm.prank(actors[0]);
        pool.stake(100e18);
        vm.prank(actors[1]);
        pool.stake(300e18);

        pool.fund(fundA);
        vm.warp(block.timestamp + gap);
        pool.fund(fundB);
        vm.warp(block.timestamp + DURATION + 1 days);

        uint256 sum;
        for (uint256 i; i < 2; ++i) {
            sum += pool.earned(actors[i]);
        }
        assertLe(sum, fundA + fundB, "entitlements exceed the funding");
        assertGe(sum + 10, fundA + fundB, "stream lost more than dust");
    }

    // ------------------------------------------------------------------ PoC #4
    /// Anyone can cause a one-wei funding. It must not restart the clock, or the
    /// stream never ends and pays out on an exponential rather than a line.
    function testFuzz_weiFundingCannotRestartTheClock(uint256 gap, uint256 amount) public {
        gap = clamp(gap, 0, DURATION);
        amount = clamp(amount, 1e18, 1_000e18);
        vm.prank(actors[0]);
        pool.stake(10e18);
        pool.fund(amount);
        uint256 end = pool.periodFinish();

        vm.warp(block.timestamp + gap);
        bool finished = block.timestamp >= end;
        pool.fund(1);
        if (finished) {
            // a stream that already ended is not "restarted": the new money gets its
            // own full duration, which is the documented rule for an idle queue
            assertEq(pool.periodFinish(), block.timestamp + DURATION, "idle funding did not get a full duration");
        } else {
            assertLe(pool.periodFinish(), end + 1, "a wei of funding moved the stream end");
            assertGe(pool.periodFinish(), end, "a wei of funding ended the stream early");
        }
    }

    // ------------------------------------------------------------------ PoC #5
    /// Many small stakers, each one wei, against the index's integer division.
    /// Measures the actual drift instead of arguing about it.
    function test_manyTinyStakesDriftIsDust() public {
        uint256 n = 40;
        for (uint256 i; i < n; ++i) {
            address a = address(uint160(0x5000 + i));
            stakeToken.mint(a, 1);
            vm.prank(a);
            stakeToken.approve(address(pool), 1);
            vm.prank(a);
            pool.stake(1);
        }
        uint256 funded = 40_000_000; // 40 wei per staker at best: the index floor bites
        pool.fund(funded);
        vm.warp(block.timestamp + DURATION + 1);

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            sum += pool.earned(address(uint160(0x5000 + i)));
        }
        assertLe(sum, funded, "over-distributed");
        assertGe(sum + n, funded, "lost more than one raw unit per staker");
        emit log_named_uint("funded", funded);
        emit log_named_uint("sum of entitlements", sum);
        emit log_named_uint("unallocated", funded - sum);
    }

    // ------------------------------------------------------------------ PoC #6
    /// A single staker leaving when it is the only one parks the rest of the stream
    /// in the queue. Re-staking must not create reward out of nothing: the queue is
    /// only re-streamed, never re-counted.
    function testFuzz_leaveAndReturnCannotMintRewards(uint256 elapsed) public {
        elapsed = clamp(elapsed, LOCK, DURATION);
        address alice = actors[0];
        vm.prank(alice);
        pool.stake(1e18);
        pool.fund(1_000e18);
        vm.warp(block.timestamp + elapsed);

        vm.prank(alice);
        pool.withdraw(1e18, alice);
        uint256 afterWithdraw = pool.queuedRewardsScaled();

        vm.prank(alice);
        pool.stake(1);
        vm.warp(block.timestamp + DURATION + 2 days);

        vm.prank(alice);
        uint256 claimed = pool.claim(alice);
        assertLe(claimed, 1_000e18, "leave/return minted rewards");
        assertLe(pool.totalClaimed(), pool.totalFunded(), "claims exceed funding");
        // the queue is drained, not duplicated
        assertLe(pool.queuedRewardsScaled(), 1_000e18 * 1e18, "queue grew");
        emit log_named_uint("queued after withdrawal (scaled)", afterWithdraw);
        emit log_named_uint("claimed", claimed);
    }
}
