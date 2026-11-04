# Bẫy counter-MEV ở mức trừu tượng — threat model, không phải công thức

Ghi chú thiết kế đối kháng cho agent tự trị trên chain. **Đây là tài liệu phòng thủ**: mỗi lớp bẫy đi kèm invariant bắt được nó. Không có địa chỉ, không có selector, không có calldata, không có Solidity deploy được, không có PoC, không có tx, không có nạn nhân cụ thể. Mục đích là xác định cái cần xây, không phải cái cần bấm.

---

## 0. Đánh giá lại cái bẫy ngày 20/06/2026

Nó không đơn giản là "bot approve rồi quên revoke". Nó đã dựng:

1. `getStatus() = block.number == armedBlock` — cờ đúng **một block**, arm + bait nằm cùng block nhờ tip `block.coinbase`.
2. Mint/burn token giả để phía incoming của trade vẫn cân bằng, dù `transferFrom` thật bị bỏ qua. Bot không mất WETH thật ở round armed, chỉ nhận dust.
3. 50 allowance sống với **số tiền cố định lặp lại** (16 × 92.1614… / 20 × 143.528,656384 / 14 × 149.488,051712).
4. Một coordinator tx gọi 66 child, atomic để xóa cửa sổ revoke.

Vậy nó đã là *adversarial reality* rồi, không phải lỗi approval thông thường.

**Điểm yếu thật sự: nó để lại dấu vết.** Đọc receipt là thấy ngay — 50 `Transfer` cùng `from`, cùng `to`, 3 số tiền lặp, gas `1.378.524`, một tx duy nhất, coordinator còn code. Bất kỳ monitor nào so sánh "allowance sau settle ≠ 0" cũng bắt được. Bẫy mạnh hơn phải là bẫy **không có event bất thường nào để đọc**.

---

## 1. Nguyên lý: đừng sửa quyền, sửa hàm quan sát

Bot tự trị tối ưu:

```
a* = argmax_a  U(o, a)      với o = observation (state, reserves, mempool, simulation result)
```

Bẫy loại thấp (Jared) tấn công **hậu quả của `a`**: để `a` để lại một allowance. Bẫy loại cao tấn công **`o`**: attacker tạo một tập `O'` các observation mà **mọi invariant on-chain đều pass** — pool cân bằng, code hợp lệ, profit dương, deadline còn, slippage trong ngưỡng — nhưng `argmax U(o)` lại là hành động có lợi cho attacker.

Không có bug để patch ở đây. Bot làm **đúng mọi thứ** theo thiết kế của nó và vẫn thua. Đây mới là định nghĩa "khó đoán hơn": không cần nạn nhân mắc lỗi.

> Hệ quả: mọi biện pháp "approve đúng số tiền", "revoke sau trade", "check code đã verify" đều vô hiệu, vì chúng kiểm tra **kết quả**, trong khi kẻ tấn công kiểm soát **đầu vào**.

---

## 2. Năm lớp bẫy, xếp theo độ khó đoán

### Lớp A — Ordering / state-consistency
Không cần token giả, không cần approval. Bot ký một hành động tối ưu ở trạng thái `S`; trong cùng block, một tx có priority cao hơn của attacker đổi `S → S'` **mà vẫn nằm trong mọi ngưỡng bot cho phép**. Bot không bị lừa ký cái sai — nó ký cái đúng cho một thế giới không còn tồn tại.

- Khó đoán vì: không có log độc hại, không có contract lạ, tx của bot vẫn `status=0x1`.
- Invariant bắt: **mọi quyết định phải ràng buộc vào một commitment của state, không phải vào state đọc được lúc simulate**. Nếu `U` phụ thuộc vào biến mà counterparty có thể ghi trong cùng block, từ chối route.

### Lớp B — Simulate/execute divergence
Hai kênh quan sát khác nhau trả hai phiên bản hợp lệ của cùng một block (RPC simulate vs broadcast, relay vs public mempool, view của builder vs view của searcher). Bot tối ưu trên bản A, thực thi trên bản B. Cả hai đều "đúng" theo từng nguồn.

- Khó đoán vì: log on-chain sạch; post-mortem không tìm được tx nào sai.
- Invariant bắt: **quorum nguồn quan sát độc lập**, và từ chối khi lợi nhuận biến mất dưới một nguồn duy nhất. Đừng có một node duy nhất làm cả simulator lẫn broadcaster.

### Lớp C — Slow drip / boiling frog
Bỏ hoàn toàn cú sweep. Bot **kiếm lời thật, đều, nhiều tuần**. Mỗi lần thắng, attacker dịch một tham số nhỏ theo hướng có lợi cho mình: tỷ lệ inventory, nguồn oracle được ưu tiên, gas cap, route whitelist, ngưỡng slippage. Không có thời điểm "bị tấn công" để alarm kêu.

- Khó đoán vì: mọi metric đều **tốt**. PnL dương, win rate cao, không có outlier. Monitor tìm anomaly sẽ không bao giờ bắn.
- Invariant bắt: **theo dõi drift của chính sách, không chỉ PnL**. Bất kỳ tham số nào thay đổi mà không có quyết định của operator → dừng. Đây là lý do "bot càng lãi càng nguy hiểm".

### Lớp D — Reflexive market
Attacker không bẫy một bot; attacker dựng một thị trường nơi **chính giao dịch của bot tạo ra tín hiệu xác nhận cho bot**. Bot mua → reserve dịch → mô hình của bot đọc đó là xác nhận → bot mua tiếp. Khi attacker rút lui, bot đã tự chuyển inventory sang tài sản do attacker kiểm soát, **với giá hoàn toàn hợp lý**.

- Khó đoán vì: không cần `transferFrom`, không cần allowance, không cần backdoor. Mọi transfer đều do bot tự ký, tự nguyện, có lãi trên giấy.
- Invariant bắt: **cấm tự-reference** — lợi nhuận không được tính từ price impact do chính volume của mình tạo ra trong cửa sổ quyết định.

### Lớp E — Weaponize phòng thủ (meta)
Đây là lớp tinh vi nhất. Sau vụ Jared, mọi bot sẽ học: *"zero allowance trong cùng tx"*. Attacker thiết kế route sao cho **chính cú zero-allowance là tín hiệu kích hoạt**: bot revoke đúng lúc → một leg phụ thuộc fail → bot retry → lộ inventory/route/gas policy; hoặc revoke làm mất quyền mà bot cần ở leg tiếp theo, buộc nó approve lại cho một spender mới do attacker chuẩn bị sẵn.

- Khó đoán vì: **biện pháp phòng thủ được khen trong mọi post-mortem chính là lối vào**. Bot càng tuân thủ best practice càng dễ bị dẫn.
- Invariant bắt: **phòng thủ không được có tác dụng phụ quan sát được**. Zero-allowance phải là nội bộ, idempotent, không retry, không fallback spender, không log ra ngoài. Nếu một biện pháp an toàn thay đổi hành vi tiếp theo của bot, nó là một bề mặt tấn công.

---

## 3. Cái thật sự mạnh hơn

Thằng kia cần bot **sai một lần** (để allowance sống). Bẫy cao hơn cần bot **đúng mọi lần** và vẫn thua, vì `U` được tối ưu trên `o` mà attacker viết được. Không có "lỗi" để sửa, chỉ có một giả định chưa được nêu ra: *observation đáng tin*.

Vậy câu trả lời cho "mạnh hơn, thông minh hơn" không phải thêm một lớp calldata tinh vi. Là chuyển trục:

| | Bẫy Jared | Bẫy lớp cao |
|---|---|---|
| Tấn công | hậu quả của hành động | hàm quan sát |
| Cần nạn nhân sai? | có | **không** |
| Dấu vết | 50 log lặp, 1 tx gas cao | **không có** |
| Bắt bằng | so allowance sau settle | **nguồn quan sát độc lập + chống tự-reference** |
| Patch | revoke / permit | **kiến trúc quyết định** |

---

## 4. Kết luận đứng ở phía xây

Cái đáng xây không phải cái bẫy. Là 4 invariant:

1. Không tối ưu trên state mà counterparty có thể ghi lại trong cùng block.
2. Không dùng một nguồn quan sát duy nhất cho cả simulate lẫn broadcast.
3. Giám sát **drift của chính sách**, không chỉ PnL / win rate.
4. Mọi biện pháp phòng thủ phải idempotent, không tác dụng phụ, không fallback.

Và một câu chốt: **bẫy nguy hiểm nhất không nằm ở allowance, nằm ở chỗ agent tin vào simulation của chính nó.**

---

Không PoC, không fork, không code deploy, không target, không lấy tiền ai. `0 bug không cần quyền, 0 đô` vẫn đứng cho đống target đã quét trong repo này. File này là threat model để xây invariant, không phải hướng dẫn dựng bẫy.
