#!/usr/bin/env bash
# Lint, typecheck and test of ONE package, in that order, each under the machine guard (../scripts/guard.sh run, 1.5G).
# For agents working in parallel: this is the check to run before a commit. The repo-wide `just verify`, `just lint` and
# `just typecheck` belong to the final merge step only.
# usage: check-pkg.sh <package-dir>   (e.g. packages/core-tools, apps/host, plugins/x; "scripts" is xeon/scripts itself)
# env: XEON_CHECK_MAX (default 1500M) memory cap of lint and typecheck; test runs through test-capped.sh (its own knobs).
# turbo runs with --concurrency=1: a package with many dependencies has dozens of upstream tsc tasks on a cold cache, and turbo starts
# them side by side (one tsc is several hundred MB), which went past the cap and got the run killed (137). One at a time stays under it.
# exit: 0 passed, 1 a check failed (the first failure stops the run), 2 environment problem, 64 wrong call.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

pkg="${1:-}"
pkg="${pkg#xeon/}"
pkg="${pkg#./}"
pkg="${pkg%/}"
if [[ -z "$pkg" || $# -ne 1 ]]; then
  echo "usage: check-pkg.sh <package-dir>   (e.g. packages/contracts, apps/host, scripts)" >&2
  exit 64
fi
if [[ "$pkg" != "scripts" && ! -f "$pkg/package.json" ]]; then
  echo "check-pkg: $pkg has no package.json (run from the repo: just check packages/<name>)" >&2
  exit 64
fi
guard="$PWD/../scripts/guard.sh"
if [[ ! -x "$guard" ]]; then
  echo "check-pkg: $guard is missing (ws repo adopt copies it)" >&2
  exit 2
fi
export TURBO_TELEMETRY_DISABLED=1
export WS_GUARD_RUN_MAX="${XEON_CHECK_MAX:-1500M}"

run() {
  echo "== $pkg: $*"
  env -u WS_GUARD_ACTIVE "$guard" run -- "$@"
}

if [[ "$pkg" == "scripts" ]]; then
  run mise exec -- bun run lint:root
  run mise exec -- bun run typecheck:root
else
  run mise exec -- bun run turbo run lint --filter="./$pkg" --concurrency=1
  run mise exec -- bun run turbo run typecheck --filter="./$pkg" --concurrency=1
fi
echo "== $pkg: test"
env -u WS_GUARD_ACTIVE scripts/test-capped.sh "$pkg"
