# maia-analyzer.user.js

Một file userscript duy nhất, fork từ
[peenjeee/chess-userscript](https://github.com/peenjeee/chess-userscript) v3.13.
Giữ nguyên toàn bộ phần đọc bàn cờ / vẽ mũi tên / auto move đang chạy tốt, chỉ
thay đúng 2 chỗ.

## 1. Stockfish → Maia-3

| | bản gốc | bản này |
|---|---|---|
| Engine | Stockfish 19 NNUE (WASM, ~113MB) | **Maia-3** (ONNX, transformer) |
| Cách tính | tìm kiếm sâu, nước mạnh nhất | nhìn bàn 1 lần, đoán nước **người ở Elo X** hay đi |
| Tải về | ~113MB wasm + NNUE | 79M ≈ 313MB (fallback 23M ≈ 92MB, 5M ≈ 22MB) |
| Runtime | Stockfish wasm | onnxruntime-web 1.31.1 (~15MB) |
| Độ trễ mỗi nước | tăng dần theo độ sâu | 1 lượt forward, cố định |

- Weights: `cstr/maia3-onnx-int32` (ONNX int32, chạy CPU/browser), gốc là
  [CSSLab/maia3](https://github.com/CSSLab/maia3) — AGPL-3.0.
- **Đi từ nhỏ lên**: 5M (~22MB) lên trước để có mũi tên trong vài giây, rồi tải
  tiếp 23M và 79M ở nền, xong cái nào thay cái đó. Model to nhất từng load được
  ghi vào `localStorage['maia3-tier']`, lần sau vào thẳng 79M.
- Không load được size nào thì báo lỗi lên dòng trạng thái, không im lặng.
- Không search, nên mũi tên là "nước người ta hay đi", không phải nước mạnh
  nhất. Đó chính là ý bạn: engine yếu/giống người hơn.
- Nút **Elo: 1500 [E]** (hoặc phím `E`) đổi 800 → 1100 → 1500 → 1800 → 2100 →
  2400, đổi xong tính lại ngay vị trí đang xem.
- Điểm số trên nút là win-probability của value head, quy ra centipawn.

## 2. Màu mũi tên → kiểu "Brilliant move"

- Nước tốt nhất: **xanh ngọc `#00e5c0`** + badge tròn `!!` (nền xanh ngọc,
  viền trắng) đặt ở góc ô đích, giống huy hiệu brilliant của chess.com.
- Nước thứ 2: đỏ `#ef4444`. Nước thứ 3: xanh lá `#22c55e`.
- Bỏ hẳn màu xanh nước biển và mũi tên tím chỉ nước đi tiếp theo (ponder).

## Dòng trạng thái

Ngay cạnh nút có một dòng chữ nhỏ cho biết analyzer đang làm gì — đây là chỗ
đầu tiên cần đọc khi không thấy mũi tên:

| Dòng trạng thái | Nghĩa |
|---|---|
| `runtime 1/3 … 3/3` | đang tải onnxruntime (~15MB, 1 lần) |
| `downloading Maia-3 5M 45%` | đang tải model, có % |
| `starting Maia-3 5M` | đang khởi tạo session |
| `Maia-3 5M (35ms) · +0.4 · 3 arrows @1500` | **đang chạy tốt** |
| `position not readable as chess: <fen>` | đọc bàn ra thế cờ sai (thường do bàn đang chạy animation) |
| `no board found on this page` | không tìm thấy `wc-chess-board` |
| `Maia-3: <lỗi>` | model trả lỗi, xem console `[Maia3]` |
| `analyzer error: <lỗi>` | lỗi JS trong vòng lặp, xem console |

Mọi bước cũng được log ra console với tiền tố `[Maia3]`.

## Cài

1. Cài Violentmonkey (hoặc Tampermonkey) cho Firefox/Chrome.
2. Mở `maia-analyzer.user.js`, copy **toàn bộ** file.
3. Violentmonkey → `+` → New script → dán → `Ctrl+S`.
4. Vào chess.com, tải lại trang (F5).

Phím: `A` bật/tắt analyzer · `E` đổi Elo · `B` auto move · `Insert` ẩn/hiện
thanh nút · `Ctrl+Shift+C` copy Relay ID.

Lần đầu bấm `A` sẽ tải model (79M ≈ 313MB) và lưu vào IndexedDB, các lần sau
dùng lại.

## Giới hạn đã biết

- Maia-3 chỉ biết cờ chuẩn. Lichess/endgame.ai variants vẫn đọc được bàn nhưng
  không vẽ mũi tên (báo "Maia-3: standard chess only").
- En passant không được mô hình hoá (FEN đọc từ DOM luôn là `-`).
- 79M trên CPU khá nặng; máy yếu thì tự rơi xuống 23M/5M.
- Chưa chạy thử trên trình duyệt thật trong môi trường của tôi: phần logic cờ,
  worker ONNX và toàn bộ luồng analyzer được test bằng python-chess + jsdom
  (226 thế cờ, ONNX thật với model giả cùng I/O 96/97 cột, int32/int64).
- Nếu input của bản export thật là 97 cột hoặc Elo kiểu int64/scalar, worker tự
  dò và tự đổi kiểu; sai shape vẫn báo ra dòng trạng thái.

`arrow-style-preview.png` là ảnh render đúng đoạn code vẽ mũi tên trong file.

## File cũ

`chess_arrow.py`, `test_chess_arrow.py`, `requirements.txt` là bản Python
(AppleScript + Stockfish) đã bị thay thế — xoá được nếu không cần.
