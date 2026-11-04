# JaredFromSubway (20/06/2026) — kiểm lại bản dán

**Vụ này có thật.** Khác với mấy lần trước, bản dán lần này đúng gần hết. Tao vẫn đọc trực tiếp block trên RPC thay vì chỉ dẫn báo: `scripts/rpc_jared.py` chạy trên CI, `eth_getBlockByNumber` / `eth_getTransactionByHash` / `eth_getTransactionReceipt` / `eth_getCode`, không tx, không fork, không key.

Kết quả trong `JARED_ONCHAIN.md` / `rpc_jared_raw.json`:

- Block **25,360,696** = `2026-06-20T18:49:11Z`. Đúng cả số block lẫn giờ.
- Sweep tx `0x2be8704f5a59b69e0b71f64aefdb99eb0e8ae9fb3926147c581910d71bcf3e65` → coordinator `0xb84db016324e8f2bfdd8dd9c260338aee0a8df52`, selector `0xc269a509`, `status=0x1`, gas `1,378,524`, kèm `0.01 ETH` tip cho `block.coinbase`.
- Receipt có đúng **50** log `Transfer`, tất cả `from` = bot `0x1f2f10d1…f387`, tất cả `to` = `0x3e37f4a1…65d0`:

| Token | Số leg | Mỗi leg | Tổng |
|---|---|---|---|
| WETH | **16** | 92.16140768781219 | **1,474.582523** |
| USDC | **20** | 143,528.656384 | **2,870,573.127680** |
| USDT | **14** | 149,488.051712 | **2,035,760.155871** |

- Coordinator vẫn còn **2,537 byte code** (không self-destruct).
- Bounty: block **25,370,085** = `2026-06-22T02:15:35Z`, tx `0x3d30d74d…4ab3`, `value=0`, từ operator `0xae2fc483…ae13`. Input data decode ra đúng câu: *"Well played. We are willing to offer a 50% white hat bounty if you return 2150 ETH … in the next 48 hours …"*.

Nguồn đối chiếu: [The Block](https://www.theblock.co/news/ecosystems/2026-06-21-notorious-jaredfromsubway-mev-bot-drained-for-roughly-7-5-million-in-counter-mev-honeypot-405464), [CoinDesk](https://www.coindesk.com/tech/2026/06/21/ethereum-s-biggest-sandwich-bot-drained-of-usd7-5-million-in-ironic-exploit), [Blockaid post-mortem](https://blockaid.io/blog/the-predator-becomes-the-prey-how-a-counter-mev-honeypot-drained-75m-from-jaredfromsubway), [ivan2kh on-chain anatomy](https://ivan2kh.com/posts/jaredfromsubway-honeypot/), [SigIntZero](https://sigintzero.com/blog/jaredfromsubway-mev-bot-honeypot-7-5m), [AuditAid](https://www.auditaid.io/blog/jaredfromsubway-dangling-approvals).

## 7 chỗ cần sửa / thêm cho chính xác

**1. "Chuẩn bị kéo dài vài tuần" — báo chí nói vậy, chain thì nói ~13 ngày.**
Forensic đọc trực tiếp state: root account nhận `19.898 ETH` ngày 07/06, factory deploy cùng ngày, một coordinator **diễn tập** được arm ngày 08/06 nhưng không bao giờ drain. Bộ **66 token + coordinator thật được dựng trong một tối 19/06, 15:32–22:08 UTC**. Ngày 20/06: 11 lần `armRound()` từ 17:55–18:47, drain lúc 18:49. Bait diễn ra trên **97 block**, không phải bot trade tin tưởng suốt vài tuần. "Vài tuần" là ước lượng của Blockaid/CoinDesk; timeline on-chain ngắn hơn.

**2. "Coordinator gọi đồng loạt 66 contract, mỗi contract rút" — 66 gọi, 50 rút.**
Receipt tao đếm được 50 log, không phải 66. Cơ cấu: 16 allowance WETH + 20 USDC + 14 USDT = **50 allowance còn sống**; **16 child còn lại inert** (`allowance = 0` → `withdraw()` no-op). Con số 66 là số contract deploy, không phải số lần rút. Bản dán gom hai số này lại làm một.

**3. "Toàn bộ WETH/USDC/USDT trong bot" — quá đà.**
Không phải sweep balance, mà là **50 lần `transferFrom` theo đúng allowance còn mở**, mỗi loại một số tiền cố định lặp đi lặp lại (92.1614… / 143,528.656384 / 149,488.051712). Tiền nào nằm ngoài 50 allowance đó không bị đụng.

**4. "Không phải bug smart contract" — đúng, nhưng dễ hiểu nhầm thành "không có mã độc".**
Không có lỗi trong WETH, Uniswap, hay contract của bot. Nhưng phía attacker **có backdoor thiết kế sẵn**: child `withdraw(victim)` (selector `0x51cff8d9`) đọc `realToken.allowance(victim, address(this))` rồi `transferFrom(victim, owner, amt)`; coordinator `drain()` **không có access control**, payout đóng cứng trong storage nên một EOA ném đi (`0x5af3…36e1`) cũng gọi được. Fake token là fork `CoreRef` của Fei + `TransferHelper` của Uniswap — trông như code đã audit để qua mặt check của bot. Nói đúng phải là: **mã độc nằm ở counterparty giả, không phải lỗ hổng ở nạn nhân**.

**5. "Flag trạng thái theo block" — đúng, nhưng là đúng 1 block duy nhất.**
`getStatus()` không phải boolean lưu trong storage, mà là `block.number == armedBlock`. `armRound()` (`0xb6e808af`) ghi block hiện tại và tip `block.coinbase` ~0.025 ETH để cái arm và cái bait nằm **cùng block**. 11 lần arm = 11 block. Ở block armed, `wrapTo()` `_mint` fake-WETH, gọi `setBorrowAmount()` rồi **bỏ qua** `transferFrom` — allowance còn nguyên; ở block unarmed thì `transferFrom` thật ăn allowance. Bot ở chế độ armed **không mất WETH thật**, chỉ nhận dust `0.001119 WETH` và nhường quyền. Nên câu "bot nhận lời thật rồi tin tưởng" là đơn giản hóa: lời danh nghĩa có, nhưng phần 92.16 WETH nó tưởng đã di chuyển là token giả tự mint rồi tự burn.

**6. "$15M do operator claim" — cần tách làm hai chuyện.**
Bản dán xử đúng (chọn $7.5M), nhưng nguồn của $15M không phải on-chain: nó từ tài khoản X `@jaredsmev` mà [The Block không xác minh được](https://www.theblock.co/news/ecosystems/2026-06-21-notorious-jaredfromsubway-mev-bot-drained-for-roughly-7-5-million-in-counter-mev-honeypot-405464) liên quan tới operator (đổi username 8 lần, từng shill token), operator vốn khẳng định không có social công khai. **Message on-chain thì có thật** — và nó tự phản chứng $15M: đòi trả `2,150 ETH` mà gọi là "50%", tức ~$3.7M ≈ nửa của $7.5M (ETH ~$1,750 lúc đó), không phải nửa của $15M. Thêm chi tiết nhỏ: bounty tx gửi tới **executor `0x5af3…36e1`**, không phải ví nhận tiền `0x3e37…65d0`.

**7. Cái kết luận "approve đúng số tiền / revoke là đủ" — SAI, và đây là chỗ đáng nhất.**
Bot **đã** approve đúng số lượng, chính xác tới 18 chữ số thập phân: `92.161407687812186112 WETH`. Không phải infinite approve. Nó vẫn bị rút. Lỗi không nằm ở *bao nhiêu*, mà ở *approval còn sống sau khi trade đã settle*. Cái cần là reconcile allowance về 0 **trong cùng transaction**, dùng `permit` / approve-exact-then-zero, và **vet cái spender chứ không chỉ vet cái giá**. Một pool cân bằng + simulation ra lãi nói không lên điều gì về việc spender có giữ allowance lại hay không. Phần lớn bài báo rút ra bài học "approve exact amount" là lặp lại chính cái giả định đã giết bot.

## Chi tiết khác bản dán bỏ qua

- **Laundering**: stablecoin swap qua **CoW Protocol Settlement** ra ~`4,427 ETH` (~$7.7M), **1,000 ETH** vào Tornado Cash, một phần hướng sang DAI để tránh freeze. Tornado Cash đã bị OFAC gỡ khỏi SDN từ 03/2025 — đừng gọi là "sanctioned mixer" nữa.
- **EIP-7702**: account điều khiển là EIP-7702-delegated (MetaMask smart account), nhưng chỉ để batch mấy lệnh deploy/config. **Không phải vector tấn công**; bot là contract nên không thể là nạn nhân 7702. Atomicity đến từ vòng lặp coordinator, không phải 7702.
- **Vì sao một tx**: 16 lần rút rải rác sẽ cho risk logic của bot cửa sổ revoke. Một tx xóa cửa sổ đó.
- **Quy mô nạn nhân** (để câu "threesome" có số): EigenPhi đo 27/02–08/05/2023 — `$40.65M` gross, `$34.35M` gas, net `~$6.3M`, `238,000` sandwich, `>106,000` victim. Khoảng 11/2024–10/2025 bot chiếm ~**70%** sandwich attack trên Ethereum, 60k–90k vụ/tháng, thiệt hại ~`$60M`/năm cho trader. Tháng 05/2026 nó còn front-run chính swap vài đô của Vitalik bằng `$1.14M` WETH.

## Đứng ở đâu so với mấy bài trước

Đây là **exploit có thật, tiền thật, một tx rút sạch** — không phải address synthetic kiểu Alephium, cũng không phải "số đúng nhãn sai" kiểu Opyn. Nhưng nó vẫn **không phải bug permissionless trong một protocol**: attacker không có quyền admin, không lộ key, không phá được WETH/Uniswap; nó cần **chính nạn nhân tự ký allowance**, lặp 50 lần. Điều kiện đó là giả định hành vi, không phải lỗ hổng ai cũng gọi được.

`0 bug không cần quyền, 0 đô` vẫn đứng cho đống target mình quét trong repo này (governance / zombie / Opyn). Vụ Jared nằm ngoài phạm vi đó: một bài học về approval hygiene của autonomous agent, không phải mục tiêu trong danh sách, và tao không dựng PoC/fork hay tx nào từ nó.
