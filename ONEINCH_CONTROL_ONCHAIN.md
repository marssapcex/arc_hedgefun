# 1inch wave3-drain — CONTROL experiment (doc tu chain)

Generated 2026-11-06T15:10:00.369623+00:00 · `https://ethereum-rpc.publicnode.com` · head **26356614**. Read-only, khong key/tx/fork.

## A) Co phai dang doc default cua contract khong?

**Control passed: True**. Real question_ids differ from fabricated ones: getters are reading real storage, not a fallback/default.

| question_id | exists | isFinalized | resultFor | contentHash | getBond(ETH) |
|---|---|---|---|---|---|
| real/wave3-drain | True | True | 0 | 0xe24db667f0d1… | 0.8 |
| real/wave5-accumulation-001 | True | True | 0 | 0x9373beffa93e… | 0.2 |
| control/all-zero | False | False | None | 0x000000000000… | None |
| control/all-ff | False | False | None | 0x000000000000… | None |
| control/keccak-fake | False | False | None | 0x000000000000… | None |

## B) Ket cuc

- `wave3-drain`: finalized = **True**, `resultFor` = **0** (0 = NO), finalizeTS = **2026-09-18T13:27:59+00:00**.
- `getBond` = **0.8 ETH**. Voi `minimumBond = 0,1 ETH` va  Reality.eth nhan doi bond moi lan dispute, day la dau vet cua **8 lan tra loi** (0,1 → 0,2 → 0,4 → 0,8).
- Log giai ma duoc: **0** `LogNewAnswer`; bond = `[]`; answer = `[]`.
- `ExecutionSuccess` tu Safe trong cua so: **0**.

## C) Gioi han

- Mot public RPC endpoint, khong doi chieu archive node khac.
- `eth_getLogs` chi quet block 25964781..26050749 (tim bang binary search theo timestamp).
- `resultFor = 0` la **NO da finalize**. No KHONG tu dong nghia la 'khong co tx nao chay' — muon khang dinh phai doc nonce/threshold Safe va log ExecutionSuccess (da lam o tren).

