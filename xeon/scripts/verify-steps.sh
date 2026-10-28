#!/usr/bin/env bash
# The steps of `just verify`, in order, one machine-guarded scope per step (../scripts/guard.sh run). The root justfile's
# verify takes the machine slot (WS_GUARD_SLOTS=1: one helm verify at a time) and calls this script inside it; the slot's
# scope only holds this light orchestrator, so every step gets its own memory cap and a failed step ends only itself.
# A step that fails stops the run and its exit code is this script's exit code (1 fix, 2 environment, 3 human confirm).
# The `test` step is not wrapped: test-capped.sh already runs every package under guard.sh run (1.5G each).
# usage: verify-steps.sh   (from anywhere; steps run from the repository root)
# env: XEON_VERIFY_STEP_MAX (default 2G) memory cap of each step; no time limit for a step (WS_GUARD_TIMEOUT_SEC=0).
#      The other WS_GUARD_* knobs are described in ../scripts/guard.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

step_max="${XEON_VERIFY_STEP_MAX:-2G}"
steps=(setup fmt-check lint typecheck check-layers check-ts-rules depcruise knip "docs-route --check" test)

# runs inside each step's scope: the step, then the scope's peak memory (cgroup v2 memory.peak) on stderr when readable
step_cmd='just "$@"; status=$?; f="/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)/memory.peak"
[ -r "$f" ] && echo "verify: peak $(( $(cat "$f") / 1048576 ))M ($1)" >&2; exit $status'

timings=()
for step in "${steps[@]}"; do
  echo "== verify: $step"
  status=0
  started=$SECONDS
  # shellcheck disable=SC2086 # a step with arguments ("docs-route --check") is split on purpose
  if [[ "$step" == "test" ]]; then
    env -u WS_GUARD_ACTIVE just $step || status=$?
  else
    env -u WS_GUARD_ACTIVE WS_GUARD_RUN_MAX="$step_max" WS_GUARD_TIMEOUT_SEC=0 scripts/guard.sh run -- bash -c "$step_cmd" step $step || status=$?
  fi
  timings+=("$((SECONDS - started))s $step")
  echo "verify: time $((SECONDS - started))s ($step)" >&2
  if [[ "$status" -ne 0 ]]; then
    echo "verify: step '$step' failed: exit $status (137: memory cap ${step_max}, see journalctl --user -n 20)" >&2
    echo "verify: step times: ${timings[*]}" >&2
    exit "$status"
  fi
done
echo "verify: step times: ${timings[*]}" >&2
echo "verify: all ${#steps[@]} steps passed in ${SECONDS}s"
