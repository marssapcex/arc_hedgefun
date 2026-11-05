# VulnChain — live triage report

Generated 2026-11-05T06:35:12.354Z · chain `ethereum` · mode `hybrid` · blocks 26346822–26346861

**Đây là xếp hạng độ giống với 821 sự cố đã biết, không phải kết luận có lỗ hổng.**

| Metric | Value |
|---|---|
| incidentCount | `821` |
| contractsScanned | `60` |
| logsSeen | `34044` |
| verdicts | `{"REVIEW":7,"INFO":53}` |
| clusters | `4` |
| sourcifyHits | `0` |
| errors | `0` |
| bandKeys | `25627` |
| selectorKeys | `1617` |
| knownAddresses | `381` |
| seededBytecodeFingerprints | `38` |

## Top findings

| Verdict | Score | Address | Creator | Similar incident | Bytecode sim | Selector sim | Rules |
|---|---|---|---|---|---|---|---|
| REVIEW | 0.353 | `0xba9abfdfb7c28e232d853d85c619e4248971aa31` | `—` | 2021-03-09_DODO_FlashLoan_ReInit | 1.00 | 0.00 | arbitrary-call |
| REVIEW | 0.353 | `0xd661623947ef2ead12d577b47021c167d163b0c5` | `—` | 2021-03-09_DODO_FlashLoan_ReInit | 1.00 | 0.00 | arbitrary-call |
| REVIEW | 0.353 | `0x941ddc62f8699f448e86c798e62520550616503d` | `—` | 2021-03-09_DODO_FlashLoan_ReInit | 1.00 | 0.00 | arbitrary-call |
| REVIEW | 0.353 | `0xace88ccc9f71c811ea38ea93d707d036579166d4` | `—` | 2021-03-09_DODO_FlashLoan_ReInit | 1.00 | 0.00 | arbitrary-call |
| REVIEW | 0.32 | `0xbdb20519288025f180533b5acd9139ae22752f06` | `—` | 2021-03-09_DODO_FlashLoan_ReInit | 1.00 | 0.00 | arbitrary-call |
| REVIEW | 0.32 | `0xc0c69d0556d2ae3b2d236e45395a4eed7f6514e6` | `—` | 2021-03-09_DODO_FlashLoan_ReInit | 1.00 | 0.00 | arbitrary-call |
| REVIEW | 0.32 | `0xb25bac207297773ce7fb17af0f9d06863330dac2` | `—` | 2021-03-09_DODO_FlashLoan_ReInit | 1.00 | 0.00 | arbitrary-call |
| INFO | 0.2129 | `0xdb1475c24597d10d31b28eac2ddfb14fd5d2a249` | `—` | 2022-03-14_CompoundTUSD_SweepTokenUnauthoriz | 0.09 | 0.91 | reentrancy, oracle-price-manipulation |
| INFO | 0.2 | `0x23617e59a5925b2a4bf75d73ff6711cd0b29de85` | `—` | 2024-07-18_MEVbot_0xdd7c_UniswapV3CallbackEx | 0.00 | 1.00 | reentrancy, oracle-price-manipulation |
| INFO | 0.1971 | `0xca7c2771d248dcbe09eabe0ce57a62e18da178c0` | `—` | 2022-08_Circle_MakerCDP_FlashLoan | 0.00 | 0.82 | oracle-price-manipulation |
| INFO | 0.1971 | `0xdfcf744c8ae896e8631ba9b9dc717546646f6708` | `—` | 2022-08_Circle_MakerCDP_FlashLoan | 0.00 | 0.82 | oracle-price-manipulation |
| INFO | 0.1971 | `0x2325e3f261cadb1c30cebf66c9f95f6fb016c0d4` | `—` | 2022-08_Circle_MakerCDP_FlashLoan | 0.00 | 0.82 | oracle-price-manipulation |
| INFO | 0.1971 | `0x1d45a4e326a29454036e7154c60c4a855a041a9f` | `—` | 2022-08_Circle_MakerCDP_FlashLoan | 0.00 | 0.82 | oracle-price-manipulation |
| INFO | 0.1812 | `0x0000000aa232009084bd71a5797d089aa4edfad4` | `—` | 2023-07-25_Platypus02_PriceManipulation | 0.00 | 0.66 | reentrancy, oracle-price-manipulation |
| INFO | 0.1545 | `0x48ba574edf0bc4e2e40b529863aaa6a67c264e7c` | `—` | 2022-12_TIFI_DepositBorrowReserveManipulatio | 0.00 | 0.52 | oracle-price-manipulation |
| INFO | 0.1414 | `0x8f10b468b06c6fd214b65f87778827f7d113f996` | `—` | 2024-08-29_Unverified667d_AccessControl | 0.00 | 0.71 | reentrancy, arbitrary-call, oracle-price-manipulation |
| INFO | 0.1293 | `0x8157a9d65807521fbb8db8f37eeecefdd247e9b1` | `—` | 2024-03-XX_SSS_TransferLimitBypass | 0.00 | 0.65 | — |
| INFO | 0.1273 | `0x7a250d5630b4cf539739df2c5dacb4c659f2488d` | `—` | 2023-05-xx_NeverFall_BuySellPriceManipulatio | 0.00 | 0.39 | reentrancy, oracle-price-manipulation |
| INFO | 0.1269 | `0xeff6cb8b614999d130e537751ee99724d01aa167` | `—` | 2024-03-20_ParaSwap_AccessControl_Multichain | 0.00 | 0.38 | reentrancy, arbitrary-call, oracle-price-manipulation |
| INFO | 0.1251 | `0xbc530bfa3fca1a731149248afc7f750c18360de1` | `—` | 2023-07-25_Platypus02_PriceManipulation | 0.00 | 0.38 | oracle-price-manipulation |
| INFO | 0.1182 | `0xaddc26a3854feabfd20d6bf658254088d83a425a` | `—` | 2025-07-22_MulticallWithETH_ValueForwarding | 0.00 | 0.59 | oracle-price-manipulation |
| INFO | 0.1182 | `0x4cd00e387622c35bddb9b4c962c136462338bc31` | `—` | 2025-07-22_MulticallWithETH_ValueForwarding | 0.00 | 0.59 | oracle-price-manipulation |
| INFO | 0.1 | `0x00000011f84b9aa48e5f8aa8b9897600006289be` | `—` | 2022-03-27_Revest_FNFTReentrancyMint | 0.16 | 0.00 | reentrancy, oracle-price-manipulation |
| INFO | 0.0969 | `0x51c72848c68a965f66fa7a88855f9f7784502a7f` | `—` | 2024-07-18_MEVbot_0xdd7c_UniswapV3CallbackEx | 0.00 | 0.48 | reentrancy, oracle-price-manipulation |
| INFO | 0.0932 | `0xe0554a476a092703abdb3ef35c80e0d76d32939f` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | oracle-price-manipulation |
| INFO | 0.0932 | `0x5ae13baaef0620fdae1d355495dc51a17adb4082` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | oracle-price-manipulation |
| INFO | 0.0932 | `0x09c5f9b273de8d41e5dce0867ca67e78c92a3a32` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | oracle-price-manipulation |
| INFO | 0.0932 | `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | oracle-price-manipulation |
| INFO | 0.0932 | `0xc7bbec68d12a0d1830360f8ec58fa599ba1b0e9b` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | oracle-price-manipulation |
| INFO | 0.0932 | `0x6546055f46e866a4b9a4a13e81273e3152bae5da` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | oracle-price-manipulation |

## Evidence (top 5)

### `0xba9abfdfb7c28e232d853d85c619e4248971aa31` — REVIEW (0.353)

- bytecode opcode-5gram Jaccard ≈ 1.00 vs a known-vulnerable deployment
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- → `2021-03-09_DODO_FlashLoan_ReInit` (DODO Finance, 2021-03-09) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-06-23_88mph_UnprotectedInit` (88mph (MPH NFT), 2021-06-23) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-09-04_DaoMaker_UnprotectedInit_EmergencyExit` (DAO Maker, 2021-09-04) score 0.353: bc=1.00 sel=0.00 src=0.00

### `0xd661623947ef2ead12d577b47021c167d163b0c5` — REVIEW (0.353)

- bytecode opcode-5gram Jaccard ≈ 1.00 vs a known-vulnerable deployment
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- → `2021-03-09_DODO_FlashLoan_ReInit` (DODO Finance, 2021-03-09) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-06-23_88mph_UnprotectedInit` (88mph (MPH NFT), 2021-06-23) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-09-04_DaoMaker_UnprotectedInit_EmergencyExit` (DAO Maker, 2021-09-04) score 0.353: bc=1.00 sel=0.00 src=0.00

### `0x941ddc62f8699f448e86c798e62520550616503d` — REVIEW (0.353)

- bytecode opcode-5gram Jaccard ≈ 1.00 vs a known-vulnerable deployment
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- → `2021-03-09_DODO_FlashLoan_ReInit` (DODO Finance, 2021-03-09) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-06-23_88mph_UnprotectedInit` (88mph (MPH NFT), 2021-06-23) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-09-04_DaoMaker_UnprotectedInit_EmergencyExit` (DAO Maker, 2021-09-04) score 0.353: bc=1.00 sel=0.00 src=0.00

### `0xace88ccc9f71c811ea38ea93d707d036579166d4` — REVIEW (0.353)

- bytecode opcode-5gram Jaccard ≈ 1.00 vs a known-vulnerable deployment
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- → `2021-03-09_DODO_FlashLoan_ReInit` (DODO Finance, 2021-03-09) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-06-23_88mph_UnprotectedInit` (88mph (MPH NFT), 2021-06-23) score 0.353: bc=1.00 sel=0.00 src=0.00
- → `2021-09-04_DaoMaker_UnprotectedInit_EmergencyExit` (DAO Maker, 2021-09-04) score 0.353: bc=1.00 sel=0.00 src=0.00

### `0xbdb20519288025f180533b5acd9139ae22752f06` — REVIEW (0.32)

- bytecode opcode-5gram Jaccard ≈ 1.00 vs a known-vulnerable deployment
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- → `2021-03-09_DODO_FlashLoan_ReInit` (DODO Finance, 2021-03-09) score 0.320: bc=1.00 sel=0.00 src=0.00
- → `2021-06-23_88mph_UnprotectedInit` (88mph (MPH NFT), 2021-06-23) score 0.320: bc=1.00 sel=0.00 src=0.00
- → `2021-09-04_DaoMaker_UnprotectedInit_EmergencyExit` (DAO Maker, 2021-09-04) score 0.320: bc=1.00 sel=0.00 src=0.00

---

_Ranked similarity to known incidents. Not a vulnerability proof._

Artifacts: `vulnchain/data/corpus.json`, `vulnchain/data/vulnerableBytecode.json`, `vulnchain/data/scan_result.json`.
