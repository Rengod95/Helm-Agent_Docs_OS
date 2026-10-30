---
id: X.operations.plan
layer: X
domain: operations
kind: plan
status: draft
depends_on: [X.operations.spec, X.primitives.plan, X.loading-trust.plan, F.extensions.plan, F.records.plan, F.wire-settings.plan, eng.testing.guide]
binds: [xeon/packages/ext-host/src/operations/**]
---

# X 운영 규칙 구현 계획

대상 스펙: `X.operations.spec`. 패키지: `@xeon/ext-host`(`xeon/packages/ext-host`), 소스 `src/operations/`.

## 1. 목표와 마일스톤 배치

[결정] M0 범위에 `ext-host`(Cordis vendored, on/post/drive/scope 최소형)가 들어가고, M1은 테스트용 그룹이 on/post/drive를 쓰는 걷는 골격이다(`_research/foundation-plan.md` §5 P4). 이 계획의 1차·2차 구분은 `_research/layer-plan-v2.json` X-c를 따른다. 이름 충돌, 안전 모드는 2차다. 외부 훅은 M4다 [결정: 2026-10-28 사용자].

| 마일스톤 | 범위 | 스펙 절 | 소비자 |
|---|---|---|---|
| M0 | tier 정렬 키(`TIERS`, `orderKeyOf`, `compareOrderKey`, `assignTier`, `TierTable`)와 `DispatchPolicy.tierOf`·`budgetMs`·`onHandlerFailure`·`onHandlerSettled`·`run` 연결(X.primitives.spec §3.4). 핸들러 시간 예산(`runWithBudget`, `BudgetGate`, `awaitUser`, `budgetClassOf`, `DEFAULT_BUDGETS_MS`)과 UI 대기 제외. 예산 초과·예외의 fold별 처리(tap 기록, first `FIRST_DENY`, chain 패치 버림)를 primitives 디스패처에 연결. 확장 단위 실패 집계(`FailureLedger`)와 `HandlerOutcomeRecord` 기록. 1차 설정 키 중 예산 키 | §3.1~§3.3, §4.1~§4.2, §4.3.1~§4.3.2, §6 | X.primitives 디스패처, L1 지점 발화 |
| M1 | `ExtStorage` 최소형: 접두 테이블 정의·DDL, 확장 투영으로 코어 커밋과 같은 트랜잭션 쓰기, 읽기, 소유 장부 `xh_ext_tables`. 테스트 그룹이 이를 사용한다. 자동 끄기(`judgeAutoDisable`, `AutoDisabler`, `ScopeControl` 연결)와 알림. 자동 끄기 설정 키 | §3.3~§3.4, §4.3.3~§4.3.5, §4.4.1~§4.4.5, §4.4.8 | M1 스모크 테스트 그룹, L3 group-kit |
| M2 이후 | 이름 충돌 네임스페이스(`resolveNames`). 안전 모드와 `--disable-ext`, 연속 시작 실패 제안. 외부 훅 프로토콜(설정, 실행, 해석, 환경 정리)은 M4로 옮겼다 [결정: 2026-10-28 사용자]. 접두 밖 접근 차단 강화(`checkStatement` 상시화 검토, authorizer 조사), `ExtQuery` 범위 조건. 확장 테이블 삭제(`ExtStorageAdmin`). 보존 테이블과 열 추가 마이그레이션(스펙 §10 미결 8 결정 뒤) | §3.5~§3.7, §4.4.6~§4.4.7, §4.5~§4.7 | X.loading-trust(제거, 로더), L4 host·cli·settings-ui |

- M0에서 F.records의 휘발 kind `scope.handler_failed` 추가(스펙 §10 미결 4)가 아직이면 알림은 운영 로그로만 남기고, kind가 생기면 같은 `OperationsNotifier` 구현을 바꾼다.
- M1의 확장 테이블 삭제는 범위 밖이다. M1 테스트 그룹은 제거하지 않는다.

## 2. 패키지와 파일 배치

[제안] 스펙 §3의 파일 구분을 그대로 쓴다.

```
xeon/packages/ext-host/
  src/operations/
    tier.ts              # Tier, TIERS, TierSchema, HandlerOwner, ownerKey, HandlerOrigin, HandlerOrderKey,
                         # TierOfFn, orderKeyOf, compareOrderKey, TierInput, TierError, TierTable,
                         # createTierTable, tierOfFrom, GUARD_EXTENSIONS, assignTier
    budget.ts            # BudgetClass, BudgetTable, DEFAULT_BUDGETS_MS, STREAM_TAP_POINTS, budgetClassOf,
                         # budgetMsFrom, BudgetGate, BudgetOutcome, BudgetDeps, runWithBudget, awaitUser
    failure.ts           # FailureKind, HandlerResultKind, HandlerOutcomeRecord, fromHandlerFailure,
                         # FailureStats, FailureLedger, createFailureLedger
    auto-disable.ts      # AutoDisablePolicy, DEFAULT_AUTO_DISABLE, AUTO_DISABLE_EXEMPT_TIERS,
                         # AutoDisableVerdict, judgeAutoDisable, ScopeChangeReason, ScopeControl,
                         # OperationsNotifier, AutoDisabler, createAutoDisabler
    storage/
      ext-storage.ts     # ExtQuery, ExtTableReader/Writer, ExtReaders/Writers, ExtProjection, ExtTables,
                         # ExtStorageError, ExtStorage, storageOf, ExtTableRecord, ExtStorageAdmin
      tables.ts          # EXT_TABLE_LOCAL_PATTERN, EXT_COLUMN_PATTERN, RESERVED_LOCAL_TABLES, THREAD_COLUMN,
                         # ExtTableDef(s), extTablePrefix, extTableName, parseExtTableName, columnTypeOf, tableDdl
      guard.ts           # GuardViolation, checkStatement
      migrate.ts         # M2 이후. 보존 테이블 마이그레이션(스펙 §10 미결 8 결정 뒤). M1에는 투영 버전 재생성 호출만
    naming.ts            # M2. NamedResourceKind, ResourceClaim, ResolvedName, qualifiedName, ReservedNames,
                         # resolveNames, createResourcePolicy
    safe-mode.ts         # M3a. SafeModeSource, StartupOptions, LoadCandidate, SkipReason, startupFilter,
                         # allowedInSafeMode, shouldSuggestSafeMode
    hooks/
      config.ts          # M2. HOOK_ID_PATTERN, HOOK_POINTS, HookPointName, HookDefSchema, HookDef,
                         # HookDefListSchema, HookSource, LoadedHook, loadHooks
      protocol.ts        # M2. HOOK_SCHEMA_VERSION, 상한 상수, HookInput, HookOutputSchema,
                         # HookVerdict, interpretHookRun, F HookRawRun 재export
      run.ts             # M2. BASE_ENV_ALLOW, SECRET_ENV_PATTERN, hookEnv, runHook, F HookProcessPort·HookRunSpec 재export
    settings-keys.ts     # defineSettings("x.operations", …). 1차 키는 M0·M1, 2차 키는 M2에 더한다
    index.ts             # OperationsDeps, OperationsSettingsSource, OperationsPolicy,
                         # createOperationsPolicy와 공개 이름 재export
  test/operations/
    tier.test.ts  budget.test.ts  failure.test.ts  auto-disable.test.ts  policy.test.ts
    storage/tables.test.ts  storage/guard.test.ts  storage/ext-storage.contract.ts
    storage/ext-storage.fake.test.ts      # 계약 시나리오를 자체 저장 대역으로 실행. bun:sqlite 실행은 L0.store.plan ST-23
    support/fake-store.ts  support/manual-clock.ts   # F 인터페이스로 만든 저장 대역과 시계(L0 import 없음)
    naming.test.ts  safe-mode.test.ts  hooks/protocol.test.ts  hooks/env.test.ts  hooks/run.test.ts
    settings-keys.test.ts  doc-constants.test.ts
    fixtures/bypass-identifiers.ts   # 접두 우회 시도 문자열 모음
    fixtures/hooks/                  # 테스트용 훅 스크립트(exit 0·1·2·137, 큰 출력, 지연)
```

- import 방향: `tier` ← `budget` ← `failure` ← `auto-disable` ← `index`. `storage/tables` ← `storage/guard` ← `storage/ext-storage`. `hooks/config` ← `hooks/protocol` ← `hooks/run`. `naming`, `safe-mode`는 `tier`만 import한다. `index.ts`만 모든 파일을 import한다.
- 외부 import: `@xeon/contracts`(루트, `/extensions`, `/records`, `/conversation`, `/settings`)와 `typebox`만 쓴다. 같은 패키지의 `../primitives/index.ts`(`DispatchPolicy`, `HandlerEntryInfo`, `HandlerFailure`, `ResourcePolicy` 등)와 `../loading-trust/index.ts`(`TrustLevel`, `InstallSource`, `LoadedExtensionInfo`)는 타입만 import한다(`import type`). 그래서 도메인 사이 값 순환이 없다. `operations/`는 Cordis를 import하지 않는다 [제안]. Cordis import는 `src/primitives/cordis-bridge.ts` 한 파일이고(X.primitives.plan §2), operations는 포트(`ScopeControl`, `PortLookup`, 설정 포트)로만 받는다. 이 규칙은 `eng.dependency-rules.guide` DR-11(Cordis는 `ext-host`만 import)보다 좁고, X.primitives.plan §6 4번의 grep 검사로 확인한다.
- L0·L1 기능(`xeon.store`, `xeon.session`, `xeon.process`)은 Cordis 서비스 주입으로 받는다. primitives가 주입받은 서비스를 `ExtHost.ports`(`PortLookup`)로 내놓고, 조립 루트가 그것을 `OperationsDeps.ports`로 늦은 연결해 넘긴다. operations는 `ProjectorRegistryPortKey`·`ScopedStorePortKey`(저장 영역, `storageOf`)와 `ProcessPortKey`(외부 훅)로 꺼낸다(X.primitives.spec §3.6, `architecture.layers.spec` §4.3.3).
- 시계와 타이머는 `ExtHostDeps`와 같은 `now`, `setTimer` 함수로 받는다(X.primitives.spec §3.2). [결정: review.decisions-2 U-03] F에는 `./testing` 서브패스가 없고 테스트 대역은 각 패키지 `test/` 안에 둔다. 그래서 `test/operations/support/manual-clock.ts`에 F `Clock` 인터페이스로 `ManualClock`을 두고 두 함수를 만든다. 같은 패키지의 `@xeon/ext-host/testing` 가짜 타이머(X.primitives.plan P-03)가 같은 일을 하면 그것을 쓴다.
- [결정: review.decisions-2 D-05] X 테스트는 L0를 import하지 않는다. 저장 대역은 `test/operations/support/` 안에 F 인터페이스(`StoreDb`, `ProjectionTx`, `Projector`, F.records.spec §3.9)로 만든다. 실제 bun:sqlite 저장소로 같은 계약 시나리오를 돌리는 일은 L0.store.plan ST-23(`ext-storage.contract.int.test.ts`, L0.store.spec §9 18번)이 맡는다(O-15).
- 아래 표의 L0·L1 plan 선행 작업은 구현 순서의 의존이다. X 코드와 테스트의 import 의존은 아니다.

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| O-01 | `settings-keys.ts`에 1차 예산 키 6개(`setupMs` 포함) 선언(`defineSettings("x.operations", …)`), `index.ts` 골격, `package.json` exports 확인 | F.wire-settings.plan(`defineSettings`, `SettingDef`) | S | M0 |
| O-02 | `tier.ts`: `TIERS`, `TierSchema`, `orderKeyOf`, `compareOrderKey`, `ownerKey`, `assignTier`, `TierTable`, `tierOfFrom`, `GUARD_EXTENSIONS` | F.extensions.plan(`PointDecl`, `ExtensionName`, `ExtensionManifest`), L-02(`TrustLevel`, `InstallSource`) | S | M0 |
| O-03 | `createOperationsPolicy`(`tierOf`, `budgetMs`, `onHandlerFailure`, `admit`, `forget`, `setupBudgetMs`)를 `ExtHostDeps.policy`·`setupBudgetMs`로 연결. 로더 6a단계(설치 전) `admit` 호출은 L-06이 한다. 정렬이 `(tierOf, loadIndex, seq)`인지 확인하는 통합 테스트(P-20과 같은 시나리오) | P-04(핸들러 레지스트리), P-06(`DispatchPolicy`), L-03(로드 순서), O-02 | M | M0 |
| O-04 | `budget.ts`: `runWithBudget`(`now`·`setTimer` 주입, pause 깊이, TimeoutError abort, 늦은 결과 버림, outer abort), `awaitUser` | O-02 | M | M0 |
| O-05 | `budgetClassOf`, `budgetMsFrom`, `STREAM_TAP_POINTS`, `DEFAULT_BUDGETS_MS`, `OperationsSettingsSource.budgets()`로 유효 예산 읽기(`live`). `OperationsPolicy.setupBudgetMs`로 scope setup 예산(`ExtHostDeps.setupBudgetMs`)에 `setup` 값 제공 | O-01, O-04 | S | M0 |
| O-06 | `OperationsPolicy.run` 구현(`DispatchPolicy.run`, X.primitives.spec §3.4): 디스패처가 이 함수로 핸들러를 실행하고, 결과(`timeout`, `threw`, `aborted`)를 fold 규칙(tap 기록, first `FIRST_DENY`, chain 패치 버림)에 넘기는지 확인. drive 경로는 `budgetMs: null` | P-06(fold 엔진, `run` 호출), P-11(drive 실행기), O-05 | M | M0 |
| O-07 | UI 포트 래핑: primitives가 핸들러에 주는 UI 포트·승인 대기를 `awaitUser`로 감싼다. signal 합치기(`AbortSignal.any`). [결정: review.decisions-2 U-07] `HandlerContext.ui`는 M1에 넣지 않으므로 M2에 둔다 | X.primitives.plan(UI 포트, 스펙 §10 미결 5), O-04 | S | M2 |
| O-08 | `failure.ts`: `fromHandlerFailure`, `FailureLedger`(연속 수, 창, aborted·`value_from_tap` 제외), `onHandlerFailure`·`onHandlerSettled` 구현 | O-06 | M | M0 |
| O-09 | `OperationsNotifier` 기본 구현: 운영 로그. F.records에 `scope.handler_failed`가 생기면 휘발 이벤트 발신으로 바꾼다 | F.records.plan(kind 추가 요청, 스펙 §10 미결 4), O-08 | S | M0 |
| O-10 | `auto-disable.ts`: `judgeAutoDisable`, `createAutoDisabler`(요청 1회 보장, 면제 tier, 훅 끄기 자리), 자동 끄기 설정 키 5개 | P-09(scope 토글, `ScopeControl`의 바탕), O-08 | M | M1 |
| O-11 | `scope.changed`의 `reason` 기록 연결. F 필드가 없으면 M1은 운영 로그에만 사유를 남긴다 | F.records.plan(`ScopeChangedPayload.reason` 추가 요청), O-10 | S | M1 |
| O-12 | `storage/tables.ts`: 이름 규칙, `parseExtTableName`, `columnTypeOf`, `tableDdl`(인용, STRICT, 인덱스 이름) | F.extensions.plan(`ExtensionName`) | M | M1 |
| O-13 | `storage/guard.ts`: `checkStatement`(접두 대조, 금지 키워드, 여러 문장). 테스트·디버그 빌드에서 O-14가 만든 모든 문장에 적용 | O-12 | S | M1 |
| O-14 | `storage/ext-storage.ts`: `defineTables`(검사, 소유 장부 `xh_ext_tables`, `kinds` 소유 검사), `ExtProjection` → `Projector` 변환과 `ProjectorRegistryPort.register` 등록(`Result` 오류 → `defineTables` 실패), `onFailure` 구독, `ExtWriters`(ProjectionTx 감싸기), `read`(`scoped("ext.<name>")` 읽기), 소유 장부(`scoped("xh")`), `storageOf` | P-30(`ProjectorRegistryPortKey`, `ScopedStorePortKey`, `PortLookup`), L0.store.plan(`StoreService.scoped`, `ProjectionTx` 포트), L1.persistence.plan(`ProjectorRegistry.register`), F.records.plan(확장 kind 등록 `EventKindRegistry`), O-12, O-13 | L | M1 |
| O-15 | 저장 영역 계약 시나리오 `ext-storage.contract.ts`: 저장소 팩토리를 인자로 받는 시나리오 모음. X `test/` 안에서는 F 인터페이스로 만든 자체 저장 대역(`test/operations/support/fake-store.ts`, 장애 주입 지점 포함)으로 돌린다. 시나리오 파일은 테스트 파일이라 L0.store.plan ST-23이 실제 bun:sqlite 팩토리로 같은 시나리오를 돌릴 수 있다(테스트 파일 교차 import, [결정: review.decisions-2 U-17]). 장애 주입 롤백 시나리오 포함 | F.records.plan(`StoreDb`, `ProjectionTx`, `Projector`), O-14 | M | M1 |
| O-16 | M1 스모크 연결: 테스트 그룹이 `storageOf(g).defineTables`로 테이블 하나를 정의하고 `boundary.step.after` entries의 자기 kind 이벤트를 투영한다. 재개 뒤 행이 이어지는지 확인 | F.extensions.plan M1 스모크 매니페스트, L4.host-service.plan 조립, O-14 | M | M1 |
| O-17 | `doc-constants.test.ts`: 스펙 §4.2.2 표·§6 표의 기본값과 §3.1 tier 이름을 코드 상수와 대조 | O-05, O-10, O-02 | S | M1 |
| O-18 | `naming.ts`: `qualifiedName`, `resolveNames`(순서 무관, 예약, 충돌, 64자), `createResourcePolicy`(`ResourcePolicy.resolve` 쌍 판정) | P-24(리소스 레지스트리, `ResourcePolicy`) | M | M2 |
| O-19 | `ExtHostDeps.resourcePolicy` 연결, 집합 판정 메서드 추가를 primitives와 합의(스펙 §10 미결 17). 어댑터 등록 매핑 확인은 삭제합니다(adr.0017 §3.7, D-M3-11 c) | O-18 | M | M2 |
| O-20 | `safe-mode.ts`: `startupFilter`, `allowedInSafeMode`, `shouldSuggestSafeMode`. `OperationsPolicy.startupFilter`(후보별 `assignTier` 뒤 `startupFilter`), `StartupHealthStore` 포트(호스트가 시작 상태 파일을 연결할 때 정의합니다. 2026-10-28 미사용 export 정리), 2차 안전 모드 키 2개. 로더 5a단계 연결은 L-29 | L-08(로더), L4.host-service.plan(시작 상태 파일, `--safe-mode`·`--disable-ext` 파싱), O-02 | M | M2 |
| O-21 | `hooks/config.ts`: `HookDefSchema`, 범위별 목록 병합, tier 부여, 프로젝트 신뢰 조건, 2차 훅 키 3개 | L-17(프로젝트 신뢰), F.wire-settings.plan(배열 키 병합, 스펙 §10 미결 13), O-02 | M | M4 |
| O-22 | `hooks/protocol.ts`: `HookInput` 직렬화, `HookOutputSchema`, `interpretHookRun`(스펙 §4.7.3 표 전체) | F.extensions.plan(`POINTS[point].result` 스키마), O-21 | M | M4 |
| O-23 | `hooks/run.ts`: `hookEnv`, `HookProcessPort`(`ProcessPortKey`로 조회)로 실행, 출력 상한, 예산, 결과를 `HandlerOutcomeRecord`로 보고 | P-30(`ProcessPortKey`), L0.process.plan(`ProcessService` 실행 메서드, 프로세스 그룹 종료), O-22, O-08 | M | M4 |
| O-24 | 외부 훅 등록: 범위별 내부 내장 확장 단위(`xeon-hooks-<범위>`)를 `ExtHost.install`로 싣고 훅마다 on 핸들러 하나를 등록(모든 확장 뒤 loadIndex, `TierTable`에 범위별 tier), (단위, 순번) → 훅 id 표, 자동 끄기의 훅 끄기 연결 | P-13(`install`), O-03, O-10, O-23 | M | M4 |
| O-25 | `ExtStorageAdmin`(`tablesOf`, `dropExtension` 2단계 확인)과 제거 흐름 연결(`LoaderDeps.storageAdmin`) | L-28(제거 흐름), L4.settings-ui.plan(확인 화면), O-14 | M | M2 |
| O-26 | 접두 차단 강화: `bun:sqlite` authorizer 노출 여부 조사(문서·소스 읽기만), `ExtQuery` 범위 조건 | O-14, 스펙 §10 미결 9 | M | M2 |
| O-27 | 보존 테이블과 `storage/migrate.ts` 열 추가 마이그레이션 | 스펙 §10 미결 8 결정, F.records.plan(`CommitPlan` 확장 시) | L | M2 이후 |

## 4. 채택 코드

- 외부 패키지: 없음. 이 도메인은 자체 구현이다(`_research/packages.md` §4.5 X-c "패키지 없음", "자체").
- 쓰는 워크스페이스 의존: `@xeon/contracts`(workspace), `typebox` 1.3.27(워크스페이스 catalog, `F.readme` §1). 런타임 Bun 1.4.3, TypeScript 7.0.x(`_research/foundation-plan.md` §2).
- 읽기 자료(복사하지 않음):

  | 자료 | 경로 | 라이선스 | 쓰는 방법 |
  |---|---|---|---|
  | omp 핸들러 예산 | `packages/coding-agent/src/extensibility/extensions/runner.ts:133-200`(`EXTENSION_HANDLER_TIMEOUT_MS`, `SESSION_SHUTDOWN_HANDLER_TIMEOUT_MS`, `HandlerTimeoutBudget`, `createHandlerUIContext`), `:300-375`(`raceHandlerWithTimeout`) | MIT | pause 깊이 세기, 남은 시간 계산, 늦은 결과 버림, 타이머 해제 방식만 참고한다. 코드는 Xeon의 `now`·`setTimer` 주입 구조로 새로 쓴다. `performance.now()`·`setTimeout` 직접 호출은 쓰지 않는다 |
  | pi 오류 처리 | `~/projects/_ref/pi-src/packages/coding-agent/src/core/extensions/runner.ts`(`emitError` 737-746, emit 루프의 catch 1104-1113), `types.ts:2268`(`ExtensionError`) | MIT | 오류 기록 필드(확장 경로, 이벤트, 메시지, 스택)를 `HandlerOutcomeRecord` 설계 참고로만 쓴다 |
  | Claude Code 훅·mods | 공개 문서만(`_research/refs/claude-code.md` hooks·mods 항목) | 코드 비공개, "All rights reserved"(`_research/refs/claude-code.md` 27행) | 문서화된 프로토콜(stdin JSON, 종료 코드 0·2, 출력 10,000자, tier 순서)만 따른다. 공개 저장소의 `mods/` 소스와 타입 선언은 읽지 않고 가져오지 않는다 |
  | Hermes 관찰 훅 | `_research/refs/hermes.md` 46·304행 | MIT | 스키마 버전 필드 관례와 `pre_tool_call` 시간 초과 차단 규칙만 참고 |

- 내려받은 외부 코드는 실행하지 않는다. 테스트의 훅 스크립트는 `test/operations/fixtures/hooks/`에 우리가 쓴 짧은 셸 스크립트만 쓴다.

## 5. 단위 테스트 목록

| # | 테스트 이름 | 확인할 동작 | 스펙 |
|---|---|---|---|
| 1 | `tier: guard handler always runs first` | 사용자 확장을 먼저 싣고 먼저 등록해도 정렬 결과의 첫 항목은 `guard` 핸들러 | §9-1 |
| 2 | `tier: first fold stops at outer guard deny` | 가드가 거부하면 `user`·`builtin` 핸들러 호출 수 0 | §9-2 |
| 3 | `tier: lexicographic order within tier` | 같은 tier에서 loadIndex, 같은 확장에서 registrationIndex 오름차순 | §9-3 |
| 4 | `tier: assignTier table` | 스펙 §4.1.2 표의 모든 행(허용 목록 밖 guard 거부, `source_trust_mismatch`, `untrusted`) | §9-4 |
| 5 | `budget: first timeout boundary 29999/30000` | 가짜 시계 29,999ms 완료는 값 사용, 30,000ms 미완료는 `FIRST_DENY`와 `TimeoutError` abort | §9-5 |
| 6 | `budget: chain timeout skips only that patch` | 다음 핸들러가 이전 `current`를 받음 | §9-6 |
| 7 | `budget: pause/resume excludes user wait` | 20s 실행 + 60s 대기 + 20s 실행은 통과, 대기 없는 40s는 초과 | §9-7 |
| 8 | `budget: nested pause counts depth` | pause 두 번, resume 한 번이면 여전히 멈춤. 두 번째 resume에서 다시 잼 | §4.2.3 |
| 9 | `budget: late result is discarded` | 초과 뒤 반환값·예외가 결과와 장부에 영향 없음, 타이머가 남지 않음(`ManualClock` 대기 타이머 0) | §9-8 |
| 10 | `budget: shutdown and stream classes` | `session.shutdown` 2,000ms, `boundary.message.update` 1,000ms, detached tap도 예산 적용 | §9-9, §4.2.2 |
| 11 | `budget: drive has no time budget` | `budgetMs: null`이면 600,000ms 진행에도 abort 없음 | §9-10 |
| 12 | `budget: outer abort is aborted not failure` | outer abort → `aborted`, 장부 연속 수 변화 없음 | §9-14 |
| 13 | `failure: classification table` | threw, timeout, result_invalid, aborted, ok 분류와 연속 수·창 갱신 | §4.3.1~§4.3.2 |
| 14 | `autoDisable: five consecutive failures request disable once` | 5번째 실패에서 `requestDisable(…, "auto_disable")` 1회, 6번째에서 추가 요청 없음 | §9-11 |
| 15 | `autoDisable: failure rate rule` | 창 50 중 실패 10·실패율 0.5 이상에서 판정, 9회면 판정 안 함 | §4.3.3 |
| 16 | `autoDisable: guard and core are exempt` | 면제 tier는 기준을 넘어도 요청 없음, 알림은 나감 | §9-12 |
| 17 | `autoDisable: reenable resets ledger` | 장부 0, `requestEnable(…, "request")` | §9-13 |
| 18 | `autoDisable: applied at step boundary` | primitives 가짜와 함께, 요청 후 진행 중 디스패치는 완료되고 경계에서 `scope.changed{disabled}` | §9-11 |
| 19 | `storage: table names start with prefix` | 생성 DDL의 모든 테이블·인덱스 이름이 접두로 시작, 식별자 인용 | §9-15 |
| 20 | `storage: bypass identifier corpus is rejected` | `fixtures/bypass-identifiers.ts`의 모든 문자열이 `identifier_invalid`, DB 테이블 수 불변 | §9-16 |
| 21 | `storage: checkStatement rejects foreign tables and keywords` | `events`, `main.events`, `sqlite_master`, `ATTACH`, `PRAGMA`, 세미콜론 두 문장 거부 | §4.4.6 |
| 22 | `storage: hyphen names do not collide` | `a`/`bc`와 `a-b`/`c`가 다른 테이블, `parseExtTableName` 역변환 | §9-18 |
| 23 | `storage contract: rollback discards extension writes` | X 자체 저장 대역에서 `after_ext_projection:0` 장애 주입 뒤 확장 테이블 행 해시 불변. bun:sqlite 실행은 L0.store.plan ST-23 | §9-17 |
| 24 | `storage contract: projection writes commit with core` | 커밋 성공 시 같은 커밋의 이벤트와 확장 행이 함께 보임, 투영 버전 증가 시 재생으로 다시 만들어짐 | §4.4.4 |
| 25 | `storage: kinds must be owned` | 다른 확장 kind를 `kinds`에 넣으면 `kind_not_owned` | §4.4.4 |
| 26 | `storage: drop only registry-owned tables` | `confirmed:false`는 목록만, `true`는 소유 장부 테이블만 DROP, 이벤트 행 수 불변 | §9-18, §9-19 |
| 27 | `naming: conflicts expose qualified names regardless of order` | 같은 짧은 이름 두 확장 → 둘 다 정식 이름, 입력 순열 전부 같은 결과, 내장 예약 이름 | §9-20 |
| 28 | `safeMode: filter keeps guard core and L0-L2 builtins` | 스펙 §4.6.2 표의 각 행, `--disable-ext`는 그 확장만 빼고 설정 불변, 실패 3회 제안 | §9-21~§9-23 |
| 29 | `hooks: exit code table` | 스펙 §4.7.3 표의 모든 칸(0+빈 출력, 0+유효, 0+무효, 2, 1, 137 신호, 시작 실패, 시간 초과, 큰 출력) × tap·first·chain | §9-24~§9-26 |
| 30 | `hooks: output cap truncates at 10000 chars` | stdout 10,001자 → 10,000자로 잘림, `hook_output` 실패. stderr 초과는 실패 아님 | §9-26 |
| 31 | `hooks: stdin carries schemaVersion` | `HookInput`의 `schemaVersion`, `point`, `fold`, `payload`, chain의 `current` | §9-27 |
| 32 | `hooks: env allowlist and secret filter` | 허용 목록 밖·비밀 패턴 변수 제외, 프로젝트 범위 `hookEnvAllow` 무시 | §9-28 |
| 33 | `hooks: project hook requires trust` | 신뢰 전 실행 0회, 신뢰 뒤 실행 | §9-29 |
| 34 | `settings: x.operations keys pass catalog` | `buildCatalog` 통과, 기본값이 상수와 같음 | §9-30 |
| 35 | `docs: constants match spec tables` | 스펙 §4.2.2·§6 표의 기본값, §3.1 `TIERS`를 문서에서 읽어 코드 상수와 대조 | 완료 기준 4 |

- 1~18, 34는 M0·M1, 19~26은 M1(26은 M2), 27~33은 M2다.
- 시계는 모두 `ManualClock`이다. 실제 시간을 기다리는 테스트는 두지 않는다. 훅 실행 테스트(29~33)는 `HookProcessPort` 가짜로 표를 돌리고, 실제 프로세스 실행은 `hooks/run.test.ts`의 픽스처 스크립트 몇 개로만 확인한다.

## 6. 완료 기준

1. 위 테스트가 패키지 단위 `bun test`에서 통과하고 `just verify`가 종료 코드 0이다.
2. 저장 영역 계약 시나리오(`ext-storage.contract.ts`)가 X `test/`의 자체 저장 대역(F 인터페이스)에서 통과한다. X 테스트에는 L0 import가 0건이다. 실제 bun:sqlite 저장소에서의 통과는 L0.store.plan ST-23(L0.store.spec §9 18번)이 확인한다. 장애 주입 지점 이름은 L0.store와 같은 문자열(`after_ext_projection:<n>` 등)을 쓴다.
3. `settings-keys.ts`의 키가 F.wire-settings 카탈로그 검사(`buildCatalog`, `checkSettingDef` D1~D9)를 통과한다.
4. 문서-코드 상수가 일치한다. 대상은 기본 예산(`DEFAULT_BUDGETS_MS`), 자동 끄기 기본값(`DEFAULT_AUTO_DISABLE`), tier 이름과 순서(`TIERS`), 훅 상수(`HOOK_SCHEMA_VERSION`, `HOOK_OUTPUT_MAX_CHARS`, `HOOK_EXIT_DENY`, M2)다. `doc-constants.test.ts`가 확인한다.
5. M0 끝: primitives 디스패처가 `createOperationsPolicy`를 받아 실행 순서와 예산을 적용한다. operations 쪽 기본 구현 없이 primitives만으로 디스패치하는 경로가 남지 않는다.
6. M1 끝: M1 스모크의 테스트 그룹이 `ExtStorage`로 테이블 하나를 쓰고, 강제 종료·재개 뒤 행이 이벤트와 일치한다.
7. `src/operations/`와 `test/operations/`에서 `cordis`, `@cordisjs/*`, `@xeon/platform-*`, `@xeon/core-*` import가 0개다(architecture.layers.spec §4.3.3 결론 1번, 테스트 포함).

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 비협조적 핸들러는 예산이 멈추지 못한다 | signal을 무시하는 핸들러의 타이머·네트워크 작업이 프로세스에 남는다 | 예산은 디스패치 진행만 보장한다고 스펙 §5 1번에 적었다. 자동 끄기로 다음 경계부터 호출을 멈춘다. 강제 종료가 필요하면 격리 경로(`X.loading-trust.spec`, 2차)로 옮긴다. adr.0007 §6 미결과 같은 항목이다 |
| 접두 차단 우회 | 확장이 세션 테이블을 읽거나 고친다 | 원시 SQL을 열지 않는다(쿼리 래퍼). 식별자는 정규식 + 인용, 값은 바인딩. 테스트·디버그 빌드의 `checkStatement`와 L0 `ProjectionTx` 검사를 겹친다. 우회 시도 문자열 모음을 회귀 테스트로 키운다. 같은 프로세스 코드의 메모리 접근은 막지 못한다는 한계를 스펙에 적었다 |
| 자동 끄기 오탐으로 필수 확장이 꺼진다 | 보안 가드나 코어 기본 동작이 빠진다 | `guard`, `core` tier를 면제한다(`AUTO_DISABLE_EXEMPT_TIERS`). 기준값은 실측 전 값이므로 설정 키로 조정하고 M1 스모크 뒤 다시 정한다(스펙 §10 미결 14). 끄기는 프로세스 단위라 재시작으로 되돌아온다 |
| 외부 훅 프로세스의 비밀 노출 | 환경 변수의 API 키가 훅 스크립트와 그 로그로 나간다 | 환경을 비우고 허용 목록만 넣는다. 비밀 이름 패턴은 허용 목록에 있어도 뺀다. 프로젝트 범위는 허용 목록을 바꾸지 못한다. 비밀 참조는 풀지 않는다 |
| F 매니페스트 필드(`storage`, `hooks`)와 F.records 필드(`reason`, `scope.handler_failed`) 추가가 늦어진다 | 설치 전 검토와 사유 기록이 빠진다 | 테이블 선언은 코드(`defineTables`)가 정본이고 매니페스트는 검토용이라 M1은 필드 없이 동작한다. 필드가 늦어지면 확장 루트의 임시 구성 파일 `.xeon-plugin/operations.json`을 X가 읽는다. 사유는 운영 로그로 남긴다(O-09, O-11) |
| primitives의 `DispatchPolicy`(X.primitives.spec §3.4) 모양이 구현 중에 바뀐다 | O-03, O-06 연결을 다시 쓴다 | `createOperationsPolicy` 내부를 `orderKey`, `run`, `report` 세 함수로 나눠 두어 모양이 바뀌어도 어댑터만 고친다. P-06·P-20과 같은 M0에서 함께 확인한다 |
| 투영 `apply` 예외가 세션 커밋을 계속 막는다 | 확장 하나의 결함으로 세션이 진행되지 않는다 | 스펙 §5 6번의 복구 경로(투영기 해제와 확장 끄기 뒤 재시도)를 L1.persistence.plan과 정한다(스펙 §10 미결 6). 그 전에는 M1 테스트 그룹 투영을 단순한 삽입 하나로 제한한다 |
| 확장 이름 규칙(`^[a-z][a-z0-9-]{1,31}$`, 접두 `x_`, [결정: review.decisions-2 U-18])이 번복된다 | 테이블 이름 규칙과 역변환이 달라진다 | 이름 변환을 `extTablePrefix`·`parseExtTableName` 두 함수에 모은다. 규칙이 바뀌면 두 함수와 `doc-constants.test.ts`만 고친다 |

## 8. M2 구현 현황 (X 레인)

| 작업 | 상태 | 비고 |
|---|---|---|
| O-07 | 완료 | 핸들러용 UI 포트는 F 타입에 넣지 않고 `hostOf(g).awaitUser(wait, { signal? })`로 연결했다. 핸들러의 `gate`·신호를 `withAmbient`로 싣고 `awaitUser`가 예산 시계를 멈춘다. `user-wait.test.ts` |
| O-18 | 완료 | `naming.ts`: `qualifiedName`, `resolveNames`(순서 무관, 예약, 충돌, 64자), `createResourcePolicy`(집합 판정 `exposeAll`과 쌍 판정 `resolve`), `NO_RESERVED_NAMES`. `naming.test.ts` |
| O-19 | 부분 | `ExtHostDeps.resourcePolicy` 연결(`OperationsPolicy.resources`)과 집합 판정 메서드(`ResourcePolicy.exposeAll`) 합의는 끝났습니다. 어댑터 등록 매핑 확인은 삭제했습니다(adr.0017 §3.7, D-M3-11 c). 조립 루트(apps/host)가 `resourcePolicy: policy.resources`를 넘기는 일은 HOST 트랙 몫입니다 |
| 저장 영역 N-08 | 완료 | `ExtTableReader`·`ExtTableWriter`·`ExtProjection.apply`가 `Result<_, ExtRowError>`를 돌려준다(spec §3.4, §4.4.4) |

## 9. M3b 구현 현황 (X 레인)

| 작업 | 상태 | 비고 |
|---|---|---|
| O-09 | 완료(ext-host) | `createVolatileNotifier`(`auto-disable.ts`)를 만들고 루트에서 재export한다. 실패마다 `scope.handler_failed`를 발신하고 같은 운영 로그를 남긴다. 발신이 던지면 운영 로그에 남기고 호출자에게 던지지 않는다(M3-REQ-35). 시험은 `auto-disable.test.ts`다. 조립 기본 알림기 교체와 host 연결은 B1-NTF H1에서 끝났다(`apps/host/src/assembly/handler-failed.ts`, `L4.host-service` HS-92, 시험 `apps/host/test/assembly/handler-failed.test.ts`와 `test/int/handler-failed.int.test.ts`) |
