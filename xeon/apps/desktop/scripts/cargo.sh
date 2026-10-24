#!/usr/bin/env bash
# Tauri 셸(src-tauri)의 cargo 명령. just desktop-run / desktop-build / desktop-test가 부른다. just verify에는 들어 있지 않다.
# usage: cargo.sh <test|check|run|build>
#   test, check  사이드카 바이너리 없이 돈다(externalBin을 비워 컴파일한다).
#   run, build   src-tauri/binaries/xeon-<host triple>이 있어야 한다: just desktop-sidecar <triple>
# 빌드 산출물은 src-tauri/.cargo/config.toml의 target-dir(저장소 밖)에 쌓인다.
# env: CARGO_BUILD_JOBS (기본 4)
# 종료코드: 0 성공, 1 컴파일·시험 실패, 2 환경 문제(cargo 없음, 사이드카 없음, 시스템 패키지)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-}"
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"

if ! command -v cargo >/dev/null; then
  echo "cargo-sh: cargo가 없습니다(rustup으로 설치, ~/.cargo/bin). 환경 문제입니다" >&2
  exit 2
fi
cd "$here/src-tauri"

needs_sidecar() {
  local triple
  triple="$(rustc --print host-tuple)"
  local file="binaries/xeon-$triple"
  [[ "$triple" == *windows* ]] && file="$file.exe"
  if [[ ! -f "$file" ]]; then
    echo "cargo-sh: $file 이 없습니다. 먼저 just desktop-sidecar $triple 을 실행하세요" >&2
    exit 2
  fi
}

case "$mode" in
  test)
    TAURI_CONFIG='{"bundle":{"externalBin":[]}}' exec cargo test ;;
  check)
    TAURI_CONFIG='{"bundle":{"externalBin":[]}}' exec cargo check --all-targets ;;
  run)
    needs_sidecar
    exec cargo run ;;
  build)
    needs_sidecar
    exec cargo build --release ;;
  *)
    echo "usage: cargo.sh <test|check|run|build>" >&2
    exit 1 ;;
esac
