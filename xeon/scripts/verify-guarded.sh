#!/usr/bin/env bash
# Run a whole verification under two guards so parallel agents cannot exhaust the machine:
# 1. a machine-wide slot (flock): at most XEON_VERIFY_SLOTS verifications run at once, the rest wait;
# 2. one memory cap for the whole run (systemd user scope): exceeding it ends only this run.
# While it runs, the top memory users are sampled every 5 s to ~/.cache/xeon/verify-mem.log.
# usage: verify-guarded.sh <command> [args...]
# env: XEON_VERIFY_SLOTS (default 2), XEON_VERIFY_MEMORY_MAX (default 3G), XEON_SLICE (default xeon-dev.slice:
#      shared budget for all tests and verifications, ~/.config/systemd/user/xeon-dev.slice)
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: verify-guarded.sh <command> [args...]" >&2
  exit 1
fi

slots="${XEON_VERIFY_SLOTS:-2}"
mem="${XEON_VERIFY_MEMORY_MAX:-3G}"
lock_dir="${XDG_RUNTIME_DIR:-/tmp}/xeon-verify"
log_dir="${XDG_CACHE_HOME:-$HOME/.cache}/xeon"
mkdir -p "$lock_dir" "$log_dir"

# Take a free slot; if all are busy, wait and retry.
slot_fd=""
waited=false
while [[ -z "$slot_fd" ]]; do
  for ((i = 1; i <= slots; i++)); do
    exec {fd}>"$lock_dir/slot$i"
    if flock -n "$fd"; then
      slot_fd="$fd"
      break
    fi
    exec {fd}>&-
  done
  if [[ -z "$slot_fd" ]]; then
    if [[ "$waited" == "false" ]]; then
      echo "verify-guarded: all $slots verification slots are busy, waiting" >&2
      waited=true
    fi
    sleep 5
  fi
done

log="$log_dir/verify-mem.log"
if [[ -f "$log" ]] && [[ "$(stat -c %s "$log")" -gt 5000000 ]]; then mv "$log" "$log.1"; fi
(
  while sleep 5; do
    {
      echo "== $(date '+%F %T') pid $$ $(free -m | awk 'NR==2{print "used " $3 "M avail " $7 "M"}')"
      ps -eo rss=,comm= --sort=-rss | head -8
    } >>"$log"
  done
) &
sampler=$!
trap 'kill "$sampler" 2>/dev/null || true' EXIT

if command -v systemd-run >/dev/null && [[ "$(systemctl --user is-system-running 2>/dev/null)" =~ ^(running|degraded)$ ]]; then
  systemd-run --user --scope --quiet --slice="${XEON_SLICE:-xeon-dev.slice}" -p MemoryMax="$mem" -p MemorySwapMax=0 -- "$@"
else
  echo "verify-guarded: systemd user session not available, running without a memory cap" >&2
  "$@"
fi
