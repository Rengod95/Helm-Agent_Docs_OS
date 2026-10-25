#!/usr/bin/env bash
# ws-guard v1
# scripts/guard.sh: tests and verifications under a machine-wide guard (the source is dotfiles modules/ws/templates/guard.sh;
# ws repo new and ws repo adopt copy it, ws stack update guard brings the copy to the newest version).
# Parallel agents that run tests in many worktrees can exhaust a small machine (swap thrashing freezes the VM). So:
#   guard.sh verify -- <cmd...>   a machine-wide slot (flock: at most WS_GUARD_SLOTS verifications at once, the rest wait),
#                                 then the whole command in one systemd user scope, capped at WS_GUARD_VERIFY_MAX
#   guard.sh run -- <cmd...>      the command in one systemd user scope, capped at WS_GUARD_RUN_MAX (no slot)
# Every scope sits in the shared slice WS_GUARD_SLICE (ws-dev.slice, installed by the ws module: dot install ws), whose
# limit is the memory budget of all tests and verifications together. Exceeding a cap ends only that run (exit 137).
# Inside a guarded run the nested guard.sh calls run the command directly: the outer scope already caps it (and a nested
# verify would wait for a slot its parent holds).
# Without a systemd user session (macOS, CI, containers) the command runs unguarded, with one note on stderr: a repository
# stands alone. The exit code of the command is the exit code of guard.sh (64: a wrong call).
# env: WS_GUARD_SLOTS (2)           verifications at once on this machine
#      WS_GUARD_VERIFY_MAX (3G)     memory cap of one verification
#      WS_GUARD_RUN_MAX (1500M)     memory cap of one run
#      WS_GUARD_TIMEOUT_SEC         seconds a run may take, 0 for no limit (default: run 900, verify none)
#      WS_GUARD_SLICE (ws-dev.slice)  the shared slice
#      WS_GUARD_SAMPLE_SEC (5)      seconds between samples of the top memory users in ~/.cache/ws/guard-mem.log, 0 for none
#      WS_GUARD_POLL_SEC (3)        seconds between looks for a free slot
# Bash 3.2 compatible (the Mac's /bin/bash).
set -euo pipefail

guard_usage() {
  cat >&2 <<'EOF'
usage: guard.sh verify -- <command...>   take a machine slot, run the command capped (one verification)
       guard.sh run -- <command...>      run the command capped in the shared slice (one test run)
EOF
}

mode="${1:-}"
case "$mode" in
  verify | run) shift ;;
  -h | --help)
    guard_usage
    exit 0
    ;;
  *)
    guard_usage
    exit 64
    ;;
esac
if [ "${1:-}" = -- ]; then shift; fi
if [ "$#" -eq 0 ]; then
  guard_usage
  exit 64
fi

# nested in a guarded run: the outer scope is the cap
if [ -n "${WS_GUARD_ACTIVE:-}" ]; then exec "$@"; fi

slice="${WS_GUARD_SLICE:-ws-dev.slice}"
slots="${WS_GUARD_SLOTS:-2}"
sample_sec="${WS_GUARD_SAMPLE_SEC:-5}"
if [ "$mode" = verify ]; then
  mem="${WS_GUARD_VERIFY_MAX:-3G}"
  timeout_sec="${WS_GUARD_TIMEOUT_SEC:-0}"
else
  mem="${WS_GUARD_RUN_MAX:-1500M}"
  timeout_sec="${WS_GUARD_TIMEOUT_SEC:-900}"
fi

# a systemd user session that can start scopes ("degraded" only means some unit failed)
guard_systemd() {
  command -v systemd-run >/dev/null 2>&1 || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  case "$(systemctl --user is-system-running 2>/dev/null)" in
    running | degraded) return 0 ;;
    *) return 1 ;;
  esac
}

if ! guard_systemd; then
  echo "guard.sh: no systemd user session, running $mode without a memory cap or slot" >&2
  if [ "$timeout_sec" != 0 ] && command -v timeout >/dev/null 2>&1; then
    exec timeout "$timeout_sec" "$@"
  fi
  exec "$@"
fi

if ! systemctl --user cat "$slice" >/dev/null 2>&1; then
  echo "guard.sh: $slice is not installed: each run is capped, but there is no shared memory budget (dot install ws)" >&2
fi

# a free slot (verify only): a lock file per slot; wait and retry while all are busy
if [ "$mode" = verify ] && command -v flock >/dev/null 2>&1; then
  lock_dir="${XDG_RUNTIME_DIR:-/tmp}/ws-guard"
  mkdir -p "$lock_dir"
  taken=0
  waited=0
  while [ "$taken" = 0 ]; do
    i=1
    while [ "$i" -le "$slots" ]; do
      exec 9>"$lock_dir/slot$i"
      if flock -n 9; then
        taken=1
        break
      fi
      exec 9>&-
      i=$((i + 1))
    done
    if [ "$taken" = 0 ]; then
      if [ "$waited" = 0 ]; then
        echo "guard.sh: all $slots verification slots of this machine are busy, waiting" >&2
        waited=1
      fi
      sleep "${WS_GUARD_POLL_SEC:-3}"
    fi
  done
fi

# the top memory users while the command runs (a person reads this after a freeze or an oom-kill)
sampler=""
if [ "$sample_sec" != 0 ] && command -v ps >/dev/null 2>&1; then
  log_dir="${XDG_CACHE_HOME:-$HOME/.cache}/ws"
  log="$log_dir/guard-mem.log"
  mkdir -p "$log_dir"
  if [ -f "$log" ] && [ "$(wc -c <"$log" | tr -d ' ')" -gt 5000000 ]; then mv "$log" "$log.1"; fi
  guard_pid="$$"
  guard_dir="${PWD##*/}"
  (
    while sleep "$sample_sec"; do
      {
        echo "== $(date '+%F %T') $mode $guard_dir pid $guard_pid $(free -m | awk 'NR==2{print "used " $3 "M avail " $7 "M"}')"
        ps -eo rss=,comm= --sort=-rss | head -8
      } >>"$log" 2>&1
    done
  ) >/dev/null 2>&1 9>&- &
  sampler=$!
fi
trap '[ -z "$sampler" ] || kill "$sampler" 2>/dev/null || true' EXIT

args="-p MemoryMax=$mem -p MemorySwapMax=0"
if [ "$timeout_sec" != 0 ]; then args="$args -p RuntimeMaxSec=$timeout_sec"; fi
export WS_GUARD_ACTIVE="$mode"
status=0
# shellcheck disable=SC2086 # args is a list of -p options, split on purpose
systemd-run --user --scope --quiet --slice="$slice" --description="ws guard $mode ${PWD##*/}" $args -- "$@" 9>&- || status=$?
if [ "$status" = 137 ] || [ "$status" = 143 ]; then
  echo "guard.sh: $mode ended by a signal (exit $status): memory cap $mem or time limit ${timeout_sec}s; see journalctl --user -n 20" >&2
fi
exit "$status"
