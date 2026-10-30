# Chạy Foundry trong repo này

> Phạm vi: toolchain + PoC cho `src/v2/**` (vòng audit này). Báo cáo: [AUDIT.md](AUDIT.md).

Kết quả: **`forge test` cho toàn repo không chạy được trong sandbox này**, nhưng
**chạy được từng suite một** (3–35 s/suite) qua profile `poc`. Toàn bộ lệnh dưới
đây đã chạy thật, log ở `audit/poc/runs/`.

## 1. Vì sao toàn repo không build được

Repo: 337 file, ~4.3 MB mã nguồn đưa vào solc. Trong sandbox không có mạng tới
`binaries.soliditylang.org`, nên compiler duy nhất là `solc@0.8.26` bản npm —
tức **soljson wasm**. Heap wasm của nó chết ở khoảng **1.2–1.4 MB** mã nguồn:

| đầu vào | kết quả |
| --- | --- |
| `src/**` (123 file, ~0.95 MB) | OK, 58 s |
| 200 contract tổng hợp, 418 KB | OK |
| 400 contract, 837 KB | OK |
| 700 contract, 1.46 MB | `memory access out of bounds` |
| repo test dir + utils, 2.2 MB | `memory access out of bounds` |

Đây là giới hạn của compiler chạy bằng wasm, không phải lỗi của repo.

Lỗi thứ hai, riêng biệt: **CLI của solc-js in rác ra stdout**
(`>>> Cannot retry compilation with SMT …`) trước JSON, làm forge báo
`missing field type` / `missing field component`. Vì vậy
`/home/user/bin/solc` (không nằm trong repo) **gọi thư viện** chứ không gọi CLI:

```js
if (args.includes('--version')) → solc.version()
if (args.includes('--standard-json')) → solc.compile(stdin) → chỉ in JSON
khi throw → in lỗi hợp lệ ra stdout (có `component` + `type`) và dump request
            vào /tmp/solc-fail.json
```

## 2. Cài đặt (npm, không dùng tarball GitHub)

```bash
mkdir -p /home/user/work/tools && cd /home/user/work/tools
npm i @foundry-rs/forge@1.7.1 @foundry-rs/cast@1.7.1 @foundry-rs/anvil@1.7.1 solc@0.8.26
# wrapper trong /home/user/bin: forge, cast, anvil, solc
export PATH=/home/user/bin:$PATH
forge --version     # forge 1.7.1
solc --version      # 0.8.26+commit.8a97fa7a.Emscripten.clang
```

## 3. Profile `poc` (trong `foundry.toml`)

```toml
[profile.poc]
src = "audit/poc/empty"                 # src rỗng: contract chỉ vào build khi có import
test = "audit/poc/harness/test"
script = "audit/poc/empty"
remappings = [
  "forge-std/=audit/poc/forge-std/",    # symlink tới lib/forge-std/src, trừ safeconsole
  "hedgefun/=src/",                     # src/** import được từ harness
  "repo-script/=script/",               # test/utils import script/ theo đường dẫn tương đối
  ...                                   # phần còn lại y như profile mặc định
]
```

`audit/poc/forge-std/` là 22 symlink tới `lib/forge-std/src`, riêng
`safeconsole.sol` là bản rỗng: 13 248 dòng hàm log do máy sinh, `Test.sol` import
nhưng không ai gọi (không repo này, không forge-std). Bỏ nó tiết kiệm 408 KB —
đúng bằng khoảng trống cần để vừa trần 1.2 MB.

## 4. Chạy PoC của audit

```bash
cd /home/user/arc_hedgefun && export PATH=/home/user/bin:$PATH

# 14 test, mỗi test 1000 fuzz run, ~2 phút
FOUNDRY_PROFILE=poc FOUNDRY_FUZZ_RUNS=1000 \
  forge test --use /home/user/bin/solc --offline --force
```

`--offline` là bắt buộc (không có mạng ra binaries.soliditylang.org),
`--force` để không dùng cache cũ của solc nếu vừa sửa contract.

## 5. Chạy một suite test của repo

```bash
./audit/poc/import-test.sh BondingCurve.t.sol
FOUNDRY_PROFILE=poc forge test --use /home/user/bin/solc --offline --force \
  --match-path 'audit/poc/harness/test/repo_BondingCurve.t.sol'
```

Script chép file test vào harness, copy `test/mocks` + `test/utils` (có rewrite
import), và đổi `../src/X.sol` → `hedgefun/X.sol`. Mỗi lần **một suite**: hai
suite cùng lúc là vượt trần bộ nhớ.

Đã chạy được và **pass hết**:

| suite | kết quả | file compile |
| --- | --- | --- |
| `BondingCurve.t.sol` | 20 passed | 128 |
| `V2CurveSecurity.t.sol` | 1 + 3 passed | 130 |
| `V2TradeRouter.t.sol` | 2 + 24 passed | 125 |
| `V2CurveDeployer.t.sol` | 6 passed | ~120 |

Không chạy được: `V2DustProgressFuzz` (134 file) và các suite lớn hơn — vượt
trần. Muốn chạy thì phải bỏ bớt file trong `test/utils`, hoặc chuyển sang máy có
solc native. Test fork (`*Fork.t.sol`) cần RPC, ngoài phạm vi sandbox.

## 6. File trong `audit/poc/`

| file | việc |
| --- | --- |
| `harness/test/CurvePoC.t.sol` | 7 PoC đánh `HedgeFunBondingCurve` |
| `harness/test/StakingPoC.t.sol` | 6 PoC đánh `V2StakingIncome` |
| `harness/test/Smoke.t.sol` | kiểm tra harness tự chạy |
| `import-test.sh` | chép 1 suite của repo vào harness |
| `empty/` | thư mục rỗng cho `src`/`script` của profile `poc` |
| `forge-std/` | symlink forge-std, `safeconsole.sol` rút gọn |
| `runs/` | log lần chạy đã dùng làm bằng chứng |
