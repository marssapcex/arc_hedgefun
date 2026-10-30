#!/usr/bin/env bash
# Dựng lại môi trường để chạy PoC StackingDAO offline.
#
#   ./audit/stackingdao/prepare.sh /home/user/sdao
#
# Vì sao phải patch: Clarinet.toml của repo khai báo 20 contract mainnet trong
# `[[project.requirements]]` và simnet cố tải chúng từ api.hiro.so. Sandbox này
# không gọi được api.hiro.so, nên phải bỏ requirement + bỏ các contract chỉ dùng
# cho việc đọc số liệu on-chain. Trong code Clarity chỉ thay đúng một thứ:
# principal mainnet của pox-4 -> .pox-4-mock (nhánh `is-in-mainnet` vốn không
# bao giờ chạy trong simnet, nên hành vi không đổi).
set -euo pipefail

DIR="${1:-/home/user/sdao}"
REPO="https://github.com/StackingDAO/contracts.git"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$DIR/.git" ]; then
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

# 1. bỏ mọi requirement mainnet (thứ duy nhất khiến simnet gọi mạng)
python3 - <<'PY'
import re
s = open('Clarinet.toml').read()
s = re.sub(r"\[\[project\.requirements\]\]\ncontract_id = \"[^\"]+\"\n\n?", "", s)
open('Clarinet.toml', 'w').write(s)
PY

# 2. pox-4 mainnet -> mock (nhánh is-in-mainnet là dead code trong simnet)
grep -rl "'SP000000000000000000002Q6VF78.pox-4" contracts --include=*.clar \
  | xargs -r sed -i "s/'SP000000000000000000002Q6VF78\.pox-4/.pox-4-mock/g"

# 3. bỏ các contract chỉ đọc dữ liệu on-chain (block-info-*, protocol-*, job, swap)
python3 - <<'PY'
import re, subprocess
off = subprocess.run(
    ["bash", "-c",
     r"""grep -rl "'SP[0-9A-Z]\{20,\}\." contracts --include=*.clar | sed 's|.*/||; s|\.clar$||'"""],
    capture_output=True, text=True).stdout.split()
extra = {"stacking-dao-genesis-nft-minter", "stacking-dao-genesis-nft-minter-v2", "stacking-dao-genesis-nft"}
blocks = re.split(r'(?m)^(?=\[)', open('Clarinet.toml').read())
out = [b for b in blocks
       if not (m := re.match(r'\[contracts\.([a-zA-Z0-9_-]+)\]', b)) or (m.group(1) not in set(off) | extra)]
open('Clarinet.toml', 'w').write(''.join(out))
PY

# 4. toolchain
npm ci --no-audit --no-fund
npm i --no-save --no-audit --no-fund @rollup/rollup-linux-x64-gnu

# 5. PoC
mkdir -p tests/poc
cp "$HERE/fomo_poc_test.ts" tests/poc/fomo_poc_test.ts

echo
echo "chạy:"
echo "  cd $DIR && npx vitest run tests/poc/fomo_poc_test.ts"
