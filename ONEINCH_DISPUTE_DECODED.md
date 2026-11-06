# 1inch `wave3-drain` — giai ma tu chain (khong doc bao)

Nguon: `rpc_oneinch_raw.json` (head 26356594) + `rpc_oneinch_control_raw.json` (head 26356633), sinh 2026-11-06T15:13:47.374961+00:00 boi GitHub Actions tren `https://ethereum-rpc.publicnode.com`. **Read-only**: `eth_getCode`, `eth_call`, `eth_getLogs`, `eth_getBalance`, `eth_getBlockByNumber`. Khong key, khong tx, khong fork, khong web_search.

## Ket luan: **BI CHAN. NO thang. Khong co tx nao execute.**

Cau tra loi cho cai con bo ngo o cau truoc (`chua ro ket cuc`). Attacker dong bond YES, bi nguoi khac dong bond NO gap doi, lap lai 3 lan. Answer cuoi cung la **NO (0)**, da finalize luc **2026-09-18T13:27:59+00:00**. `RealityModuleETH.executeProposal` chi chay khi oracle tra YES — nen 5 batch tx an trong proposal **khong bao gio duoc goi**.

## Dung la doc storage that, khong phai fallback

Control experiment: goi cung 11 getter tren 3 `question_id` bia.

| question_id | exists | isFinalized | resultFor | getContentHash |
|---|---|---|---|---|
| real/wave3-drain | True | True | 0 | `0xe24db667f0d16437…` |
| real/wave5-accumulation-001 | True | True | 0 | `0x9373beffa93eeb3d…` |
| control/all-zero | False | False | None | `0x0000000000000000…` |
| control/all-ff | False | False | None | `0x0000000000000000…` |
| control/keccak-fake | False | False | None | `0x0000000000000000…` |

3 id bia deu `exists=false`, `isFinalized=false`, `resultFor` revert. 2 id that tra ve storage khac nhau → ket luan khong phai gia tri mac dinh cua fallback contract.

## Timeline doc tu `eth_getLogs`

Cua so block 25964781..26050749 (tim bang binary search theo timestamp, khong hardcode).

| block | UTC | event | nguoi goi | answer | bond | tx |
|---|---|---|---|---|---|---|
| 25976609 | 2026-09-14T15:31:47+00:00 | `LogNewQuestion` | `module 0xa62d…f2e` | — | — | `0x4db430aa9f56…` |
| 25976609 | — | `LogFundAnswerBounty / min-bond set` | `—` | — | 0.1 ETH | `0x4db430aa9f56…` |
| 25976622 | 2026-09-14T15:34:23+00:00 | `LogNewAnswer` | `0x6f25cc4d6bd161e7f4514948af1ae1b8baff5ae1` | **YES (1)** | 0.1 ETH | `0x47a4c2f6c989…` |
| 25976649 | 2026-09-14T15:39:47+00:00 | `LogNewAnswer` | `0x934ec00e427bad5610ef6333f7bd3b228b827522` | **NO (0)** | 0.2 ETH | `0x300e36611eef…` |
| 25983114 | 2026-09-15T13:18:35+00:00 | `LogNewAnswer` | `0x6f25cc4d6bd161e7f4514948af1ae1b8baff5ae1` | **YES (1)** | 0.4 ETH | `0xf10f77ebebdd…` |
| 25983160 | 2026-09-15T13:27:59+00:00 | `LogNewAnswer` | `0xad53a8a9b4d154c612a65dfa2f531e08d49bf004` | **NO (0)** | 0.8 ETH | `0x12ba86d6e6c4…` |

Chuoi bond nhan doi dung luat Reality.eth (`minimumBond = 0,1 ETH`, moi lan dispute bond gap doi): **0,1 → 0,2 → 0,4 → 0,8 ETH** = 4 answer / 3 dispute. `getBond()` doc duoc hien tai = **0,8 ETH**, khop log cuoi.

- Question text on-chain: `wave3-drain␟4a755762e7e88ad984182a33115ca01cbf1049b5f5f6da358aa2f1b1dead3696`
- `getContentHash(wave3)` = `0xe24db667f0d1643789f035d43f4ef9b7b28210696b6321ff995e120d7d9ae99e`
- `getTimeout` = 259200s = 72h; finalizeTS = answer cuoi + 72h.
- `resultFor` = `0x0000000000000000000000000000000000000000000000000000000000000000` → NO; `isFinalized` = True.
- `wave5-accumulation-001`: bond 0.2 ETH, resultFor = `0x0000000000000000000000000000000000000000000000000000000000000000` (NO), finalize 2026-09-15T17:39:23+00:00. Cung bi chan.

## Trang thai Safe / module

- Safe `0x7951c7ef839e26F63DA87a42C9a87986507f1c07`: code 171 bytes, `isModuleEnabled(0xa62d…f2e)` = **True**, `isModuleEnabled(0xa745…bcf)` = **False**, nonce = 21, threshold = 7, ETH balance = 257.53058653389.
- Module: questionTimeout = 259200s, questionCooldown = 259200s, answerExpiration = 604800s, minimumBond = 0.1 ETH, oracle = `0x5b7dd1e86623548af054a4985f7fc8ccbb554e2c`, avatar = `0x7951c7ef839e26f63da87a42c9a87986507f1c07`.
- `ProposalExecuted` logs: **0**. `ExecutionSuccess` tu Safe: **0** (control run: 0).

Module **van con enabled** den hom nay. Cai chan khong phai la `removeModule` hay guardian go bo module — la chinh ket qua **NO** cua Reality.eth oracle. Day la diem khac voi cach tuong thuat trong bai blog (noi ve 1IP-XX / Security Council 7-of-12 nhu phanh chinh).

## Gioi han (doc ky keo tuong day la audit)

- Mot public RPC endpoint (`ethereum-rpc.publicnode.com`), khong doi chieu archive node thu hai.
- `eth_getLogs` chi quet block 25.964.781..26.050.749; khong quet toan bo lich su.
- Khong doc ERC-20 balance cua Safe, nen **khong xac nhan con so ~$4,76M** trong bai bao — do van la so cua nguon secondary, khong phai so tao do duoc.
- `resultFor = 0` khong tu dong bang 'khong co tx'; phai ket hop `isModuleEnabled`, nonce, va log `ExecutionSuccess` (da lam).
- Day la ket luan ve mot proposal cu thang 9/2026, **khong phai** nhan xet ve gia token, co hoi mua ban, hay loi khuyen dau tu.

Scripts: `scripts/rpc_oneinch_reality.py`, `scripts/rpc_oneinch_control.py`, `scripts/oneinch_decode.py`. Workflows: `.github/workflows/rpc-oneinch.yml`, `.github/workflows/rpc-oneinch-control.yml`.

