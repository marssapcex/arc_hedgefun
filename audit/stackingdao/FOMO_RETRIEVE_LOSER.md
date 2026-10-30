# StackingDAO — lỗ hổng rút quỹ FOMO (`retrieve-loser`)

Repo: https://github.com/StackingDAO/contracts (clone `--depth 1`)
File lỗi: `contracts/nakamoto/fomo.clar` — hàm `retrieve-loser`
Mức: **Critical theo nghĩa mất tiền thật** (ai cũng rút được, không cần sở hữu gì), phạm vi thiệt hại = quỹ của một ván FOMO.
Trạng thái: **PoC chạy xanh**, tái lập từ clone sạch trong ~11 giây.

---

## 1. Lỗi là gì

```clarity
(define-public (retrieve-loser (nft-id uint))
  (let (
    (ststx-balance (var-get total-treasure))
    (amount (/ (* ststx-balance u2500) u10000))     ;; 25% quỹ
    (loser tx-sender)
    (avg (/ amount (- (var-get nft-amount) u1)))
  )
    (asserts! (has-game-ended) (err ERR_GAME_NOT_ENDED))
    (try! (as-contract (contract-call? .ststx-token transfer avg tx-sender loser none)))
    (try! (contract-call? .stacking-dao-fomo-nft burn-for-protocol nft-id))
    (ok avg)
  )
)
```

Ba thứ bị thiếu, và chúng cộng lại thành lỗ hổng:

1. **Không kiểm `nft-id` thuộc về `tx-sender`.** `burn-for-protocol` chỉ kiểm `contract-caller` là protocol (nó là chính contract `fomo`), nên nó đốt được NFT của **bất kỳ ai**.
2. **Không có cờ "id này đã trả thưởng".** Mỗi lần gọi chỉ đốt một NFT, nên số lần gọi = số NFT đang tồn tại.
3. **Mẫu số là `nft-amount - 1` nhưng trả được `nft-amount` lần.** `-1` giả định NFT của người thắng không phải "loser"; nhưng vì (1) không có kiểm tra chủ sở hữu, kẻ tấn công đốt luôn NFT của người thắng và ăn thêm một suất.

Hệ quả: kẻ không mua claim nào, sau khi ván kết thúc (24h không ai claim), gọi `retrieve-loser(id)` cho **mọi** id tồn tại và nhận `N/(N-1) × 25%` quỹ — tức **hơn** phần 25% dành cho người chơi, trong khi đó NFT của họ bị đốt sạch và người thắng không còn đủ tiền nhận 70%.

Tỷ lệ over-drain: `N/(N-1)`. Tổng phải trả = `70% + 25%·N/(N-1)` > 100% với mọi N ≥ 2 ⇒ **khoản 70% luôn thiếu**.

## 2. PoC — số đo thật

`audit/stackingdao/fomo_poc_test.ts`, chạy trên Clarinet simnet (không cần mạng):

```
treasure          3600000      (3.6 stSTX, 3 claim: 1.1 + 1.2 + 1.3)
loser pool (25%)  900000
per call          450000
attacker received 1350000      <-- gấp 1.5 lần quỹ loser (N/(N-1) = 3/2)
attacker stSTX    1350000      <-- ví attacker bắt đầu từ 0, không mua claim nào
fomo stSTX before 3600000
fomo stSTX after  2250000
retrieve-winner   (err u1)     <-- người thắng gọi retrieve-winner thì FAIL
short by          270000       (thiếu 0.27 stSTX so với mức 70% = 2.52)
```

Test khẳng định 4 điều:

1. attacker (wallet_8, chưa từng `buy-claim`) nhận `1 350 000` µstSTX;
2. `1 350 000 > 900 000` = quỹ 25% ⇒ rút quá phần được chia;
3. `get-owner` của cả 3 NFT trả `none` — NFT của 3 người chơi, **kể cả NFT của người thắng**, bị đốt bởi người không sở hữu;
4. `retrieve-winner` của người thắng trả `(err u1)` (transfer thất bại vì contract chỉ còn 2.25 < 2.52).

## 2b. Attacker có thực sự kiếm được tiền không? **Có** — và không cần vốn

PoC thứ hai (`fomo_scale_test.ts`, N = 5 claim) chứng minh 3 điều:

```
paid in          6500000     (5 claim: 1.1 … 1.5 stSTX)
sweep result     (ok (list 406250 406250 406250 406250 406250))
attacker got     2031250     <- MỘT giao dịch, ví attacker = 0 stSTX lúc đầu, 0 claim
left in contract 4468750
winner prize     4550000     <- nhiều hơn số còn lại => người thắng không nhận được
```

- **Một tx duy nhất**: attacker deploy một contract 5 dòng, gọi `retrieve-loser(0..4)` trong cùng tx. Vì Clarity lấy `tx-sender` = người ký chứ không phải contract gọi, tiền về thẳng ví attacker, contract trung gian không giữ một xu.
- **Lời ròng**: bỏ ra 0, thu 2.03 stSTX = **31.25% toàn bộ quỹ** (trong khi quỹ "loser" chỉ 25%) — phần dư 6.25% lấy từ 70% của người thắng. Gas vài xu.
- **Không cần điều kiện về quyền**: không whitelist, không admin call, không cần sở hữu NFT, không cần vốn, không cần là người chơi. Ví mới tinh là đủ.
- **Tiền lấy từ đâu**: từ stSTX của chính những người đã mua claim, đang nằm trong contract `fomo`. Đây là trộm tiền người dùng, không phải "tự làm mình thiệt".

### Điều kiện duy nhất (và tại sao nó gần như luôn đúng)

1. Ván đã bắt đầu — admin gọi `start-game` một lần khi mở ván.
2. `has-game-ended` — 144 burn block (~24h) không ai claim. **Tự động**, không ai cần bấm.
3. Số dư thật của contract đủ lớn để trả phần đã phóng đại. Vì `total-treasure` mặc định 100 stSTX là tiền ảo (mục 3), điều kiện này thành: quỹ thật phải xấp xỉ

   `B ≥ 100·(N+1)/(3N−5)` stSTX  →  ~100 stSTX khi N=3, ~35 stSTX khi N lớn.

   Dưới ngưỡng đó `retrieve-loser` revert `(err u1)` và attacker **không lấy được gì** — PoC thứ hai chứng minh đúng nhánh này: quỹ thật 3.6 stSTX, `treasure` ghi 103.6 stSTX, lệnh gọi trả `(err u1)`, attacker nhận 0. Nhưng khi đó người thắng và người chơi cũng không rút được: ván hỏng sẵn.

Tóm lại: có điều kiện về **thời điểm** (ván đã đóng) và **độ lớn của quỹ**, nhưng không có điều kiện nào về **danh tính hay vốn**. Với một ván FOMO thật (quỹ hàng trăm stSTX, hàng chục đến hàng trăm claim) thì cả ba điều kiện đều thoả, và attacker lấy ~31% quỹ trong một tx.

## 3. Hai lỗi phụ cùng file

- **Quỹ khởi tạo 100 stSTX là tiền ảo.** `(define-data-var total-treasure uint u100000000)` nhưng contract không hề được nạp 100 stSTX. Lần chạy đầu tiên của tôi (giữ nguyên giá trị mặc định): `treasure = 103 600 000` trong khi số dư contract chỉ `3 600 000` ⇒ mọi lệnh trả thưởng đều revert `(err u1)` cho tới khi người chơi nạp vào > 100 stSTX. `retrieve-winner`/`retrieve-loser` tính trên một con số không có thật.
- **Chia cho 0 khi chỉ có 1 claim.** `avg = amount / (nft-amount - 1)`; nếu `nft-amount = 1` thì cả hàm revert, người thắng không có đường nhận thưởng.

## 4. Cách sửa

```clarity
(define-map claimed { nft-id: uint } bool)

(define-public (retrieve-loser (nft-id uint))
  (let (
    (owner (unwrap! (get-owner nft-id) (err ERR_GET_OWNER)))
    ...
  )
    (asserts! (has-game-ended) (err ERR_GAME_NOT_ENDED))
    (asserts! (is-eq owner tx-sender) (err ERR_NOT_OWNER))   ;; 1. chỉ chủ NFT
    (asserts! (not (default-to false (map-get? claimed { nft-id: nft-id }))) (err ERR_ALREADY_CLAIMED))
    (map-set claimed { nft-id: nft-id } true)                ;; 2. mỗi id một lần
    ;; 3. mẫu số phải là số loser thật, và tổng trả không vượt 25%
  )
)
```

Đúng ra nên giữ một biến `losers-remaining` giảm dần mỗi lần trả, và một biến `distributed` chặn tổng chi ≤ `amount`. Cách gọn nhất: ghi nợ theo từng NFT (`claim-value`) ngay lúc `buy-claim`, lúc trả chỉ đọc đúng con số đó.

## 5. Mức độ thực tế

- `fomo` nằm trong danh sách contract active của `dao.clar` (`(map-set contracts { address: .fomo } { active: true })`).
- Điều kiện duy nhất là `has-game-ended` (burn-height > last claim + 144). Sau khi ván đóng, kẻ tấn công chỉ cần gửi giao dịch trước những người chơi thật (hoặc gom nhiều lời gọi trong một contract) là lấy hết.
- Thiệt hại = toàn bộ quỹ của ván hiện tại; người thắng mất 70%, người chơi mất NFT và phần 25%.

## 6. Chạy lại

```bash
cd /home/user/arc_hedgefun
./audit/stackingdao/prepare.sh /tmp/sdao2      # clone + vá Clarinet cho offline, ~11s
cd /tmp/sdao2 && npx vitest run tests/poc/     # 3 test, tất cả xanh
```

`prepare.sh` làm đúng 3 việc với repo gốc, không đụng vào logic:

1. xoá 20 `[[project.requirements]]` (mainnet) — đây là thứ duy nhất khiến simnet gọi `api.hiro.so` (sandbox không gọi được);
2. đổi principal mainnet `'SP000...pox-4` → `.pox-4-mock` — nhánh `is-in-mainnet` không bao giờ chạy trong simnet nên hành vi không đổi;
3. bỏ các contract chỉ để đọc dữ liệu on-chain (`block-info-*`, `protocol-*`, job, swap) khỏi `Clarinet.toml`.

## 7. Những gì đã đọc và KHÔNG thấy lỗi (nói thẳng, chưa có PoC)

Đã đọc hết: `stacking-dao-core-v6`, `dao`, `ststx-token`, `data-core-v1/v2/v3`, `direct-helpers-v4`, `reserve-v1`, `rewards-v5`, `swap-ststx-ststxbtc-v2`, `ststxbtc-tracking-v2`, `ststxbtc-migration-v1`, `stacking-pool-payout-v1`, `staking-v1`, `fomo`, NFT contracts.

- Vòng `deposit → init-withdraw → withdraw`: cả hai phép chia đều floor, nghiêng về protocol; tỷ lệ `stx/ststx` bảo toàn qua swap và qua fee (fee rời reserve đúng bằng lượng ststx bị burn tương ứng).
- `swap stSTX ↔ stSTXbtc`: `X = total_stx - supply_btc_v1 - supply_btc_v2`, mint/burn đúng 1:1, round-trip lỗ ≤ 1 µunit.
- `direct-helpers-v4`: mọi nhánh `add/subtract/stop` đều cộng-trừ đồng thời `user`, `pool`, `total`; `stop-direct-stacking-user` chỉ cho user hạ phần của chính mình.
- `staking-v1`: thứ tự `claim → update total → update index` đúng, không có đường bơm `cumm-reward-per-stake` (hàm này public nhưng chỉ hiện thực hoá phần đã accrual).
- Chưa soi kỹ: `stacking-pool-v1`, `stacking-pool-signer-v1` (526 dòng), `strategy-v3/v4`, `native-stacking-pool-v1`, `commission-v2` — đây là chỗ tôi sẽ đào tiếp, và cũng là chỗ `stacking-pool-payout-v1::distribute-rewards` không có access control (mới đọc, chưa kết luận).

Báo cáo audit có sẵn trong `audits/` (ClarityAlliance 2024-11, 2025-01, 2025-06, CoinFabrik 2023-11) đã bỏ sót lỗi này — nó nằm ở contract game, ngoài phạm vi các lần review đó.
