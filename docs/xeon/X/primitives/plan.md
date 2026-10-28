---
id: X.primitives.plan
layer: X
domain: primitives
kind: plan
status: draft
depends_on: [X.primitives.spec, F.extensions.plan, F.extensions.spec, adr.0002, adr.0007, eng.testing.guide, eng.dependency-rules.guide, architecture.layers.spec]
binds: [xeon/packages/ext-host/src/primitives/**]
---

# X 확장 원시 연산 구현 계획

대상 스펙: X.primitives.spec. 패키지: `@xeon/ext-host`(`xeon/packages/ext-host`). 코드: `src/primitives/**`. 테스트: `test/primitives/**`(eng.testing.guide TS-06).

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 확인 방법 | 소비자 |
|---|---|---|---|
| M0 | Cordis 래퍼(`cordis-bridge.ts`: 루트, scope fiber, effect, dispose, 포트 inject), 레지스트리와 스냅샷, 세대 가드, fold 디스패처 tap·first·chain(시간 예산 포함, `DEFAULT_DISPATCH_POLICY`, `DispatchPolicy`의 선택 메서드 `run`·`onHandlerSettled`), X.operations 정책 결합(P-20), 인메모리 포트로 동작하는 post(멱등), drive 단일 그룹(임대 부여·상한·재호출·반납), scope enable/disable 최소형(경계 훅 `prepare`/`settle`, 유휴 적용), 상태 문서 `state()`/`commit()`(마이그레이션 제외), `createExtHost`·`install`(시작 적용, `InstallResult`)·`registerPlatform`·`ExtHost.ports`·`hostOf`(provide·port만), `@xeon/ext-host/testing`의 인메모리 포트·가짜 타이머 | §5 단위 테스트 중 M0 표시 항목 | L1 core-loop·core-tools 구현자(지점 발화), X.loading-trust(L-06), X.operations(O-03, O-06), M1 스모크 |
| M1 | 걷는 골격: 테스트용 그룹이 `on`(`tool.call.before`, `boundary.step.after`), `post`, `drive`를 쓰고, drive 그룹의 켜기·끄기가 단계 경계에서 적용됨을 모델 테이프 스모크로 확인한다(`_research/foundation-plan.md` §5 P4, §6 M1 스모크). 실제 L1 포트(`xeon.loop`, `xeon.tasks`, `xeon.session`)와 연결, 포트 계약 스위트, `record`/`readRecords`, 능력 바인딩(공급자 하나), 설정 `x.primitives.driveLimits`, 재개(`openThread`의 열린 임대·상태 판 복원), 투영기 등록·접두 테이블·프로세스 포트 키(P-30) | M1 스모크(`apps/cli/test/chat.scenario.test.ts`, 저장소 1개), 포트 계약 스위트를 L1 구현이 통과 | L3 테스트 그룹, X.operations(O-14) |
| M2 이후 | 임대 중재 설정(`x.primitives.activeDriveGroup`, `LeaseArbiterPort`, `revoked`), 상태 마이그레이션 훅, 리소스 등록 전체(도구·명령·키 조합·플래그·provider·MCP·렌더러, `ResourceRegistry`, `ResourcePolicy`), 진짜 detached tap, 그룹 간 이벤트 격리(호스트 안쪽 휘발 버스), 공급자 여럿의 선택 설정(`x.primitives.capabilityProviders`), thread별 scope 켜짐 상태(서비스 모드) | §5의 M2 표시 항목 | L3 Helm·학습 그룹, X.loading-trust(외부 확장 로더), L4 설정 화면 |

- M0에서 `dispatch: "detached"` 지점(5개)은 await 방식으로 실행했다 [제안]. 결과와 실패 규칙은 같고 지연만 다르다. 진짜 detached 실행은 M2(P-25)에서 구현했다.
- M0의 경계 기여는 L1 경계 커밋에 넣지 않고 `RecordCommitPort.commit`으로 따로 커밋한다(spec §3.5 끝 항목). M1에서 L1이 `BoundaryContribution.drafts`를 C5 커밋에 넣는다.

## 2. 패키지와 파일 배치

```
xeon/packages/ext-host/
  package.json             # dependencies: @xeon/contracts(workspace:*), @xeon/vendor-cordis(workspace:*), typebox(catalog:)
                           # exports: ".": "./src/index.ts", "./testing": "./src/testing/index.ts"
  src/
    index.ts               # 공개 이름만 명시 재export(아래 규칙). 다른 작업자가 작성 중 → 이 목록으로 맞춘다
    testing/index.ts       # primitives/testing/* 재export (eng.testing.guide TS-06 위치)
    primitives/
      index.ts             # 이 도메인의 모든 export(패키지 내부용 포함)
      errors.ts            # PrimitiveError, PrimitiveErrorCode
      ports.ts             # F ports.ts 포트·키·부속 타입의 재export(정의 없음)와 ExtHostPortKey
      services.ts          # capabilityServiceName, providerServiceName, isReservedServiceName, 능력 바인딩
      cordis-bridge.ts     # Cordis import는 이 파일 하나. 루트 Context, scope fiber, effect, provide/inject, 포트 주입 플러그인
      ambient.ts           # AsyncLocalStorage 기반 thread·디스패치 맥락
      registry.ts          # HandlerRegistry, 항목, 등록 순번, 스냅샷, 세대 필터
      dispatch.ts          # dispatch 진입, runOne, 시간 예산, 정렬, DispatchPolicy, DEFAULT_DISPATCH_POLICY, 결과 타입
      fold/
        tap.ts
        first.ts
        chain.ts
      boundary.ts          # BoundaryHooks, BoundarySignal, BoundaryContribution, 유휴 적용
      scope.ts             # ScopeRuntime: 정의, 상태기계, 세대, 적용 순서, ScopeInfo
      state.ts             # 상태 캐시, commit, 마이그레이션, record, readRecords
      post.ts              # PostQueue
      lease.ts             # LeaseBroker: 중재, 차수, 상한 클램프, 반납, LoopHandle, 호출 루프
      resources.ts         # ResourceRegistry, ResourcePolicy, X 보관 *ResourceDef, F ToolsPort·ModelsPort·McpPort와 리소스 정의 재export
      host-api.ts          # hostOf, ScopeHostApi
      host.ts              # createExtHost, ExtHost, ExtHostDeps, ExtensionUnit, InstallResult
      settings.ts          # primitivesSettings = defineSettings("x.primitives", …)
      testing/
        ports.ts           # memoryLoopPort, memoryInputQueue, memoryRecordStore
        timers.ts          # fakeTimers (setTimer·now 쌍)
        host.ts            # createTestHost(옵션) → { host, ports, timers, boundary(threadId) 도우미 }
        port-contract.ts   # runPortContract(factory): L1 포트 구현이 통과해야 할 시나리오
        smoke-group.ts     # M1 스모크 테스트 그룹(on tool_call·turn_end, post, drive)
  test/primitives/
    registry.test.ts  dispatch-tap.test.ts  dispatch-first.test.ts  dispatch-chain.test.ts
    post.test.ts  lease.test.ts  drive.test.ts  scope.test.ts  state.test.ts  services.test.ts
    resources.test.ts  host.test.ts
    cordis.contract.test.ts       # vendored Cordis 동작 고정(eng.testing.guide TS-01 contract 태그)
    ambient.contract.test.ts      # Bun AsyncLocalStorage 동작 고정
    fixtures/
```

- `src/testing/`과 `src/index.ts`는 이 문서의 binds(`src/primitives/**`) 밖이다. 두 파일은 재export 한 줄씩만 두고 내용은 `src/primitives/` 안에 둔다. 위치는 eng.testing.guide §1.2의 `@xeon/ext-host/testing` 행을 따른다.
- 공개 export 규칙 [제안]:
  - `src/index.ts`는 X.primitives.spec §3.1 표의 이름만 이름을 적어 재export한다. `export *`를 쓰지 않는다. 내부 이름(`ScopeRuntime`, `PostQueue`, `LeaseBroker`, `HandlerRegistry`, `CordisBridge`)은 루트로 나가지 않는다.
  - loading-trust와 operations 도메인 코드는 같은 패키지 안이므로 `../primitives/index.ts`에서 내부 이름을 import한다.
  - F 타입은 재export하지 않는다. 소비자는 `@xeon/contracts/extensions`에서 직접 가져온다(F 타입 재정의·이중 경로 방지).
- Cordis import 범위(eng.dependency-rules.guide DR-11) [제안]: `@xeon/vendor-cordis`는 `src/primitives/cordis-bridge.ts`만 import한다. loading-trust·operations가 Cordis 기능이 필요하면 `cordis-bridge.ts`의 함수를 쓴다. oxlint `no-restricted-imports` 예외를 이 파일 하나로 좁히는 설정을 eng.toolchain.guide 담당과 조율한다. 조율 전에는 패키지 단위 예외(DR-11 원문)로 둔다.
- `package.json`의 `xeon` 필드는 현재 `{ "layer": "X", "domain": "ext-host" }`다. routes.yaml 도메인(primitives 등)과의 불일치는 architecture.layers.spec §10 미결이다. 이 계획은 값을 바꾸지 않는다.

## 3. 작업 분해

선행 작업 중 F.extensions.plan의 E1~E9(M0)는 `@xeon/contracts/extensions`의 타입, `POINTS`, `FIRST_DENY`, `CHAIN_RULES`, `validateManifest`·`validateUsage`·`validateManifestSet`·`validateGroupRecord`를 낸다. 이 계획은 그 산출을 import만 한다.

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| P-01 | 패키지 준비: 의존 선언(`@xeon/contracts`, `@xeon/vendor-cordis`, `typebox`), `tsconfig.json` references, `exports`에 `./testing`, `src/primitives/index.ts`·`src/testing/index.ts` 골격 | F.extensions.plan E5·E6 | S | M0 |
| P-02 | `errors.ts`, `ports.ts`(F 포트·키 재export와 `ExtHostPortKey`), `services.ts`의 이름 함수 3개 | P-01, F.extensions.plan E10(`ports.ts`) | S | M0 |
| P-03 | `testing/ports.ts`, `testing/timers.ts`: 인메모리 `LoopPort`(turn 결과 표, `(scopeId, requestId)` 멱등, `whenIdle` 잠금), `InputQueuePort`(멱등 표), `RecordCommitPort`(이벤트 배열, `expectStateRev`, `loadThread`), 가짜 타이머 | P-02 | M | M0 |
| P-04 | `registry.ts`: 항목, 등록 순번, `add`·`remove`(멱등), `snapshot(point, threadId)`, 세대 필터, 정렬 캐시(레지스트리 버전) | P-01, F E4(`PointName`) | M | M0 |
| P-05 | `ambient.ts`: `withAmbient`, `ambient()`, 맥락 없음 판정. `ambient.contract.test.ts`로 Bun 1.4의 await 경계 유지 확인 | P-01 | S | M0 |
| P-06 | `dispatch.ts`, `fold/tap.ts`·`first.ts`·`chain.ts`: `runOne`(동기 예외·거부 통일, 시간 예산, `AbortController` 연결, `policy.run`이 있으면 위임, `aborted`는 보고 없이 fold 실패 처리, 성공 시 `onHandlerSettled`), `HandlerGate`·`HandlerRunOutcome`, 정렬 `(tier, loadIndex, seq)`, first의 결정 스키마 검사와 `FIRST_DENY` 대체, chain의 merge 거부 skip·`stop`·`finalize`(누락은 `Bug`), `strict` 모드 페이로드 검사·동결, `DEFAULT_DISPATCH_POLICY` | P-04, P-05, F E4(`POINTS`, `FIRST_DENY`, `CHAIN_RULES`) | L | M0 |
| P-07 | `cordis-bridge.ts`: 루트 `Context` 생성, scope 세대마다 `ctx.plugin`으로 fiber 생성, `effect` 래퍼(해제기 멱등), `onDispose` 묶음 effect(역순 순차), `provide` disposer 타입 교정과 await, 포트별 inject 플러그인(ACTIVE에서 참조 설정, 해제에서 비움), 루트 dispose. `cordis.contract.test.ts` | P-02 | M | M0 |
| P-08 | `post.ts`: `PostQueue.post(scope, item, options)`, `usesPost` 검사(`validateUsage`), `requestId` 길이 검사, `InputQueuePort.enqueue` 위임, `PostReceipt` | P-03, P-05, F E9 | S | M0 |
| P-09 | `scope.ts`, `boundary.ts`: `ScopeFn` 구현(정의, id 검사), 상태기계 4상태(마지막 요청 우선), 켜기 적용(fiber 생성 → setup → `validateUsage` → `scope.changed` 초안 → `settle`에서 세대 열기), 끄기 적용(세대 닫기 → 임대 반납 초안 → `scope.changed` 초안 → `settle`에서 abort와 `fiber.dispose()`), `settle(failed)` 되돌리기, 유휴 적용(`LoopPort.whenIdle`), 세대 가드, `ScopeInfo` | P-04, P-07 | L | M0 |
| P-10 | `lease.ts` 중재부 `LeaseBroker`: drive 등록 검사(`drive_requires_group`, `drive_undeclared`, `drive_duplicate`, `drive_outside_setup`), 후보 계산, 단일 후보 부여, `leaseEpoch`, `leaseId` 발급, 상한 클램프(설정 × `DriveOptions`), `lease.acquired`·`lease.released` 초안, 반납 사유 6종, `releasing` 상태 | P-09 | M | M0 |
| P-11 | `lease.ts` 구동부: `LoopHandle`(`turn`, `spawn`, `budget` getter, `signal`), 기본 requestId `${leaseId}:${baseRev}.${i}`, 사용량 집계(재생 제외), 호출 예약(`turn_settled`·`idle`), 같은 판 연속 무효과 반납, 예외 반납과 오류 표시, 동시 호출 금지 | P-10, P-12(상태 판) | L | M0 |
| P-12 | `state.ts`: 상태 캐시(`openThread`에서 적재), `state()`, `commit()`(스키마, 크기, 멱등 키, `expectStateRev`), 상태 이벤트 kind `<x\|grp>.<name>.state.committed` 초안 | P-05, P-07, P-03 | M | M0 |
| P-13 | `host.ts`, `host-api.ts`: `createExtHost`, `install`(엔트리 실행과 `entryError`, scope 정의 수집, 시작 적용 spec §4.5.6과 `ScopeSetupOutcome`, `setupBudgetMs`), `uninstall`, `dispatch`·`boundary`·`openThread`·`closeThread`·`dispose` 연결, `hostOf`(M0는 `provide`, `providePort`, `port`), `xeon.ext` 서비스 등록, `src/index.ts` 공개 목록(spec §3.1 표 전체. loading-trust·operations 행은 그 도메인 작업이 끝날 때 더한다) | P-06, P-08, P-09, P-11, P-12 | M | M0 |
| P-14 | `testing/host.ts`: `createTestHost`와 경계 도우미(`stepEnd`, `turnSettled`, `idle`) | P-13 | S | M0 |
| P-15 | `state.ts` 확장: `record`(`validateGroupRecord`), `readRecords`(읽기 선언 검사, `queryRecords`의 셋째 인자 `reader`에 호출한 확장 이름을 넘겨 다른 확장의 비공개 행 제외, `record_version_unknown` 진단), `recordPrivate`(자기 접두·`state` 영역·공개 kind 중복 검사, `visibility: "private"` 커밋, `record`와 같은 멱등 키, spec §4.6.5, [결정: review.decisions-2 T-21]). `testing/ports.ts`의 `RecordCommitPort` 가짜에 `visibility`와 `reader` 필터를 더한다(F.records.spec §3.9 비공개 기록 규칙 3) | P-12, F E6(`ScopeApi.recordPrivate`), F E9 | S | M1 |
| P-16 | 재개: `openThread`가 `ExtThreadSnapshot`으로 켜짐 상태·상태 판·열린 임대·차수를 복원하고 첫 경계에서 drive 재호출 또는 `restart` 반납 | P-11, P-12 | M | M1 |
| P-17 | `services.ts` 능력 바인딩(공급자 하나): `hostOf(g).provide` → `providerServiceName` provide, 바인딩 플러그인이 `capabilityServiceName`으로 다시 provide, scope fiber의 `inject`를 `requires`에서 계산, `capability(key)` 구현(`optional`은 루트 조회) | P-07, P-13 | M | M1 |
| P-18 | `settings.ts`: `primitivesSettings`(`driveDefaultLimits`, `driveLimits`, `activeDriveGroup`, `capabilityProviders`) 선언과 `PrimitivesSettingsSource` 기본 구현(`driveDefaultLimits` 기본 4/8/400000, 천장 없음, review.decisions-2 U-12) | P-13, F.wire-settings.plan(`defineSettings`) | S | M1 |
| P-19 | `testing/port-contract.ts`: `runPortContract`(runTurn 멱등, `leaseEpoch` 펜싱, `whenIdle` 중 turn 시작 차단, enqueue 멱등, `expectStateRev` 충돌). L1 core-loop·core-tasks·core-persistence가 자기 테스트에서 돌린다 | P-03, P-13 | M | M1 |
| P-20 | `DispatchPolicy` 결합: X.operations 구현을 `ExtHostDeps.policy`로 받는 통합 테스트(tier 정렬, `run` 위임 예산, 실패·성공 보고) | P-06, O-03, O-06 | S | M0 |
| P-21 | `testing/smoke-group.ts`: M1 스모크 그룹(매니페스트는 F.extensions.plan `fixtures/smoke-group.manifest.json`과 같은 내용). `tool.call.before`에서 특정 도구 거부, `boundary.step.after`에서 엔트리 추가, `post(followUp)`, drive로 `loop.turn` 1회 후 commit | P-13, P-15 | S | M1 |
| P-22 | 임대 중재 설정: `activeDriveGroup`, `LeaseArbiterPort` 주입, `drive_conflict` 경고, `revoked` 반납, `idle` 반납 뒤 재후보 조건 | P-10, P-18 | M | M2 |
| P-23 | 상태 마이그레이션: `hostOf(g).migrateState`, 버전 비교, 마이그레이션 판 커밋, `future_version` 거부 | P-12 | S | M2 |
| P-24 | `resources.ts` 전체: `ResourceRegistry`, `ResourcePolicy` 결합, 도구·provider·MCP 포트 위임, 명령·키 조합·플래그·렌더러 X 보관, effect 자동 해제, 구독 알림 | P-07, P-13, L1.tools.spec·L1.models.spec·L2.mcp.spec 포트 합의 | L | M2 |
| P-25 | 진짜 detached tap: 대기 없는 실행, 늦은 실패 보고, 세션 종료 뒤 결과 폐기 | P-06 | S | M2 |
| P-26 | 그룹 간 이벤트 격리: 확장에 Cordis 이벤트 미노출 검사. pi `events` 어댑터용 휘발 버스는 ADR-0017 §3.7로 지웠다(M3a) | P-13 | M | M2 |
| P-27 | 공급자 여럿의 선택(`capabilityProviders`), major 불일치 공급자 제외, `capability_ambiguous` 진단 | P-17, P-18 | S | M2 |
| P-28 | thread별 scope 켜짐 상태와 fiber 수명(한 thread 이상 켜짐 동안 유지) | P-09, P-16 | M | M2 |
| P-29 | `ExtHost.registerPlatform`(`PlatformModule`, `PlatformContext`, L0 fiber, dispose 역순)과 `ExtHost.ports`(`PortLookup`) | P-07, P-13 | S | M0 |
| P-30 | 포트 키 재export 추가: `ProjectorRegistryPortKey`(`xeon.session`의 `projectors`), `ScopedStorePortKey`(`xeon.store`), `ProcessPortKey`(`xeon.process`)와 `testing/ports.ts`의 가짜 구현(`register`는 `Result<{ dispose }, ProjectorRegisterError>`, `scoped(owner)`). O-14(저장 영역), O-23(외부 훅), L-22(격리)의 선행 | P-02, P-29 | S | M1 |
| P-32 | 능력 래퍼 문맥 검사(`capability-guard.ts`, `ExtHostDeps.capabilityDefs`), drive 멱등 쓰기 기본 키 [제안] (M3-REQ-22) | P-13 | M | M3a |
| P-33 | 효과 워커(`effect-worker.ts`, `requestEffect`, `EffectWorkerPort`) (M3-REQ-27) | P-32 | M | M3a |
| P-34 | 상태 커밋 줄, `updateState`, `commitWith` (M3-REQ-23·24) | P-13 | M | M3a |
| P-35 | 임대 대기 상한과 `lease.rejected`, `leaseEpoch` 기록 (M3-REQ-25·28) | P-10 | M | M3a |
| P-36 | 수명주기 지점 디스패치(`lifecycle.ts`, `xeon.session` 피드, 소유 scope 거르기), 이벤트 버스 제거 (M3-REQ-26·102·108) | P-06 | M | M3a |
| P-37 | 도구 `execute`·명령 처리기의 ambient(디스패치 키는 도구 호출 id·명령 호출 id), 능력 래퍼의 재실행 검사 제외 (M3-REQ-102) | P-13, P-24 | S | M3a |
| P-31 | 포트 재export 확인: `primitives/ports.ts`·`resources.ts`, loading-trust의 로더 포트, operations의 훅 포트에 자기 정의가 없고 모두 F `ports.ts` 이름을 다시 export하는지(spec §3.6, §3.9, [결정: review.decisions-2 U-14, D-04]), `src/index.ts` 공개 이름이 spec §3.1 표와 같은지 타입 테스트로 확인 | P-02, P-30, F.extensions.plan E10 | S | M1 |

순서 요약: P-01 → P-02 → (P-03, P-04, P-05, P-07 병렬) → P-06 → P-08 → P-09 → P-12 → P-10 → P-11 → P-13 → P-29 → P-14 → P-20 (M0 끝) → P-15~P-19, P-21, P-30 (M1) → P-22~P-28 (M2 이후).

## 4. 채택 코드

| 대상 | 버전 | 쓰는 방식 |
|---|---|---|
| Cordis core (`xeon/vendor/cordis`, 패키지 이름 `@xeon/vendor-cordis`) | upstream `cordiverse/cordis` 커밋 `df4431eb43086bd1f8263a0e8c03e9b7c5233b68`, `UPSTREAM.json` 표기 "4.0.0-rc.11" | 그대로. 수정 금지(`UPSTREAM.json` `modifications: none`). `Context`, `ctx.plugin`, `fiber.effect`, `fiber.dispose`, `ctx.provide`, `inject`만 쓴다. `emit`·`parallel`·`serial`·`bail`·`waterfall`과 `Config` 스키마는 쓰지 않는다 |
| `cosmokit`, `@standard-schema/spec` | 1.8.1, 1.1.0 (`xeon/package.json` catalog) | Cordis 런타임 의존. ext-host가 직접 import하지 않는다 |
| `typebox` | 1.3.27 (`xeon/package.json` catalog `"typebox": "1.3.27"`) | 그대로. `Value.Check`로 결정·패치·상태·페이로드 검사 |
| `@xeon/contracts` | 워크스페이스 | `extensions`, `capabilities`, `records`, `conversation`, `settings` 서브패스에서 타입과 상수 import |
| Bun | 1.4.3 (`packageManager: bun@1.4.3`) | `bun:test`, `node:async_hooks`의 `AsyncLocalStorage` |
| pi coding-agent 확장 러너 | 소스 1.1.0 `~/projects/_ref/pi-src/packages/coding-agent/src/core/extensions/runner.ts` | 읽기 자료. 복사하지 않는다. 참고 위치: 스냅샷 `snapshotEventHandlers` 269-271, 일반 `emit` 1089-1119, `emitToolCall` 1242-1260, `emitBoundary` 1029-1087 |
| pi coding-agent 확장 타입 | 같은 소스 `types.ts` 1564-1890 | 읽기 자료. 리소스 등록 표(spec §4.8)의 대응 근거 |
| pi durable 훅 표 | `~/projects/_ref/pi-src/packages/durable/docs/spec.md` 2636-2660 | 읽기 자료. 재실행 가능한 질의 계약 |

- 포크 코드는 없다.
- [가정] vendored Cordis의 동작 판정은 소스 읽기 결과다(`_research/notes/arch-1.md`, `_research/notes/X-2.md`). P-07의 `cordis.contract.test.ts`가 실행으로 처음 확인한다. 판정과 다르면 이 계획의 해당 작업과 spec §4.3 표를 고친다.

## 5. 단위 테스트 목록

규칙: eng.testing.guide를 따른다. 결정성 D0, 실제 시간 대기 없음(가짜 타이머, TS-03), 저장은 인메모리 포트(X는 L0 `testing`을 쓸 수 없다, eng.testing.guide §1.2), Cordis 동작 고정은 `contract` 태그 파일(TS-01). 포트 가짜는 `@xeon/ext-host/testing`이 제공한다.

| 파일 | 테스트 | 확인할 동작 | M |
|---|---|---|---|
| `dispatch-tap.test.ts` | `tap continues after throw` | 핸들러 A가 던져도 B가 실행되고 `failures`에 `threw` 1건(spec 수용 1) | M0 |
| | `tap ignores returned value` | 값을 돌려준 tap 핸들러는 `value_from_tap` 진단만 남고 다음 핸들러에 영향이 없다 | M0 |
| | `policy run replaces own timer` | `run`을 가진 정책이면 디스패처 타이머가 0개이고 모든 핸들러가 `run`으로 실행된다. `aborted`는 `onHandlerFailure`로 보고되지 않는다(수용 24) | M0 |
| | `settled reported once per success` | 성공 호출마다 `onHandlerSettled` 1회, `result_invalid`·`merge_rejected`로 끝난 호출은 0회 | M0 |
| `dispatch-first.test.ts` | `first throw yields FIRST_DENY` | 예외 시 결정이 `FIRST_DENY.tool_call`, `substituted` 참, 뒤 핸들러 미실행(수용 2) | M0 |
| | `first zero is not a decision` | `0`, `''`, `null`, `false` 반환은 `result_invalid`와 `FIRST_DENY`(수용 3). Cordis `bail` 함정 회귀 | M0 |
| | `first undefined passes through` | 모두 `undefined`면 `decision` undefined, `decidedBy` null | M0 |
| | `first timeout denies` | 예산 50ms, 가짜 타이머 100ms 진행 시 `timeout`과 `FIRST_DENY`(수용 8) | M0 |
| `dispatch-chain.test.ts` | `chain merge rejection skips` | `boundary.message.after` role 불일치 패치는 `merge_rejected`로 skip, 다음 패치는 적용(수용 4) | M0 |
| | `chain stop halts` | `input.user.before`의 `handled` 패치 뒤 핸들러 미실행, `stopped` 참(수용 5) | M0 |
| | `chain payload stays original` | 두 번째 핸들러가 받는 `payload`는 원본과 같은 객체, `current`는 누적값 | M0 |
| | `boundary finalize once` | `boundary.step.after`에서 `finalize`가 모든 핸들러 뒤 정확히 1회, 생략하면 `Bug`(`dispatch.finalize_missing`)(수용 7) | M0 |
| | `chain has no next` | 핸들러가 `next` 인자를 받지 않고, 같은 핸들러를 두 번 등록해도 각자 한 번씩 실행된다. Cordis `waterfall` next 이중 호출 함정 회귀 | M0 |
| `registry.test.ts` | `snapshot ignores mid-dispatch changes` | 디스패치 중 등록·해제가 그 디스패치에 반영되지 않고 다음 디스패치에 반영(수용 6) | M0 |
| | `order is tier load seq` | 정책 tier, `loadIndex`, `seq` 사전식 정렬 | M0 |
| | `unsubscribe idempotent` | `Unsubscribe` 두 번 호출해도 오류 없고 한 번만 제거 | M0 |
| `post.test.ts` | `duplicate requestId` | 같은 `requestId` 두 번째 post가 `duplicate: true`, 큐 항목 1개(수용 9) | M0 |
| | `post requires usesPost` | `usesPost` 없는 매니페스트의 post는 `post_undeclared`(수용 10) | M0 |
| | `post scoped by scope` | 다른 scope의 같은 `requestId`는 중복이 아니다 | M0 |
| `lease.test.ts` | `single lease among two groups` | 두 drive 그룹 + `activeDriveGroup`이 하나를 가리키면 그 함수만 호출, 다른 쪽 0회(수용 11) | M2 |
| | `limits clamp to settings` | `DriveOptions.limits.maxTurns 10`, 설정 5 → `lease.acquired.limits.maxTurns` 5(수용 19) | M0 |
| | `third turn rejected at turns 2` | `maxTurns: 2`에서 세 번째 `loop.turn`이 `lease_budget`, 임대 `releasing`(수용 12) | M0 |
| `drive.test.ts` | `reinvoke replays committed turn` | 같은 상태 판 재호출 시 같은 기본 requestId, `replayed: true`, 새 turn 없음(수용 13) | M0 |
| | `idle twice releases` | 같은 판으로 연속 2회 무효과 반환 → `lease.released { reason: "idle" }`(수용 14) | M0 |
| | `throw releases and keeps handlers` | drive 예외 → `error` 반납, on 핸들러 계속 실행, 토글 전 재호출 없음(수용 15) | M0 |
| `scope.test.ts` | `disable applies at step boundary` | turn 중 `disable()` → `disabling`, 진행 중 `loop.turn` 정착까지 진행, 경계에서 핸들러 제외 → `lease.released` → `onDispose` 순서(수용 16) | M0 |
| | `enable while idle` | 유휴 thread에서 `enable()` → `whenIdle` 안에서 적용, `scope.changed` 커밋(수용 17) | M0 |
| | `dispose releases registrations` | 끄면 on 핸들러, `provide` 서비스, 등록 도구가 모두 해제(수용 18). 도구는 M2에서 추가 | M0/M2 |
| | `stale generation rejected` | 꺼진 scope의 옛 `g`로 `on` → `scope_inactive`(수용 22). Cordis 비활성 fiber에서 `on` 함정 회귀 | M0 |
| | `onDispose runs in reverse order` | 등록 역순으로 차례 실행, 앞 함수 예외 뒤에도 다음 함수 실행 | M0 |
| `state.test.ts` | `commit schema and conflict` | 스키마 위반 `state_schema`, 같은 판 두 번째 커밋 `state_conflict`(수용 20) | M0 |
| | `rerun handler commit is idempotent` | 같은 `dispatchKey`로 핸들러를 두 번 실행하면 두 번째 commit이 `replayed`, 판이 한 번만 오른다 | M0 |
| | `record and read declarations` | 미선언 kind의 `record`는 `record_kind_undeclared`, 미선언 읽기는 `read_kind_undeclared`(수용 21) | M1 |
| | `recordPrivate is hidden from other extensions` | 비공개 기록은 다른 그룹의 `readRecords`에 0건, 같은 그룹에는 보임. 다른 접두·`state` 영역·공개 kind는 `record_private_invalid`(수용 29·30) | M1 |
| `direct-invocation.test.ts` | `a tool execute can recordPrivate, record, commit and read state` | 도구 `execute`에서 세 쓰기가 되고 반환 상태와 저장소 doc이 `{ n: 1 }`(수용 30) | M3a |
| | `a command handler can recordPrivate, record, commit and read state` | 명령 처리기도 같다 | M3a |
| | `rerunning a tool call with the same tool call id does not repeat its effects` | 같은 호출 id는 이벤트 3건 그대로, 다른 id는 6건 | M3a |
| | `rerunning a command with the same invocation id does not repeat its effects` | 명령 호출 id로 같다 | M3a |
| | `a tool call id and a command invocation id with the same text do not share keys` | 접두가 달라 키가 겹치지 않는다 | M3a |
| | `a tool run in a child conversation writes to that conversation only` | 자식 thread에만 기록·상태가 남는다(REQ-LN-04) | M3a |
| | `without an open thread or a thread id the writes still fail with no_thread` | 닫힌 thread의 도구와 `threadId: null` 명령은 `no_thread` | M3a |
| `services.test.ts` | `service names` | `cap:web.search`, `cap:web.search@web-exa`, 두 공급자 provide 시 Cordis 오류 없음(수용 23) | M1 |
| `host.test.ts` | `install maps setup outcomes` | setup의 선언 밖 `on`은 `failed`(`point_undeclared`)이고 등록 0, 엔트리 본문 예외는 `entryError`, 실행 중 thread가 있으면 `deferred`(수용 25). `registerPlatform` 포트가 `ports.get`으로 보인다(수용 26) | M0 |
| `cordis.contract.test.ts` | `bail treats zero as decision` | vendored `bail`이 `0`을 결정으로 돌려준다(함정이 여전히 있음을 고정) | M0 |
| | `waterfall next twice throws` | `next` 두 번 호출 시 `next() called multiple times` | M0 |
| | `emit does not isolate errors` | 앞 리스너가 던지면 뒤 리스너가 실행되지 않고 호출자에게 전파 | M0 |
| | `on in pending fiber does not throw` | 주입 서비스가 없는 PENDING fiber에서 `ctx.on`이 던지지 않는다(X-2 §5) | M0 |
| | `provide disposer returns promise` | `provide` 해제기가 Promise를 돌려준다(타입 교정 근거) | M0 |
| | `effects dispose concurrently` | 같은 fiber의 effect 두 개 해제가 순차 실행되지 않고 동시에 시작된다(`onDispose` 묶음 근거) | M0 |
| `ambient.contract.test.ts` | `context survives await` | `AsyncLocalStorage` 값이 `await`·`setTimeout`(가짜 아님, 0ms 한 번)·`queueMicrotask`를 넘어 유지된다 | M0 |

- `cordis.contract.test.ts`는 Cordis 판본을 바꿀 때 가장 먼저 실패해야 하는 파일이다. 결과가 바뀌면 spec §4.3 표를 다시 확인한다(adr.0002 §6 제안 절차).
- `ambient.contract.test.ts`의 0ms 타이머 한 번은 TS-03 예외 조건(런타임 동작 확인)으로 둔다 [제안]. 허용되지 않으면 `queueMicrotask`와 `await`만 확인한다.
- 위 표는 42개다. M0 39개(`dispose releases registrations`는 M0에서 on·provide 부분만), M1 2개, M2 1개다.

## 6. 완료 기준

1. §5 표의 해당 마일스톤 테스트가 모두 통과한다. M0 종료 시 M0 표시 39개, M1 종료 시 M1 표시 포함 전부(M2 표시 제외).
2. X.primitives.spec §9 수용 기준 1~26이 §5의 테스트 이름과 대응되고(표의 "수용 n" 표기), M2 항목(11, 18의 도구 부분)을 뺀 나머지가 M1까지 통과한다.
3. `just verify`가 종료코드 0이다. 특히 `check-layers`와 `depcruise`가 통과한다. `@xeon/ext-host`가 `platform-*`, `core-*`, `cap-*`, `group-*`, `apps/*`를 import하지 않는다(F와 vendor만).
4. `@xeon/vendor-cordis` import가 `src/primitives/cordis-bridge.ts` 한 파일에만 있다(grep 0건 확인. 다른 도메인 파일 포함).
5. F 타입을 재정의하지 않는다. `Handler`, `PointDecl`, `POINTS`, `FIRST_DENY`, `CHAIN_RULES`, `ExtensionOps`, `PostItem`, `DriveFn`, `LoopHandle`, `DriveLease`, `ScopeDef`, `ScopeApi`, `ScopeHandle`, `ExtensionEntry`, `validate*`는 `@xeon/contracts/extensions`에서 import한다. 같은 이름의 `interface`·`type`·`const` 선언이 ext-host 안에 0건이다(F.extensions.plan §6 5번 교차 확인 항목).
6. 문서-코드 이름 대조: X.primitives.spec §3.1 표(primitives·loading-trust·operations 행 전체)의 공개 이름 전부가 `src/index.ts`에서 export되고, 표에 없는 이름은 export되지 않는다(테스트 `host.test.ts`의 `public surface` 항목이 `Object.keys(await import("@xeon/ext-host"))` 값 이름과 타입 전용 이름 목록을 대조한다 [제안]). 마일스톤 중간에는 아직 만들지 않은 loading-trust·operations 이름을 대조 목록에서 빼고, 그 작업(L-*, O-*)이 끝날 때 더한다. 최종 목록은 §3.1 표와 같아야 한다.
7. M1: 모델 테이프 스모크에서 스모크 그룹을 turn 중에 끄면 다음 단계 경계에서 `scope.changed { disabled }`와 `lease.released { disabled }`가 커밋되고, 진행 중인 turn은 정착까지 진행한다(`_research/foundation-plan.md` §6).

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| Cordis rc API 변경(판본 교체 때 `plugin`, `effect`, `provide`, inject, fiber 상태가 바뀜) | `cordis-bridge.ts`와 scope 수명이 깨진다 | Cordis import를 한 파일로 모았다. `cordis.contract.test.ts`가 의존하는 동작을 고정한다. 판본 교체는 adr.0002 §6 제안 절차(재복사 → `UPSTREAM.json` 기록 → contract 테스트 → 대조표 재확인)를 따른다 |
| async drive 함수의 재생 규율 위반(클로저 지역 변수에 진행 상태) | 재개 뒤 같은 단계를 반복하거나 다르게 동작한다 | 타입으로 막지 못한다. 기본 requestId를 상태 판에 묶어 이미 커밋된 turn이 다시 실행되지 않게 한다. 결정성 lint와 재생 검사 도구(`replayDrive`)는 L3.group-kit.plan에 요청한다(eng.events.design EV-09) |
| 비협조적 확장(오래 걸리는 핸들러, 반납 신호를 무시하는 drive) | 디스패치 지연, 포트 밖 효과 | 시간 예산 초과 시 결과를 버리고 다음으로 진행한다. 예산 값과 반복 실패 자동 끄기는 X.operations, 격리는 X.loading-trust(2차)다. 한계는 spec §4.4.5에 적었다 |
| 경계 정의가 L1.loop 구현과 어긋남(`step_end`·`turn_settled`·`idle` 호출 시점, `whenIdle` 의미, `finalize` 호출) | 토글이 늦거나 turn 중간에 적용된다 | `runPortContract`(P-19)를 L1 구현의 테스트에서 돌리게 한다. M1 스모크가 경계 적용을 끝단에서 확인한다 |
| `post.when = next` 의미 미확정 | L1 큐 구현이 바뀐다 | X는 `when` 값을 포트로 넘기기만 하므로 X 코드는 영향이 작다. 큐 위치 결정은 L1.tasks 쪽 변경이다. 결정 전에는 spec §4.7 [제안](시작하지 않음)으로 테스트를 둔다 |
| Bun `AsyncLocalStorage`가 일부 비동기 경계에서 값을 잃음 | `state()`·`commit()`·`post`가 `no_thread`로 실패 | `ambient.contract.test.ts`로 먼저 확인한다. 실패하면 F에 thread 인자 추가(spec §10 미결)를 앞당겨 요청한다 |
| F `ports.ts`의 포트 이름이나 시그니처가 바뀜([결정: review.decisions-2 U-14, D-04]로 정본은 F다) | L1 구현과 X의 import가 함께 바뀐다 | X는 정의를 두지 않고 `ports.ts`·`resources.ts`에서 재export만 하므로 바뀐 이름은 타입 검사에서 바로 드러난다(P-31) |
| 공급자 재시작 연쇄로 setup이 경계 밖에서 다시 실행됨 | 그룹이 turn 중간에 핸들러 집합을 바꾼다 | [해소, 결정 D8] 재적용 요청만 기록하고 다음 단계 경계에서 새 세대로 setup을 다시 실행한다(spec §4.5.4). 그 사이 소비자의 핸들러는 스냅샷에 없다 |
| `ext-host/src/index.ts`를 다른 작업자가 먼저 채움 | 공개 이름 충돌 | P-13에서 spec §3.1 목록과 대조하고 충돌을 spec §10에 적는다 |

## 8. M2 구현 현황 (X 레인)

`review.m2-plan` 4.3절의 X 레인 작업이 끝난 항목을 적는다. 한 줄은 작업 ID 하나다.

| 작업 | 상태 | 비고 |
|---|---|---|
| P-22 | 완료 | `LeaseArbiterPort` 주입, `activeDriveGroup` 중재, `drive_conflict`, `revoked` 반납(이름 지정 그룹이 후보일 때, spec §4.4.1 5번), `idle`·`budget` 반납 뒤 재후보 조건. `lease.test.ts` |
| P-23 | 완료 | `hostOf(g).migrateState`, 버전 비교, 새 판 커밋(`mig:` 키), `state_future_version` 거부. thread에서 켤 때 준비한다. `migration.test.ts` |
| P-27 | 완료 | `capabilityProviders` 선택, major 불일치 제외 진단, `capability_ambiguous`. `services.test.ts` |
| P-28 | 완료 | thread별 켜짐 집합·요청, 세대 공유와 마지막 thread에서 해제, thread별 임대. 재시작을 넘는 전이 횟수와 끈 scope 복원은 `ExtThreadSnapshot.scopeTransitions`·`disabled`로 해소(spec §10). `thread-scope.test.ts` |
| group-kit 요청 2·3·4 | 완료 | `ExtHost.leaseOf`, `ExtHost.onChange`, `TestHost.restart` |
| group-kit 요청 1 | 완료 | `LeaseCandidate.enabledAtSeq`(F `ports.ts`)와 `ExtThreadSnapshot.enabledAtSeq`. ext-host는 열 때 스냅샷에서, 켠 경계를 커밋한 뒤 `loadThread`에서 채운다. `lease.test.ts` |
| N-08 | 완료 | `ExtTableReader`·`ExtTableWriter`·`ExtProjection.apply`의 `Result`화(`ExtRowError`). 다른 패키지 호출처는 없다 |
| P-24 | 완료 | `resources.ts`: `ResourceRegistry`(`list`·`subscribe`·`setFlag`), `ResourcePolicy` 결합(쌍 판정 + 집합 판정 `exposeAll`), 도구·provider·MCP 포트 위임, 명령·단축키·플래그·렌더러 보관, effect 자동 해제, `hostOf(g).register*`·`getFlag`. `resources.test.ts` |
| P-25 | 완료 | detached tap은 완료를 기다리지 않고 `detached: true`를 돌려준다. 핸들러는 그 뒤 순서대로 실행되고 실패는 정책·진단으로만 보고된다. 예산은 받고 thread가 닫히면 중단·폐기한다. `dispatch-detached.test.ts` |
| P-26 | 완료 | 확장에 Cordis 이벤트·컨텍스트 API가 없음을 시험으로 고정했다. pi events 어댑터용 휘발 버스는 M3a에서 지웠다(ADR-0017 §3.7). 그룹 격리는 kind 접두 필터이고 `event-isolation.test.ts`가 확인한다 |
| N-01 | 완료(X 쪽) | `openThread`가 이미 열린 세대를 그 thread의 켜짐 집합에 올리고(`seedThread`) 저장된 켜짐 기록과 같으면 `scope.changed`를 쓰지 않는다. 같은 프로세스 재열기·재시작 시험(`thread-scope.test.ts`). core-persistence가 `loadThread.enabled`를 비워 돌려주는 M1 대역(PS-16 전)에서는 중복이 남는다 |
| N-02 | 완료 | 결정 D8(b): 공급자 재시작 뒤 Cordis가 apply를 다시 불러도 setup을 바로 다시 실행하지 않고 `stale` 표시 후 다음 단계 경계(유휴면 곧바로)에서 새 세대로 만든다. `provider-restart.test.ts` |

### M3a 구현 현황 (T-X2)

| 작업 | 상태 | 내용 |
|---|---|---|
| P-32 | 완료 | `capability-guard.ts`, 시험 `replay-effects.test.ts`. 기본 키는 [제안], ADR 확정 대기 |
| P-33 | 완료 | `effect-worker.ts`, 시험 `replay-effects.test.ts` |
| P-34 | 완료 | `state.ts` 줄·`updateState`·`commitWith`, 시험 `state-queue.test.ts` |
| P-35 | 완료 | `lease.ts` 대기 계수·`lease.rejected`, 시험 `lifecycle.test.ts`. 설정 `x.primitives.leaseWaitLimit` |
| P-36 | 완료 | `lifecycle.ts`, `event-bus.ts` 삭제, 시험 `lifecycle.test.ts`·`event-isolation.test.ts` |
| P-37 | 완료 | `host-api.ts`의 `registerTool`·`registerCommand`가 호출 ambient를 열고(`ambient.ts`의 `invocation`), `capability-guard.ts`가 그 문맥을 재실행으로 보지 않는다. `ToolResourceDef.execute`의 `ctx.toolCallId`, `CommandResourceDef.handler`의 `ctx.invocationId`. 시험 `direct-invocation.test.ts`. `onDispose`·단축키 처리기는 제외 |
