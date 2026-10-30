#!/usr/bin/env bash
# Reproduce the StackingDAO PoCs offline.
#
#   ./audit/stackingdao/prepare.sh /home/user/sdao
#
# Why the script patches the repo at all: the upstream Clarinet.toml declares 20
# mainnet contracts under [[project.requirements]], and simnet tries to fetch them
# from api.hiro.so. This sandbox cannot reach that host, so the requirements are
# dropped, together with the contracts that only exist to read on-chain data.
# Only one thing in the Clarity code itself is changed: the mainnet pox-4
# principal becomes .pox-4-mock. The `is-in-mainnet` branch never runs in simnet,
# so behaviour is unchanged.
set -euo pipefail

DIR="${1:-/home/user/sdao}"
REPO="https://github.com/StackingDAO/contracts.git"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$DIR/.git" ]; then
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

# 1. drop every mainnet requirement -- the only thing that makes simnet hit the network
python3 - <<'PY'
import re
s = open('Clarinet.toml').read()
s = re.sub(r"\[\[project\.requirements\]\]\ncontract_id = \"[^\"]+\"\n\n?", "", s)
open('Clarinet.toml', 'w').write(s)
PY

# 2. mainnet pox-4 -> mock (the is-in-mainnet branch is dead code under simnet)
grep -rl "'SP000000000000000000002Q6VF78.pox-4" contracts --include=*.clar \
  | xargs -r sed -i "s/'SP000000000000000000002Q6VF78\.pox-4/.pox-4-mock/g"

# 3. drop contracts that only read on-chain data (block-info-*, protocol-*, jobs, swap)
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

# 5. PoCs
mkdir -p tests/poc
cp "$HERE"/fomo_*.ts tests/poc/

echo
echo "run:"
echo "  cd $DIR && npx vitest run tests/poc/"
