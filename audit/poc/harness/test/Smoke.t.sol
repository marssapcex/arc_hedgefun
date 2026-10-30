// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {HedgeFunBondingCurve} from "hedgefun/v2/HedgeFunBondingCurve.sol";

contract SmokeTest is Test {
    function testHarnessCompilesAndRuns() public pure {
        assertTrue(type(HedgeFunBondingCurve).creationCode.length > 0);
    }
}
