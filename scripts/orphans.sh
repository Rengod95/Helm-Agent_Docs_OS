#!/usr/bin/env bash
# scripts/orphans.sh: test-like and monitor processes whose parent is gone (reparented to pid 1), with age and worktree.
# usage: orphans.sh [--min-age SEC] [--grace SEC] [--root DIR]... [--reap [--yes]]
#   (no flag)    read-only list. Never changes anything.
#   --reap       stop the processes that belong to this repository's worktrees (git worktree list, or ORPHANS_ROOTS, plus every --root)
#                and are at least --min-age seconds old (default 600), together with their descendants: SIGTERM, then SIGKILL
#                after --grace seconds (default 5). Stopping a process cannot be undone, so without --yes it only prints
#                what it would stop and exits 3 (a person looks, then runs it again with --yes).
# What counts: processes of this user whose parent is pid 1 and whose command matches bun test, bun run, turbo, vitest,
#   playwright, oxlint, tsc, cargo test, sandbox-exec or the srt violation monitor (`log stream ... _SBX`); ORPHANS_PATTERN adds an
#   extended regex. A process is "ours" when its working directory is inside one of the worktrees. Others are listed and left alone.
# env: ORPHANS_PATTERN extra command regex; ORPHANS_ROOTS colon-separated roots that replace the git worktrees (the tests use it,
#      so they reach only their own probes, never another worktree's processes).
# exit: 0 list printed, or reap done; 1 a process survived SIGKILL; 2 environment problem (no ps, not in a git repository);
#       3 --reap without --yes (nothing was stopped); 64 wrong call.
# Bash 3.2 compatible (the Mac's /bin/bash).
set -euo pipefail

min_age=600
grace=5
reap=0
yes=0
roots=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --min-age) min_age="${2:?--min-age needs seconds}"; shift 2 ;;
    --grace) grace="${2:?--grace needs seconds}"; shift 2 ;;
    --root) roots+=("${2:?--root needs a directory}"); shift 2 ;;
    --reap) reap=1; shift ;;
    --yes) yes=1; shift ;;
    -h | --help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "usage: orphans.sh [--min-age SEC] [--grace SEC] [--root DIR]... [--reap [--yes]]" >&2; exit 64 ;;
  esac
done
case "$min_age$grace" in *[!0-9]*) echo "orphans: --min-age and --grace are whole seconds" >&2; exit 64 ;; esac

command -v ps >/dev/null 2>&1 || { echo "orphans: ps is missing" >&2; exit 2; }
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if ! wt="$(git -C "$repo" worktree list --porcelain 2>/dev/null)"; then
  echo "orphans: $repo is not a git repository" >&2
  exit 2
fi
if [ -n "${ORPHANS_ROOTS:-}" ]; then
  # the tests: these roots replace the worktrees, so nothing else can be a candidate
  old_ifs="$IFS"; IFS=:
  # shellcheck disable=SC2206 # split on the colons on purpose
  extra=($ORPHANS_ROOTS)
  IFS="$old_ifs"
  roots+=("${extra[@]}")
else
  while IFS= read -r line; do
    case "$line" in "worktree "*) roots+=("${line#worktree }") ;; esac
  done <<<"$wt"
fi
resolved=()
for r in "${roots[@]}"; do
  if [ -d "$r" ]; then resolved+=("$(cd "$r" && pwd -P)"); fi
done
roots=("${resolved[@]}")

pattern='(^|/| )bun (test|run)( |$)|(^|/| )turbo( |$)|vitest|playwright|oxlint|(^|/| )tsc( |$)|cargo test|sandbox-exec|log stream .*_SBX'
if [ -n "${ORPHANS_PATTERN:-}" ]; then pattern="$pattern|$ORPHANS_PATTERN"; fi

# "pid<TAB>cwd" for each pid of a comma list: /proc on Linux, one lsof call on macOS (a call per pid costs ~0.1 s each under load)
cwd_table() {
  local p
  if [ -d /proc/self ]; then
    for p in $(printf '%s' "$1" | tr , ' '); do
      printf '%s\t%s\n' "$p" "$(readlink "/proc/$p/cwd" 2>/dev/null || true)"
    done
    return 0
  fi
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -a -d cwd -Fn -p "$1" 2>/dev/null | awk '/^p/ { p = substr($0, 2) } /^n/ { printf "%s\t%s\n", p, substr($0, 2) }' || true
}

# the worktree root that holds this directory, empty when none does
root_of() {
  local dir="$1" r best=""
  for r in "${roots[@]}"; do
    case "$dir/" in "$r"/*) if [ "${#r}" -gt "${#best}" ]; then best="$r"; fi ;; esac
  done
  printf '%s' "$best"
}

# one line per process of an orphan tree: root pid, pid, age seconds, command (the awk walks parent links, so a child of an orphan is found)
tree="$(ps -U "$(id -u)" -axo pid=,ppid=,etime=,command= | awk -v pat="$pattern" -v self="$$" '
  function secs(t,   n, p, d) {
    d = 0
    if (index(t, "-")) { split(t, a, "-"); d = a[1]; t = a[2] }
    n = split(t, p, ":")
    if (n == 3) return d * 86400 + p[1] * 3600 + p[2] * 60 + p[3]
    return d * 86400 + p[1] * 60 + p[2]
  }
  {
    pid = $1; ppid = $2; age[pid] = secs($3)
    cmd = $0; sub(/^ *[0-9]+ +[0-9]+ +[^ ]+ +/, "", cmd)
    par[pid] = ppid; text[pid] = cmd; order[++n] = pid
  }
  END {
    for (i = 1; i <= n; i++) {
      p = order[i]
      if (par[p] == 1 && p != self && text[p] ~ pat) root[p] = p
    }
    for (i = 1; i <= n; i++) {
      p = order[i]; q = p; hops = 0
      while (!(q in root) && q in par && par[q] > 1 && hops++ < 50) q = par[q]
      if (q in root && p != self && text[p] !~ /<defunct>/) printf "%s\t%s\t%s\t%s\n", q, p, age[p], text[p]
    }
  }')"

if [ -z "$tree" ]; then
  echo "orphans: no orphaned test or monitor processes"
  exit 0
fi

printf '%-7s %-7s %-9s %-26s %s\n' PID ROOT AGE WORKTREE COMMAND
cwds="$(cwd_table "$(printf '%s\n' "$tree" | cut -f1 | sort -u | paste -sd, -)")"
reap_pids=""
would=0
while IFS="$(printf '\t')" read -r root_pid pid age cmd; do
  cwd="$(awk -F '\t' -v p="$root_pid" '$1 == p { print $2; exit }' <<<"$cwds")"
  owner="$(root_of "${cwd:-/nonexistent}")"
  name="?"
  note=""
  if [ -n "$owner" ]; then
    name="${owner##*/}"
    if [ "$age" -ge "$min_age" ]; then note="reapable"; else note="younger than ${min_age}s"; fi
  else
    note="not this repository's worktree, left alone"
  fi
  short="${cmd:0:90}"
  printf '%-7s %-7s %-9s %-26s %s  [%s]\n' "$pid" "$root_pid" "${age}s" "$name" "$short" "$note"
  if [ "$note" = reapable ]; then reap_pids="$reap_pids $pid"; would=$((would + 1)); fi
done <<<"$tree"

if [ "$reap" = 0 ]; then
  echo "orphans: read-only list; just orphans --reap [--yes] stops the reapable ones"
  exit 0
fi
if [ "$would" = 0 ]; then
  echo "orphans: nothing to reap"
  exit 0
fi
if [ "$yes" = 0 ]; then
  echo "orphans: would stop $would process(es); check the list, then run again with --yes" >&2
  exit 3
fi

# children first would leave nothing to find by parent links, so signal the whole set at once
# shellcheck disable=SC2086 # reap_pids is a list of pids
kill -TERM $reap_pids 2>/dev/null || true
waited=0
while [ "$waited" -lt "$grace" ]; do
  alive=0
  for p in $reap_pids; do if kill -0 "$p" 2>/dev/null; then alive=1; fi; done
  [ "$alive" = 0 ] && break
  sleep 1
  waited=$((waited + 1))
done
left=0
for p in $reap_pids; do
  if kill -0 "$p" 2>/dev/null; then
    kill -KILL "$p" 2>/dev/null || true
    sleep 0.2
    if kill -0 "$p" 2>/dev/null; then left=$((left + 1)); echo "orphans: pid $p survived SIGKILL" >&2; fi
  fi
done
echo "orphans: stopped $((would - left)) of $would"
[ "$left" = 0 ] || exit 1
