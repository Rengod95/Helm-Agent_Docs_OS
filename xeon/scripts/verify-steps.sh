#!/usr/bin/env bash
# The steps of `just verify`, in order, one machine-guarded scope per step (../scripts/guard.sh run). The root justfile's
# verify takes the machine slot (WS_GUARD_SLOTS=1: one helm verify at a time) and calls this script inside it; the slot's
# scope only holds this light orchestrator, so every step gets its own memory cap and a failed step ends only itself.
# A step that fails stops the run and its exit code is this script's exit code (1 fix, 2 environment, 3 human confirm).
# The light checks (fmt-check, check-layers, check-ts-rules, docs-route, knip) run side by side, each in its own scope; their output
# is printed step by step when all of them are done. If some fail, the first failed one in the list below gives the exit code
# and every failed one is named. The heavy steps (lint, typecheck, depcruise) and test run alone, one after the other.
# The `test` step is not wrapped: test-capped.sh already runs every package under guard.sh run (1.5G each).
# Two modes. fast (default, `just verify`): turbo caches are read (lint, typecheck, test) and lint runs without type-aware rules
# (xeon/.oxlintrc.fast.json, one oxlint call). full (`just verify-full`): TURBO_FORCE=true, so nothing is read from the turbo cache
# (results are still written), and lint is the type-aware run of every package.
# usage: verify-steps.sh [fast|full]   (from anywhere; steps run from the repository root)
# env: XEON_VERIFY_STEP_MAX (default 2G) memory cap of each step; no time limit for a step (WS_GUARD_TIMEOUT_SEC=0).
#      The other WS_GUARD_* knobs are described in ../scripts/guard.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

mode="${1:-fast}"
case "$mode" in
  fast) ;;
  full) export TURBO_FORCE=true ;;
  *)
    echo "usage: verify-steps.sh [fast|full]" >&2
    exit 64
    ;;
esac

step_max="${XEON_VERIFY_STEP_MAX:-2G}"
steps=(setup fmt-check check-layers check-ts-rules "docs-route --check" knip lint typecheck depcruise test)
light=(fmt-check check-layers check-ts-rules "docs-route --check" knip)

# runs inside each step's scope: the step, then the scope's peak memory (cgroup v2 memory.peak) on stderr when readable
step_cmd='just "$@"; status=$?; f="/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)/memory.peak"
[ -r "$f" ] && echo "verify: peak $(( $(cat "$f") / 1048576 ))M ($1)" >&2; exit $status'

is_light() {
  local item
  for item in "${light[@]}"; do [[ "$item" == "$1" ]] && return 0; done
  return 1
}

# run_step <step>: the step in its own scope (the test step is not wrapped); the exit code is the step's
run_step() {
  local step="$1"
  if [[ "$step" == "lint" && "$mode" == "fast" ]]; then step="lint fast"; fi
  # shellcheck disable=SC2086 # a step with arguments ("docs-route --check") is split on purpose
  if [[ "$step" == "test" ]]; then
    env -u WS_GUARD_ACTIVE just $step
  else
    env -u WS_GUARD_ACTIVE WS_GUARD_RUN_MAX="$step_max" WS_GUARD_TIMEOUT_SEC=0 scripts/guard.sh run -- bash -c "$step_cmd" step $step
  fi
}

timings=()
finish_failed() { # finish_failed <exit code> <step names>
  echo "verify: step '$2' failed: exit $1 (137: memory cap ${step_max}, see journalctl --user -n 20)" >&2
  echo "verify: step times: ${timings[*]}" >&2
  exit "$1"
}

pending=()
# run_pending: the collected light steps side by side; each one's output is printed in list order when all are done
run_pending() {
  [[ ${#pending[@]} -gt 0 ]] || return 0
  local dir index=0 step pid status first_status=0 started=$SECONDS failed=() pids=()
  dir="$(mktemp -d)"
  echo "== verify: ${pending[*]} (side by side)"
  for step in "${pending[@]}"; do
    (
      began=$SECONDS
      code=0
      run_step "$step" >"$dir/$index.log" 2>&1 || code=$?
      echo "$((SECONDS - began))" >"$dir/$index.time"
      exit "$code"
    ) &
    pids+=("$!")
    index=$((index + 1))
  done
  index=0
  for step in "${pending[@]}"; do
    status=0
    wait "${pids[$index]}" || status=$?
    echo "-- verify: $step"
    cat "$dir/$index.log"
    echo "verify: time $(cat "$dir/$index.time")s ($step)" >&2
    timings+=("$(cat "$dir/$index.time")s $step")
    if [[ "$status" -ne 0 ]]; then
      failed+=("$step")
      [[ "$first_status" -ne 0 ]] || first_status=$status
    fi
    index=$((index + 1))
  done
  rm -rf "$dir"
  echo "verify: time $((SECONDS - started))s (${pending[*]} side by side)" >&2
  pending=()
  if [[ ${#failed[@]} -gt 0 ]]; then finish_failed "$first_status" "${failed[*]}"; fi
}

for step in "${steps[@]}"; do
  if is_light "$step"; then
    pending+=("$step")
    continue
  fi
  run_pending
  echo "== verify: $step"
  status=0
  started=$SECONDS
  run_step "$step" || status=$?
  timings+=("$((SECONDS - started))s $step")
  echo "verify: time $((SECONDS - started))s ($step)" >&2
  if [[ "$status" -ne 0 ]]; then finish_failed "$status" "$step"; fi
done
run_pending
echo "verify: step times: ${timings[*]}" >&2
echo "verify: all ${#steps[@]} steps passed in ${SECONDS}s ($mode)"
