#!/usr/bin/env bash
# Run `bun test` for scripts/ and every workspace package, one at a time, each under a memory cap.
# A runaway test then ends only its own run (oom-kill) instead of exhausting the machine.
# usage: test-capped.sh [package-dir ...]   (default: scripts and all packages with a "test" script)
# env: XEON_TEST_MEMORY_MAX (default 1500M), XEON_TEST_TIMEOUT_SEC (default 300)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mem="${XEON_TEST_MEMORY_MAX:-1500M}"
timeout_sec="${XEON_TEST_TIMEOUT_SEC:-300}"
root="$PWD"

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

# systemd user scope gives a real cgroup cap; without it fall back to a plain run.
capped=false
if command -v systemd-run >/dev/null && systemctl --user is-system-running >/dev/null 2>&1; then
  capped=true
else
  echo "test-capped: systemd user session not available, running without a memory cap" >&2
fi

failed=()
for target in "${targets[@]}"; do
  dir="$root/$target"
  args=(test)
  if [[ "$target" == "scripts" ]]; then dir="$root"; args=(test scripts); fi
  echo "== $target"
  if [[ "$capped" == "true" ]]; then
    status=0
    systemd-run --user --wait --pipe --collect --quiet \
      -p MemoryMax="$mem" -p MemorySwapMax=0 -p RuntimeMaxSec="$timeout_sec" \
      -p WorkingDirectory="$dir" -E PATH="$PATH" -E HOME="$HOME" \
      -- mise exec -- bun "${args[@]}" || status=$?
  else
    status=0
    (cd "$dir" && timeout "$timeout_sec" mise exec -- bun "${args[@]}") || status=$?
  fi
  if [[ "$status" -ne 0 ]]; then
    reason="exit $status"
    if [[ "$capped" == "true" ]]; then reason="$reason (memory cap $mem, timeout ${timeout_sec}s; 'journalctl --user -n 20' shows oom-kill or timeout)"; fi
    echo "test-capped: $target failed: $reason" >&2
    failed+=("$target")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "test-capped: failed: ${failed[*]}" >&2
  exit 1
fi
echo "test-capped: all ${#targets[@]} targets passed"
