# BugChain integration — triage report

Generated 2026-11-05T06:02:58.236368+00:00. Read-only: RPC discovery + local incident database.

**Đây là xếp hạng để đọc tiếp, không phải kết luận có lỗ hổng.** Selector trùng ≠ bug (mọi ERC20 đều có `transfer(address,uint256)`).

| Metric | Value |
|---|---|
| incidentCount | `821` |
| derivedSelectors | `2234` |
| genericSelectorsDropped | `7` |
| genericCutoff | `82` |
| newContractsScanned | `0` |
| indexerMode | `"creation"` |
| blockRange | `[26346684, 26346703]` |
| verdictCounts | `{}` |
| identicalBytecodeClusters | `0` |
| indexerErrors | `2` |
| indexerStats | `{"blocksScanned": 20, "txSeen": 5775, "hashOnlyTx": 0, "creationTxSeen": 2, "receiptMissing": 0}` |

## Findings (top 30)

| Verdict | Score | Address | Block | Creator | Selector hits | Identical code |
|---|---|---|---|---|---|---|

_No contracts in range._

## Known-actor hits (exact IOC match)

_None._

## Selector hits (non-generic)

_None._

---

_Heuristic triage. Selector overlap is NOT a vulnerability. No exploit, no tx, no claim of drainable value._

Artifacts: `bugchain/data/incident_db.json`, `bugchain/data/incident_signatures.json`, `bugchain/data/new_contracts.json`, `bugchain/data/bugchain_findings.json`.
