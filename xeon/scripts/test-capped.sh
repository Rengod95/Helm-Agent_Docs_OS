#!/usr/bin/env bash
# Run `bun test` for scripts/ and every workspace package. The packages go through turbo (`turbo run test`): a package whose inputs
# and dependencies are unchanged replays from the turbo cache, shared by all worktrees (TURBO_CACHE_DIR, default
# ~/.cache/xeon/turbo). A miss runs the package's `test` script, scripts/test-pkg.sh: bun test under the machine guard
# (../scripts/guard.sh run: a memory cap per run inside the shared ws-dev.slice budget) with a time limit, so a runaway test ends
# only its own run (oom-kill). turbo runs two packages at a time; apps/host and core-persistence never run together (test-pkg.sh lock).
# xeon/scripts itself (`bun test scripts`) is cheap and reads the docs and CI files, so it always runs, uncached, one scope.
# `just verify` does not wrap the test step (xeon/scripts/verify-steps.sh): WS_GUARD_ACTIVE must be unset when this script is called.
# usage: test-capped.sh [package-dir ...]   (default: scripts and all packages with a "test" script)
# env: XEON_TEST_TIMEOUT_SEC (default 300) seconds per target; WS_GUARD_RUN_MAX (default 1500M) memory cap per target;
#      TURBO_FORCE=true runs every package (no cache read); TURBO_CACHE_DIR cache location
#      (see ../scripts/guard.sh for the other WS_GUARD_* knobs).
# The summary line counts the tests bun reported as skipped, so a skip in CI is visible (just exit-tests fails on it). The count
# is part of each package's cached log, so replayed packages report their skips too.
# exit: 0 passed, 1 a target failed, 2 environment problem.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

root="$PWD"
guard="$root/../scripts/guard.sh"
timeout_sec="${XEON_TEST_TIMEOUT_SEC:-300}"
export TURBO_TELEMETRY_DISABLED=1
export TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/.cache/xeon/turbo}"

if [[ ! -x "$guard" ]]; then
  echo "test-capped: $guard is missing (ws repo adopt copies it)" >&2
  exit 2
fi

run_scripts=false
filters=()
if [[ $# -gt 0 ]]; then
  for target in "$@"; do
    if [[ "$target" == "scripts" ]]; then run_scripts=true; else filters+=("--filter=./$target"); fi
  done
else
  run_scripts=true
  filters=("--filter=./packages/*" "--filter=./apps/*" "--filter=./plugins/*")
fi

failed=()
skipped=0
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if [[ "$run_scripts" == true ]]; then
  echo "== scripts"
  status=0
  started=$SECONDS
  limit=()
  if command -v timeout >/dev/null 2>&1; then limit=(timeout "$timeout_sec"); fi
  (cd "$root" && "$guard" run -- ${limit[@]+"${limit[@]}"} mise exec -- bun test scripts) 2>&1 | tee "$log" || status=$?
  echo "test-capped: time $((SECONDS - started))s (scripts)" >&2
  count="$(sed -nE 's/^ *([0-9]+) skip$/\1/p' "$log" | tail -1)"
  skipped=$((skipped + ${count:-0}))
  if [[ "$status" -ne 0 ]]; then
    echo "test-capped: scripts failed: exit $status (124: time limit ${timeout_sec}s; 137: memory cap, see journalctl --user -n 20)" >&2
    failed+=(scripts)
  fi
fi

if [[ ${#filters[@]} -gt 0 ]]; then
  echo "== packages (turbo, cache $TURBO_CACHE_DIR)"
  status=0
  started=$SECONDS
  mise exec -- bun run turbo run test "${filters[@]}" --concurrency=2 --continue --log-prefix=task --output-logs=full 2>&1 | tee "$log" || status=$?
  hit="$(grep -cE '^[^ ]+:test: cache hit' "$log" || true)"
  miss="$(grep -cE '^[^ ]+:test: cache (miss|bypass)' "$log" || true)"
  echo "test-capped: packages: $hit cached, $miss ran, $((SECONDS - started))s" >&2
  # per-package seconds of the packages that ran, slowest first (a replayed log shows the seconds of the run that filled the cache)
  ran="$(sed -nE 's/^([^ ]+):test: cache (miss|bypass).*/\1/p' "$log")"
  if [[ -n "$ran" ]]; then
    echo "test-capped: ran packages, slowest first:" >&2
    sed -nE 's/^([^ ]+):test: test-pkg: ran ([0-9]+)s, .*/\2 \1/p' "$log" | sort -rn |
      awk -v ran="$ran" 'BEGIN { n = split(ran, names, "\n"); for (i = 1; i <= n; i++) seen[names[i]] = 1 } seen[$2] && ++shown <= 12 { print "  " $1 "s " $2 }' >&2
  fi
  while read -r count; do skipped=$((skipped + count)); done < <(sed -nE 's/^[^ ]+:test: test-pkg: ran [0-9]+s, ([0-9]+) skipped$/\1/p' "$log")
  if [[ "$status" -ne 0 ]]; then
    echo "test-capped: packages failed: exit $status (see the failed tasks above; 124: time limit ${timeout_sec}s; 137: memory cap, see journalctl --user -n 20)" >&2
    failed+=(packages)
  fi
fi

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "test-capped: failed: ${failed[*]} ($skipped skipped)" >&2
  exit 1
fi
echo "test-capped: all targets passed ($skipped skipped)"
