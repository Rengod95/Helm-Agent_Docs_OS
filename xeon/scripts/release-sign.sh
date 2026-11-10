#!/usr/bin/env bash
# Signing and notarization of a macOS release stage (L4.release.spec 5). Without the secrets it does not sign: the result is the
# explicit state UNSIGNED (printed, a CI warning annotation and a job summary line). Forks, pull requests and manual runs stay
# green with that state; a release tag (GITHUB_REF refs/tags/v*) fails instead, so an unsigned archive cannot come out of a
# green tag release. The secrets are registered by the user, never by this repository. Values are never printed: only
# whether a name is set.
#   release-sign.sh <stage-dir>      the fresnel-<version>-aarch64-apple-darwin directory release.ts left (before tar)
# env: APPLE_CERTIFICATE_P12_BASE64, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY (codesign),
#      APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD (notarytool)
# exit: 0 signed and notarized, or UNSIGNED outside a release tag; 1 a step failed or UNSIGNED on a release tag; 2 environment (not macOS, tools missing)
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
  message="release-sign: UNSIGNED, secrets not set: ${missing[*]}"
  echo "$message"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::warning title=UNSIGNED macOS archive::$message"; fi
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '**UNSIGNED** macOS archive: %s\n' "$message" >>"$GITHUB_STEP_SUMMARY"; fi
  if [[ "${GITHUB_REF:-}" == refs/tags/v* ]]; then
    echo "release-sign: a release tag must be signed; register the secrets and run the release again" >&2
    exit 1
  fi
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
for file in "$stage"/binaries/* "$stage"/fresnel "$stage"/fresnel-web; do
  [[ -f "$file" ]] || continue
  codesign --force --options runtime --timestamp --keychain "$keychain" --sign "$APPLE_SIGNING_IDENTITY" "$file"
done
codesign --verify --strict "$stage/fresnel"
codesign --verify --strict "$stage/fresnel-web"

# notarization takes a zip; a bare binary cannot be stapled, Gatekeeper checks the ticket online
zip_path="$work/notarize.zip"
ditto -c -k --keepParent "$stage" "$zip_path"
xcrun notarytool submit "$zip_path" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
echo "release-sign: signed and notarized"
