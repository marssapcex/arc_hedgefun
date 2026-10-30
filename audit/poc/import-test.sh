#!/usr/bin/env bash
# Imports one of the repo's own test files into the audit harness so it can be
# compiled and run on its own.
#
# Why: `forge test` at the repo root hands solc 337 files (~4MB). solc-js, the
# only compiler available offline here, dies at roughly 1.2MB of source. The
# `poc` profile points `src`, `test` and `script` at empty directories and lets
# contracts in through the `hedgefun/` remapping, so only what the test actually
# imports is compiled. This script rewrites those imports.
#
# Usage:  audit/poc/import-test.sh BondingCurve.t.sol
#         FOUNDRY_PROFILE=poc forge test --offline --match-path 'audit/poc/harness/test/repo_*'
#         (pass --use "$SOLC" if the default solc cannot be downloaded)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
name="${1:?usage: import-test.sh <TestFile.t.sol>}"
src="$root/test/$name"
testdir="$root/audit/poc/harness/test"
dst="$testdir/repo_${name}"

[ -f "$src" ] || { echo "no such test: $src" >&2; exit 1; }

# `../src/X.sol`, `../../src/X.sol` -> `hedgefun/X.sol`, so an imported contract
# is pulled in through the remapping instead of a path outside the harness.
rewrite_dir() {
    find "$1" -name '*.sol' -print0 | xargs -0 -r sed -i \
        -e 's#\.\./\.\./\.\./src/#hedgefun/#g' \
        -e 's#\.\./\.\./src/#hedgefun/#g' \
        -e 's#\.\./src/#hedgefun/#g' \
        -e 's#\.\./\.\./script/#repo-script/#g' \
        -e 's#\.\./script/#repo-script/#g' \
        -e 's#"\.\./\.\./test/#"./#g' \
        -e 's#"\.\./test/#"./#g'
}

# one suite at a time: each imported test also drags test/utils, and two of them
# together push solc past its heap limit.
[ "${2:-}" = "--keep" ] || rm -f "$testdir"/repo_*.sol

rm -rf "$testdir/mocks" "$testdir/utils"
for dir in mocks utils; do
    if [ -d "$root/test/$dir" ]; then
        cp -r "$root/test/$dir" "$testdir/$dir"
        rewrite_dir "$testdir/$dir"
    fi
done

mkdir -p "$testdir"
sed -e 's#\.\./\.\./src/#hedgefun/#g' -e 's#\.\./src/#hedgefun/#g' "$src" > "$dst"
sed -i -e 's#"\.\./test/#"./#g' "$dst"

echo "imported $name -> ${dst#$root/} ($(grep -c '' "$dst") lines)"
echo "run it with:"
echo "  cd $root && FOUNDRY_PROFILE=poc forge test --offline --match-path 'audit/poc/harness/test/repo_$name'"
