---
id: L3.group-kit.plan
layer: L3
domain: group-kit
kind: plan
status: draft
depends_on: [L3.group-kit.spec, L3.slots.spec, F.extensions.plan, X.primitives.plan, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/group-kit/**]
---

# L3 그룹 기반 (group-kit) 구현 계획

대상 스펙: L3.group-kit.spec. 패키지: `@xeon/group-kit`(`xeon/packages/group-kit`). 이 문서 작성 단계에서는 코드를 만들지 않는다.

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | group-kit 작업 없음. 선행 작업만 있다: F `contracts/extensions` 타입(`ScopeApi`, `DriveFn`, `GroupRecord`, `validateManifest`, `validateUsage`), X `ext-host` 최소형(on/post/drive/scope) | `product.scope.spec` 4.3절 M0, F.extensions.plan M0 |
| M1 | 테스트용 그룹 fixture 하나만 만든다. `src/testing/smoke-group.ts`: on(`tool_call`, `turn_end`)·post·drive를 모두 쓰는 최소 그룹. 이 그룹은 F 타입과 X 최소형만 쓰고 `defineGroup`을 쓰지 않는다. `xeon.domain` 값 수정 | `product.scope.spec` 4.3절 M1, `_research/foundation-plan.md` §6 M1 스모크, F.extensions.plan M1 |
| M2 | `defineGroup`(상태 없는 그룹 포함), `groupManifest`, `validateGroupDef`, `checkGroup`, `GroupApi` 래퍼(`settings()`, 메모리 계측, `registerTool`·`registerCommand`), `DriveArbiter`와 `LeaseArbiterPort` 어댑터, 그룹 상태 레코드 어댑터, 레코드 래퍼 검사, `GroupService`(`xeon.groups`), `/group` 명령 해석·실행, 상태줄 문자열 생성, `l3.group-kit.*` 설정, `replayDrive` 최소형(Helm 테스트가 쓴다), DR-02 허용 목록 등록, M1 fixture를 `defineGroup`으로 옮김 | `product.scope.spec` 4.3절 M2 "Helm 본체 1차(group-kit, group-helm)" |
| M3 이후(2차) | `delegate` 구현(학습 그룹 M3와 함께, L1.agents 의존), `scanDriveSource`, `PromotionReport`, `GroupMetrics` 이벤트 기록, `replayDrive` 옵션 확장. L3.slots의 템플릿 3종과 정식 예 3종을 이 패키지에 둔다(G-24~G-27) | `_research/layer-plan-v2.json` L3-a·L3-d 2차 항목, `product.scope.spec` 4.3절 M3, L3.slots.plan §1 |

구성요소별 배치:

| 구성요소(L3.group-kit.spec) | 공개 이름 | M1 | M2 | M3 이후 |
|---|---|---|---|---|
| 테스트 그룹 fixture | `smokeGroup` | ● | `defineGroup`으로 옮김 | |
| defineGroup과 정적 검증 | `defineGroup`, `groupManifest`, `validateGroupDef`, `checkGroup` | | ● | |
| GroupApi 래퍼 | `GroupApi.settings()`, `metrics.snapshot()`(메모리), `registerTool`, `registerCommand` | | ● | 계측 이벤트 |
| delegate 래퍼 | `GroupApi.delegate`, `DelegateSpec` | | 타입만, 호출 시 `group.delegateUnavailable` | ● |
| drive 임대 중재 정책 | `DriveArbiter`, `defaultDriveArbiter`, `leaseArbiterPort` | | ● | |
| 그룹 상태 레코드 어댑터 | `checkStateCommit`, `stateUpcasters`, 투영 행 모양 | | ● | |
| 그룹 간 통신 검사 | 레코드 래퍼, kind 접두 필터 함수 | | ● | |
| GroupService | `GroupService`, `GroupServiceName`(`xeon.groups`), `GroupStatus` | | ● | |
| 전환 명령·상태줄 | `parseGroupCommand`, `runGroupCommand`, `groupCommand`, `formatGroupStatusLine` | | ● | |
| 설정 | `l3.group-kit.instrumentation`, `.statusLine`. 구동 그룹 선택은 X 키 `x.primitives.activeDriveGroup`을 읽는다(review.decisions-2 S-15) | | ● | |
| 재생 하니스 | `replayDrive` | | 최소형(every-commit, 그룹 하나) | 지점 목록, 입력 시작 |
| 재생 규율 정적 검사 | `scanDriveSource` | | | ● |
| 승격 보고 | `PromotionReport`, `buildPromotionReport` | | | ● |
| 계측 | `GroupMetrics`, `grp.<그룹>.metrics.recorded`(`recordPrivate`) | | 메모리 집계 | ● |
| 템플릿(L3.slots) | `templates/`, `index.json` | | | ● |
| 정책 정식 예(L3.slots) | `reviewgate`, `commitguard`, `guardrail`(`testing` 진입점) | | | ● |

- [가정] `delegate` 구현을 M3에 둔다. 학습 그룹이 M3이고(`product.scope.spec` 4.3절) L1.agents.spec의 위임 서비스가 그 전에 정해지지 않을 수 있기 때문이다. Helm이 M2에서 위임을 쓰기로 하면 G-14를 M2로 당긴다.

## 2. 패키지와 파일 배치

```
xeon/packages/group-kit/
  package.json
  tsconfig.json                 # references: ../contracts, ../ext-host (+ devDependencies 패키지). include에서 templates/ 제외
  src/
    index.ts                    # 공개 재export(.)
    define-group.ts             # defineGroup, groupManifest, validateGroupDef, GROUP_NAME_PATTERN, RESERVED_GROUP_NAMES,
                                # GroupDef, GroupApi, GroupModule, GroupManifest, GroupSetting*, StateMigrations
    wrap.ts                     # ScopeApi → GroupApi 감싸기(계측 집계, settings, delegate 연결, hostOf로 registerTool·registerCommand)
    delegate.ts                 # DelegateSpec, DelegateToolPolicy, DelegateLimits, DelegateFork, DelegateReceipt, DelegateReport,
                                # DelegateRequest 변환, 입력 검사
    arbiter.ts                  # DriveArbiter, defaultDriveArbiter, leaseArbiterPort, ArbiterInput, ArbiterDecision, DriveCandidate
    state.ts                    # checkStateCommit, stateUpcasters, StateCommittedPayload, StateProjectionRow
    records.ts                  # record·readRecords 래퍼 검사(자기 접두, customType 접두), kindVisibleTo(필터)
    service.ts                  # GroupService 구현(타입은 @xeon/contracts/services의 services/groups.ts), Cordis 플러그인 본문은 X 플러그인 API로, GroupStatus 계산, choose
    commands.ts                 # parseGroupCommand, runGroupCommand, groupCommand, 출력 문자열
    status-line.ts              # formatGroupStatusLine
    settings.ts                 # defineSettings("l3.group-kit", …)
    promotion/
      report.ts                 # buildPromotionReport (2차)
    metrics/
      types.ts                  # GroupMetrics, GroupMetricsSummary, GroupMetricsHandle, MetricsRecordedPayload
      counter.ts                # 메모리 집계(M2)
      record.ts                 # 단계 경계 증가분 이벤트(2차)
    testing/
      index.ts                  # @xeon/group-kit/testing: checkGroup, replayDrive, scanDriveSource, smokeGroup, 정식 예 3종
      smoke-group.ts            # M1 테스트 그룹
      check-group.ts            # 기록용 가짜 host와 validateUsage 대조
      replay/
        replay-drive.ts         # replayDrive. 다른 패키지 testing 서브패스를 import하므로 testing 아래(DR-08)
      scan/
        scan-drive.ts           # scanDriveSource (2차)
        codes.ts                # SD-01~SD-10 표
      policies/                 # (2차) 정책 플러그인 정식 예. L3.slots.spec §3.2
        reviewgate.ts
        commitguard.ts
        guardrail.ts
  templates/                    # (2차) 그룹 템플릿 3종. L3.slots.spec §3.3, L3.slots.plan §2.2
    index.json
    common/  drive/  policy/  observe/
  test/
    define-group.test.ts  arbiter.test.ts  state.test.ts  records.test.ts  service.test.ts
    commands.test.ts  status-line.test.ts  replay.test.ts  scan.test.ts  promotion.test.ts
    metrics.test.ts  comms.test.ts  smoke-group.test.ts  resources.test.ts
    slots/                      # (2차) templates.test.ts, policies.test.ts. L3.slots.plan §5
    tapes/
      slots/                    # (2차) 정식 예 테이프 3개. L3.slots.plan §2.3
    fixtures/
      cross-group-import/       # check-layers 실패 샘플(DR-02). 검사 스크립트 입력으로만 쓰고 워크스페이스에 넣지 않는다
      drive-good.ts  drive-bad.ts  # EV-09 좋은 예·나쁜 예 그룹
```

`package.json` 목표 형태:

```json
{
  "name": "@xeon/group-kit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
  "scripts": {
    "lint": "oxlint --type-aware --deny-warnings -c ../../.oxlintrc.json src test",
    "typecheck": "tsc -b",
    "test": "bun test",
    "fmt-check": "oxfmt --check -c ../../.oxfmtrc.json src test"
  },
  "dependencies": {
    "@xeon/contracts": "workspace:*",
    "@xeon/ext-host": "workspace:*",
    "typebox": "catalog:"
  },
  "devDependencies": {
    "@types/bun": "catalog:",
    "@xeon/core-models": "workspace:*",
    "@swc/core": "catalog:"
  },
  "xeon": { "layer": "L3", "domain": "group-kit" }
}
```

- `xeon.domain`: 현재 스캐폴드 값 `kit`을 routes layout 도메인 `group-kit`으로 맞춘다(`architecture.layers.spec` 3.2절, `eng.dependency-rules.guide` DR-03). DR-03의 "디렉터리 이름의 접두사를 뺀 값" 규칙으로는 `kit`이 나오므로, `check-layers.ts`에 DR-03 검사를 넣을 때 `group-kit`을 예외로 적는다. 이 예외의 확정은 L3.group-kit.spec §10 공통 모순 3이다.
- `@xeon/ext-host`는 `dependencies`다. 운영 코드가 `hostOf`(`registerTool`, `registerCommand` 래퍼)와 리소스 정의 타입을 쓰기 때문이다(L3.group-kit.spec §3.2). `LeaseArbiterPort`·`LeaseCandidate`는 `@xeon/contracts/extensions`(F.extensions.spec §3.2.1)에서, `GroupService`와 부속 타입은 `@xeon/contracts/services`(F.capabilities.spec §3.12 `services/groups.ts`)에서 가져온다. 테스트 호스트(`@xeon/ext-host/testing`)는 테스트 파일만 import한다. 운영 코드의 `@xeon/ext-host` import는 DR-14 ext-host 예외(서비스 등록·주입 API만)에 든다 [결정: review.decisions-2 U-17].
- [M2 구현] `replayDrive`는 하니스를 인자로 받으므로 `@xeon/core-models`를 import하지 않는다. `package.json`에 `@xeon/core-models`·`@swc/core`를 더하지 않았고(`typebox`만 더했다), `@swc/core`는 `scanDriveSource`(M3) 때 더한다. 시험의 하니스는 `@xeon/ext-host/testing`의 `createTestHost`와 `restart()`로 만든다.
- `@xeon/core-models`는 `testing` 서브패스만 쓰므로 `devDependencies`다(DR-08). 다른 패키지의 `testing` 서브패스를 import하는 파일(`replay/`)과 테스트 전용 검사(`scan/`)는 모두 `src/testing/` 아래에 둔다. DR-08은 그 import를 테스트 파일과 `testing` 서브패스 자신에서만 허용한다. 운영 진입점 `.`은 `src/testing/**`를 import하지 않는다.
- `templates/`(2차): `exports`에 넣지 않는다. 생성 명령은 import 없이 파일로 읽는다(L3.slots.spec §3.3.6 R3). 템플릿 `.ts`에는 치환 자리(`__ID__`)가 있어 그대로 컴파일하지 않는다. 그래서 `tsconfig.json`의 `include`, oxlint·oxfmt 대상(`src test`만 넘긴다), knip 진입점에서 뺀다. 생성 결과는 `test/slots/`의 테스트가 임시 디렉터리에 만든 뒤 컴파일·로드한다(L3.slots.plan §2.2).
- `src/testing/policies/`(2차): 정식 예 3종은 `testing` 진입점에서만 내보내므로 기본 배포 카탈로그에 들어가지 않는다(L3.slots.plan §2.3).
- `@swc/core`는 `scanDriveSource`(2차)가 쓴다. DR-07 `MODULE_OWNERS` 표에 `@swc/core` 행(소유: `group-kit`, dependency-cruiser 설정)을 더하는 작업이 G-19에 있다.
- 허용 목록 `xeon/scripts/dependency-allowlist.json`에 `DR-02/group-kit-helm`, `DR-02/group-kit-learning`을 등록한다(`eng.dependency-rules.guide` 4절. `DR-02/group-kit-*` 예외는 [결정: review.decisions-2 U-15]). `reason`의 "pending L3.group-kit.spec"은 "L3.group-kit.spec §3.1"로 바꾸고 `approvedBy`는 `eng.dependency-rules.guide`로 둔다.

## 3. 작업 분해

| id | 내용 | 선행 작업 | 규모 | 마일스톤 |
|---|---|---|---|---|
| G-01 | M1 테스트 그룹 `smokeGroup`: F `ExtensionEntry`로 직접 작성. 매니페스트 `points: ["tool_call", "turn_end"]`, `usesPost: true`, `usesDrive: true`. drive는 `loop.turn` 한 번 뒤 `commit`, `turn_end`에서 `post`(`requestId: smoke:${stepId}`), `tool_call`에서 쓰기 도구 차단. `testing` 진입점 추가 | F.extensions.plan E(M0 타입·검증), X.primitives.plan의 M0 최소형과 `@xeon/ext-host/testing` | S | M1 |
| G-02 | `package.json` `xeon.domain`을 `group-kit`으로 변경, `exports`에 `./testing` 추가, `tsconfig.json` `references` 정리 | 없음 | S | M1 |
| G-03 | 허용 목록에 `DR-02/group-kit-helm`, `DR-02/group-kit-learning` 등록, `reason` 갱신 | G-02, `check-layers.ts` 허용 목록 읽기(eng.toolchain) | S | M2 |
| G-04 | `define-group.ts`: 타입, `GROUP_NAME_PATTERN`, `RESERVED_GROUP_NAMES`, `validateGroupDef`, `defineGroup`(검증 실패 시 `Bug`) | F `ExtensionManifest`, `StateDecl`, `validateManifest`, F `SettingGroup`, `defineSettings` | M | M2 |
| G-05 | `wrap.ts`: `ScopeApi` → `GroupApi`. `on`·`post`·`drive`·`commit`·`record` 전달과 메모리 계측, `settings()`(유효 값 스냅샷, 단계 경계 갱신) | G-04, X `ScopeApi` 구현, X 설정 조회 [가정] | M | M2 |
| G-06 | `testing/check-group.ts`: 기록용 가짜 host로 entry 실행, F `validateUsage` 대조 | G-04, F `validateUsage` | S | M2 |
| G-07 | `arbiter.ts`: `defaultDriveArbiter` 순수 구현과 표 기반 테스트 | F `ScopeId`, `LeaseId`, `DriveLease` | S | M2 |
| G-08 | X 정책 포트 연결: `leaseArbiterPort`(`LeaseCandidate` → `DriveCandidate`, `x.primitives.activeDriveGroup` 설정 읽기), `xeon.groups`가 `choose`를 제공 | G-07, F `LeaseArbiterPort`(F.extensions.spec §3.2.1, 호출 규칙 X.primitives.spec §3.6), `LeaseCandidate.enabledAtSeq` 요청(L3.group-kit.spec §3.13, 없으면 `loadOrder`만) | M | M2 |
| G-09 | `state.ts`: `checkStateCommit`, `stateUpcasters`, 투영 행 모양. `wrap`의 `commit` 앞 검사 연결 | G-04, F `Upcaster`, X `commit` 저장 [가정] | M | M2 |
| G-10 | `records.ts`: `record`의 자기 접두 검사, `post` `customType` 접두 검사, `kindVisibleTo(groupManifest, kind)` 필터 함수(X가 격리에 쓴다) | G-04, F `isRecordKindOf`, `RECORD_KIND_READ_PATTERN` | S | M2 |
| G-11 | `settings.ts`: `l3.group-kit` 두 키(`instrumentation`, `statusLine`) 정의. 구동 그룹 선택은 X 키 `x.primitives.activeDriveGroup`이라 정의하지 않는다. 켜기 키는 X 예약 키 `ext.<이름>.enabled`라 정의하지 않는다 | F `defineSettings`, `buildCatalog` | S | M2 |
| G-12 | `service.ts`: F `GroupService`(F.capabilities.spec §3.12 `services/groups.ts`, F.capabilities.plan P9) 구현, `GroupStatus` 계산, `onChange`(단계 경계마다 최대 한 번), `setDriveHolder` 검증과 설정 쓰기 | G-08, G-11, X `ExtHost.scopes()`, 구독·`leaseId` 조회 요청(L3.group-kit.spec §3.13 요청 2·3) | M | M2 |
| G-13 | `commands.ts`, `status-line.ts`: 문법 해석, 출력 문자열, 상태줄 규칙, L4 등록용 `groupCommand` | G-12 | S | M2 |
| G-14 | `delegate.ts` 입력 검사(M2) + L1-g 서비스 호출, 보고 post 키 파생, 멱등 처리(M3) | G-05, L1.agents.spec 위임 서비스 키 [가정] | M | M2(검사)/M3(호출) |
| G-15 | `testing/replay/replay-drive.ts` 최소형: every-commit 절단, `ReplayHarness`(L3.group-kit.spec §3.10)로 받은 digest 비교. 하니스는 그룹 테스트 파일이 테스트 호스트·테이프·정규화 함수로 만든다(review.decisions-2 U-03, U-17) | G-05, G-09, `@xeon/ext-host/testing` 재시작 지원 [가정], `@xeon/core-models/testing` 테이프(테스트 파일에서만 import) | L | M2 |
| G-16 | `smokeGroup`을 `defineGroup`으로 옮기고 M1 스모크가 그대로 통과하는지 확인 | G-04, G-05, G-01 | S | M2 |
| G-17 | `metrics/record.ts`: 단계 경계 증가분 기록 `grp.<그룹>.metrics.recorded`(`recordPrivate`), 토큰·비용·임대 시간 계산 | G-05, X `ScopeApi.recordPrivate`(review.decisions-2 T-21) | M | M3 |
| G-18 | `promotion/report.ts`: `buildPromotionReport`, `/group status` 부가 줄 | G-17, X `events()`·`toolOwner()` [가정] | M | M3 |
| G-19 | `scan/`: `scanDriveSource`(`@swc/core` `parseSync`), SD-01~SD-10, DR-07 `MODULE_OWNERS` 행 추가 | G-04, `eng.dependency-rules.guide` 표 변경 승인 | M | M3 |
| G-20 | `replayDrive` 확장: 지점 목록 지정, 사용자 입력 시작, 실패 보고에 첫 차이 이벤트 표시 | G-15 | S | M3 |
| G-21 | 통신 검사 샘플: `test/fixtures/cross-group-import`로 check-layers DR-02 실패를 확인하는 테스트 | G-03, `check-layers.ts` fixture 입력 지원(eng.toolchain) | S | M2 |
| G-22 | 리소스 등록 래퍼: `GroupApi.registerTool`, `registerCommand`를 X `hostOf(g)`로 전달. 그룹을 끄면 해제되는지 테스트 | G-05, X `hostOf`·`ResourceRegistry`(X.primitives.spec §3.8, §3.9) | S | M2 |
| G-23 | `groupManifest`(plugin.json 값 검증·좁히기)와 상태 없는 그룹(`state` 생략) 지원, `state_version` 검사 확장 | G-04 | S | M2 |
| G-24 | (L3.slots S-01 대응) `templates/` 3종과 `index.json` 추가, `tsconfig.json` `include`·oxlint·oxfmt·knip 대상에서 `templates/` 제외 | G-23, L3.slots.plan S-01 | M | 2차 |
| G-25 | (L3.slots S-02 대응) `src/testing/policies/` 정식 예 3종과 `test/tapes/slots/` 테이프 3개, `testing` 진입점 재export | G-22, G-23, L3.slots.plan S-02 | M | 2차 |
| G-26 | (L3.slots S-03 대응) `test/slots/templates.test.ts`: drive 템플릿을 임시 디렉터리에 생성하고 `replayDrive`로 재생 | G-15, G-24 | S | 2차 |
| G-27 | (L3.slots S-04 대응) `test/slots/templates.test.ts`: 세 템플릿 생성 결과의 `validateManifest`·`validateUsage`, 로드·토글 확인 | G-24 | S | 2차 |

선행 작업 정리:

- F.extensions.plan: `ScopeApi`, `DriveFn`, `LoopHandle`, `GroupRecord`, `RecordKindDecl`, `validateManifest`, `validateUsage`, `validateManifestSet`, `isRecordKindOf`(M0).
- F.wire-settings.plan: `defineSettings`, `SettingGroup`, `SettingDefInput`, `EffectiveSetting`, `WriteCheck`.
- F.records.plan: `Upcaster`, `lease.*`, `scope.changed` 카탈로그, `StepCheckpoint.leaseRefs`.
- X.primitives.plan: 임대 부여·반납(X.primitives.spec §4.4), 정책 포트 `LeaseArbiterPort`(§3.6), 토글 API(`ScopeHandle`), `ExtHost.scopes()`, `hostOf` 리소스 등록(§3.8). [가정] 요청 4개(L3.group-kit.spec §3.13), 테스트 호스트와 재시작 시뮬레이션.
- Cordis는 ext-host 뒤에 숨긴다. group-kit은 `cordis`, `@cordisjs/*`를 import하지 않는다(ADR-0002 4번, DR-11).

## 4. 채택 코드

| 대상 | 판정 | 내용 |
|---|---|---|
| 그룹 기반 전체 | 자체 | `_research/packages.md` §4.6: L3-a 구성요소는 모두 자체 구현이고 판정 변경이 없다. 그대로 쓰는 패키지는 없다 |
| `@cordisjs/plugin-group` | 쓰지 않음 | 이름만 겹치는 3줄 설정 그룹 재수출(`group/src/index.ts`)이다(`_research/packages.md` §4.6). 의미가 다르고 Cordis 직접 import도 DR-11 위반이다 |
| `create-cordis` 스캐폴딩 방식 | 참고만 | 추가 그룹 템플릿의 스캐폴드 방식 참고 자료다. `create-cordis` 코드는 들이지 않는다. 템플릿 파일 자체는 L3.slots.plan §2.1 후보 a에 따라 이 패키지의 `templates/`에 둔다(G-24). 위치의 최종 확정은 `eng.context-map.design` C-2 [미결]과 함께 한다 |
| 결정성 규칙(Date.now·Math.random 금지) | 읽기 자료 | Claude Code 워크플로 문서와 pi durable tasks를 근거로 규칙만 가져온다(`_research/packages.md` §4.6, `_research/ref-synthesis.md` 확장 지점 발견 4). 코드는 들이지 않는다 |
| `typebox` 1.3.27 | 그대로(catalog) | 상태 스키마 검사(`Value.Check`). DR-07상 소유 제한 없음 |
| `@swc/core` 1.16.18 | 그대로(catalog, 2차) | `scanDriveSource` 파서. dependency-cruiser가 이미 같은 버전을 쓴다(`eng.toolchain.guide` 1.1절). DR-07 행 추가 필요 |
| Cordis vendored(`df4431eb43086bd1f8263a0e8c03e9b7c5233b68`) | 직접 사용 안 함 | ext-host가 감싼 API만 쓴다(ADR-0002) |

## 5. 단위 테스트 목록

테스트는 `bun test`, 패키지 안 `test/`에 둔다. 2차의 템플릿·정식 예 테스트(L3.slots.plan §5 목록)는 `test/slots/`에 두고 G-24~G-27이 만든다. 모델이 필요한 테스트는 테이프 가짜(`@xeon/core-models/testing`)를 쓰고, X는 테스트 호스트(`@xeon/ext-host/testing`)를 쓴다. 통합 테스트는 두지 않고 저장소 공용 스모크 1개(`eng.testing.guide` TS-01 `scenario`)에 M1 그룹을 올린다.

| 테스트 이름 | 확인하는 동작 | 마일스톤 |
|---|---|---|
| `smoke.uses-on-post-drive-in-one-turn` | `smokeGroup`이 한 턴에서 `tool_call`·`turn_end` 핸들러, `post`, drive 함수를 모두 호출한다 | M1 |
| `smoke.manifest-passes-validation` | `smokeGroup` 매니페스트가 `validateManifest`, 실제 등록이 `validateUsage`를 오류 없이 통과한다 | M1 |
| `smoke.toggle-applies-at-step-boundary` | 실행 중 끄기 요청이 다음 단계 경계에서 적용되고 그 전 단계의 핸들러는 계속 불린다 | M1 |
| `define-group.rejects-usage-without-manifest-point` | 매니페스트에 없는 지점에 `on`을 건 그룹에서 `checkGroup`이 `point_undeclared`를 돌려준다 | M2 |
| `define-group.rejects-reserved-name` | `name: "auto"`, `"core"`, `"web"`(L2 도메인 이름), `"focus_lens"`(밑줄), `"-abc"`에 `group_name`. 하이픈 이름 `"web-exa"`는 통과한다(review.decisions-2 U-18). `RESERVED_GROUP_NAMES`가 L3.readme §4와 L3.slots.spec §3.3.4가 가리키는 정본이다 | M2 |
| `define-group.accepts-stateless-group` | `state` 없이 `on`만 쓰는 정의가 오류 없이 `GroupModule`(`stateVersion: 0`)을 만들고, `migrations`만 있으면 `state_version` | M2 |
| `define-group.group-manifest-from-json` | `groupManifest`가 템플릿 `plugin.json` 값을 통과시키고 `kind: "plugin"` 값에는 `Bug`를 던진다 | M2 |
| `resources.tool-and-command-released-on-disable` | `registerTool`·`registerCommand`로 등록한 리소스가 그룹을 끄면 해제된다(가짜 `ExtHost.resources`) | M2 |
| `define-group.rejects-wrong-settings-namespace` | 내장 그룹이 `ext.<이름>`, 외부 그룹이 `l3.<이름>`을 쓰면 `settings_namespace` | M2 |
| `define-group.throws-bug-on-invalid` | 오류가 있는 정의에서 `defineGroup`이 `Bug`를 던지고 메시지에 모든 code가 있다 | M2 |
| `arbiter.auto-keeps-holder` | A가 임대를 가진 동안 새 그룹 C가 켜져도 X가 `choose`를 부르지 않고 holder는 A다(테스트 호스트) | M2 |
| `arbiter.auto-first-request-wins` | `requestSeq` 최소 그룹이 받고, 동률이나 null은 `loadOrder`로 깬다 | M2 |
| `arbiter.named-holder-only` | `x.primitives.activeDriveGroup` = B면 `decide`는 B만 고른다. B가 후보가 아니면 null | M2 |
| `arbiter.port-maps-lease-candidates` | `leaseArbiterPort`가 `LeaseCandidate.loadIndex`를 `loadOrder`로 옮기고 `decide`의 `holder`를 `choose` 결과로 돌려준다 | M2 |
| `arbiter.named-unavailable-grants-none` | 지정 그룹이 후보가 아니면 `holder: null`, 모두 `waiting` | M2 |
| `arbiter.excludes-drive-error` | drive 예외로 오류 표시된 그룹은 X가 후보에 넣지 않고 `GroupStatus.drive`가 `"error"`다(테스트 호스트) | M2 |
| `arbiter.waiting-group-keeps-on-handlers` | 대기 그룹의 drive 함수 호출은 0이고 `tool_call` 핸들러와 `post`는 계속 동작한다(테스트 호스트) | M2 |
| `arbiter.named-swap-revokes-at-the-next-boundary` | A가 임대를 가진 동안 `x.primitives.activeDriveGroup`을 B로 바꾸면 임대는 그 경계까지 유지되고, 다음 경계에서 `lease.released{revoked}` 뒤 B가 `lease.acquired`를 받는다. 끊긴 step이 없다. B가 후보가 아니면 유지된다(X.primitives.spec §4.4.1 5번) | M2 |
| `state.restore-on-branch` | v1·v2 커밋 뒤 v1 직후로 분기하면 `state()`가 v1이다 | M2 |
| `state.restore-on-resume` | 재시작 뒤 drive 함수 인자가 마지막 커밋 상태다 | M2 |
| `state.rejects-oversize-and-skips-unchanged` | 64 KiB 초과 커밋 거부, 같은 값 커밋은 이벤트를 쓰지 않는다 | M2 |
| `state.migration-required-on-version-bump` | version 2에 `migrations[1]`이 없으면 `state_migration_missing`, 있으면 v1 저장값이 업캐스트된다 | M2 |
| `records.write-requires-declared-kind` | 선언하지 않은 kind로 `record`하면 `record_kind_undeclared`이고 이벤트가 없다 | M2 |
| `records.rejects-foreign-prefix` | 다른 그룹 접두 kind와 `customType`을 거부한다 | M2 |
| `records.kind-filter-hides-undeclared-groups` | `kindVisibleTo`가 자기 접두, `readsRecordKinds` 대상만 참이다 | M2 |
| `comms.no-cross-group-import` | `fixtures/cross-group-import` 샘플에서 check-layers가 DR-02로 실패하고, group-kit 소스의 그룹 패키지 import 수가 0이다 | M2 |
| `service.set-holder-rejects-unknown-and-no-drive` | `group.unknown`, `group.noDrive`를 돌려주고 설정을 바꾸지 않는다 | M2 |
| `service.status-reports-pending-toggle` | 요청 직후 `pendingToggle`이 채워지고 적용 뒤 null이 된다 | M2 |
| `command.parse-grammar` | 문법 표의 모든 형태를 해석하고 잘못된 입력에 사용법 문자열을 돌려준다 | M2 |
| `command.group-off-applies-at-step-boundary` | 실행 중 `/group off helm`의 출력이 `pending: true`이고 문구 "다음 단계 경계에 적용한다"를 담는다 | M2 |
| `status-line.examples` | 스펙 §3.9 예 표 다섯 입력의 출력이 그대로다. 폭 초과 때 `+N` | M2 |
| `settings.no-drive-holder-key` | `l3.group-kit` 묶음에 키가 `instrumentation`, `statusLine` 둘뿐이고 `checkSettingDef`를 통과한다. 구동 그룹 선택 키는 X 키를 읽는다 | M2 |
| `replay.cut-at-every-commit-yields-same-events` | EV-09 좋은 예 그룹에서 모든 절단 지점의 digest가 기준과 같다 | M2 |
| `replay.detects-closure-state` | EV-09 나쁜 예 그룹에서 `ok: false`이고 `firstDiff`가 채워진다 | M2 |
| `delegate.rejects-long-request-id` | 48자 초과 `requestId`와 남의 접두 `customType`을 호출 전에 거부한다 | M2 |
| `delegate.idempotent-by-request-id` | 같은 `requestId` 두 번째 호출이 `duplicate`이고 자식이 하나다(가짜 위임 서비스) | M3 |
| `scan.flags-date-now-in-drive` | drive 본문 `Date.now()`에 SD-01, drive 밖에는 없음 | M3 |
| `scan.flags-all-forbidden-targets` | SD-02~SD-09 각 금지 문자열 샘플이 해당 코드를 낸다 | M3 |
| `scan.warns-closure-reassignment` | drive 밖 `let`을 drive 안에서 재할당하면 SD-10 경고 | M3 |
| `metrics.disabled-writes-nothing` | instrumentation false면 계측 이벤트 0개, `GroupStatus.metrics` null | M3 |
| `metrics.counts-deny-and-patch` | first 거부 2회, chain 패치 3회가 `denies: 2`, `chainPatches: 3`으로 집계된다 | M3 |
| `promotion.second-consumer-is-candidate` | 그룹 A 도구를 B 임대 turn이 호출하면 후보, 사용자 turn 호출은 `userCalls`만 | M3 |

## 6. 완료 기준

마일스톤별:

| 마일스톤 | 기준 |
|---|---|
| M1 | `cd xeon && just verify` 종료코드 0. 1~3번 `smoke.*` 테스트 통과. 저장소 스모크(`xeon chat` 테이프 한 턴 + 강제 종료 뒤 재개)에서 `smokeGroup`의 drive 켜기·끄기가 단계 경계에서 적용된다(`_research/foundation-plan.md` §6). `xeon.domain`이 `group-kit`이다 |
| M2 | `just verify` 종료코드 0. M2 표시 테스트 전부 통과. 허용 목록 두 항목이 있고 `group-helm`이 `@xeon/group-kit`만 import해 check-layers를 통과한다. `group-helm` 테스트가 `replayDrive`로 `ok: true`를 낸다 |
| M3 이후 | `just verify` 종료코드 0. M3 표시 테스트 전부 통과. `grp.<그룹>.metrics.recorded` 기록이 `recordPrivate`로 쓰이고, `grp.<그룹>.state.committed`는 X가 쓴다 |

수용 기준(L3.group-kit.spec §9)과 테스트 이름 대응:

| 수용 기준 | 테스트 |
|---|---|
| 1 | `arbiter.auto-first-request-wins`, `arbiter.port-maps-lease-candidates`, `arbiter.waiting-group-keeps-on-handlers` |
| 2 | `arbiter.waiting-group-keeps-on-handlers`, `delegate.idempotent-by-request-id` |
| 3 | `arbiter.auto-keeps-holder` |
| 4 | `arbiter.named-holder-only`, `arbiter.named-swap-revokes-at-the-next-boundary` |
| 5 | `arbiter.named-unavailable-grants-none` |
| 6 | `service.set-holder-rejects-unknown-and-no-drive`, `command.parse-grammar` |
| 7 | `command.group-off-applies-at-step-boundary`, `service.status-reports-pending-toggle`, `smoke.toggle-applies-at-step-boundary` |
| 8 | `comms.no-cross-group-import` |
| 9 | `smoke.uses-on-post-drive-in-one-turn`, `smoke.manifest-passes-validation` |
| 10 | `define-group.rejects-usage-without-manifest-point`, `define-group.rejects-reserved-name`, `define-group.throws-bug-on-invalid`, `define-group.accepts-stateless-group` |
| 10a | `resources.tool-and-command-released-on-disable` |
| 10b | `define-group.group-manifest-from-json` |
| 11 | `state.restore-on-branch`, `state.restore-on-resume` |
| 12 | `state.migration-required-on-version-bump` |
| 13 | `state.rejects-oversize-and-skips-unchanged` |
| 14 | `delegate.idempotent-by-request-id` |
| 15 | `replay.cut-at-every-commit-yields-same-events`, `replay.detects-closure-state` |
| 16 | `scan.flags-date-now-in-drive` |
| 17 | `promotion.second-consumer-is-candidate` |
| 18 | `metrics.disabled-writes-nothing` |
| 19 | `status-line.examples` |

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| X 요청 사항 반영 지연. X.primitives.spec은 `LeaseArbiterPort`, `ExtHost.scopes()`, 유휴 토글 적용을 정했지만 `LeaseCandidate.enabledAtSeq`, `leaseId` 조회, 변경 구독, 테스트 호스트 재시작 지원은 아직 없다(스펙 §3.13) | G-08의 요청 순번, G-12의 구독, G-15가 늦어진다 | `DriveArbiter`(G-07), 명령·상태줄(G-13 문자열 부분), 상태 검사(G-09 순수 함수)를 먼저 순수 함수로 끝낸다. `enabledAtSeq`가 없으면 `loadOrder`만으로 정하고, 구독이 없으면 경계 훅 뒤 `scopes()`를 다시 읽는다. 요청 4개는 스펙 §3.13 목록으로 X 작성자에게 넘긴다 |
| DR-02 예외는 방법 (b)로 정했다(review.decisions-2 U-15, 2026-10-22 확인). 뒤에 (a)(F·X로 이동)로 번복하면 group-kit의 정의 API 위치가 바뀐다 | G-03, G-04의 배치 변경 | 공개 이름과 시그니처는 그대로 두고 파일만 옮길 수 있게 `define-group.ts`가 F 타입만 의존하도록 쓴다 |
| drive 재생 규율을 타입으로 막을 수 없다(F.extensions.spec §4.6) | 클로저 상태를 쓰는 그룹이 재개 뒤 다르게 동작한다 | M2에 `replayDrive`를 그룹 테스트 필수 항목으로 두고(G-15), 2차에 `scanDriveSource`(G-19)로 정적 검사를 더한다. 두 수단 모두 협조적 코드만 잡는다는 한계를 그룹 문서에 적는다 |
| 계측 kind `grp.<그룹>.metrics.recorded`는 그룹 접두이고 group-kit이 만든다 | X `recordPrivate`가 늦으면 G-17이 늦어진다 | G-17을 M3에 두고 그때까지 메모리 집계만 쓴다 |
| L1.agents 위임 서비스 미정 | `delegate` 구현(G-14 M3)이 늦어진다 | M2는 입력 검사와 `group.delegateUnavailable`만 둔다. 학습 그룹 계획(L3.learning.plan)과 같은 시점에 맞춘다 |
| `@swc/core` 파서 결과가 TS 7 문법 일부를 해석하지 못함 | `scanDriveSource` 오탐·누락 | 파싱 실패는 `warning` 하나로 보고하고 실패시키지 않는다. 대상 문법은 drive 함수 본문으로 좁다 |

## 8. M2 구현 상태 (2026-10-24, 브랜치 m2/gk)

| m2-plan ID | plan 작업 | 상태 | 비고 |
|---|---|---|---|
| GK.1 | G-04, G-05, G-06, G-23 | 완료 | `defineGroup`, `groupManifest`, `validateGroupDef`, `GroupApi` 래퍼, `checkGroup`. `on` 래퍼의 거부·패치·예외 계수는 M3 |
| GK.2 | G-07, G-08 | 완료 | `defaultDriveArbiter`, `leaseArbiterPort`. 이름 지정 회수는 X가 한다 |
| GK.3 | G-09, G-10, G-11 | 완료 | `checkStateCommit`, `stateUpcasters`, 레코드·post 검사, `kindVisibleTo`, 설정 2키. 시험은 인메모리 기록 저장소(`memoryRecordStore`)로 한다. 실제 `ext.commit`·`queryRecords`(L1B.1) 연결은 HOST 조립 |
| GK.4 | G-12, G-13, G-22, G-14(M2분) | 완료 | `createGroupService`, `/group` 해석·실행, 상태줄, `registerTool`·`registerCommand` 해제 시험, `delegate` 입력 검사 |
| GK.5 | G-15, G-16, G-21 | 완료 | `replayDrive` 최소형, `smokeGroup`의 `defineGroup` 이전, 그룹 간 import 실패 시험 |
| (G-02 일부) | `xeon.domain` | 미완료 | `package.json`의 `xeon.domain`은 `kit`이다. `group-kit`으로 바꾸려면 `scripts/check-layers.ts`의 DR-03 `expectedDomain`에 예외를 더해야 하는데 이 파일은 공유 파일이다(m2-plan §3 규칙 2) |
| (G-03) | 허용 목록 | 완료(F.1) | `DR-02/group-kit-helm`, `DR-02/group-kit-learning`이 이미 있다. G-21 시험용으로 `DR-07/group-kit-test-spawn`(scope test)을 더했다 |

M2 시험 이름 대응에서 바뀐 것: `arbiter.swap-waits-for-lease-release`는 `arbiter.named-swap-revokes-at-the-next-boundary`로 바꿨다(X.1 P-22). `define-group.migration-required-on-version-bump`는 `define-group.*`와 `state.migration-upgrades-a-lower-stored-version` 둘로 나눴다.
