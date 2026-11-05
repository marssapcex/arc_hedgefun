# VulnChain — live triage report

Generated 2026-11-05T06:40:10.827Z · chain `ethereum` · mode `hybrid` · blocks 26346846–26346885

**Đây là xếp hạng độ giống với 821 sự cố đã biết, không phải kết luận có lỗ hổng.**

| Metric | Value |
|---|---|
| incidentCount | `821` |
| contractsScanned | `60` |
| logsSeen | `28154` |
| verdicts | `{"REVIEW":4,"INFO":56}` |
| clusters | `4` |
| sourcifyHits | `0` |
| errors | `0` |
| bandKeys | `25720` |
| selectorKeys | `1617` |
| knownAddresses | `381` |
| seededBytecodeFingerprints | `37` |

## Top findings

| Verdict | Score | Address | Creator | Similar incident | Bytecode sim | Selector sim | Rules |
|---|---|---|---|---|---|---|---|
| REVIEW | 0.338 | `0x7f50786a0b15723d741727882ee99a0bf34e3466` | `—` | 2021-11-30_MonoSwap_SelfSwap_PriceManipulati | 0.88 | 0.29 | arbitrary-call, proxy-storage |
| REVIEW | 0.3367 | `0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb` | `—` | 2024-10-13_MorphoBlue_BundlerAccessControl_E | 0.00 | 0.58 | oracle-price-manipulation |
| REVIEW | 0.3255 | `0x35ac13efaab970f32269b61e4704f4377ce7a0ad` | `—` | 2021-11-30_MonoSwap_SelfSwap_PriceManipulati | 0.84 | 0.29 | arbitrary-call, proxy-storage |
| REVIEW | 0.25 | `0x09b0e3a114135f528f762db8363b4f5eae3f3bf1` | `—` | 2023-05-xx_LocalTrader_ProxyStorageSlotManip | 0.00 | 1.00 | arbitrary-call, proxy-storage |
| INFO | 0.2309 | `0xbee3211ab312a8d065c4fef0247448e17a8da000` | `—` | 2023-05-xx_LocalTrader_ProxyStorageSlotManip | 0.00 | 0.90 | arbitrary-call, proxy-storage |
| INFO | 0.2008 | `0xaa6e91c82942aeae040303bf96c15a6dbcb82ca0` | `—` | 2023-05-xx_LocalTrader_ProxyStorageSlotManip | 0.00 | 0.75 | arbitrary-call, proxy-storage |
| INFO | 0.2 | `0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae` | `—` | 2022-03-20_LiFi_ArbitrarySwapCallExploit | 0.47 | 0.00 | arbitrary-call |
| INFO | 0.1812 | `0x0000000aa232009084bd71a5797d089aa4edfad4` | `—` | 2023-07-25_Platypus02_PriceManipulation | 0.00 | 0.66 | reentrancy, oracle-price-manipulation |
| INFO | 0.1682 | `0xa832f3ee8b624f6db0152f1f67c5ff70b4b7f598` | `—` | 2025-07-22_MulticallWithETH_ValueForwarding | 0.00 | 0.59 | arbitrary-call |
| INFO | 0.1682 | `0x2ec368daa950212748eeb59c11defc591e95f274` | `—` | 2025-07-22_MulticallWithETH_ValueForwarding | 0.00 | 0.59 | arbitrary-call |
| INFO | 0.1641 | `0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc` | `—` | 2022-08_Circle_MakerCDP_FlashLoan | 0.00 | 0.82 | oracle-price-manipulation |
| INFO | 0.1432 | `0x941ddc62f8699f448e86c798e62520550616503d` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | arbitrary-call, oracle-price-manipulation |
| INFO | 0.1414 | `0x8f10b468b06c6fd214b65f87778827f7d113f996` | `—` | 2024-08-29_Unverified667d_AccessControl | 0.00 | 0.71 | reentrancy, arbitrary-call, oracle-price-manipulation |
| INFO | 0.1377 | `0xe2fe44cef3024ec08e375075429f8199d6b3e294` | `—` | 2024-09-06_Unverified03f9_SwapCallback | 0.00 | 0.69 | — |
| INFO | 0.1377 | `0x4645e287ba6057f8dde942b3f640803e7728e5a9` | `—` | 2024-09-06_Unverified03f9_SwapCallback | 0.00 | 0.69 | — |
| INFO | 0.1364 | `0x52aa899454998be5b000ad077a46bbe360f4e497` | `—` | 2022-12_FPR_SetAdminAccessControl | 0.00 | 0.68 | arbitrary-call, proxy-storage |
| INFO | 0.1342 | `0xc839b7f1c4fc093afd03e235c341dd7ece5863cf` | `—` | 2022-11_MooCAKECTX_HarvestFlashLoanManipulat | 0.00 | 0.67 | oracle-price-manipulation |
| INFO | 0.1293 | `0x0000a26b00c1f0df003000390027140000faa719` | `—` | 2024-03-XX_SSS_TransferLimitBypass | 0.00 | 0.65 | arbitrary-call |
| INFO | 0.1272 | `0xb9f29969e5ab22deec107129064b5fd56e6b9367` | `—` | 2024-05-XX_TSURU_OnERC1155ReceivedUnauthoriz | 0.00 | 0.58 | reentrancy, oracle-price-manipulation |
| INFO | 0.1272 | `0x3c2c5f8326e9547009122147690b2aacd4003f39` | `—` | 2024-05-XX_TSURU_OnERC1155ReceivedUnauthoriz | 0.00 | 0.58 | reentrancy, oracle-price-manipulation |
| INFO | 0.1269 | `0x86165beb9253bf144c4cd9d17c03324c611b39b2` | `—` | 2024-03-20_ParaSwap_AccessControl_Multichain | 0.00 | 0.38 | arbitrary-call, oracle-price-manipulation |
| INFO | 0.125 | `0x3fb9ceb77c36f946fe40553dc1f1bcc5c8b9ad49` | `—` | 2024-03-20_ParaSwap_AccessControl_Multichain | 0.00 | 0.38 | arbitrary-call, oracle-price-manipulation |
| INFO | 0.1182 | `0x7e0f27b24bcd527ffac4d61fee9de00b29352d45` | `—` | 2025-07-22_MulticallWithETH_ValueForwarding | 0.00 | 0.59 | oracle-price-manipulation |
| INFO | 0.1182 | `0xe6eeda550918638529c6cf2ea14f9ea0572d6f88` | `—` | 2025-07-22_MulticallWithETH_ValueForwarding | 0.00 | 0.59 | oracle-price-manipulation |
| INFO | 0.1156 | `0xc0a7d0a6915a35d0b9a5e5b9edc4ae67ede7ab7d` | `—` | 2024-09-06_Unverified03f9_SwapCallback | 0.00 | 0.58 | oracle-price-manipulation |
| INFO | 0.1066 | `0xbdb3ba9ffe392549e1f8658dd2630c141fdf47b6` | `—` | 2024-03-20_ParaSwap_AccessControl_Multichain | 0.00 | 0.28 | reentrancy, arbitrary-call, oracle-price-manipulation |
| INFO | 0.1022 | `0x529863940bf6065d8c122a550c2ff37c1cfefa16` | `—` | 2026-04-05_Denaria_BusinessLogic_Linea | 0.00 | 0.51 | — |
| INFO | 0.0993 | `0xe92af59d00becd5f70d2ba11ae1a74751503a185` | `—` | 2024-03-05_WOOFi_sPMMOracleManipulation_ARB | 0.00 | 0.25 | oracle-price-manipulation |
| INFO | 0.098 | `0xfd617dbf2b4d56e8e733b5a701b17ca2bd615b39` | `—` | 2024-06-XX_JokInTheBox_UnstakeIndexZeroRepea | 0.00 | 0.49 | — |
| INFO | 0.0932 | `0x99950bae3d0b79b8bee86a8a208ae1b087b9dcb0` | `—` | 2023-12-20_TransitFinance_UntrustedInput_BSC | 0.00 | 0.47 | oracle-price-manipulation |

## Evidence (top 5)

### `0x7f50786a0b15723d741727882ee99a0bf34e3466` — REVIEW (0.338)

- bytecode opcode-5gram Jaccard ≈ 0.88 vs a known-vulnerable deployment
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- rule proxy-storage (bytecode): EIP-1967 implementation slot + DELEGATECALL (proxy layout)
- → `2021-11-30_MonoSwap_SelfSwap_PriceManipulation` (MonoSwap (MonoX), 2021-11-30) score 0.338: bc=0.88 sel=0.29 src=0.00
- → `2022-06-08_Snood_TransferFromSyncDrain` (Snood Token (SNOOD), 2022-06-08) score 0.330: bc=0.88 sel=0.00 src=0.00
- → `2022-01-27_Qubit_DepositZeroAddressWhitelist` (Qubit Finance, 2022-01-27) score 0.280: bc=0.88 sel=0.00 src=0.00

### `0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb` — REVIEW (0.3367)

- IDF-weighted selector cosine > 0.30
- rule oracle-price-manipulation (bytecode): spot reserve/balanceOf read combined with an external call
- creator/address is an exact IOC from the incident database
- → `2024-10-13_MorphoBlue_BundlerAccessControl_ETH` (Morpho Blue Bundler, 2024-10-13) score 0.337: bc=0.00 sel=0.58 src=0.00
- → `2024-06-13_UwuLend_Second_OraclePriceManipulation` (UwU Lend #2, 2024-06-13) score 0.076: bc=0.00 sel=0.13 src=0.00
- → `2026-03-17_dTRINITY_PrecisionLoss_ETH` (dTRINITY (dLEND), 2026-03-17) score 0.028: bc=0.00 sel=0.14 src=0.00

### `0x35ac13efaab970f32269b61e4704f4377ce7a0ad` — REVIEW (0.3255)

- bytecode opcode-5gram Jaccard ≈ 0.84 vs a known-vulnerable deployment
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- rule proxy-storage (bytecode): EIP-1967 implementation slot + DELEGATECALL (proxy layout)
- → `2021-11-30_MonoSwap_SelfSwap_PriceManipulation` (MonoSwap (MonoX), 2021-11-30) score 0.325: bc=0.84 sel=0.29 src=0.00
- → `2022-06-08_Snood_TransferFromSyncDrain` (Snood Token (SNOOD), 2022-06-08) score 0.318: bc=0.84 sel=0.00 src=0.00
- → `2022-01-27_Qubit_DepositZeroAddressWhitelist` (Qubit Finance, 2022-01-27) score 0.268: bc=0.84 sel=0.00 src=0.00

### `0x09b0e3a114135f528f762db8363b4f5eae3f3bf1` — REVIEW (0.25)

- IDF-weighted selector cosine > 0.30
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- rule proxy-storage (bytecode): EIP-1967 implementation slot + DELEGATECALL (proxy layout)
- → `2023-05-xx_LocalTrader_ProxyStorageSlotManipulation` (, ) score 0.250: bc=0.00 sel=1.00 src=0.00
- → `2021-11-30_MonoSwap_SelfSwap_PriceManipulation` (MonoSwap (MonoX), 2021-11-30) score 0.180: bc=0.38 sel=0.29 src=0.00
- → `2024-09-17_MARA_EncodedCallExploit` (MARA, 2024-09-17) score 0.180: bc=0.00 sel=0.65 src=0.00

### `0xbee3211ab312a8d065c4fef0247448e17a8da000` — INFO (0.2309)

- IDF-weighted selector cosine > 0.30
- rule arbitrary-call (bytecode): DELEGATECALL combined with caller-supplied calldata
- rule proxy-storage (bytecode): EIP-1967 implementation slot + DELEGATECALL (proxy layout)
- → `2023-05-xx_LocalTrader_ProxyStorageSlotManipulation` (, ) score 0.231: bc=0.00 sel=0.90 src=0.00
- → `2024-09-17_MARA_EncodedCallExploit` (MARA, 2024-09-17) score 0.168: bc=0.00 sel=0.59 src=0.00
- → `2023-05-xx_LFI_DelegatecallRewardLoop` (, ) score 0.164: bc=0.00 sel=0.57 src=0.00

---

_Ranked similarity to known incidents. Not a vulnerability proof._

Artifacts: `vulnchain/data/corpus.json`, `vulnchain/data/vulnerableBytecode.json`, `vulnchain/data/scan_result.json`.
