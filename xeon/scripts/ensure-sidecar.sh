#!/usr/bin/env bash
# Builds the desktop sidecar binary of this machine when it is missing or older than its sources, so the apps/desktop e2e tests
# never run against a stale binary (a stale one gave a false failure) and never skip for a missing one.
# The binary is gitignored, so turbo cannot see it. The e2e test's turbo hash instead follows what the binary is built from:
# apps/desktop/turbo.json makes the test depend on @xeon/cli's transit task (the sidecar entry is apps/cli/src/main.ts).
# Staleness here is content based: a stamp next to the binary holds the hash of the non-test sources of @xeon/cli and every
# workspace package it uses, of sidecar.json, build-sidecar.ts, bun.lock and mise.toml. A different hash rebuilds, and so does a binary whose reported version is not 0.0.0.
# usage: ensure-sidecar.sh   (from anywhere; build output as `just desktop-sidecar host`)
# exit: 0 binary is current, 1 the build failed, 2 environment (no turbo, unsupported host).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

dir="apps/desktop/src-tauri/binaries"
stamp="$dir/.sources.sha256"

packages="$(mise exec -- bun run turbo ls --filter='@xeon/cli...' --output=json 2>/dev/null | sed -n 's/^ *"path": "\(.*\)"$/\1/p')"
if [[ -z "$packages" ]]; then
  echo "ensure-sidecar: turbo could not list the packages @xeon/cli uses" >&2
  exit 2
fi

hash_sources() {
  {
    # shellcheck disable=SC2086 # one path per line, no spaces
    git ls-files -co --exclude-standard -z -- $packages apps/desktop/sidecar.json scripts/build-sidecar.ts bun.lock mise.toml |
      tr '\0' '\n' | grep -v '/test/' | LC_ALL=C sort |
      while IFS= read -r file; do
        [[ -f "$file" ]] && printf '%s %s\n' "$(git hash-object -- "$file")" "$file"
      done
  } | shasum -a 256 | cut -d' ' -f1
}

current="$(hash_sources)"
built="$(cat "$stamp" 2>/dev/null || true)"
# A development sidecar reports "0.0.0" (L4.release.spec 8.1). A binary that runs and reports another version came from a release
# build and is stale for the e2e tests. A binary that cannot run here (another triple) or has no JSON answer is not judged by this.
version_mismatch() {
  local file reported
  for file in "$dir"/xeon-*; do
    [[ -x "$file" ]] || continue
    reported="$("$file" version --json 2>/dev/null | sed -n 's/.*"cli":"\([^"]*\)".*/\1/p' || true)"
    [[ -n "$reported" && "$reported" != "0.0.0" ]] && return 0
  done
  return 1
}

if [[ "$current" == "$built" ]] && compgen -G "$dir/xeon-*" >/dev/null && ! version_mismatch; then
  echo "ensure-sidecar: binary is current"
  exit 0
fi
echo "ensure-sidecar: sources changed or no binary, building (just desktop-sidecar host)"
mise exec -- bun scripts/build-sidecar.ts host
mkdir -p "$dir"
printf '%s\n' "$current" >"$stamp"
