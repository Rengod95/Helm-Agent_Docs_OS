#!/usr/bin/env bash
# The `test` script of every package: `bun test` of the package under the machine guard (../../../scripts/guard.sh run, a memory
# cap per run) and a time limit. turbo runs it (`turbo run test`), so an unchanged package replays from the turbo cache;
# test-capped.sh is the entry point. Needs the package directory as cwd, which turbo sets.
# The last line is `test-pkg: ran <s>s, <n> skipped`; it is part of the cached log, so the skip count survives a cache replay
# (the seconds are those of the run that filled the cache).
# The heavy packages (apps/host, core-persistence) take a machine-wide lock so that two of them never run at once.
# env: FRESNEL_TEST_TIMEOUT_SEC (default 300) seconds per package; WS_GUARD_RUN_MAX (default 1500M) memory cap
#      FRESNEL_HOST_TEST_PARALLEL, FRESNEL_CLI_TEST_PARALLEL bun test workers of apps/host, apps/cli (default 4 on macOS, serial elsewhere);
#      (see ../../scripts/guard.sh for the other WS_GUARD_* knobs); FRESNEL_HEAVY_LOCK lock file (default ~/.cache/fresnel/heavy.lock).
# exit: bun's exit code (124: time limit; 137: memory cap, see journalctl --user -n 20), 2 when guard.sh is missing.
set -euo pipefail

guard="$PWD/../../../scripts/guard.sh"
if [[ ! -x "$guard" ]]; then
  echo "test-pkg: $guard is missing (ws repo adopt copies it)" >&2
  exit 2
fi
timeout_sec="${FRESNEL_TEST_TIMEOUT_SEC:-300}"
limit=()
if command -v timeout >/dev/null 2>&1; then
  limit=(timeout "$timeout_sec")
else
  # macOS has no timeout(1): the guard's supervisor (scripts/guard-supervise.pl) holds the limit and ends the whole process group (exit 124)
  export WS_GUARD_TIMEOUT_SEC="$timeout_sec"
fi

case "$(basename "$PWD")" in
  desktop) bash ../../scripts/ensure-sidecar.sh ;;
esac

lock=()
case "$(basename "$PWD")" in
  host | core-persistence)
    lock_file="${FRESNEL_HEAVY_LOCK:-$HOME/.cache/fresnel/heavy.lock}"
    if command -v flock >/dev/null 2>&1; then
      mkdir -p "$(dirname "$lock_file")"
      lock=(flock "$lock_file")
    fi
    ;;
esac

# apps/host: its test files own their temp dirs and ephemeral ports (no fixed port, socket path or shared file; FRESNEL_HOME is per process),
# so bun runs them in worker processes. Same tests, same bun default 5s timeout. macOS only (4 workers, measured 60s -> 36s under load);
# elsewhere serial until measured under the guard memory cap. FRESNEL_HOST_TEST_PARALLEL overrides (0 or 1 = serial).
# apps/cli is the same on macOS (99s serial -> about 40s with 4 workers on a quiet machine; 6 workers hit a 5s test timeout under load 600, so it stays 4); FRESNEL_CLI_TEST_PARALLEL overrides.
bun_args=()
case "$(basename "$PWD")" in
  host | cli)
    workers=0
    if [[ "$(uname -s)" == "Darwin" ]]; then workers=4; fi
    if [[ "$(basename "$PWD")" == "host" ]]; then workers="${FRESNEL_HOST_TEST_PARALLEL:-$workers}"; else workers="${FRESNEL_CLI_TEST_PARALLEL:-$workers}"; fi
    if [[ "$workers" -gt 1 ]]; then bun_args=("--parallel=$workers"); fi
    ;;
esac

# runs inside the guard scope: the command, then the scope's peak memory (cgroup v2 memory.peak) when readable
scope_cmd='"$@"; status=$?; f="/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)/memory.peak"
[ -r "$f" ] && echo "test-pkg: peak $(( $(cat "$f") / 1048576 ))M"; exit $status'

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
status=0
started=$SECONDS
"$guard" run -- bash -c "$scope_cmd" scope ${lock[@]+"${lock[@]}"} ${limit[@]+"${limit[@]}"} mise exec -- bun test ${bun_args[@]+"${bun_args[@]}"} 2>&1 | tee "$log" || status=$?
count="$(sed -nE 's/^ *([0-9]+) skip$/\1/p' "$log" | tail -1)"
echo "test-pkg: ran $((SECONDS - started))s, ${count:-0} skipped"
exit "$status"
