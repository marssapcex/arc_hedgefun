# SETTLED — Đừng tin số liệu. Đối chiếu biên lai.

**Zero dependency · zero API key · zero tx · zero vốn.** Chạy bằng `node`, không `npm install`.

---

## Vấn đề

Mọi dashboard trên thị trường đều báo **một lớp số**: volume, TVL, số transaction, "AI agents".
Lớp đó và tiền thật là hai chuyện khác nhau:

| Báo cáo | Tiền thật |
|---|---|
| DefiLlama `currentChainTvls.Moonriver = 0` | 8 contract vẫn giữ số dư khác 0 tại block `17.381.654` |
| Kalshi **$19,03B** weekly contract volume | **$4,42B** execution-price USD |
| x402 **138,5 triệu** transactions | **$52,7M** settlement, ~$0,38/tx |
| DEX **$11,68B** volume/24h | **$78,15M** fees/24h ≈ **66,89 bps** |

SETTLED không đoán lớp nào đúng. Nó **đặt hai biên lai cạnh nhau**, gắn file/method/block đã đọc, và đẩy chỗ khác nhau vào `disagreements`. Không có điểm số, không có nhãn, không có "VULNERABLE".

> Đây là điểm khác biệt với cái tool gắn nhãn theo hình dạng hàm trước đó: ở đây **mọi con số đều truy về được một `eth_call` hoặc một URL**, không có suy diễn.

## Pitch 30 giây

> "Tụi tao không bán AI phát hiện bug. Tụi tao bán **biên lai**. Cùng một protocol, tracker bảo $0 trong khi on-chain còn 86.942 MOVR; cùng một sàn, $19 tỷ notional nhưng chỉ $4,4 tỷ tiền chạy. Mấy chỗ lệch đó là nơi rủi ro và định giá sai nằm. Bọn tao đã tự đo 224 chain bằng RPC read-only, có block number, có 19 vụ governance làm đối chứng. Chạy offline, không cần key, không cần vốn, không cần tin tụi tao — tự `npm test` và tự đọc `evidence`."

## Why now (số liệu tới 06/11/2026)

- Perp DEX: Hyperliquid **$216,9B/30 ngày**, **$75,4M fees/30 ngày** ([Datawallet](https://www.datawallet.com/crypto/hyperliquid-statistics)); builder codes **$17,92M Q1 → $16,38M Q2**, HIP-3 deployer **$1,10M → $7,49M** ([SpotedCrypto](https://www.spotedcrypto.com/hyperliquid-rwa-perps-buyback-decline-2026/)). Tiền chia cho bên thứ ba là thật.
- Prediction markets: **$2,7B** weekly crypto notional, Kalshi **$19,03B** mọi category/tuần 5–11/10 ([Cryptobriefing](https://cryptobriefing.com/kalshi-polymarket-record-weekly-crypto-volume/), [DeFi Rate](https://defirate.com/news/kalshi-hits-record-19-billion-week-as-polymarket-us-triples/)).
- x402: **138,5M tx / $52,7M**, TRM ước chỉ **0,6–7,5%** là agent thật ([Cryptopolitan](https://www.cryptopolitan.com/base-logs-138-million-x402-payments-as-ai-agent-revenue-draws-scrutiny/)).
- Bug bounty: **median critical $20.000** trên 593 program ([Stingrai](https://www.stingrai.io/blog/bug-bounty-statistics-2026)) — con số trung vị duy nhất có thật trong đống "kiếm vài chục nghìn đô".

Cả bốn đều có cùng một bệnh: **số headline thì to, tiền settle thì nhỏ**. Đó là cái tool này đo.

## Chạy

```bash
cd settled
npm test                     # 8 test, KHONG can mang, KHONG can key
npm run report               # bang CLI
npm run json > report.json   # may doc duoc
npm run serve                # dashboard http://0.0.0.0:3000
```

`serve` mở dashboard, gọi `/api/report` (relative URL, cùng origin). Không CDN, không build, không env. Muốn đổi cổng: `node src/cli.js serve --port 8080`.

## Kiến trúc — 6 file, không rác

| File | Việc |
|---|---|
| `data/snapshot.json` | Con số đã capture, **mỗi số kèm URL + `kind`**: `api` / `reported` / `measured` |
| `src/evidence.js` | Đọc 5 file JSON RPC tự đo của repo. Không gọi mạng |
| `src/analyze.js` | 4 phép đối chiếu + `buildReport()`. Mọi fact có `evidence[]` |
| `src/cli.js` | `report` / `--json` / `--out` / `serve` (HTTP thuần, bind `0.0.0.0`) |
| `public/index.html` | Dashboard vanilla JS, fetch `/api/report` |
| `test/analyze.test.js` | 8 test offline, kể cả test **cấm từ "VULNERABLE/verdict/buy/airdrop"** trong report |

4 phép đối chiếu:

1. **deadCapital** — tracker `$0` vs `getCash()`/`eth_getBalance`. Trả **số token thô**, cố tình **không quy đổi USD**.
2. **liveness** — `FROZEN_AT_BLOCK` chỉ khi ≥2 endpoint độc lập cùng trả block `N` và `N+1 = null`. `DEAD_RPC` **không** bị gán thành "chain chết".
3. **governance** — quorum / threshold / votingDelay / votingPeriod / timelock delay / admin / guardian, cộng tỉ lệ `cost_of_quorum : treasury` của MIP-R39 (1:597) và **parameter drift** giữa MIP-R41 (quorum 100M) với `getQuorum()` vẫn 40.000.001.
4. **volumeQuality** — xếp theo **fee/volume**, không xếp theo volume. Cố tình **không nhân** tỉ lệ agent-share ra USD.

## Moat (cái khó copy)

Không phải thuật toán. Là **evidence pack tự đo**:

- 224 chain, `rpc_zombie_raw.json`, có `block`, `blockTimestamp`, `nextBlockProbe`.
- 29 contract đọc bằng `eth_call`/`getCode`/`getStorageAt` trong `rpc_target_raw.json`, có `generatedAt`.
- 16 phép đo voting power trong `rpc_votes_raw.json` — chứng minh **balance ≠ phiếu bầu**.
- 7 market Moonwell + Unitroller + oracle + governor + timelock, đo tại block `17.381.654`.
- 19 vụ governance takeover đã xảy ra, trong `GOVERNANCE_TAKEOVERS.md`.

Ai cũng gọi được DefiLlama. Ít ai có cái để **so sánh ngược lại**.

## Cái này KHÔNG phải

- Không phải oracle giá. Không quy đổi USD, không đoán giá tại block cũ.
- Không chứng minh bug, không gắn nhãn contract, không xếp hạng rủi ro, không có PoC drain.
- Không cần private key, không broadcast tx, không fork mainnet, không gọi API có phí.
- Số `reported` là trich danh báo chí/forum, **không phải** kết quả `eth_call`. Đã ghi rõ trong `snapshot.json`.
- `FROZEN` chỉ nói state đọc được đứng yên; không khẳng định chain chết.

## Roadmap nếu có tiền (không cần để chạy bản này)

- Adapter live cho `api.llama.fi` với cache + `--offline` fallback (hiện tại snapshot là đủ để demo).
- Thêm chain khác từ `rpc_zombie_raw.json`: 8 FROZEN, 4 STALLED, 17 SUSPECT_RPC.
- Xuất `disagreements` thành webhook cho risk desk / insurance underwriter.
- Đóng gói `cost_of_quorum / treasury` thành chỉ số chuẩn cho 19 case.

---

**License:** MIT. **Chi phí chạy:** 0 đô. **Chi phí tin tao:** cũng 0, tự đọc `evidence`.
