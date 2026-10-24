#!/usr/bin/env bash
# Tauri 셸(src-tauri)의 cargo 명령. just desktop-run / desktop-build / desktop-test가 부른다. just verify에는 들어 있지 않다.
# usage: cargo.sh <test|check|run|build>
#   test, check  사이드카 바이너리 없이 돈다(externalBin을 비워 컴파일한다).
#   run, build   src-tauri/binaries/xeon-<host triple>이 있어야 한다: just desktop-sidecar <triple>
# Rust는 mise.toml이 고정한 버전을 쓴다(mise exec). 빌드 산출물은 Syncthing 폴더(~/projects) 밖의 기기별 캐시에 쌓인다.
# env: CARGO_TARGET_DIR (기본 ${XDG_CACHE_HOME:-$HOME/.cache}/xeon/cargo-target, spike/shell도 같은 값을 쓴다)
#      CARGO_BUILD_JOBS (기본 2, .cargo/config.toml의 jobs와 같다)
# 종료코드: 0 성공, 1 컴파일·시험 실패, 2 환경 문제(mise·cargo 없음, 사이드카 없음, 시스템 패키지)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/xeon/cargo-target}"

if ! (cd "$here/.." && mise exec -- cargo --version >/dev/null 2>&1); then
  echo "cargo-sh: mise exec -- cargo가 실패했습니다. xeon/에서 mise install로 mise.toml의 rust를 설치하세요. 환경 문제입니다" >&2
  exit 2
fi
cd "$here/src-tauri"

needs_sidecar() {
  local triple
  triple="$(mise exec -- rustc --print host-tuple)"
  local file="binaries/xeon-$triple"
  [[ "$triple" == *windows* ]] && file="$file.exe"
  if [[ ! -f "$file" ]]; then
    echo "cargo-sh: $file 이 없습니다. 먼저 just desktop-sidecar $triple 을 실행하세요" >&2
    exit 2
  fi
}

# 화면 번들(src-tauri/ui)은 tauri.conf의 frontendDist다. run은 개발 번들, build는 릴리스 번들을 만든다.
# test, check는 번들 없이 컴파일되도록 자리 표시 파일만 둔다(없을 때).
ensure_ui() {
  case "$1" in
    run) rm -rf ui; (cd "$here/../.." && mise exec -- bun run --cwd apps/desktop build:ui:dev) ;;
    build) rm -rf ui; (cd "$here/../.." && mise exec -- bun run --cwd apps/desktop build:ui) ;;
    *)
      if [[ ! -f ui/index.html ]]; then
        mkdir -p ui
        printf '<!doctype html><title>Xeon</title>\n' > ui/index.html
      fi ;;
  esac
}

case "$mode" in
  test)
    ensure_ui test
    TAURI_CONFIG='{"bundle":{"externalBin":[]}}' exec mise exec -- cargo test ;;
  check)
    ensure_ui check
    TAURI_CONFIG='{"bundle":{"externalBin":[]}}' exec mise exec -- cargo check --all-targets ;;
  run)
    needs_sidecar
    ensure_ui run
    exec mise exec -- cargo run ;;
  build)
    needs_sidecar
    ensure_ui build
    exec mise exec -- cargo build --release ;;
  *)
    echo "usage: cargo.sh <test|check|run|build>" >&2
    exit 1 ;;
esac
