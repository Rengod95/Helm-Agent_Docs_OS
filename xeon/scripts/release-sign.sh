#!/usr/bin/env bash
# Signing and notarization of a macOS release stage (L4.release.spec 5). Skips with exit 0 when the secrets are absent, so
# forks and pull requests stay green; the secrets are registered by the user, never by this repository. Values are never
# printed: only whether a name is set.
#   release-sign.sh <stage-dir>      the xeon-<version>-aarch64-apple-darwin directory release.ts left (before tar)
# env: APPLE_CERTIFICATE_P12_BASE64, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY (codesign),
#      APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD (notarytool)
# exit: 0 signed and notarized, or skipped; 1 a step failed; 2 environment (not macOS, tools missing)
set -euo pipefail

stage="${1:-}"
if [[ -z "$stage" || ! -d "$stage" ]]; then
  echo "usage: release-sign.sh <stage-dir>" >&2
  exit 1
fi

missing=()
for name in APPLE_CERTIFICATE_P12_BASE64 APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_TEAM_ID APPLE_APP_PASSWORD; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if ((${#missing[@]} > 0)); then
  echo "release-sign: skipped, secrets not set: ${missing[*]}"
  exit 0
fi
if [[ "$(uname -s)" != "Darwin" ]] || ! command -v codesign >/dev/null || ! command -v xcrun >/dev/null; then
  echo "release-sign: needs macOS with codesign and xcrun" >&2
  exit 2
fi

work="$(mktemp -d)"
keychain="$work/release.keychain-db"
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

kc_pass="$(uuidgen)"
printf '%s' "$APPLE_CERTIFICATE_P12_BASE64" | base64 --decode >"$work/cert.p12"
security create-keychain -p "$kc_pass" "$keychain"
security set-keychain-settings -lut 900 "$keychain"
security unlock-keychain -p "$kc_pass" "$keychain"
security import "$work/cert.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$kc_pass" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" login.keychain-db

# the bundled helpers first, then the main binary, all with the hardened runtime and a secure timestamp
for file in "$stage"/binaries/* "$stage"/xeon; do
  [[ -f "$file" ]] || continue
  codesign --force --options runtime --timestamp --keychain "$keychain" --sign "$APPLE_SIGNING_IDENTITY" "$file"
done
codesign --verify --strict "$stage/xeon"

# notarization takes a zip; a bare binary cannot be stapled, Gatekeeper checks the ticket online
zip_path="$work/notarize.zip"
ditto -c -k --keepParent "$stage" "$zip_path"
xcrun notarytool submit "$zip_path" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
echo "release-sign: signed and notarized"
