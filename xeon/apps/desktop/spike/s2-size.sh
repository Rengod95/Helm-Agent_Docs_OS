#!/usr/bin/env bash
# S2: bun build --compile 바이너리 크기. 기동 시간은 s4.ts가 잰다. 결과는 TSV로 stdout에 낸다.
# usage: s2-size.sh [출력 디렉터리]   (cwd 무관)
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
xeon="$(cd "$here/../../.." && pwd)"
out="${1:-$here/out/s2}"
mkdir -p "$out"
cd "$xeon"

echo 'console.log("hello")' >"$out/hello.ts"

entries=(
  "hello:$out/hello.ts"
  "host:apps/host/src/main.ts"
  "cli:apps/cli/src/main.ts"
)
flagsets=(
  "plain:"
  "minify:--minify"
  "minify+bytecode:--minify --bytecode"
  "minify+sourcemap:--minify --sourcemap"
  "minify+bytecode+sourcemap:--minify --bytecode --sourcemap"
)
echo -e "entry\ttarget\tflags\tbytes\tmib\tcompile_ms\tnote"
for e in "${entries[@]}"; do
  name="${e%%:*}"; src="${e#*:}"
  for f in "${flagsets[@]}"; do
    label="${f%%:*}"; flags="${f#*:}"
    bin="$out/$name-$label"
    s=$(date +%s%N)
    # shellcheck disable=SC2086
    if msg=$(bun build --compile $flags "$src" --outfile "$bin" 2>&1); then
      ms=$(( ($(date +%s%N) - s) / 1000000 ))
      b=$(stat -c %s "$bin")
      echo -e "$name\tlinux-x64(host)\t$label\t$b\t$(awk "BEGIN{printf \"%.1f\", $b/1048576}")\t$ms\t"
    else
      echo -e "$name\tlinux-x64(host)\t$label\t-\t-\t-\tFAIL: $(echo "$msg" | tr '\n' ' ' | cut -c1-160)"
    fi
  done
done

# 5 triple(교차 컴파일, 실행은 하지 않음): host 진입을 --minify로
declare -A targets=(
  [aarch64-apple-darwin]=bun-darwin-arm64
  [x86_64-apple-darwin]=bun-darwin-x64
  [x86_64-unknown-linux-gnu]=bun-linux-x64
  [aarch64-unknown-linux-gnu]=bun-linux-arm64
  [x86_64-pc-windows-msvc]=bun-windows-x64
)
for triple in "${!targets[@]}"; do
  t="${targets[$triple]}"
  for e in "hello:$out/hello.ts" "host:apps/host/src/main.ts"; do
    name="${e%%:*}"; src="${e#*:}"
    bin="$out/$name-$triple"
    if msg=$(bun build --compile --minify --target="$t" "$src" --outfile "$bin" 2>&1); then
      f="$bin"; [[ -f "$bin.exe" ]] && f="$bin.exe"
      b=$(stat -c %s "$f")
      echo -e "$name\t$triple\tminify(cross)\t$b\t$(awk "BEGIN{printf \"%.1f\", $b/1048576}")\t-\t"
    else
      echo -e "$name\t$triple\tminify(cross)\t-\t-\t-\tFAIL: $(echo "$msg" | tr '\n' ' ' | cut -c1-160)"
    fi
  done
done
