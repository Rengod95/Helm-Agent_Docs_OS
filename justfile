# justfile 계약 v2 (전체: ws help justfile). 고치기 전에 읽는다.
# 1. 공개 레시피 이름은 동사 사전에서 고른다(ws help verbs). 없는 동사가 필요하면 저장소 고유 이름 + [group('local')].
# 2. 변형은 레시피를 늘리지 말고 env/target/mode 값으로 추가한다. 새 env는 `just env-add <env>`.
# 3. 기기를 넘는 일은 `ws on`, 비밀은 `secrets`. ssh·sops·절대 경로·비밀 값 출력 금지.
# 4. 레시피 본문이 10줄을 넘으면 scripts/<이름>.sh로 옮긴다.
# 5. verify에서 단계를 빼거나 약하게 바꾸려면 주인 확인을 받는다.
# 6. 앱 스크립트(package.json 등)를 바꾸면 그것을 부르는 레시피도 같은 커밋에서 고친다.
# 7. 환경·비밀 동사(secret-add, dotenv …)는 ~/.config/ws/ws.just에서 온다. 여기서 다시 만들지 않는다.
# 8. 고친 뒤 `just --list`, `just verify`.
# 9. test·verify는 scripts/guard.sh(기기 슬롯, 공용 메모리 예산) 아래에서 돈다: `scripts/guard.sh run -- <명령>`, verify는 `scripts/guard.sh verify -- just _verify-steps`.
# 이 저장소: verify는 기기에서 한 번에 하나(WS_GUARD_SLOTS=1)이고 _verify-steps(xeon/scripts/verify-steps.sh)가 단계마다 guard.sh run scope(2G, XEON_VERIFY_STEP_MAX)를 따로 만든다. test 단계는 turbo(동시 2개)로 패키지마다 1.5G, 캐시에 맞는 패키지는 다시 돌지 않는다.
# 병렬 작업 중에는 `just check <패키지>`·`just test <패키지>`만 돌린다. 저장소 전체 verify·lint·typecheck는 마지막 병합 단계 한 곳에서만.
set shell := ["bash", "-euo", "pipefail", "-c"]
set allow-duplicate-recipes
import? '~/.config/ws/ws.just'

envs := "dev"

# Xeon 의존성 설치: 잠금 파일 기준 (xeon/bun.lock, bun install --frozen-lockfile)
[group('setup')]
setup:
    cd xeon && just setup

# Xeon 포매팅 적용 (oxfmt)
[group('quality')]
fmt:
    cd xeon && just fmt

# Xeon 포매팅 검사 (oxfmt --check)
[group('quality')]
fmt-check:
    cd xeon && just fmt-check

# Xeon 정적 검사 (oxlint type-aware, turbo)
[group('quality')]
lint:
    cd xeon && just lint

# Xeon 타입 검사 (tsc -b, TypeScript 7)
[group('quality')]
typecheck:
    cd xeon && just typecheck

# Xeon 단위 테스트: scripts는 매번, 패키지는 turbo 캐시(모든 worktree 공용)에 맞으면 재생하고 아니면 scripts/guard.sh run 상한 아래에서. 인자로 패키지 디렉터리 (xeon/scripts/test-capped.sh)
[group('quality')]
test *targets:
    cd xeon && just test {{targets}}

# 층 순위 검사 (xeon/scripts/check-layers.ts)
[group('local')]
check-layers:
    cd xeon && just check-layers

# TypeScript 작성 규칙 스캔: 단언 위치, Bug 범위, 오류 삼킴, 억제 주석 (xeon/scripts/check-ts-rules.ts)
[group('local')]
check-ts-rules:
    cd xeon && just check-ts-rules

# 의존 경계 검사 (dependency-cruiser)
[group('local')]
depcruise:
    cd xeon && just depcruise

# 미사용 코드·의존성 검사 (knip)
[group('local')]
knip:
    cd xeon && just knip

# 문서 라우팅·프런트매터 검사 또는 조회: docs-route --check | --task implement <경로> | --unresolved
[group('local')]
docs-route +args:
    cd xeon && just docs-route {{args}}

# 패키지 하나만 lint, typecheck, test: 각각 scripts/guard.sh run 1.5G 아래에서 차례로. 병렬 작업 중에는 이것과 just test <패키지>만 돌린다 (xeon/scripts/check-pkg.sh)
[group('quality')]
check pkg:
    cd xeon && just check {{pkg}}

# 한 층만 lint, typecheck, test: layer는 root F X L0 L1 L2 L3 L4(root는 xeon/scripts), affected=true면 turbo --affected
[group('local')]
ci-layer layer affected="false":
    cd xeon && just ci-layer {{layer}} {{affected}}

# 종료 조건 시험 실행: 건너뛴 시험이 있으면 실패하고 건너뛴 수를 출력 (xeon/scripts/exit-tests.txt). 이 기기의 사이드카가 없으면 먼저 빌드한다(E2·E3). CI가 bwrap·socat·sops와 함께 돈다
[group('local')]
exit-tests:
    cd xeon && just exit-tests

# 완료 기준. 검사 전부와 ws check (ws help justfile). 마지막 병합 단계만 돌린다. 기기에서 한 번에 하나(슬롯 1), 단계마다 따로 메모리 상한 2G(XEON_VERIFY_STEP_MAX), 시험은 패키지마다 1.5G, 공용 예산 ws-dev.slice (scripts/guard.sh)
[group('quality')]
verify:
    WS_GUARD_SLOTS=1 scripts/guard.sh verify -- just _verify-steps
    ws check

# verify 단계 묶음: setup fmt-check lint typecheck check-layers check-ts-rules depcruise knip docs-route test를 차례로, 단계마다 guard.sh run scope 하나. 처음 실패에서 멈추고 종료코드를 그대로 낸다 (xeon/scripts/verify-steps.sh)
[private]
_verify-steps:
    bash xeon/scripts/verify-steps.sh

# 웹 가격표 asOf 90일 검사: 오래된 항목을 출력만 하고 종료코드는 0 (xeon/packages/cap-web/src/cost/pricing-cli.ts)
[group('local')]
web-pricing:
    cd xeon && just web-pricing

# 데스크톱 사이드카 빌드 <triple|host>: bun build --compile --minify --bytecode, 크기 상한 검사. 인자 --no-bytecode, --list
[group('local')]
desktop-sidecar triple *flags:
    cd xeon && just desktop-sidecar {{triple}} {{flags}}

# 데스크톱 화면 번들 (bun build → apps/desktop/src-tauri/ui). 인자 dev는 불변식 검사를 켠 개발 빌드. just verify 밖
[group('local')]
desktop-ui mode="release":
    cd xeon && just desktop-ui {{mode}}

# 데스크톱 개발 실행 (cargo run, 사이드카 필요: 없으면 종료코드 2). just verify 밖
[group('local')]
desktop-run:
    cd xeon && just desktop-run

# 데스크톱 앱 릴리스 빌드 (cargo build --release, 사이드카 필요: 없으면 종료코드 2). just verify 밖
[group('local')]
desktop-build:
    cd xeon && just desktop-build

# 데스크톱 Rust 셸 단위 시험 (cargo test: 릴레이, 엔진 수명). 사이드카 불필요. just verify 밖
[group('local')]
desktop-test:
    cd xeon && just desktop-test

# 실제 provider로 모델 테이프 녹화 <scenario>: 비용이 들어 사람 확인 뒤 --yes, 없으면 종료코드 3 (xeon/scripts/tape-record.ts)
[group('local')]
tape-record scenario *flags:
    cd xeon && just tape-record {{scenario}} {{flags}}

# 속도 기준선(콜드 스타트, --first-token은 실제 모델 호출이라 --yes 필요, 없으면 종료코드 3). 예산은 eng.performance.guide (xeon/scripts/bench.ts)
[group('local')]
bench *flags:
    cd xeon && just bench {{flags}}
