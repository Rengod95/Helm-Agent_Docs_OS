#!/usr/bin/env bash
# Run lint, typecheck and test for the packages of one layer through turbo.
# usage: ci-layer.sh <F|X|L0|L1|L2|L3|L4> [true]   (true adds turbo --affected; base via TURBO_SCM_BASE)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

layer="${1:?usage: ci-layer.sh <F|X|L0|L1|L2|L3|L4> [true]}"
affected="${2:-false}"

case "$layer" in
  F) dirs=(./packages/contracts) ;;
  X) dirs=(./packages/ext-host) ;;
  L0) dirs=('./packages/platform-*') ;;
  L1) dirs=('./packages/core-*' './plugins/*') ;;
  L2) dirs=('./packages/cap-*') ;;
  L3) dirs=('./packages/group-*') ;;
  L4) dirs=('./apps/*') ;;
  *) echo "unknown layer: $layer (expected F X L0 L1 L2 L3 L4)" >&2; exit 1 ;;
esac

args=()
for dir in "${dirs[@]}"; do args+=("--filter=$dir"); done
if [[ "$affected" == "true" ]]; then args+=(--affected); fi

export TURBO_TELEMETRY_DISABLED=1
exec mise exec -- bun run turbo run lint typecheck test "${args[@]}"
