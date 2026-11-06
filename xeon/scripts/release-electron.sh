#!/usr/bin/env bash
# Release of the bundled Electron app (L4.release.spec §3.5): builds Fresnel.app (UI bundle and engine sidecar inside), signs and
# notarizes it with scripts/electron-sign.sh (without the six Apple secrets: UNSIGNED, printed, exit 0 outside a release tag),
# and packs Fresnel-<version>-arm64.zip with its .sha256 into $FRESNEL_RELEASE_OUT. With --smoke it also launches the app
# (scripts/electron-smoke.ts: engine, first screen, window restore, second launch, tray, inspect off, quit).
# The Tauri path (`release-archive`, `release-smoke`) stays; this is the Electron one beside it. macOS arm64 only (Windows and
# Linux bundles are not made yet).
#   release-electron.sh [--smoke]
# env: FRESNEL_RELEASE_VERSION (default 0.0.0-smoke), FRESNEL_RELEASE_OUT (default dist/release-electron),
#      FRESNEL_ELECTRON_ADHOC=1 (sign ad hoc for a local structure check instead of the secrets path; never a release)
# exit: 0 ok, 1 a build, sign or smoke step failed, 2 environment (not macOS arm64, tools or inputs missing)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

smoke=0
[[ "${1:-}" == "--smoke" ]] && smoke=1
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "release-electron: needs macOS arm64" >&2
  exit 2
fi
version="${FRESNEL_RELEASE_VERSION:-0.0.0-smoke}"
version="${version#v}"
out="${FRESNEL_RELEASE_OUT:-dist/release-electron}"
bun="mise exec -- bun"
shell="apps/desktop-shell"
app_dir="$shell/dist-app/Fresnel-darwin-arm64"

begin=$SECONDS
step() { echo "release-electron: $1 ($((SECONDS - begin)) s so far)"; }

step "UI bundle"
$bun run --cwd apps/desktop build:ui
step "engine sidecar"
$bun scripts/build-sidecar.ts host
step "shell bundle and Fresnel.app"
FRESNEL_RELEASE_VERSION="$version" just desktop-build-electron
step "sign"
if [[ "${FRESNEL_ELECTRON_ADHOC:-}" == "1" ]]; then
  bash scripts/electron-sign.sh --adhoc "$app_dir/Fresnel.app"
else
  bash scripts/electron-sign.sh "$app_dir/Fresnel.app"
fi
if ((smoke == 1)); then
  step "launch smoke"
  bash ../scripts/guard.sh run -- $bun scripts/electron-smoke.ts "$app_dir/Fresnel.app"
fi

step "archive"
rm -rf "$out"
mkdir -p "$out"
zip_name="Fresnel-$version-arm64.zip"
ditto -c -k --keepParent "$app_dir/Fresnel.app" "$out/$zip_name"
(cd "$out" && shasum -a 256 "$zip_name" >"$zip_name.sha256")
echo "release-electron: $out/$zip_name ($(du -m "$out/$zip_name" | cut -f1) MiB) in $((SECONDS - begin)) s"
