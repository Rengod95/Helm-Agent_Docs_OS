# Xeon: 층별 스펙·계획 문서화, 정합성 검증, 기반 구현

## Context

- 층 구성 계획 v2(https://claude.ai/artifact/6Wre6DTnvJgiT4i7qYzbnc)가 F~L3의 하위 층 41개와 구성요소 182개를 정했다.
- 다음 단계는 다섯 가지다.
  - 이 계획을 제품 Xeon(임시 이름)의 실제 스펙·구현 계획 문서로 만든다.
  - 문서 사이의 모순을 검증한다.
  - 공통 엔지니어링 규칙(의존 방향, 타입, 트랜잭션, 이벤트, 안티패턴)을 구속력 있는 문서로 둔다.
  - 툴체인과 CI를 세운다.
  - 기반 구현(M0·M1)까지 진행한다.
- 사용자 지시:
  - 문서는 `docs/xeon/<층>/<도메인>/<문서종류>` 구조로 둔다.
  - 문서는 층별로 병렬 작성한다.
  - 모델 배정:
    - 문서 작성: Opus medium
    - 하위 조정: Sonnet medium~high
    - 조사·구현: Sonnet medium~high 또는 Haiku xhigh
    - 메인 조정: 나
  - 스택 확정(이 계획 승인)이 실제 구현보다 먼저다.
- 저장소: `/home/user/projects/helm/code/helm`, 브랜치 `design/restructure`.
  - 레거시 Helm JS 코드와 루트 `package.json`이 미커밋 상태다. 이 부분은 건드리지 않는다.
  - 기존 설계 정본 `docs/design/01~26`(Helm 커널·데몬 전제)은 Xeon의 참고 자료로 인용만 한다. 정본 병합은 하지 않는다.

## 1. 결정 (사용자 답 + 내 권고)

| # | 항목 | 결정 |
|---|---|---|
| 1 | pi durable 활용 | 권고안을 따른다. 그대로 쓰지 않는다. DI는 Cordis 하나로 둔다.<br>· env, tools, images, truncate(25파일 4.8k줄)를 포크한다. 이 범위의 Chord 의존은 `import type` 8줄뿐이고 내용은 취소 토큰 `{abortSignal}`이다. 그래서 로컬 타입 `CancelScope`로 치환하고, `harness/types.ts`에서 도구 타입만 100~200줄 추출한다.<br>· 커널(L1-a/b/f/g)은 계획대로 직접 구현한다. 그때 durable `docs/spec.md`를 설계 근거로 인용한다: 소유 트리 1972-2200, requestId 2288-2301, 결과 불명 1917-1927·2082-2108, 훅 표 2636-2660, 재생 3136-3170.<br>· 스파이크는 하지 않는다. |
| 2 | 예약·원격·알림 | 범위에 포함한다. 그래서 공유 서비스 모드를 1차로 올린다. 데몬은 `xeon service`(자동 기동, 유휴 종료)이고 OS 서비스 등록은 2차다. |
| 3 | 데스크톱 | Tauri 2(시스템 WebView, 3플랫폼)를 쓴다. 엔진은 `bun build --compile` 사이드카로 넣고, 엔진과 UI는 stdio JSON-RPC로 연결한다. |
| 4 | 목표 판정 | 별도 판정 모델을 두고 실행 횟수 상한을 건다. |
| 5 | 질문·계획 승인 | L1-d 승인 프로토콜 하나로 합친다. |
| 6 | 무료 검색 기본값 | 트레이드오프 결론은 아래 단계 구성이다.<br>① 모델용 도구: 현재 provider의 내장 검색. 설정이 필요 없다.<br>② 서비스 API `web.search`: L3 그룹 코드가 모델 턴 밖에서 호출해야 하므로 내장 검색만으로는 불가하다. 기본은 "내장 검색 래퍼"다. 소형 모델 한 턴으로 검색하고 약 $0.011/회다.<br>③ SearXNG를 감지하면 우선 사용한다. 무료이고 키가 필요 없다. 수정 없이 별도 프로세스로 쓰므로 AGPL 배포 의무가 없다.<br>④ 무료 크레딧 API(Exa 월 2,500건, Brave 약 1,000건)는 첫 실행 설정에서 플러그인으로 권장한다.<br>키 없는 스크레이핑(DuckDuckGo)은 약관 위험 때문에 제외한다. |
| — | 코드 위치 | `xeon/` 독립 워크스페이스로 둔다(사용자 선택). 문서는 `docs/xeon/`에 둔다. |
| — | CI | `.github/workflows/xeon-ci.yml`을 추가한다. 사용자가 workflows 수정을 허용했다. 기존 ci.yml과 publish.yml은 필요할 때만 고친다. |
| — | 런타임 | Bun 1.4(사용자 선택). |

## 2. 스택 (승인 = 컨펌)

| 영역 | 선택 (정확 버전 고정) | 비고 |
|---|---|---|
| 런타임·패키지 관리 | Bun 1.4.x, Bun workspaces + catalog | `packageManager: bun@1.4.3` |
| 언어·타입 검사 | TypeScript 7.0.x (`tsc` = tsgo), strict | 추가 옵션: `isolatedDeclarations`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. `isolatedDeclarations` 덕분에 d.ts 생성에 TS API가 필요 없다. |
| 린트 | oxlint 1.89 + type-aware(oxlint-tsgolint, TS 7.0.2 대응) | `import/no-cycle`, `no-restricted-imports` 사용 |
| 포맷 | oxfmt 0.74 (0.x라 정확 고정) | 문제가 생기면 그 파일만 제외한다. Biome로 되돌리지 않는다. |
| 테스트 | `bun test` (패키지별 실행, `--coverage`) | Vitest는 bun:sqlite 같은 Bun API를 쓰는 테스트를 돌리지 못해 제외한다. |
| 태스크 러너 | Turborepo 2.11 (`--affected`, 캐시) | |
| 경계·위생 | dependency-cruiser 18(층 순위 규칙), knip 6(미사용 코드), publint와 attw(공개 패키지만), 자체 `scripts/check-layers.ts` | |
| 빌드 | 내부 패키지는 TS 소스를 그대로 export한다. 바이너리는 `bun build --compile`(CLI, 사이드카). 공개 라이브러리만 tsdown 0.23을 쓴다. | |
| DI·플러그인 | Cordis 4.0.0-rc.x를 `xeon/vendor/cordis`에 커밋 고정으로 둔다. | |
| 스키마 | TypeBox 1.4 | pi-ai와 같은 계열 |
| 모델·루프 | `@earendil-works/pi-ai`, `pi-agent-core` 1.3.0 정확 고정 + 훅 래핑 | 위장 경로는 `plugins/provider-anthropic-oauth`로 분리하고 배포판에서 제외한다. |
| DB | bun:sqlite(WAL, 단계 경계 FULL) | macOS는 `Database.setCustomSQLite`로 FTS5가 포함된 SQLite를 지정한다. 시작할 때 FTS5를 확인하는 검사를 둔다. |
| MCP | `@modelcontextprotocol/client` 2.3.1 | |
| 샌드박스 | `@anthropic-ai/sandbox-runtime` | |
| 웹 | 로컬 fetch: guarded-fetch, defuddle, turndown<br>브라우저: playwright-core, agent-browser(선택) | Playwright가 Bun에서 동작하지 않으면 Node 자식 프로세스로 우회한다. |
| 비밀 | sops 바이너리 + age, `SOPS_AGE_KEY_CMD`로 OS 키체인을 쓴다. | |
| 데스크톱 | Tauri 2.12 + 엔진 사이드카 | |
| 저장소 위생 | lefthook(pre-commit에서 oxfmt, oxlint, gitleaks), `xeon/justfile`(`just verify`) | |

## 3. 저장소 배치

```
xeon/
  package.json  bunfig.toml  turbo.json  tsconfig.base.json  .oxlintrc.json  .oxfmtrc.json
  .dependency-cruiser.cjs  knip.json  lefthook.yml  justfile  AGENTS.md  CLAUDE.md(@AGENTS.md)
  vendor/cordis/                      # 커밋 고정
  packages/
    contracts/                        # F (서브패스: conversation, records, capabilities, extensions, wire, settings)
    ext-host/                         # X: Cordis 래퍼, on/post/drive/scope, 로딩·신뢰·운영 규칙
    platform-{exec,sandbox,secrets,process,store,os}/      # L0 (exec = pi durable env 포크)
    core-{tasks,loop,models,tools,context,persistence,agents}/  # L1
    cap-{workspace,mcp,web,knowledge,work,dialog,artifacts,schedule}/  # L2
    group-{kit,helm,learning}/        # L3
  plugins/provider-anthropic-oauth/   # 배포 제외
  apps/{cli,host,desktop}/            # L4 (host = 엔진 진입점: in-process / stdio / service)
  scripts/{check-layers.ts,docs-route.ts}
.github/workflows/xeon-ci.yml
.claude/skills/xeon-*/SKILL.md        # 작업자용 기술 스킬
```

### 층 순위와 의존 방향

- 순위: F(0) → X `ext-host`(1) → L0(2) → L1(3) → L2(4) → L3(5) → L4(6).
- 패키지 의존 규칙:
  - 패키지는 자기보다 낮은 순위만 import한다.
  - 같은 층의 패키지끼리는 import하지 않는다. 같은 층 협력은 F 정의와 Cordis 서비스로만 한다.
  - 각 패키지의 `package.json`에 `"xeon": {"layer": "L1", "domain": "loop"}`를 둔다. `check-layers.ts`와 dependency-cruiser가 이 값으로 위반을 거부한다.
- L1의 확장 지점 선언(지점 이름, fold, 페이로드 타입)은 F4에 둔다. L1과 X는 그 선언을 공유한다.
- 문서 단계에서 이 순위(X를 L0 아래에 두는 것)가 타당한지 정합성 검사로 확인한다.

## 4. 문서 구조와 라우팅

```
docs/xeon/
  README.md                     # 진입점: 층 지도, 읽는 순서, 라우팅 사용법
  _routing/routes.yaml          # 작업 유형·코드 경로 → 필수 문서 목록 (기계용)
  _routing/README.md            # 사람용 설명
  _templates/{spec,design,plan,adr,guide}.md
  product/{vision,usecases,scope}/spec.md        # 제품 기획 (app 전체)
  architecture/{overview,layers,runtime-flow}/{spec,design}.md   # 전체 구조
  engineering/                  # 구속 문서 (모든 구현 작업에 자동 라우팅)
    dependency-rules/guide.md   # 층 순위, import 규칙, 강제 수단
    typescript/guide.md         # typed programming, 브랜드 ID, Result, 금지 구문
    domain-types/guide.md       # DTO·스키마·도메인 타입 설계, 버전, 확장 규칙
    context-map/design.md       # 바운디드 컨텍스트 지도와 소유 경계
    transactions/design.md      # 정합성·원자성, 단일 DB, outbox, 멱등
    events/design.md            # 이벤트 종류, 내구/휘발, 순서, 재생
    anti-patterns/guide.md      # 아키텍처·코드·스택 단위 안티패턴
    best-practices/guide.md
    testing/guide.md            # 단위 테스트 우선, 테이프 기반 모델 가짜, 통합 최소화
    toolchain/guide.md          # bun, tsgo, oxlint/oxfmt, turbo, CI
  decisions/ADR-NNNN-*.md       # 스택, DI 단일화, pi durable 포크 등
  F/<domain>/{spec,plan}.md     # domain: conversation, records, capabilities, extensions, wire-settings
  L0/<domain>/{spec,plan}.md    # exec, sandbox, secrets, process, store, os
  L1/<domain>/{spec,plan}.md    # tasks, loop, models, tools, context, persistence, agents
  X/<domain>/{spec,plan}.md     # loading-trust, primitives, operations
  L2/<domain>/{spec,plan}.md    # workspace, mcp, web, knowledge, work, dialog, artifacts, schedule
  L3/<domain>/{spec,plan}.md    # group-kit, helm, learning, slots
  L4/<domain>/{spec,plan}.md    # cli, desktop, host-service, settings-ui
  <층>/README.md                # 층 개요 spec (층당 1개)
  review/consistency-*.md       # 정합성 검증 결과
```

### 문서 규칙

- 모든 문서는 YAML 프런트매터를 갖는다.

  ```yaml
  id: L1.loop.spec
  layer: L1
  domain: loop
  kind: spec
  status: draft|review|accepted
  depends_on: [F.extensions.spec, ...]
  binds: [xeon/packages/core-loop/**]
  owners_model: opus
  ```

- 본문 골격은 종류마다 하나로 정한다.
  - spec: 목적, 범위·비범위, 용어, 인터페이스(TypeBox 타입 서명), 동작 규칙, 실패·경계, 설정 노출(L4), 확장 지점, 수용 기준
  - plan: 작업 분해, 순서·의존, 패키지 경로, 단위 테스트 목록, 완료 기준, 위험
- 층당 문서 수: 층 README 1개 + 도메인마다 spec과 plan. 합계 약 90개.

### 라우팅

- `routes.yaml`이 문서 선택을 정한다.
  - 모든 구현 작업은 `engineering/*`를 항상 읽는다.
  - 코드 경로 glob을 `binds`에 매칭해 해당 spec과 plan을 고른다.
  - 해당 문서의 `depends_on`을 한 단계 펼친다.
- `scripts/docs-route.ts <경로|작업>`이 위 결과 목록을 출력한다.
- 작업자 프롬프트는 항상 이 목록으로 시작한다.

## 5. 실행 단계와 모델 배정

### P0 기반 (메인 조정, 나)

- 브랜치 `xeon/foundation`을 만든다.
- 다음 골격을 만든다.
  - `docs/xeon` 디렉터리, README, 템플릿, `routes.yaml` 초안
  - ADR-0001~0005(스택, 단일 DI, pi durable 포크, 검색 기본값, 데몬 범위)
  - `xeon/` 워크스페이스 골격(설정 파일, 빈 패키지와 `xeon.layer` 필드)
  - `.claude/skills/xeon-docs`, `xeon-ts`, `xeon-test`
- 커밋은 로컬에만 한다.

### P1 문서 병렬 작성 (Workflow)

- 트랙 9개를 둔다: product+architecture, engineering, F, L0, L1, X, L2, L3, L4.
- 각 트랙의 구성:
  - 하위 조정자 Sonnet(medium~high) 1명: 도메인을 나누고, 입력 자료를 묶고, 결과를 검수한다.
  - 문서 작성자 Opus medium 1~4명: 도메인 2~3개씩 spec과 plan을 쓴다.
  - 필요하면 조사자 Haiku xhigh: 소스와 문서의 사실을 확인한다.
- 입력 자료(트랙별로 묶음):
  - 계획 v2 데이터
  - r2 보고서 6개(packages, process, secrets, settings, l2e, ext-points)
  - ref-synthesis, item-catalog, session-storage, web-tools, 브라우저 조사 문서
  - 기존 `docs/design` 관련 절(인용용)
- engineering 트랙을 먼저 시작하고, 층 트랙은 그 초안 경로를 `depends_on`으로 참조한다.

### P2 정합성 검정

- Sonnet high 검토자 4명이 관점별로 교차 검사한다.
  - ① F 계약과 소비 층의 타입·이름 일치
  - ② 의존 방향·층 순위 위반
  - ③ 트랜잭션·이벤트·재생 규칙의 상충
  - ④ 설정 노출, 데몬 범위, 기본값의 모순
- 결과는 `review/consistency-1.md`에 쓰고, 해당 문서의 Opus 작성자가 고친다.
- 고친 뒤 메인(나)이 최종 대조하고 `review/consistency-final.md`를 남긴다.

### P3 툴체인과 CI (Sonnet medium 구현자)

- `just verify`를 세운다: oxfmt 검사, oxlint(type-aware), tsc -b, check-layers, depcruise, knip, 영향 범위 `bun test`.
- 커밋 전 검사는 lefthook으로 건다.
- `xeon-ci.yml`을 만든다.
  - 층별 job matrix: F, X, L0, L1, L2, L3, L4
  - 각 job은 turbo `--affected` 범위의 lint, typecheck, test를 돌린다.
  - 통합 테스트는 모델 테이프 기반 스모크 1개만 둔다.

### P4 구현 M0~M1 (층별 병렬, Sonnet 하위 조정 + Sonnet/Haiku 구현자)

- 작업자는 `docs-route`가 주는 문서를 읽고, 해당 plan의 작업 분해대로 구현한다.
- 각 패키지에 단위 테스트를 함께 둔다.
- M0 범위:
  - `contracts`(F 전 도메인의 TypeBox 타입)
  - `ext-host`(Cordis vendored, on/post/drive/scope 최소형)
  - `platform-store`(bun:sqlite, 이벤트·투영·체크포인트·세션 잠금)
  - `platform-exec`(durable env 포크)
- M1 범위(걸어 다니는 골격): `xeon chat` CLI에서 다음이 돈다.
  - pi-ai 모델 1개
  - 도구 read, ls, bash(sandbox)
  - 이벤트 저장과 재개
  - SOPS 비밀 참조 1종
  - 테스트용 그룹이 on/post/drive를 사용
- Tauri 데스크톱, L2 웹·MCP, Helm 본체는 각 plan의 M2 이후 일정을 따른다. 이번 실행에서는 스캐폴드까지만 만든다.

### P5 보고

- 테크니컬 라이팅 보고 아티팩트를 만든다. 내용:
  - 전체 구조 그림
  - 층별 핵심
  - 사용자 결정이 필요한 항목
  - 위험
  - 다음 마일스톤
- 메모리를 갱신한다.

## 6. 검증

- 문서 검사:
  - `bun scripts/docs-route.ts`가 모든 `binds`, `depends_on` 링크를 해석해야 한다(깨진 참조 0).
  - 프런트매터 스키마 검사를 통과해야 한다.
  - 정합성 보고서의 "미해결 상충" 항목이 0이어야 한다.
- 코드 검사:
  - `cd xeon && just verify`가 종료코드 0이어야 한다.
  - 층 위반을 일부러 넣은 샘플 import로 check-layers가 실패하는지 확인한 뒤 제거한다.
  - `bun test`는 패키지별로 통과해야 하고, 층별 CI job을 로컬에서 `act` 없이 `just ci-layer L1`로 재현할 수 있어야 한다.
- M1 스모크:
  - 모델 테이프로 `xeon chat` 한 턴을 돌린다.
  - 프로세스를 강제 종료한 뒤 재개해 이벤트가 이어지는지 확인한다.
  - drive 그룹을 켜고 끄는 동작이 턴 경계에서 적용되는지 확인한다.
- 커밋과 push:
  - 브랜치 `xeon/foundation`에 로컬 커밋만 한다.
  - push와 PR은 사용자 확인 뒤에 한다.
  - 커밋은 `xeon/`, `docs/xeon/`, `.github/workflows/xeon-ci.yml`, `.claude/skills/xeon-*`만 명시해서 add한다. 레거시 미추적 파일은 커밋에 넣지 않는다.

## 7. 위험

- oxfmt는 0.x이고 TS 7 API가 없다. tsgolint는 TS 7.0.x에 묶여 있으므로 두 버전을 함께 고정한다.
- bun:sqlite는 macOS에서 FTS5 유무가 다르다. 시작 시 검사하고, 지원하지 않으면 커스텀 SQLite를 쓴다.
- Playwright가 Bun에서 호환되지 않으면 Node 자식 프로세스로 우회한다.
- Cordis는 rc 버전이다. vendored로 고정하고 ext-host 뒤에 숨긴다.
- 사이드카 단일 바이너리 크기와 Windows 서명은 L4 plan에서 다룬다.
- 작업량이 크다. P1~P4 모두 Workflow로 실행하고, 진행 상황은 `/workflows`로 볼 수 있다.
