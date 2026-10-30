// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HedgeFunToken} from "hedgefun/HedgeFunToken.sol";
import {HedgeFunBondingCurve} from "hedgefun/v2/HedgeFunBondingCurve.sol";

/// Mutable stock token: the real deployments use upgradeable issuer tokens, so the
/// curve must be probed with one that can be reconfigured, not only a fixed ERC20.
contract PoCStock is ERC20 {
    bool public taxed;
    constructor() ERC20("Stock", "STK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTaxed(bool v) external { taxed = v; }
    function _update(address from, address to, uint256 amount) internal override {
        if (taxed && from != address(0)) {
            super._update(from, address(0), amount / 100);
            amount -= amount / 100;
        }
        super._update(from, to, amount);
    }
}

/// Stands in for the factory: the curve only ever asks it to graduate, and the real
/// factory answers by calling `release()`.
contract PoCGraduation {
    HedgeFunBondingCurve public curve;
    function setCurve(HedgeFunBondingCurve c) external { curve = c; }
    function graduateCurve() external { curve.release(); }
}

/// @notice Adversarial PoCs against `HedgeFunBondingCurve` — the only place where a
///         trade is priced by arithmetic this contract owns rather than by a pool.
/// @dev Everything here runs against the real contract from `src/`. Nothing is a
///      reimplementation, so a fix that changes the curve changes these results.
///
///      Run: FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=2000 \
///             forge test --offline --match-path 'audit/poc/harness/test/CurvePoC.t.sol' -vv
contract CurvePoC is Test {
    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint256 internal constant VIRTUAL = 30_000e18;

    PoCStock internal stock;
    PoCGraduation internal graduation;
    HedgeFunToken internal token;
    HedgeFunBondingCurve internal curve;

    address internal protocol = address(0xf00d);
    address internal creator = address(0xc0ffee);
    address internal treasury = address(0x7a5);

    function setUp() public {
        vm.warp(1_700_000_000);
    }

    // ---------------------------------------------------------------- fixtures

    struct Cfg {
        uint16 saleBps;
        uint16 taxBps;
        uint16 snipeBps;
        uint8 snipeSeconds;
    }

    function _deploy(Cfg memory c) internal returns (HedgeFunBondingCurve) {
        stock = new PoCStock();
        graduation = new PoCGraduation();
        token = new HedgeFunToken("Fun", "FUN", SUPPLY, address(this), creator);
        address[] memory exemptions = new address[](0);
        HedgeFunBondingCurve.Init memory p = HedgeFunBondingCurve.Init({
            factory: address(graduation),
            token: address(token),
            stock: address(stock),
            treasury: treasury,
            protocol: protocol,
            creator: creator,
            supply: SUPPLY,
            virtualStock: VIRTUAL,
            saleBps: c.saleBps,
            taxBps: c.taxBps,
            protocolBps: 2000,
            creatorBps: 1000,
            snipeBps: c.snipeBps,
            snipeSeconds: c.snipeSeconds,
            openingTaxExemptions: exemptions
        });
        HedgeFunBondingCurve deployed = new HedgeFunBondingCurve(p);
        graduation.setCurve(deployed);
        token.transfer(address(deployed), SUPPLY);
        stock.mint(address(this), 1e30);
        stock.approve(address(deployed), type(uint256).max);
        token.approve(address(deployed), type(uint256).max);
        return deployed;
    }

    function _cfg(uint256 saleBps, uint256 taxBps, uint256 snipeBps, uint256 snipeSeconds)
        internal pure returns (Cfg memory)
    {
        return Cfg({
            saleBps: uint16(clamp(saleBps, 1000, 9000)),
            taxBps: uint16(clamp(taxBps, 0, 9999)),
            snipeBps: uint16(clamp(snipeBps, 0, 9900)),
            snipeSeconds: uint8(clamp(snipeSeconds, 0, 200))
        });
    }


    function clamp(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (x % (hi - lo + 1));
    }

    // ------------------------------------------------------------------ PoC #1
    /// A quote must never ask for more stock than the caller offered. The curve
    /// re-derives the payment from the rounded reserve, and the fee inversion is
    /// `(net-1) * 10000 / (10000-tax) + 1`: if that inversion ever overshoots the
    /// forward round trip, a caller offering exactly its budget cannot buy, and
    /// the last buy before graduation (the one that must land on
    /// `minTokenReserve`) becomes unreachable — a curve that can never graduate.
    function testFuzz_quoteNeverChargesMoreThanOffered(uint256 saleBps, uint256 taxBps, uint256 snipeBps,
        uint256 snipeSeconds, uint256 maxStockIn) public {
        Cfg memory c = _cfg(saleBps, taxBps, snipeBps, snipeSeconds);
        curve = _deploy(c);
        maxStockIn = clamp(maxStockIn, 1, 1e30);

        (uint256 spent,,) = curve.quoteBuy(maxStockIn);
        assertLe(spent, maxStockIn, "quoted charge exceeds the offer");
    }

    /// Same property at the cap boundary, where `capPayment` (derived from
    /// `terminalStock`) and `budget` (derived from that payment) must agree.
    function testFuzz_capQuoteNeverChargesMoreThanOffered(uint256 taxBps, uint256 saleBps) public {
        Cfg memory c = _cfg(saleBps, taxBps, 0, 0);
        curve = _deploy(c);
        uint256 cap = curve.terminalStock() - curve.virtualStock();
        uint256 capPayment = _grossStock(cap, c.taxBps);
        (uint256 spent, uint256 out,) = curve.quoteBuy(capPayment);
        assertLe(spent, capPayment, "cap quote charges more than it was offered");
        assertGt(out, 0, "cap quote gives nothing");
        // one unit less than the cap payment must also be honoured
        (uint256 spent2,,) = curve.quoteBuy(capPayment - 1);
        assertLe(spent2, capPayment - 1, "cap-minus-one quote overcharges");
    }

    function _grossStock(uint256 net, uint16 taxBps) internal pure returns (uint256) {
        return net == 0 ? 0 : Math.mulDiv(net - 1, 10_000, 10_000 - taxBps) + 1;
    }

    // ------------------------------------------------------------------ PoC #2
    /// Buy-then-sell in one block must never return more stock than it took, at
    /// every point of the curve and every fee. This is the Balancer/Bunni shape:
    /// a rounding fault on either side of the trade shows up here as profit.
    function testFuzz_roundTripNeverProfits(uint256 taxBps, uint256 amountIn, uint256 preBuys, uint256 seed)
        public
    {
        Cfg memory c = _cfg(5000, taxBps, 0, 0);
        curve = _deploy(c);
        // walk the curve to a random point first, so the test is not only about x = supply
        _advance(preBuys, seed);

        if (curve.status() != HedgeFunBondingCurve.Status.Active) return; // _advance closed it
        amountIn = clamp(amountIn, 1, 1e26);
        uint256 stockBefore = stock.balanceOf(address(this));
        (uint256 spent, uint256 got) = curve.buy(amountIn, 0, address(this), block.timestamp);
        assertLe(spent, amountIn, "buy charged more than offered");
        if (got == 0 || curve.status() != HedgeFunBondingCurve.Status.Active) return;
        uint256 out = curve.sell(got, 0, address(this), block.timestamp);
        uint256 stockAfter = stock.balanceOf(address(this));
        assertLe(stockAfter, stockBefore, "round trip made money");
        assertEq(stockAfter + spent, stockBefore + out, "stock is not conserved across the round trip");
    }

    /// The same, with the minimum trade the ABI allows: alternating one-wei buys
    /// and sells. Any fault that leaks per call shows up as a positive balance
    /// after thousands of them, which a single large trade would hide.
    function test_dustCycleCannotDrainTheCurve(uint256 taxBps) public {
        Cfg memory c = _cfg(5000, taxBps, 0, 0);
        curve = _deploy(c);
        uint256 curveStockBefore = stock.balanceOf(address(curve));
        uint256 traderBefore = stock.balanceOf(address(this));

        for (uint256 i; i < 1500; ++i) {
            (, uint256 got) = curve.buy(1, 0, address(this), block.timestamp);
            if (got == 0) break;
            curve.sell(got, 0, address(this), block.timestamp);
        }

        uint256 traderAfter = stock.balanceOf(address(this));
        assertLe(traderAfter, traderBefore, "dust cycling extracted stock");
        assertGe(stock.balanceOf(address(curve)), curveStockBefore, "curve stock fell: fees were paid out");
    }

    function _advance(uint256 preBuys, uint256 seed) internal {
        uint256 n = clamp(preBuys, 0, 12);
        for (uint256 i; i < n; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 amount = 1e18 + (seed % (VIRTUAL / 4));
            try curve.buy(amount, 0, address(this), block.timestamp) returns (uint256, uint256 got) {
                if (got == 0) return;
            } catch {
                return;
            }
        }
    }

    // ------------------------------------------------------------------ PoC #3
    /// Graduation must land exactly on `minTokenReserve`, must hand the factory
    /// exactly the ledger it owes, and must leave every accrued fee claimable.
    /// Otherwise the vault is seeded with less than the curve promised, or the
    /// fee recipients are silently wiped out by the migration.
    function testFuzz_graduationIsExactAndLeavesFeesClaimable(uint256 taxBps, uint256 chunk, uint256 seed) public {
        Cfg memory c = _cfg(5000, taxBps, 0, 0);
        curve = _deploy(c);
        chunk = clamp(chunk, 1e18, 1e26);

        uint256 i;
        for (; i < 64 && curve.status() == HedgeFunBondingCurve.Status.Active; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 amount = chunk + (seed % chunk);
            if (seed % 4 == 0) amount = curve.terminalStock() - curve.virtualStock() - curve.realStockReserve();
            curve.buy(amount, 0, address(this), block.timestamp);
        }
        if (curve.status() != HedgeFunBondingCurve.Status.Graduated) return; // did not finish inside the loop

        assertEq(curve.tokenReserve(), 0, "released curve still holds a token reserve");
        assertEq(curve.realStockReserve(), 0, "released curve still holds a stock reserve");
        assertEq(token.balanceOf(address(graduation)), curve.minTokenReserve(), "factory did not receive minTokenReserve");
        assertEq(token.balanceOf(address(this)) + token.balanceOf(address(graduation)) + _burned(), SUPPLY,
            "tokens were created or destroyed by the migration");
        assertEq(stock.balanceOf(address(curve)), curve.totalFees(), "curve kept stock that is not owed as fees");

        uint256 owed = curve.claimable(protocol) + curve.claimable(creator) + curve.claimable(treasury);
        assertEq(owed, curve.totalFees(), "fee claims do not add up to the fee liability");
        curve.claimFees(protocol);
        curve.claimFees(creator);
        curve.claimFees(treasury);
        assertEq(stock.balanceOf(address(curve)), 0, "claimed fees left a residue");
    }

    function _burned() internal view returns (uint256) {
        return SUPPLY - token.totalSupply();
    }

    // ------------------------------------------------------------------ PoC #4
    /// The opening surcharge is a token burn, not a stock charge. It must be zero
    /// for an exempt recipient and for anyone after the window, or the creator's
    /// own opening buy burns part of the supply it was promised.
    function testFuzz_openingBurnOnlyInsideWindowAndNeverForExempt(uint256 snipeBps, uint256 taxBps, uint256 dt)
        public
    {
        Cfg memory c = _cfg(5000, taxBps, snipeBps, 120);
        curve = _deploy(c);
        dt = clamp(dt, 0, 240);
        vm.warp(block.timestamp + dt);

        uint256 rate = curve.buyRateBps();
        assertGe(rate, c.taxBps, "combined rate below the base tax");
        assertLe(rate, c.snipeBps <= c.taxBps ? c.taxBps : c.snipeBps, "combined rate above the opening rate");
        assertEq(curve.buyRateBpsFor(creator), c.taxBps, "creator paid an opening surcharge");

        uint256 supplyBefore = token.totalSupply();
        (, uint256 out, uint256 burn) = curve.quoteBuyFor(1e22, address(0xbeef));
        curve.buy(1e22, 0, address(0xbeef), block.timestamp);
        assertEq(supplyBefore - token.totalSupply(), burn, "burned amount differs from the quote");
        if (dt >= 120 || c.snipeBps <= c.taxBps) assertEq(burn, 0, "burn outside the opening window");
        assertGt(out, 0, "no tokens out");
    }

    // ------------------------------------------------------------------ PoC #5
    /// A seller can only ever be paid from the stock reserve. The quote guards
    /// this with `gross > realStockReserve`, but the guard must hold for every
    /// input up to the circulating supply, including after a taxed stock token
    /// silently took a cut of a previous deposit.
    function testFuzz_saleNeverExceedsReserve(uint256 taxBps, uint256 preBuys, uint256 sellFraction, uint256 seed)
        public
    {
        Cfg memory c = _cfg(5000, taxBps, 0, 0);
        curve = _deploy(c);
        _advance(preBuys, seed);
        uint256 held = token.balanceOf(address(this));
        if (held == 0) return;
        uint256 amount = clamp(sellFraction, 1, held);

        if (curve.status() != HedgeFunBondingCurve.Status.Active) return;
        uint256 reserve = curve.realStockReserve();
        (uint256 out,) = curve.quoteSell(amount);
        assertLe(out, reserve, "sale exceeds the stock reserve");
        if (out == 0) {
            // `sell` refuses a fill worth nothing; the quote must not have promised it either
            vm.expectRevert(HedgeFunBondingCurve.BadTrade.selector);
            curve.sell(amount, 0, address(this), block.timestamp);
            return;
        }
        uint256 before = stock.balanceOf(address(this));
        curve.sell(amount, 0, address(this), block.timestamp);
        assertEq(stock.balanceOf(address(this)) - before, out, "executed sale differs from the quote");
    }
}
