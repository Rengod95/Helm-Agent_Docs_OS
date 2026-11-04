#!/usr/bin/env bash
# ws-guard v3
# scripts/guard.sh: tests and verifications under a machine-wide guard (the source is dotfiles modules/ws/templates/guard.sh;
# ws repo new and ws repo adopt copy it, ws stack update guard brings the copy to the newest version; `ws guard` runs the
# dotfiles copy, which the Claude Code hook ws-guard-hook points agents to). guard-supervise.pl, beside this file, is the
# supervisor of the path without systemd; the copies carry it along.
# Parallel agents that run tests in many worktrees can exhaust the machine (swap thrashing froze the WSL VM). So:
#   guard.sh verify [opts] -- <cmd...>  a machine-wide slot (flock: at most WS_GUARD_SLOTS verifications at once, the rest
#                                      wait), then the whole command in one systemd user scope, capped at WS_GUARD_VERIFY_MAX
#   guard.sh run [opts] -- <cmd...>     the command in one systemd user scope, capped at WS_GUARD_RUN_MAX (no slot)
#   guard.sh group [opts] -- <cmd...>   the command and what it starts, in one supervised process group: no memory cap, no
#                                      slot, a time limit only with --timeout or WS_GUARD_TIMEOUT_SEC; it ends with the command
# Every scope sits in the shared slice WS_GUARD_SLICE (ws-dev.slice, installed by the ws module: dot install ws), whose
# limit is the memory budget of all tests and verifications together. Exceeding a cap ends only that run (exit 137).
# Admission: a run starts only when the caps of the guarded runs alive now plus its own fit the shared slice, and the
# machine has WS_GUARD_FLOOR_MB of MemAvailable left after it. Until then it waits (one "waiting" note), at most --wait seconds.
# A scope has no swap, OOMPolicy=kill (an oom-kill ends the whole run) and, where choom exists, oom_score_adj 900: when
# memory runs out, tests die before the agents and the IDE.
# When the guard stops a run it says why in its last two lines, and exits by the convention of ws (README 0절):
#   ws-guard: reason=<r> unit=<u> cap=<c> peak=<p> killed=<comm> t=<s>s     (for tools and the hook)
#   ENV|FAIL ws-guard <r>: <what happened> → <what to do>                    (for people and agents)
#   exit 2 (environment: do not change code): oom-cap (its own cap), oom-shared (ws-dev.slice full), oom-ceiling (the
#     user's memory ceiling full), oom-machine (the whole VM), oom-unknown, busy (admission waited too long),
#     timeout-slow (still busy at the time limit), timeout-limit (the time limit on the supervised path, see below),
#     signal (killed from outside)
#   exit 1 (fix it): timeout (idle at the time limit: it hangs), crash (SIGSEGV, SIGABRT, SIGFPE)
# Every stop is also one JSON line in ~/.cache/ws/guard-events.log (ws-guard-hook reads it back to the agent).
# Without a stop the exit code is the command's (--codes conv, the default), or, with --codes tool, 0 stays 0, 126/127
# become 2 (not found: environment) and any other failure becomes 1 (tsc exits 2 on a type error, which is not exit 2).
# Inside a guarded run the nested guard.sh calls run the command directly: the outer scope already caps it (and a nested
# verify would wait for a slot its parent holds). group is the exception: it has no cap and no slot, so it stays supervised.
#
# The supervised path: group always, and run or verify where there is no systemd user session (macOS, CI, containers) or
# WS_GUARD_NO_SYSTEMD is set. The command runs under guard-supervise.pl (perl: part of macOS and every Linux base image) in
# its own process group. The time limit ends it (exit 124). The whole group, and every descendant that left it while its
# parent lived, ends when the command exits, the limit passes, guard.sh gets TERM, INT or HUP, or the caller is gone.
# There is no memory cap. verify takes a machine slot without flock: a lock directory per slot in $TMPDIR (WS_GUARD_SLOTS).
# Without perl the time limit is timeout's, when timeout exists, and nothing else is supervised.
# On this path --codes conv gives the command's code, 124 for the time limit and 128+n for a signal, as the supervisor does.
# --codes tool maps them: a time limit (124, when one was set) and a signal from outside (129, 137, 143) are stops of this
# guard: exit 2, with the two lines above (reason timeout-limit, signal). A crash (134, 136, 139) is 1. Any other failure is 1,
# and 126/127 are 2. The time limit is 2 because the guard cannot see whether the command was idle: its message says to rerun
# once with a longer limit. With perl and --codes tool, guard.sh stays the parent of the supervisor (exec would hand the
# supervisor's code to the caller unmapped): it forwards TERM, INT and HUP to it, and it ends the supervisor, within a second,
# when guard.sh's own parent changes (the supervisor sees only guard.sh as its parent, not the caller behind it).
# env: WS_GUARD_SLOTS (2)           verifications at once on this machine
#      WS_GUARD_VERIFY_MAX (2560M)  memory cap of one verification
#      WS_GUARD_RUN_MAX (1500M)     memory cap of one run
#      WS_GUARD_TIMEOUT_SEC         seconds a run may take, 0 for no limit (default: run 900, verify and group none)
#      WS_GUARD_WAIT_SEC (600)      longest admission wait
#      WS_GUARD_FLOOR_MB (1200)     MemAvailable that must remain after a run's cap, 0 for no check
#      WS_GUARD_SLICE (ws-dev.slice)  the shared slice
#      WS_GUARD_SAMPLE_SEC (5)      seconds between samples of the top memory users in ~/.cache/ws/guard-mem.log, 0 for none
#      WS_GUARD_POLL_SEC (3)        seconds between looks for a free slot or room
#      WS_GUARD_GRACE_SEC (5)       seconds between TERM and KILL when the supervised group ends (no systemd)
#      WS_GUARD_NO_SYSTEMD (unset)  1 takes the supervised path even where a systemd user session exists
# options, before --: --codes conv|tool   --wait SEC   --timeout SEC (this run's time limit, over WS_GUARD_TIMEOUT_SEC)
# Bash 3.2 compatible (the Mac's /bin/bash).
set -euo pipefail

guard_usage() {
  cat >&2 <<'EOF'
usage: guard.sh verify -- <command...>   take a machine slot, run the command capped (one verification)
       guard.sh run -- <command...>      run the command capped in the shared slice (one test run)
       guard.sh group -- <command...>    run the command in its own supervised process group (no cap, no slot)
options, before --: --codes conv|tool   --wait SEC   --timeout SEC
EOF
}

mode="${1:-}"
case "$mode" in
  verify | run | group) shift ;;
  -h | --help)
    guard_usage
    exit 0
    ;;
  *)
    guard_usage
    exit 64
    ;;
esac
codes=conv
wait_sec="${WS_GUARD_WAIT_SEC:-600}"
timeout_opt=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --) shift; break ;;
    --codes)
      [ "$#" -ge 2 ] || { guard_usage; exit 64; }
      codes="$2"
      shift 2
      ;;
    --wait)
      [ "$#" -ge 2 ] || { guard_usage; exit 64; }
      wait_sec="$2"
      shift 2
      ;;
    --timeout)
      [ "$#" -ge 2 ] || { guard_usage; exit 64; }
      timeout_opt="$2"
      shift 2
      ;;
    -*) guard_usage; exit 64 ;;
    *) break ;;
  esac
done
case "$codes" in conv | tool) ;; *) guard_usage; exit 64 ;; esac
case "$wait_sec$timeout_opt" in *[!0-9]*) guard_usage; exit 64 ;; esac
if [ "$#" -eq 0 ]; then
  guard_usage
  exit 64
fi

# map_code RC: the exit code of a command that the guard did not stop
map_code() {
  if [ "$codes" = conv ] || [ "$1" = 0 ]; then echo "$1"; return; fi
  case "$1" in
    126 | 127) echo 2 ;;
    *) echo 1 ;;
  esac
}

# run_direct CMD...: the command without a new scope, its code mapped
run_direct() {
  local rc=0
  "$@" || rc=$?
  exit "$(map_code "$rc")"
}

# nested in a guarded run: the outer scope is the cap (group has none, so it is not nested-exec'd: it stays supervised)
if [ -n "${WS_GUARD_ACTIVE:-}" ] && [ "$mode" != group ]; then run_direct "$@"; fi

slice="${WS_GUARD_SLICE:-ws-dev.slice}"
slots="${WS_GUARD_SLOTS:-2}"
sample_sec="${WS_GUARD_SAMPLE_SEC:-5}"
poll_sec="${WS_GUARD_POLL_SEC:-3}"
floor_mb="${WS_GUARD_FLOOR_MB:-1200}"
if [ "$mode" = verify ]; then
  mem="${WS_GUARD_VERIFY_MAX:-2560M}"
  timeout_sec="${WS_GUARD_TIMEOUT_SEC:-0}"
elif [ "$mode" = group ]; then
  mem=""
  timeout_sec="${WS_GUARD_TIMEOUT_SEC:-0}"
else
  mem="${WS_GUARD_RUN_MAX:-1500M}"
  timeout_sec="${WS_GUARD_TIMEOUT_SEC:-900}"
fi
[ -z "$timeout_opt" ] || timeout_sec="$timeout_opt"

# a systemd user session that can start scopes ("degraded" only means some unit failed)
guard_systemd() {
  command -v systemd-run >/dev/null 2>&1 || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  case "$(systemctl --user is-system-running 2>/dev/null)" in
    running | degraded) return 0 ;;
    *) return 1 ;;
  esac
}

# to_mb SIZE: 1500M, 3G, 2147483648 (bytes), infinity -> megabytes (infinity: empty)
to_mb() {
  case "$1" in
    *[Gg]) echo $((${1%[Gg]} * 1024)) ;;
    *[Mm]) echo "${1%[Mm]}" ;;
    *[Kk]) echo $((${1%[Kk]} / 1024)) ;;
    '' | infinity | max | *[!0-9]*) echo "" ;;
    *) echo $(($1 / 1048576)) ;;
  esac
}
mem_mb="$(to_mb "$mem")"

dir_name="${PWD##*/}"
safe_dir="$(printf '%s' "$dir_name" | tr -c 'A-Za-z0-9_-' '_' | cut -c1-24)"
unit="ws-guard-$mode-$safe_dir-$$-$(date +%s)"
# what the command was, for the notes and the event log: 80 characters, values of *KEY*/*TOKEN*/*SECRET*/*PASS* hidden
cmd_text="$(printf '%s ' "$@" | tr '\n\t' '  ' | sed -E 's/([A-Za-z_]*(KEY|TOKEN|SECRET|PASS)[A-Za-z_]*=)[^ ]*/\1***/g' | cut -c1-80)"
cmd_text="${cmd_text% }"
start_epoch="$(date +%s)"

# ---- the stop report

reason=""
killed=""
peak_mb=""
cap_text="$mem"
ev_dir="${XDG_CACHE_HOME:-$HOME/.cache}/ws"

# finish CODE LEVEL TEXT: the two last lines, one event line, exit CODE
finish() {
  local code="$1" level="$2" text="$3" now caller_cg
  now="$(date +%s)"
  caller_cg="$(sed -n 's/^0:://p' /proc/self/cgroup 2>/dev/null || true)"
  echo "ws-guard: reason=$reason unit=$unit cap=$cap_text peak=${peak_mb:-?}M killed=${killed:-?} t=$((now - start_epoch))s" >&2
  printf '%-8sws-guard %s: %s\n' "$level" "$reason" "$text" >&2
  mkdir -p "$ev_dir" 2>/dev/null || true
  if [ -f "$ev_dir/guard-events.log" ] && [ "$(wc -c <"$ev_dir/guard-events.log" | tr -d ' ')" -gt 2000000 ]; then
    mv "$ev_dir/guard-events.log" "$ev_dir/guard-events.log.1" 2>/dev/null || true
  fi
  printf '{"ts":%s,"unit":"%s","caller_cg":"%s","mode":"%s","dir":"%s","cmd":"%s","reason":"%s","exit":%s,"cap":"%s","peak_mb":"%s","killed":"%s","line":"%s"}\n' \
    "$now" "$unit" "$caller_cg" "$mode" "$(json_esc "$dir_name")" "$(json_esc "$cmd_text")" "$reason" "$code" "$cap_text" \
    "${peak_mb:-}" "$(json_esc "$killed")" "$(json_esc "$(printf '%-8sws-guard %s: %s' "$level" "$reason" "$text")")" \
    >>"$ev_dir/guard-events.log" 2>/dev/null || true
  exit "$code"
}

json_esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037'; }

# ---- admission: a verification slot, then room in the shared slice and on the machine

# reserved_mb: the caps of the guarded runs alive now (their scopes are named ws-guard-*)
reserved_mb() {
  local total=0 u cap m
  for u in $(systemctl --user list-units --plain --no-legend --state=active 'ws-guard-*.scope' 2>/dev/null | awk '{print $1}'); do
    cap="$(systemctl --user show "$u" -p MemoryMax --value 2>/dev/null || true)"
    m="$(to_mb "$cap")"
    total=$((total + ${m:-0}))
  done
  echo "$total"
}

avail_mb() { awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null || echo ""; }

waited=0
deadline=$((start_epoch + wait_sec))
# note_wait WHY: the one "waiting" note; past the deadline, the busy stop
note_wait() {
  if [ "$waited" = 0 ]; then
    echo "guard.sh: $1, waiting" >&2
    waited=1
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    reason=busy
    finish 2 ENV "$1 for ${wait_sec}s → rerun the same command with --wait 1800 (or later); do not change code; report if it stays busy for 30 minutes"
  fi
  sleep "$poll_sec"
}

# ---- the supervised path (group always; run and verify without systemd, or with WS_GUARD_NO_SYSTEMD): see the header

# wait_child PID: the exit code of PID in child_rc. wait returns early when a trap (TERM, INT, HUP) runs: then PID is still
# there, and the loop waits again
wait_child() {
  while :; do
    child_rc=0
    if wait "$1" 2>/dev/null; then child_rc=0; else child_rc=$?; fi
    kill -0 "$1" 2>/dev/null || break
  done
}

# supervised_exit RC: the exit of a command that ran on the supervised path. conv: RC as guard-supervise.pl gives it. tool: the
# time limit (124, when one was set) and a signal from outside (129, 137, 143) are stops of this guard (2), a crash (134, 136,
# 139) is 1, and the rest goes through map_code.
supervised_exit() {
  local rc="$1" sig=""
  if [ "$codes" = conv ]; then exit "$rc"; fi
  case "$rc" in
    124)
      if [ "$timeout_sec" != 0 ]; then
        reason=timeout-limit
        finish 2 ENV "'$cmd_text' passed its ${timeout_sec}s time limit (without systemd the guard cannot tell a hang from a slow run) → rerun once with --timeout $((timeout_sec * 2)) (at most 3600); if it passes that limit too, it hangs: fix that, do not raise the limit"
      fi
      ;;
    129 | 137 | 143)
      reason=signal
      finish 2 ENV "'$cmd_text' was killed by a signal (exit $rc) from outside: not the time limit → rerun once if you did not stop it; report if it repeats"
      ;;
    134 | 136 | 139)
      reason=crash
      sig=SEGV
      [ "$rc" = 134 ] && sig=ABRT
      [ "$rc" = 136 ] && sig=FPE
      finish 1 FAIL "'$cmd_text' died of SIG$sig → a crash in the code or a native module; read the output above and fix it"
      ;;
  esac
  exit "$(map_code "$rc")"
}

# guard_supervised ARGS...: the command on the supervised path. Never returns.
guard_supervised() {
  local supervisor limit_text why lock_dir taken i holder caller me child dog
  supervisor="$(dirname "${BASH_SOURCE[0]}")/guard-supervise.pl"
  limit_text="no time limit"
  if [ "$timeout_sec" != 0 ]; then limit_text="time limit ${timeout_sec}s"; fi
  cap_text="none"
  if [ "$mode" != group ]; then
    # a nested run or verify inside the command runs it directly: this process is its outer guard
    export WS_GUARD_ACTIVE="$mode"
    why="no systemd user session"
    if [ -n "${WS_GUARD_NO_SYSTEMD:-}" ]; then why="WS_GUARD_NO_SYSTEMD is set"; fi
    echo "guard.sh: $why, running $mode without a memory cap (own process group, $limit_text)" >&2
  fi
  if [ "$mode" = verify ]; then
    # a machine slot without flock (macOS): a lock directory per slot, holding the pid of its holder; a dead holder's slot is taken over
    lock_dir="${TMPDIR:-/tmp}/ws-guard-$UID"
    mkdir -p "$lock_dir"
    taken=""
    while [ -z "$taken" ]; do
      i=1
      while [ "$i" -le "$slots" ]; do
        if mkdir "$lock_dir/slot$i" 2>/dev/null; then
          taken="$lock_dir/slot$i"
          break
        fi
        holder="$(cat "$lock_dir/slot$i/pid" 2>/dev/null || true)"
        if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
          rm -rf "$lock_dir/slot$i" 2>/dev/null || true
          if mkdir "$lock_dir/slot$i" 2>/dev/null; then
            taken="$lock_dir/slot$i"
            break
          fi
        fi
        i=$((i + 1))
      done
      [ -n "$taken" ] || note_wait "all $slots verification slots of this machine are busy"
    done
    # the holder is this pid: the exec below keeps it (the supervisor takes it over), so the slot is held until the command ends
    echo "$$" >"$taken/pid"
  fi
  if command -v perl >/dev/null 2>&1 && [ -r "$supervisor" ]; then
    if [ "$codes" = conv ]; then
      # exec: the supervisor's parent is the caller of guard.sh, so it sees the caller die
      exec perl "$supervisor" "$timeout_sec" "${WS_GUARD_GRACE_SEC:-5}" -- "$@"
    fi
    # --codes tool: guard.sh stays the parent, so the code can be mapped (see the header). The supervisor runs in the background
    # with stdin kept (a background command would get /dev/null); a watcher ends it when guard.sh's own parent changes
    caller="$PPID"
    me="$$"
    perl "$supervisor" "$timeout_sec" "${WS_GUARD_GRACE_SEC:-5}" -- "$@" <&0 &
    child=$!
    (
      while sleep 1; do
        if [ "$(ps -o ppid= -p "$me" 2>/dev/null | tr -d ' ')" != "$caller" ]; then
          kill -TERM "$child" 2>/dev/null || true
          exit 0
        fi
      done
    ) </dev/null >/dev/null 2>&1 &
    dog=$!
    trap 'kill -TERM "$child" 2>/dev/null || true' TERM
    trap 'kill -INT "$child" 2>/dev/null || true' INT
    trap 'kill -HUP "$child" 2>/dev/null || true' HUP
    wait_child "$child"
    kill "$dog" 2>/dev/null || true
    supervised_exit "$child_rc"
  fi
  echo "guard.sh: no perl, running $mode without a process group supervisor" >&2
  if [ "$timeout_sec" != 0 ] && command -v timeout >/dev/null 2>&1; then
    if [ "$codes" = conv ]; then exec timeout "$timeout_sec" "$@"; fi
    child_rc=0
    timeout "$timeout_sec" "$@" || child_rc=$?
    supervised_exit "$child_rc"
  fi
  if [ "$codes" = conv ]; then exec "$@"; fi
  child_rc=0
  "$@" || child_rc=$?
  supervised_exit "$child_rc"
}

if [ "$mode" = group ] || [ -n "${WS_GUARD_NO_SYSTEMD:-}" ] || ! guard_systemd; then
  guard_supervised "$@"
fi

if ! systemctl --user cat "$slice" >/dev/null 2>&1; then
  echo "guard.sh: $slice is not installed: each run is capped, but there is no shared memory budget (dot install ws)" >&2
fi

slice_mb="$(to_mb "$(systemctl --user show "$slice" -p MemoryMax --value 2>/dev/null || true)")"
if [ -n "$slice_mb" ] && [ -n "$mem_mb" ] && [ "$mem_mb" -gt "$slice_mb" ]; then
  echo "guard.sh: the cap $mem is larger than $slice ($slice_mb M): the run cannot be admitted" >&2
  exit 64
fi

if [ "$mode" = verify ] && command -v flock >/dev/null 2>&1; then
  lock_dir="${XDG_RUNTIME_DIR:-/tmp}/ws-guard"
  mkdir -p "$lock_dir"
  taken=0
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
    [ "$taken" = 1 ] || note_wait "all $slots verification slots of this machine are busy"
  done
fi

if [ -n "$mem_mb" ]; then
  while :; do
    resv="$(reserved_mb)"
    if [ -n "$slice_mb" ] && [ $((resv + mem_mb)) -gt "$slice_mb" ]; then
      note_wait "the shared test budget $slice is reserved (${resv}M of ${slice_mb}M by running guarded runs, this one needs ${mem_mb}M)"
      continue
    fi
    av="$(avail_mb)"
    if [ "$floor_mb" != 0 ] && [ -n "$av" ] && [ $((av - mem_mb)) -lt "$floor_mb" ]; then
      note_wait "the machine has ${av}M available, this run may take ${mem_mb}M and ${floor_mb}M must remain"
      continue
    fi
    break
  done
fi

# ---- the run

# the top memory users while the command runs (a person reads this after a freeze or an oom-kill)
sampler=""
if [ "$sample_sec" != 0 ] && command -v ps >/dev/null 2>&1; then
  log_dir="${XDG_CACHE_HOME:-$HOME/.cache}/ws"
  log="$log_dir/guard-mem.log"
  mkdir -p "$log_dir"
  if [ -f "$log" ] && [ "$(wc -c <"$log" | tr -d ' ')" -gt 5000000 ]; then mv "$log" "$log.1"; fi
  guard_pid="$$"
  (
    while sleep "$sample_sec"; do
      {
        echo "== $(date '+%F %T') $mode $dir_name pid $guard_pid $(free -m | awk 'NR==2{print "used " $3 "M avail " $7 "M"}')"
        ps -eo rss=,comm= --sort=-rss | head -8
      } >>"$log" 2>&1
    done
  ) >/dev/null 2>&1 9>&- &
  sampler=$!
fi

# the scope's own numbers (peak memory, CPU time), every 2 s while it runs: the peak and the idle test of a timeout
stat_file="${XDG_RUNTIME_DIR:-/tmp}/$unit.stat"
cg_root=/sys/fs/cgroup
(
  cg=""
  while sleep 2; do
    if [ -z "$cg" ]; then
      cg="$(systemctl --user show "$unit.scope" -p ControlGroup --value 2>/dev/null || true)"
      [ -n "$cg" ] && [ -d "$cg_root$cg" ] || { cg=""; continue; }
    fi
    [ -d "$cg_root$cg" ] || break
    pk="$(cat "$cg_root$cg/memory.peak" 2>/dev/null || cat "$cg_root$cg/memory.current" 2>/dev/null || echo 0)"
    cpu="$(awk '/^usage_usec/ {print $2}' "$cg_root$cg/cpu.stat" 2>/dev/null || echo 0)"
    echo "$(date +%s) $pk $cpu" >>"$stat_file"
  done
) >/dev/null 2>&1 9>&- &
stat_pid=$!
trap '[ -z "$sampler" ] || kill "$sampler" 2>/dev/null || true; kill "$stat_pid" 2>/dev/null || true; rm -f "$stat_file"' EXIT

adj=()
if command -v choom >/dev/null 2>&1; then adj=(choom -n 900 --); fi
args="-p OOMPolicy=kill -p MemoryHigh=infinity -p MemoryMax=$mem -p MemorySwapMax=0"
if [ "$timeout_sec" != 0 ]; then args="$args -p RuntimeMaxSec=$timeout_sec"; fi
export WS_GUARD_ACTIVE="$mode"
status=0
# shellcheck disable=SC2086 # args is a list of -p options, split on purpose
systemd-run --user --scope --quiet --unit="$unit" --slice="$slice" --description="ws guard $mode $dir_name: $cmd_text" \
  $args -- ${adj[@]+"${adj[@]}"} "$@" 9>&- || status=$?

result="$(systemctl --user show "$unit.scope" -p Result --value 2>/dev/null || true)"
kill "$stat_pid" 2>/dev/null || true
if [ -s "$stat_file" ]; then
  peak_mb="$(awk 'BEGIN {m = 0} $2 > m {m = $2} END {print int(m / 1048576)}' "$stat_file")"
fi
systemctl --user stop "$unit.scope" >/dev/null 2>&1 || true
systemctl --user reset-failed "$unit.scope" >/dev/null 2>&1 || true

# kernel_oom: the oom-kill line of the kernel for this scope (journal, then dmesg); sets oom_memcg, killed, constraint
oom_memcg=""
constraint=""
kernel_oom() {
  local line="" n=0
  if command -v journalctl >/dev/null 2>&1; then
    while [ "$n" -lt 4 ]; do
      line="$(journalctl -k --since "@$start_epoch" --no-pager -o cat 2>/dev/null | grep 'oom-kill:' | grep -F "/$unit.scope" | tail -n 1 || true)"
      [ -n "$line" ] && break
      n=$((n + 1))
      sleep 0.5
    done
  fi
  if [ -z "$line" ] && command -v dmesg >/dev/null 2>&1; then
    line="$(dmesg 2>/dev/null | grep 'oom-kill:' | grep -F "/$unit.scope" | tail -n 1 || true)"
  fi
  [ -n "$line" ] || return 1
  constraint="$(printf '%s' "$line" | sed -n 's/.*constraint=\([A-Z_]*\).*/\1/p')"
  oom_memcg="$(printf '%s' "$line" | sed -n 's/.*oom_memcg=\([^,]*\).*/\1/p')"
  killed="$(printf '%s' "$line" | sed -n 's/.*task=\([^,]*\),pid=\([0-9]*\).*/\1:\2/p')"
  return 0
}

# idle_at_end: the scope used under 2 % of one CPU over its last samples (about a minute)
idle_at_end() {
  [ -s "$stat_file" ] || return 1
  tail -n 30 "$stat_file" | awk 'NR == 1 {t0 = $1; c0 = $3} {t1 = $1; c1 = $3}
    END {if (t1 - t0 < 10) exit 1; exit !(((c1 - c0) / 1e6) / (t1 - t0) < 0.02)}'
}

if [ "$result" = oom-kill ] || { [ "$status" = 137 ] && [ "$result" != timeout ]; } && kernel_oom; then
  if [ "$constraint" = CONSTRAINT_NONE ]; then
    reason=oom-machine
    finish 2 ENV "the whole VM ran out of memory while '$cmd_text' ran (not a guard limit) → do not rerun now; stop heavy work and report to the owner"
  fi
  case "$oom_memcg" in
    */"$unit.scope")
      reason=oom-cap
      finish 2 ENV "'$cmd_text' used its whole $mem cap (killed ${killed:-a process}) → rerun ONCE with less parallelism on the command line (vitest/jest --maxWorkers=2, turbo --concurrency=1, pnpm --workspace-concurrency=1, one package at a time); do not change code or config, raise the cap or run it unguarded; if it fails again report 'not completed: oom-cap $mem' (a narrowed run is not a pass)"
      ;;
    */"$slice")
      reason=oom-shared
      finish 2 ENV "the shared test budget $slice was full (other guarded runs; killed ${killed:-a process}) → rerun once with --wait 1800; do not change code"
      ;;
    */user-*.slice)
      reason=oom-ceiling
      finish 2 ENV "the user's machine-wide memory ceiling was full (sessions, IDE and tests together; tests are killed first by design; killed ${killed:-a process}) → rerun once with --wait 1800; if it happens again do not rerun, report to the owner; do not change code or stop other work"
      ;;
  esac
fi
if [ "$result" = oom-kill ]; then
  reason=oom-unknown
  finish 2 ENV "'$cmd_text' was oom-killed (no kernel line found to say which limit) → rerun once with --wait 1800; report if it repeats; do not change code"
fi
if [ "$result" = timeout ]; then
  if idle_at_end; then
    reason=timeout
    finish 1 FAIL "'$cmd_text' was idle at its ${timeout_sec}s time limit → it hangs or waits (watch mode, a server, an open handle, a prompt); fix that, do not raise the limit"
  fi
  reason=timeout-slow
  finish 2 ENV "'$cmd_text' was still busy at its ${timeout_sec}s time limit → rerun once with --timeout $((timeout_sec * 2)) (at most 3600) and narrower scope; report if it does not finish"
fi
case "$status" in
  134 | 136 | 139)
    reason=crash
    sig=SEGV
    [ "$status" = 134 ] && sig=ABRT
    [ "$status" = 136 ] && sig=FPE
    finish 1 FAIL "'$cmd_text' died of SIG$sig → a crash in the code or a native module; read the output above and fix it (a 'heap out of memory' line means the V8 heap: reduce workers or set NODE_OPTIONS=--max-old-space-size=$(((${mem_mb:-2048} * 7) / 10)))"
    ;;
  129 | 137 | 143)
    if [ "$status" = 143 ] && [ "$result" = success ]; then exit 143; fi
    reason=signal
    finish 2 ENV "'$cmd_text' was killed by a signal (exit $status) from outside: not memory, not the time limit → rerun once if you did not stop it; report if it repeats"
    ;;
esac
exit "$(map_code "$status")"
