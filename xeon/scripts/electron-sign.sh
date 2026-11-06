#!/usr/bin/env bash
# Signing and notarization of Fresnel.app (Electron, L4.release.spec §4.2, L4.desktop.spec §11.7). The app holds several code
# units: the main executable, four Electron helper apps (Helper, GPU, Renderer, Plugin), frameworks (Electron Framework with
# its dylibs and crashpad handler, Mantle, ReactiveObjC, Squirrel) and the engine sidecar in Resources. They are signed
# inside out (deepest path first) with the hardened runtime, a secure timestamp and apps/desktop-shell/build/entitlements.mac.plist,
# then the app is verified, notarized (notarytool, zip) and stapled. The same six secrets as release-sign.sh decide: without
# them nothing is signed and the state is the explicit UNSIGNED (printed, CI warning annotation, job summary line); a release
# tag (GITHUB_REF refs/tags/v*) fails instead. Values are never printed, only whether a name is set. The secrets are the
# user's: this script never creates one.
#   electron-sign.sh <Fresnel.app>            the real path: secrets, hardened runtime, notarization
#   electron-sign.sh --adhoc <Fresnel.app>    local structure check only: ad-hoc identity, hardened runtime, no notarization.
#                                             Prints ADHOC and is never a release (a v* tag refuses it). An ad-hoc app has no team id,
#                                             so library validation would reject its own frameworks: this mode adds
#                                             disable-library-validation to a temporary copy of the entitlements. Real signing does not.
# env: APPLE_CERTIFICATE_P12_BASE64, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY (codesign),
#      APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD (notarytool)
# exit: 0 signed and notarized, ADHOC, or UNSIGNED outside a release tag; 1 a step failed, or UNSIGNED/ADHOC on a release tag;
#       2 environment (not macOS, tools missing, no app)
set -euo pipefail

adhoc=0
if [[ "${1:-}" == "--adhoc" ]]; then
  adhoc=1
  shift
fi
app="${1:-}"
if [[ -z "$app" ]]; then
  echo "usage: electron-sign.sh [--adhoc] <Fresnel.app>" >&2
  exit 1
fi
if [[ ! -d "$app/Contents" ]]; then
  echo "electron-sign: no app at $app (run: just desktop-build-electron)" >&2
  exit 2
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
entitlements="$here/../apps/desktop-shell/build/entitlements.mac.plist"
[[ -f "$entitlements" ]] || { echo "electron-sign: missing $entitlements" >&2; exit 1; }

if ((adhoc == 1)); then
  if [[ "${GITHUB_REF:-}" == refs/tags/v* ]]; then
    echo "electron-sign: --adhoc is not a release; a release tag must be signed" >&2
    exit 1
  fi
  identity="-"
  timestamp="--timestamp=none"
else
  missing=()
  for name in APPLE_CERTIFICATE_P12_BASE64 APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_TEAM_ID APPLE_APP_PASSWORD; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if ((${#missing[@]} > 0)); then
    message="electron-sign: UNSIGNED, secrets not set: ${missing[*]}"
    echo "$message"
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::warning title=UNSIGNED macOS app::$message"; fi
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '**UNSIGNED** macOS app (Electron): %s\n' "$message" >>"$GITHUB_STEP_SUMMARY"; fi
    if [[ "${GITHUB_REF:-}" == refs/tags/v* ]]; then
      echo "electron-sign: a release tag must be signed; register the secrets and run the release again" >&2
      exit 1
    fi
    exit 0
  fi
  identity="$APPLE_SIGNING_IDENTITY"
  timestamp="--timestamp"
fi
if [[ "$(uname -s)" != "Darwin" ]] || ! command -v codesign >/dev/null || ! command -v xcrun >/dev/null; then
  echo "electron-sign: needs macOS with codesign and xcrun" >&2
  exit 2
fi

work="$(mktemp -d)"
keychain=""
cleanup() {
  if [[ -n "$keychain" ]]; then security delete-keychain "$keychain" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

keychain_args=()
if ((adhoc == 1)); then
  adhoc_entitlements="$work/entitlements.adhoc.plist"
  sed 's|</dict>|<key>com.apple.security.cs.disable-library-validation</key><true/></dict>|' "$entitlements" >"$adhoc_entitlements"
  entitlements="$adhoc_entitlements"
else
  keychain="$work/release.keychain-db"
  kc_pass="$(uuidgen)"
  printf '%s' "$APPLE_CERTIFICATE_P12_BASE64" | base64 --decode >"$work/cert.p12"
  security create-keychain -p "$kc_pass" "$keychain"
  security set-keychain-settings -lut 1800 "$keychain"
  security unlock-keychain -p "$kc_pass" "$keychain"
  security import "$work/cert.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple: -s -k "$kc_pass" "$keychain" >/dev/null
  security list-keychains -d user -s "$keychain" login.keychain-db
  keychain_args=(--keychain "$keychain")
fi

# code units, deepest path first: Mach-O files (dylibs, helpers' executables, crashpad handler, the engine sidecar), then
# .framework and .app bundles. The main app is the shallowest, so it comes last.
list="$work/units.txt"
{
  find "$app" -type f -exec sh -c 'file -b "$1" | grep -q "Mach-O" && printf "%s\n" "$1"' _ {} \;
  find "$app" -type d \( -name "*.framework" -o -name "*.app" \)
} | awk '{ n = gsub("/", "/"); print n "\t" $0 }' | sort -rn -s -k1,1 | cut -f2- | awk '!seen[$0]++' >"$list"

count=0
while IFS= read -r unit; do
  [[ "$unit" == "$app" ]] && continue
  codesign --force --options runtime "$timestamp" "${keychain_args[@]}" --entitlements "$entitlements" --sign "$identity" "$unit"
  count=$((count + 1))
done <"$list"
codesign --force --options runtime "$timestamp" "${keychain_args[@]}" --entitlements "$entitlements" --sign "$identity" "$app"
codesign --verify --deep --strict "$app"
echo "electron-sign: signed $((count + 1)) code units (hardened runtime)"

if ((adhoc == 1)); then
  echo "electron-sign: ADHOC, local structure check only, not notarized and not a release"
  exit 0
fi

# notarization takes a zip; the ticket is stapled to the app so Gatekeeper accepts it offline
zip_path="$work/notarize.zip"
ditto -c -k --keepParent "$app" "$zip_path"
xcrun notarytool submit "$zip_path" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
xcrun stapler staple "$app"
echo "electron-sign: signed, notarized and stapled"
