#!/usr/bin/env bash
# S1: 종료 원인별로 셸 -> 엔진 -> 손자 프로세스 트리가 10초 뒤 남는지 잰다 (Linux/WSL).
# usage: s1-matrix.sh [matrix|one <cause> <handler 0|1> <policy none|kill> <pg 0|1> <grandchild group|detached> <eof exit-clean|ignore>]
# cause: close(창 닫기 경로), sigkill, sigterm. 결과는 TSV로 stdout에 낸다.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shell_bin="${SPIKE_SHELL_BIN:-${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/xeon/cargo-target}/debug/spike-shell}"  # scripts/cargo.sh와 같은 기본값
engine_bin="$here/out/engine"
work="$(mktemp -d "${TMPDIR:-/tmp}/s1.XXXXXX")"
wait_s="${S1_WAIT_S:-10}"

alive() { # pid가 살아 있는지(좀비 제외)
  local pid="$1" st
  [[ -r /proc/$pid/stat ]] || return 1
  st="$(sed 's/.*) //' /proc/$pid/stat 2>/dev/null | cut -c1)"
  [[ "$st" != "Z" && "$st" != "X" ]]
}

run_one() {
  local cause="$1" handler="$2" policy="$3" pg="$4" gc="$5" eof="$6"
  local d="$work/$RANDOM"; mkdir -p "$d"
  local autoclose=""
  [[ "$cause" == close ]] && autoclose=2500
  SPIKE_SCENARIO=s1 SPIKE_ENGINE="$engine_bin" \
    SPIKE_ENGINE_ARGS="--grandchild=$gc --eof=$eof --state=$d/eng" \
    SPIKE_LOG="$d/log" SPIKE_SHELL_STATE="$d/shell.json" SPIKE_ENGINE_STDERR="$d/engerr" \
    SPIKE_PG="$pg" SPIKE_EXIT_POLICY="$policy" SPIKE_SIGHANDLER="$handler" SPIKE_AUTOCLOSE_MS="$autoclose" \
    "$shell_bin" >"$d/shell.out" 2>&1 &
  local shell_pid=$!
  local i
  for i in $(seq 100); do [[ -f "$d/eng.json" ]] && break; sleep 0.1; done
  if [[ ! -f "$d/eng.json" ]]; then echo -e "$cause\t$handler\t$policy\t$pg\t$gc\t$eof\tSTART-FAILED\t$(head -c 200 "$d/shell.out" | tr '\n' ' ')"; kill -KILL "$shell_pid" 2>/dev/null; return; fi
  sleep 1.5
  local engine_pid gc_pids
  engine_pid="$(sed -E 's/.*"engine":([0-9]+).*/\1/' "$d/eng.json")"
  gc_pids="$(sed -E 's/.*"grandchildren":\[([0-9,]*)\].*/\1/' "$d/eng.json" | tr ',' ' ')"
  local pgid_engine pgid_shell tree
  pgid_shell="$(ps -o pgid= -p "$shell_pid" | tr -d ' ')"
  pgid_engine="$(ps -o pgid= -p "$engine_pid" | tr -d ' ')"
  local pgid_gc=""
  for g in $gc_pids; do pgid_gc="$pgid_gc$(ps -o pgid= -p "$g" | tr -d ' ')"; done
  local t0; t0=$(date +%s%N)
  case "$cause" in
    sigkill) kill -KILL "$shell_pid" ;;
    sigterm) kill -TERM "$shell_pid" ;;
    close) while alive "$shell_pid" && (( ($(date +%s%N) - t0) / 1000000 < 8000 )); do sleep 0.05; done; t0=$(date +%s%N) ;;  # 이후 시간은 셸이 사라진 때부터
  esac
  # 셸이 끝나는 시각, 엔진이 끝나는 시각
  local shell_gone_ms="" engine_gone_ms=""
  local deadline=$(( t0 / 1000000 + wait_s * 1000 ))
  while (( $(date +%s%N) / 1000000 < deadline )); do
    [[ -z "$shell_gone_ms" ]] && ! alive "$shell_pid" && shell_gone_ms=$(( ($(date +%s%N) - t0) / 1000000 ))
    [[ -z "$engine_gone_ms" ]] && ! alive "$engine_pid" && engine_gone_ms=$(( ($(date +%s%N) - t0) / 1000000 ))
    [[ -n "$shell_gone_ms" && -n "$engine_gone_ms" ]] && { all_gone=1; for g in $gc_pids; do alive "$g" && all_gone=0; done; (( all_gone )) && break; }
    sleep 0.05
  done
  local s_alive=no e_alive=no g_alive=""
  alive "$shell_pid" && s_alive=YES
  alive "$engine_pid" && e_alive=YES
  for g in $gc_pids; do alive "$g" && g_alive="${g_alive}YES " || g_alive="${g_alive}no "; done
  local events; events="$(awk '{ $1=""; print }' "$d/log" | grep -E 'CloseRequested|ExitRequested|^ Exit|signal_received|exit_policy_kill|autoclose' | sed 's/uptime_ms=[0-9]*//' | tr '\n' ';' | tr -s ' ')"
  echo -e "$cause\t$handler\t$policy\t$pg\t$gc\t$eof\tshell:${s_alive}(${shell_gone_ms:-}ms)\tengine:${e_alive}(${engine_gone_ms:-}ms)\tgrandchild:${g_alive:-none}\tpgid shell/engine/gc=${pgid_shell}/${pgid_engine}/${pgid_gc}\t${events}"
  for p in $shell_pid $engine_pid $gc_pids; do alive "$p" && kill -KILL "$p" 2>/dev/null; done
  wait "$shell_pid" 2>/dev/null
}

if [[ "${1:-matrix}" == one ]]; then
  shift; run_one "$@"; exit 0
fi

echo -e "cause\tsighandler\texit_policy\tprocess_group\tgrandchild\tengine_eof\tshell_after${wait_s}s\tengine\tgrandchild\tpgids\tshell_events"
for gc in group detached; do
  for eof in exit-clean ignore; do
    run_one close 0 none 1 "$gc" "$eof"
    run_one close 0 kill 1 "$gc" "$eof"
    run_one sigkill 0 none 1 "$gc" "$eof"
    run_one sigterm 0 none 1 "$gc" "$eof"
    run_one sigterm 0 kill 1 "$gc" "$eof"
    run_one sigterm 1 none 1 "$gc" "$eof"
    run_one sigterm 1 kill 1 "$gc" "$eof"
  done
done
# 프로세스 그룹을 끈 경우(E3 대조): 같은 kill 정책
for eof in exit-clean ignore; do
  run_one close 0 kill 0 group "$eof"
  run_one sigterm 1 kill 0 group "$eof"
done
rm -rf "$work"
