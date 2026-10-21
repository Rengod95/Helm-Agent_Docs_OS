# justfile 계약 v1 (전체: ws help justfile). 고치기 전에 읽는다.
# 1. 공개 레시피 이름은 동사 사전에서 고른다(ws help verbs). 없는 동사가 필요하면 저장소 고유 이름 + [group('local')].
# 2. 변형은 레시피를 늘리지 말고 env/target/mode 값으로 추가한다. 새 env는 `just env-add <env>`.
# 3. 기기를 넘는 일은 `ws on`, 비밀은 `secrets`. ssh·sops·절대 경로·비밀 값 출력 금지.
# 4. 레시피 본문이 10줄을 넘으면 scripts/<이름>.sh로 옮긴다.
# 5. verify에서 단계를 빼거나 약하게 바꾸려면 주인 확인을 받는다.
# 6. 앱 스크립트(package.json 등)를 바꾸면 그것을 부르는 레시피도 같은 커밋에서 고친다.
# 7. 환경·비밀 동사(secret-add, dotenv …)는 ~/.config/ws/ws.just에서 온다. 여기서 다시 만들지 않는다.
# 8. 고친 뒤 `just --list`, `just verify`.
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

# Xeon 단위 테스트 (bun test, turbo)
[group('quality')]
test:
    cd xeon && just test

# 층 순위 검사 (xeon/scripts/check-layers.ts)
[group('local')]
check-layers:
    cd xeon && just check-layers

# 의존 경계 검사 (dependency-cruiser)
[group('local')]
depcruise:
    cd xeon && just depcruise

# 미사용 코드·의존성 검사 (knip)
[group('local')]
knip:
    cd xeon && just knip

# 문서 라우팅·프런트매터 검사 또는 조회: docs-route --check | --task implement <경로>
[group('local')]
docs-route +args:
    cd xeon && just docs-route {{args}}

# 한 층만 lint, typecheck, test: layer는 F X L0 L1 L2 L3 L4, affected=true면 turbo --affected
[group('local')]
ci-layer layer affected="false":
    cd xeon && just ci-layer {{layer}} {{affected}}

# 완료 기준. 검사 전부와 ws check (ws help justfile)
[group('quality')]
verify: setup fmt-check lint typecheck check-layers depcruise knip (docs-route "--check") test
    ws check
