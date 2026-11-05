# VulnChain — function-level labels

Generated 2026-11-05T07:17:47.484Z · chain `ethereum` · mode `hybrid` · blocks 26347036–26347075

**Nhãn = hàm của contract này giống hàm lỗi trong 821 vụ đã biết. Không phải kết luận có lỗ hổng.**

| Metric | Value |
|---|---|
| incidentCount | `821` |
| vulnerableFunctionCount | `2485` |
| contractsScanned | `60` |
| functionsExamined | `1123` |
| labelledContracts | `1` |
| labelsByCategory | `{"oracle-price-manipulation":1}` |
| logsSeen | `23998` |
| sourcifyHits | `0` |
| errors | `0` |
| bandKeys | `35355` |
| selectorKeys | `1156` |

## Labelled contracts

| Address | Functions | Labels | Top confidence | Creator |
|---|---|---|---|---|
| `0x0000000aa232009084bd71a5797d089aa4edfad4` | 23 | oracle-price-manipulation(0.5824) | 0.5824 | `—` |

## Evidence (top 10 matched functions)

- `0x0000000aa232009084bd71a5797d089aa4edfad4` · `0xf3fef3a3` **withdraw(address,uint256)** → `2023-07-25_Platypus02_PriceManipulation` (—) · score 0.5824 (feature 0.739, body 0.18, selector =) · labels oracle-price-manipulation
  - features: externalCall, staticcall, stateWrite, stateRead, callerCheck, loop, math, division, timestamp, create, revert

---

_Function-shape similarity labels. Not a vulnerability proof._

Artifacts: `vulnchain/data/corpus.json`, `vulnchain/data/scan_result.json`.
