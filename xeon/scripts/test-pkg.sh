#!/usr/bin/env bash
# The `test` script of every package: `bun test` of the package under the machine guard (../../../scripts/guard.sh run, a memory
# cap per run) and a time limit. turbo runs it (`turbo run test`), so an unchanged package replays from the turbo cache;
# test-capped.sh is the entry point. Needs the package directory as cwd, which turbo sets.
# The last line is `test-pkg: ran <s>s, <n> skipped`; it is part of the cached log, so the skip count survives a cache replay
# (the seconds are those of the run that filled the cache).
# The heavy packages (apps/host, core-persistence) take a machine-wide lock so that two of them never run at once.
# env: XEON_TEST_TIMEOUT_SEC (default 300) seconds per package; WS_GUARD_RUN_MAX (default 1500M) memory cap
#      (see ../../scripts/guard.sh for the other WS_GUARD_* knobs); XEON_HEAVY_LOCK lock file (default ~/.cache/xeon/heavy.lock).
# exit: bun's exit code (124: time limit; 137: memory cap, see journalctl --user -n 20), 2 when guard.sh is missing.
set -euo pipefail

guard="$PWD/../../../scripts/guard.sh"
if [[ ! -x "$guard" ]]; then
  echo "test-pkg: $guard is missing (ws repo adopt copies it)" >&2
  exit 2
fi
timeout_sec="${XEON_TEST_TIMEOUT_SEC:-300}"
limit=()
if command -v timeout >/dev/null 2>&1; then limit=(timeout "$timeout_sec"); fi

case "$(basename "$PWD")" in
  desktop) bash ../../scripts/ensure-sidecar.sh ;;
esac

lock=()
case "$(basename "$PWD")" in
  host | core-persistence)
    lock_file="${XEON_HEAVY_LOCK:-$HOME/.cache/xeon/heavy.lock}"
    if command -v flock >/dev/null 2>&1; then
      mkdir -p "$(dirname "$lock_file")"
      lock=(flock "$lock_file")
    fi
    ;;
esac

# runs inside the guard scope: the command, then the scope's peak memory (cgroup v2 memory.peak) when readable
scope_cmd='"$@"; status=$?; f="/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)/memory.peak"
[ -r "$f" ] && echo "test-pkg: peak $(( $(cat "$f") / 1048576 ))M"; exit $status'

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
status=0
started=$SECONDS
"$guard" run -- bash -c "$scope_cmd" scope ${lock[@]+"${lock[@]}"} ${limit[@]+"${limit[@]}"} mise exec -- bun test 2>&1 | tee "$log" || status=$?
count="$(sed -nE 's/^ *([0-9]+) skip$/\1/p' "$log" | tail -1)"
echo "test-pkg: ran $((SECONDS - started))s, ${count:-0} skipped"
exit "$status"
