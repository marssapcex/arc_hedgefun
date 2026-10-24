#!/usr/bin/env bash
cd "$(dirname "$0")/.."
gunzip -kf tools/forge.gz && chmod +x tools/forge tools/solc
FOUNDRY_SOLC="$PWD/tools/solc" FOUNDRY_OFFLINE=true ./tools/forge "$@"
