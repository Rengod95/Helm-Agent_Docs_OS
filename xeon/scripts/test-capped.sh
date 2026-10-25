#!/usr/bin/env bash
# Run `bun test` for scripts/ and every workspace package, one at a time, each under the machine guard
# (../scripts/guard.sh run: a memory cap per run inside the shared ws-dev.slice budget). A runaway test then ends only
# its own run (oom-kill) instead of exhausting the machine. Inside `just verify` the guard is already active, so each
# run shares the verify cap and only the per-target time limit below applies.
# usage: test-capped.sh [package-dir ...]   (default: scripts and all packages with a "test" script)
# env: XEON_TEST_TIMEOUT_SEC (default 300) seconds per target; WS_GUARD_RUN_MAX (default 1500M) memory cap per target
#      outside verify (see ../scripts/guard.sh for the other WS_GUARD_* knobs).
# The summary line counts the tests bun reported as skipped, so a skip in CI is visible (just exit-tests fails on it).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

root="$PWD"
guard="$root/../scripts/guard.sh"
timeout_sec="${XEON_TEST_TIMEOUT_SEC:-300}"

if [[ ! -x "$guard" ]]; then
  echo "test-capped: $guard is missing (ws repo adopt copies it)" >&2
  exit 2
fi

if [[ $# -gt 0 ]]; then
  targets=("$@")
else
  targets=(scripts)
  for pkg in packages/*/ apps/*/ plugins/*/; do
    pkg="${pkg%/}"
    if [[ -f "$pkg/package.json" ]] && grep -q '"test"[[:space:]]*:' "$pkg/package.json"; then
      targets+=("$pkg")
    fi
  done
fi

limit=()
if command -v timeout >/dev/null 2>&1; then limit=(timeout "$timeout_sec"); fi

failed=()
skipped=0
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for target in "${targets[@]}"; do
  dir="$root/$target"
  args=(test)
  if [[ "$target" == "scripts" ]]; then dir="$root"; args=(test scripts); fi
  echo "== $target"
  status=0
  (cd "$dir" && "$guard" run -- "${limit[@]}" mise exec -- bun "${args[@]}") 2>&1 | tee "$log" || status=$?
  count="$(sed -nE 's/^ *([0-9]+) skip$/\1/p' "$log" | tail -1)"
  skipped=$((skipped + ${count:-0}))
  if [[ "$status" -ne 0 ]]; then
    echo "test-capped: $target failed: exit $status (124: time limit ${timeout_sec}s; 137: memory cap, see journalctl --user -n 20)" >&2
    failed+=("$target")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "test-capped: failed: ${failed[*]} ($skipped skipped)" >&2
  exit 1
fi
echo "test-capped: all ${#targets[@]} targets passed ($skipped skipped)"
