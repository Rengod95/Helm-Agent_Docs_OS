#!/usr/bin/env bash
# Release smoke (X11): builds the release archive of this machine and runs release-smoke.ts on it. Linux x86_64 CI, the GitHub
# macOS arm64 job and `just release-smoke` run this one script with the same inputs (version, layout, checks).
# On macOS the bundled sops, age and rg come from mise (pinned in release-bundle.json), so `mise use --global sops age ripgrep`
# must have run. Without secrets the signing step skips.
# env: XEON_RELEASE_VERSION (default 0.0.0-smoke), XEON_RELEASE_OUT (default dist/release-smoke)
# exit: 0 ok, 1 a build or smoke check failed, 2 environment (mise or a bundled binary missing)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

version="${XEON_RELEASE_VERSION:-0.0.0-smoke}"
out="${XEON_RELEASE_OUT:-dist/release-smoke}"
bun="mise exec -- bun"
rm -rf "$out"
mkdir -p "$out"

flags=()
if [[ "$(uname -s)" == "Darwin" ]]; then
  bins="$(mktemp -d)"
  trap 'rm -rf "$bins"' EXIT
  for name in sops age rg; do
    if ! path="$(mise which "$name" 2>/dev/null)"; then
      echo "release-smoke: mise has no $name (run: mise use --global sops@3.13.3 age@1.3.2 ripgrep@15.0.0)" >&2
      exit 2
    fi
    cp "$path" "$bins/$name"
  done
  flags=(--binaries-dir "$bins")
fi

$bun scripts/release.ts host --version "$version" --out "$out" "${flags[@]}"
$bun scripts/release-smoke.ts "$out"/xeon-"$version"-*.tar.gz
