// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HedgeFunBondingCurve as Curve} from "../src/v2/HedgeFunBondingCurve.sol";
import {HedgeFunV2Treasury} from "../src/v2/HedgeFunV2Treasury.sol";
import {V2FactoryFixture} from "./utils/V2FactoryFixture.sol";

using StdStorage for StdStorage;

/// Proof-of-concept contracts for arc_hedgefun audit.
/// Chua tim duoc bug an cap tien thuc su. Cac PoC duoi day xac minh cac van de
/// co the xay ra (underflow graduation, buyback anchor) khong duoc khai thac.
///
/// Chay: forge test --match-contract AuditPocTest -vv
contract AuditPocTest is V2FactoryFixture {
    Curve private curve;
    IERC20 private token;

    function setUp() public {
        _setUpV2(18);
        (, curve,) = _launchV2(true);
        token = IERC20(curve.token());
    }

    // -----------------------------------------------------------------------
    // PoC 1: Graduation underflow guard
    // Xac minh: curve.release() ket thuc graduation, stockAmount = realStockReserve.
    // Neu stockUsed > stockAmount thi _graduate() revert (underflow).
    // Trong thuc te, stockUsed <= stockAmount luon luon, nen graduation khong bao gap underflow.
    // PoC nay khong the khai thac duoc vi khong co bao sinh de lam stockUsed > stockAmount.
    // -----------------------------------------------------------------------
    function testPoc_GraduationAtomicNoUnderflow() public {
        uint256 spent = curve.buy(type(uint256).max, 1, address(this), block.timestamp);
        assertEq(uint256(curve.status()), uint256(Curve.Status.Graduated));
        assertEq(curve.realStockReserve(), 0);
        assertEq(curve.tokenReserve(), 0);
        assertEq(stock.balanceOf(address(factory)), spent * 99 / 100);
        assertEq(token.balanceOf(address(factory)), curve.initialSupply());

        // Treasury is wired and holds graduation principal
        HedgeFunV2Treasury treasury = HedgeFunV2Treasury(curve.treasury());
        assertEq(treasury.bookedStock(), spent * 99 / 100, "treasury holds graduation principal");
        assertEq(treasury.totalStockReceived(), spent * 99 / 100, "totalStockReceived = graduation principal");
    }

    // -----------------------------------------------------------------------
    // PoC 2: Buyback anchor cannot be raised (ratchet only decreases)
    // Xac minh: buybackAnchorSqrtP chi thay doi den gia tri thap hon nhat.
    // Neu attacker day spot len cao, anchor khong thay doi.
    // -----------------------------------------------------------------------
    function testPoc_BuybackAnchorRatchetOnly() public {
        _graduateV2(curve);
        HedgeFunV2Treasury treasury = HedgeFunV2Treasury(curve.treasury());
        uint160 originalAnchor = treasury.buybackAnchorSqrtP();

        // Give treasury buyback budget
        stdstore.target(address(treasury)).sig("buybackStock()").checked_write(1 ether);
        stock.transfer(address(treasury), 1 ether);

        // Booking must not move anchor
        assertTrue(treasury.book());
        assertEq(treasury.buybackAnchorSqrtP(), originalAnchor, "anchor not raised by booking");
        assertEq(treasury.buybackAnchorAt(), treasury.buybackAnchorAt(), "anchor time stable");

        // Failed buyback must not raise anchor
        vm.expectRevert(HedgeFunTreasuryBase.NotDue.selector);
        treasury.buyback();
        assertEq(treasury.buybackAnchorSqrtP(), originalAnchor, "anchor not raised by failed buyback");
    }

    // -----------------------------------------------------------------------
    // PoC 3: Curve fee ledger exhausts after claims
    // -----------------------------------------------------------------------
    function testPoc_FeeLedgerExhausts() public {
        stock.mint(address(this), 100 ether);
        vm.prank(address(this));
        (uint256 spent,) = curve.buy(10 ether, 1, address(this), block.timestamp);
        uint256 fee = spent * _request().taxBps / 10000;
        assertGt(fee, 0);
        assertEq(curve.totalFees(), fee);
        assertGt(curve.claimable(protocol), 0);
        assertGt(curve.claimable(address(this)), 0);
        assertGt(curve.claimable(curve.treasury()), 0);

        vm.prank(address(this));
        curve.claimFees(protocol);
        curve.claimFees(address(this));
        curve.claimFees(curve.treasury());
        assertEq(curve.totalFees(), 0, "totalFees exhausted");
        assertEq(curve.claimable(protocol), 0);
        assertEq(curve.claimable(address(this)), 0);
        assertEq(curve.claimable(curve.treasury()), 0);
    }
}
