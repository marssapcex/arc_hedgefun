# BugChain integration — triage report

Generated 2026-11-05T06:12:20.257358+00:00. Read-only: RPC discovery + local incident database.

**Đây là xếp hạng để đọc tiếp, không phải kết luận có lỗ hổng.** Selector trùng ≠ bug (mọi ERC20 đều có `transfer(address,uint256)`).

| Metric | Value |
|---|---|
| incidentCount | `821` |
| derivedSelectors | `2234` |
| genericSelectorsDropped | `7` |
| genericCutoff | `82` |
| newContractsScanned | `11` |
| indexerMode | `"creation"` |
| blockRange | `[26346656, 26346715]` |
| verdictCounts | `{"REVIEW": 9, "INFO": 2}` |
| identicalBytecodeClusters | `0` |
| indexerErrors | `7` |
| indexerStats | `{"blocksScanned": 60, "txSeen": 16209, "hashOnlyTx": 0, "creationTxSeen": 18, "receiptMissing": 0}` |

## Findings (top 30)

| Verdict | Score | Address | Block | Creator | Selector hits | Identical code |
|---|---|---|---|---|---|---|
| REVIEW | 30 | `0x062a5dd04f1f4c5848a0c7ceb422cdef192c1402` | 26346681 | `0xd19b1367271c7f371aeaec790fa521eb71c67c50` | 7 | 1 |
| REVIEW | 20 | `0x87a7d0d096c3a761515a1dd7fb9e6f34ad8d1dce` | 26346682 | `0xb20aae0fe007519b7ce6f090a2ab8353b3da5d80` | 2 | 1 |
| REVIEW | 10 | `0xcd3dde21bbe447984ae6a9f5c6a57234efe0976e` | 26346656 | `0xfcfd2946b92747a41d283b8f586742bc465b5fcb` | 1 | 1 |
| REVIEW | 10 | `0xeadd919e5b3f3ba19865654bd67860219bf98599` | 26346657 | `0x8457ef5137e8dd7e5ee1a8a69e4a7efdd23c72ab` | 1 | 1 |
| REVIEW | 10 | `0xae2e109227e69f6bcb36529ff6f249a2347f706f` | 26346661 | `0x90ce9053b35e6432fa3e641709d3f010b7d442ff` | 1 | 1 |
| REVIEW | 10 | `0xf1a7b87b28bfe5a3fd5fc6426f0edd5c0d238024` | 26346663 | `0x8457ef5137e8dd7e5ee1a8a69e4a7efdd23c72ab` | 1 | 1 |
| REVIEW | 10 | `0xcda13db8f7d64b9690fd57210cda63afdc98c50f` | 26346685 | `0x8457ef5137e8dd7e5ee1a8a69e4a7efdd23c72ab` | 1 | 1 |
| REVIEW | 10 | `0x4151b39532fb1cc130cdbe6a5258cb223e05e991` | 26346705 | `0x8457ef5137e8dd7e5ee1a8a69e4a7efdd23c72ab` | 1 | 1 |
| REVIEW | 10 | `0x7931b843fe4531f19d6964262754d75f1d87747e` | 26346714 | `0x7c3b8d8e3bed9bfc4ccc03250ad14eabebe6336b` | 1 | 1 |
| INFO | 0 | `0x883debcb0391fdc0ed26209fd339aeaacc2d766a` | 26346669 | `0xd3fa1e7df965440b8717e05643edd34ba3bc1631` | 0 | 1 |
| INFO | 0 | `0x4fbb9f45d1c82b732c4e816c5737208179375a6f` | 26346673 | `0xd3fa1e7df965440b8717e05643edd34ba3bc1631` | 0 | 1 |

## Known-actor hits (exact IOC match)

_None._

## Selector hits (non-generic)

- `0x062a5dd04f1f4c5848a0c7ceb422cdef192c1402` `0x06fdde03` → name(), transfer_attention_tg_invmru_6e7aa58(bool,address,address) (incidents: 2022-07-25_LPC_FeeTokenSelfTransfer, 2023-10-18_MicDao_HelperContractArbitrage, 2024-04-XX_Z123_ConsecutiveSwapLiquidityBurn)
- `0x062a5dd04f1f4c5848a0c7ceb422cdef192c1402` `0x18160ddd` → totalSupply() (incidents: 2023-10-18_MicDao_HelperContractArbitrage, 2024-04-XX_Z123_ConsecutiveSwapLiquidityBurn, 2024-05-XX_SCROLL_UniversalRouterExecute)
- `0x062a5dd04f1f4c5848a0c7ceb422cdef192c1402` `0x23b872dd` → transferFrom(address,address,uint256) (incidents: 2020-11-12_Akropolis_ReentrancyDAI, 2021-05-21_JulSwap_FlashLoan_AddBNB_Manipulation, 2021-07-20_Levyathan_PrivateKeyLeak_MintOwnership)
- `0x062a5dd04f1f4c5848a0c7ceb422cdef192c1402` `0x313ce567` → decimals() (incidents: 2023-10-18_MicDao_HelperContractArbitrage, 2024-04-XX_HoppyFrogERC_V3FlashSwapCycle, 2024-04-XX_Z123_ConsecutiveSwapLiquidityBurn)
- `0x062a5dd04f1f4c5848a0c7ceb422cdef192c1402` `0x4e487b71` → Panic(uint256) (incidents: 2024-01-26_Freedom_FlashLoanPriceManipulation, 2024-04-XX_BigBangSwap_SellRewardTokenAccessControl, 2024-04-XX_OpenLeverage2_MarginTradeArbitraryDEX)
- `0x87a7d0d096c3a761515a1dd7fb9e6f34ad8d1dce` `0x01ffc9a7` → supportsInterface(bytes4) (incidents: 2023-09-12_uniclyNFT_Reentrancy, 2024-01-27_PeapodsFinance_FlashLoanBondAccumulation, 2024-09-11_WXETA_InitializeMintExploit)
- `0x87a7d0d096c3a761515a1dd7fb9e6f34ad8d1dce` `0x8da5cb5b` → owner() (incidents: 2021-12-21_Visor_Finance_DepositUnprotected, 2022-04-19_CFToken_PublicTransferDrain, 2023-05-xx_FAPEN_UnstakeWrongBalanceCheck)
- `0xcd3dde21bbe447984ae6a9f5c6a57234efe0976e` `0x4e487b71` → Panic(uint256) (incidents: 2024-01-26_Freedom_FlashLoanPriceManipulation, 2024-04-XX_BigBangSwap_SellRewardTokenAccessControl, 2024-04-XX_OpenLeverage2_MarginTradeArbitraryDEX)
- `0xeadd919e5b3f3ba19865654bd67860219bf98599` `0x4e487b71` → Panic(uint256) (incidents: 2024-01-26_Freedom_FlashLoanPriceManipulation, 2024-04-XX_BigBangSwap_SellRewardTokenAccessControl, 2024-04-XX_OpenLeverage2_MarginTradeArbitraryDEX)
- `0xae2e109227e69f6bcb36529ff6f249a2347f706f` `0x8da5cb5b` → owner() (incidents: 2021-12-21_Visor_Finance_DepositUnprotected, 2022-04-19_CFToken_PublicTransferDrain, 2023-05-xx_FAPEN_UnstakeWrongBalanceCheck)
- `0xf1a7b87b28bfe5a3fd5fc6426f0edd5c0d238024` `0x4e487b71` → Panic(uint256) (incidents: 2024-01-26_Freedom_FlashLoanPriceManipulation, 2024-04-XX_BigBangSwap_SellRewardTokenAccessControl, 2024-04-XX_OpenLeverage2_MarginTradeArbitraryDEX)
- `0xcda13db8f7d64b9690fd57210cda63afdc98c50f` `0x4e487b71` → Panic(uint256) (incidents: 2024-01-26_Freedom_FlashLoanPriceManipulation, 2024-04-XX_BigBangSwap_SellRewardTokenAccessControl, 2024-04-XX_OpenLeverage2_MarginTradeArbitraryDEX)
- `0x4151b39532fb1cc130cdbe6a5258cb223e05e991` `0x4e487b71` → Panic(uint256) (incidents: 2024-01-26_Freedom_FlashLoanPriceManipulation, 2024-04-XX_BigBangSwap_SellRewardTokenAccessControl, 2024-04-XX_OpenLeverage2_MarginTradeArbitraryDEX)
- `0x7931b843fe4531f19d6964262754d75f1d87747e` `0xfa461e33` → uniswapV3SwapCallback(int256,int256,bytes) (incidents: 2023-04-09_SushiSwap_RouteProcessor_ETH, 2024-03-20_ParaSwap_AccessControl_Multichain, 2024-05-XX_TSURU_OnERC1155ReceivedUnauthorized)

---

_Heuristic triage. Selector overlap is NOT a vulnerability. No exploit, no tx, no claim of drainable value._

Artifacts: `bugchain/data/incident_db.json`, `bugchain/data/incident_signatures.json`, `bugchain/data/new_contracts.json`, `bugchain/data/bugchain_findings.json`.
