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
# 이 저장소: verify는 기기에서 한 번에 하나(WS_GUARD_SLOTS=1)이고 _verify-steps(xeon/scripts/verify-steps.sh)가 단계마다 guard.sh run scope(2G, FRESNEL_VERIFY_STEP_MAX)를 따로 만든다. test 단계는 turbo(동시 2개)로 패키지마다 1.5G, 캐시에 맞는 패키지는 다시 돌지 않는다.
# verify는 빠른 길(병합·push 전), verify-full은 마일스톤 마감과 CI만. 병렬 작업 중에는 `just check <패키지>`·`just test <패키지>`만 돌린다. 저장소 전체 verify·lint·typecheck는 마지막 병합 단계 한 곳에서만.
set shell := ["bash", "-euo", "pipefail", "-c"]
set allow-duplicate-recipes
import? '~/.config/ws/ws.just'

envs := "dev"

# verify가 한꺼번에 잡는 기기 슬롯: Linux(WSL)는 1, macOS(32G)는 2. WS_GUARD_SLOTS로 바꾼다
guard_slots := env("WS_GUARD_SLOTS", if os() == "macos" { "2" } else { "1" })

# Fresnel 의존성 설치: 잠금 파일 기준 (xeon/bun.lock, bun install --frozen-lockfile)
[group('setup')]
setup:
    cd xeon && just setup

# caustic(데스크톱 디자인 시스템 submodule)을 main 최신으로 올린다
[group('setup')]
caustic-update:
    cd xeon && just caustic-update

# 부모가 사라진 시험·모니터 프로세스 목록(읽기 전용): 나이와 worktree. --reap은 이 저장소 worktree의 것만 멈추되 --yes 없이는 종료코드 3 (scripts/orphans.sh)
[group('local')]
orphans *flags:
    scripts/orphans.sh {{flags}}

# Fresnel 포매팅 적용 (oxfmt)
[group('quality')]
fmt:
    cd xeon && just fmt

# Fresnel 포매팅 검사 (oxfmt --check)
[group('quality')]
fmt-check:
    cd xeon && just fmt-check

# Fresnel 정적 검사: mode=full은 type-aware(turbo 캐시), mode=fast는 type-aware 없이 한 번에 (.oxlintrc.fast.json)
[group('quality')]
lint mode="full":
    cd xeon && just lint {{mode}}

# Fresnel 타입 검사 (tsc -b, TypeScript 7)
[group('quality')]
typecheck:
    cd xeon && just typecheck

# Fresnel 단위 테스트: scripts는 매번, 패키지는 turbo 캐시(모든 worktree 공용)에 맞으면 재생하고 아니면 scripts/guard.sh run 상한 아래에서. 인자로 패키지 디렉터리 (xeon/scripts/test-capped.sh)
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

# 용어 검사 1~3단계: gen은 원본(packages/client/src/i18n/terms.json)에서 카탈로그 term.* 키를 만들고 표식 문장(locales/*.src.json)을 풀며(--mockups는 목업 파생물도), check는 T·C·M·S·D 규칙을 검사한다 (xeon/scripts/terms.ts)
[group('local')]
terms mode *flags:
    cd xeon && just terms {{mode}} {{flags}}

# 요구 장부 검사: M3-REQ 행마다 상태(M3a, M3b:<트랙 id>, M4), 이월 표마다 트랙 id, 상태별 개수 (xeon/scripts/req-ledger.ts)
[group('local')]
req-ledger:
    cd xeon && just req-ledger

# caustic 부품 간극 표 검사: spec §9의 C 항목마다 상태 칸 (xeon/scripts/caustic-gaps.ts)
[group('local')]
caustic-gaps:
    cd xeon && just caustic-gaps

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

# 완료 기준, 빠른 길: 병합과 push 전에 돈다. 검사 전부와 ws check. 시험·lint·타입 검사는 turbo 캐시(모든 worktree 공용)를 쓰고 lint는 type-aware 없이 돈다. 마일스톤 마감과 CI는 verify-full. 기기에서 한 번에 하나(슬롯 1, macOS는 2: WS_GUARD_SLOTS로 바꾼다), 단계마다 따로 메모리 상한 2G(FRESNEL_VERIFY_STEP_MAX), 시험은 패키지마다 1.5G, 공용 예산 ws-dev.slice (scripts/guard.sh)
[group('quality')]
verify:
    WS_GUARD_SLOTS={{guard_slots}} scripts/guard.sh verify -- just _verify-steps fast
    ws check

# 완료 기준, 전체: TURBO_FORCE로 캐시를 읽지 않고 type-aware lint까지 모든 검사를 새로 돈다(결과 캐시는 새로 채운다). 마일스톤 마감과 CI만 쓴다. 나머지는 verify와 같다
[group('quality')]
verify-full:
    WS_GUARD_SLOTS={{guard_slots}} scripts/guard.sh verify -- just _verify-steps full
    ws check

# verify 단계 묶음: setup, 가벼운 검사(fmt-check check-layers check-ts-rules docs-route terms knip, 같이), lint typecheck depcruise test를 차례로, 단계마다 guard.sh run scope 하나. mode fast|full. 처음 실패에서 멈추고 종료코드를 그대로 낸다 (xeon/scripts/verify-steps.sh)
[private]
_verify-steps mode="fast":
    bash xeon/scripts/verify-steps.sh {{mode}}

# 웹 가격표 asOf 90일 검사: 오래된 항목을 출력만 하고 종료코드는 0 (xeon/packages/cap-web/src/cost/pricing-cli.ts)
[group('local')]
web-pricing:
    cd xeon && just web-pricing

# 데스크톱 사이드카 빌드 <triple|host>: bun build --compile --minify --bytecode, 크기 상한 검사. 인자 --no-bytecode, --list
[group('local')]
desktop-sidecar triple *flags:
    cd xeon && just desktop-sidecar {{triple}} {{flags}}

# 릴리즈 아카이브 빌드 <triple|host> [--version x.y.z] [--binaries-dir 폴더]: 사이드카, 그룹 템플릿, 기본 플러그인, 고지, 체크섬 (scripts/release.ts). macOS 서명은 비밀이 없으면 건너뜀
[group('local')]
release-archive triple *flags:
    cd xeon && just release-archive {{triple}} {{flags}}

# 릴리즈 스모크(X11): 이 기기의 릴리즈를 빌드해 풀고 구성·실행·번들 점검 (scripts/release-smoke.sh). Linux CI와 macOS job이 같은 스크립트를 돈다
[group('local')]
release-smoke:
    cd xeon && just release-smoke

# 데스크톱 화면 번들 (bun build → apps/desktop/dist/ui). 인자 dev는 불변식 검사를 켠 개발 빌드. just verify 밖
[group('local')]
desktop-ui mode="release":
    cd xeon && just desktop-ui {{mode}}

# 데스크톱 개발 실행: Electron 셸을 번들해 띄운다. 화면(`just desktop-ui`)과 사이드카(`just desktop-sidecar host`)가 없으면 종료코드 2. just verify 밖
[group('local')]
desktop-run:
    cd xeon && just desktop-run

# 묶은 Electron 앱 Fresnel.app(macOS arm64) 만들기. 화면 번들과 사이드카가 없으면 종료코드 2. 출력 xeon/apps/desktop-shell/dist-app/. just verify 밖
[group('local')]
desktop-build-electron:
    cd xeon && just desktop-build-electron

# Fresnel.app 서명과 공증. Apple 시크릿 여섯 개가 없으면 서명 없이 UNSIGNED를 출력하고 종료코드 0(릴리스 태그면 1). 인자 --adhoc는 로컬 구조 점검용 (xeon/scripts/electron-sign.sh)
[group('local')]
desktop-sign-electron *flags:
    cd xeon && just desktop-sign-electron {{flags}}

# 묶은 앱 실행 스모크: 구조, 창 위치 복원, 첫 화면, 엔진, 트레이, inspect 꺼짐, 두 번째 실행, 종료. macOS 화면 있는 로그인 환경 필요(없으면 종료코드 2) (xeon/scripts/electron-smoke.ts)
[group('local')]
desktop-smoke-electron:
    cd xeon && just desktop-smoke-electron

# Electron 셸 npm 고지(xeon/apps/desktop-shell/resources/THIRD-PARTY-NOTICES-SHELL.txt): 인자 없으면 다시 쓰고, --check면 커밋된 파일이 의존과 맞는지만 본다(다르면 종료코드 1) (xeon/scripts/shell-notices.ts)
[group('local')]
desktop-notices-electron *flags:
    cd xeon && just desktop-notices-electron {{flags}}

# Electron 릴리즈 묶음: Fresnel.app 서명(시크릿 없으면 UNSIGNED)과 Fresnel-<version>-arm64.zip, .sha256. release-archive는 CLI 릴리즈 아카이브라 그대로다. macOS arm64만 (xeon/scripts/release-electron.sh)
[group('local')]
release-archive-electron:
    cd xeon && just release-archive-electron

# Electron 릴리즈 스모크: release-archive-electron에 묶은 앱 실행 스모크를 더한다. CI macOS job이 돈다
[group('local')]
release-smoke-electron:
    cd xeon && just release-smoke-electron

# 실제 provider로 모델 테이프 녹화 <scenario>: 비용이 들어 사람 확인 뒤 --yes, 없으면 종료코드 3 (xeon/scripts/tape-record.ts)
[group('local')]
tape-record scenario *flags:
    cd xeon && just tape-record {{scenario}} {{flags}}

# 속도 기준선(콜드 스타트, --first-token은 실제 모델 호출이라 --yes 필요, 없으면 종료코드 3). 예산은 eng.performance.guide (xeon/scripts/benchmark.ts)
[group('local')]
benchmark *flags:
    cd xeon && just benchmark {{flags}}

# 데스크톱 속도·크기(Y17): size, startup, frame, trace, all. 실제 모델 호출 없음. startup은 macOS 화면 있는 로그인 환경 필요 (xeon/scripts/desktop-benchmark.ts)
[group('local')]
desktop-benchmark *flags:
    cd xeon && just desktop-benchmark {{flags}}

# 서버 측정 결과의 예산 판정(예산이 사용자 결정 대기면 통과, 넘으면 실패, --strict면 대기도 실패) (xeon/scripts/benchmark-gate.ts)
[group('local')]
benchmark-gate *flags:
    cd xeon && just benchmark-gate {{flags}}
