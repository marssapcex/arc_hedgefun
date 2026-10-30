// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity >=0.8.13 <0.9.0;

/// @dev Stub for the poc profile only.
///
/// forge-std's Test.sol and Script.sol import `safeconsole` (13,248 lines of
/// generated logging helpers) but never call it, and nothing in this repo uses
/// it either. The sandbox compiles with solc-js, whose wasm heap gives out at
/// roughly 1.2MB of source, so the poc profile remaps this path to this empty
/// library to leave room for the contracts under test. The default profile is
/// untouched and still compiles the real file.
library safeconsole {}
