---
id: F.extensions.plan
layer: F
domain: extensions
kind: plan
status: draft
depends_on: [F.extensions.spec, F.conversation.plan, F.records.plan, F.capabilities.plan]
binds: [xeon/packages/contracts/src/extensions/**]
---

# F 확장 계약 구현 계획

대상 스펙: F.extensions.spec. 패키지: `@xeon/contracts`, 서브패스 `./extensions`.

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 소비자 |
|---|---|---|
| M0 | 지점 종류 7·fold 4 타입, `PointSignatures`·`PointDecl`·`POINTS` 46행 전체(M3 개정, adr.0017), `FIRST_DENY`, `CHAIN_RULES`, M1 지점(스펙 §3.4 M1 열 ●: `input.user.before`, `request.context.before`, `request.provider.before`, `tool.call.before`, `tool.result`, `boundary.step.before`, `boundary.step.after`, `boundary.settle.before`, `boundary.settle.after`, `session.start`, `session.shutdown`)의 페이로드·결정·패치 정확화, 4연산 타입(`ExtensionOps`, `Handler`, `PostItem`, `DriveFn`, `LoopHandle`, `DriveLease`, `ScopeDef`, `ScopeApi`, `ScopeHandle`), `ExtensionManifest`, `validateManifest`, `validateUsage`, `validateManifestSet`, `GroupRecord`·`RecordKindDecl`과 `grp.`/`x.` 접두 검증, 문서 표 대조 검사 | X ext-host 최소형(on/post/drive/scope), L1 core-loop·core-tools의 지점 발화 |
| M1 | 걷는 골격 스모크: 테스트용 그룹이 이 타입으로 `on`(`tool.call.before`, `boundary.step.after`), `post`, `drive`를 쓴다(`_research/foundation-plan.md` §5 P4, §6 M1 스모크). 이 그룹의 매니페스트는 `validateManifest`와 `validateUsage`를 통과해야 한다. 스모크에서 드러난 페이로드 누락을 반영한다 | X, L1, L3 테스트 그룹 |
| M2 이후 | M1 밖 지점의 페이로드 중 `Type.Unknown()`으로 둔 필드 정확화(F.records의 투영 타입, 컴팩션 타입이 정해진 뒤), 열거형 확장 예약(파트·이벤트 종류 접두, 선언 병합 규칙), 격리 필드(`isolation: "process"`)의 와이어 직렬화 요구 반영, 미결 사항 결정 반영 | X.loading-trust(격리), L3 전체 |

- M0에서 나머지 30개 지점은 같은 PR에서 표만 채운다. `PointDecl`의 모든 필드를 채우되 페이로드 스키마의 pi 고유 하위 타입은 `Type.Unknown()`으로 둘 수 있다(스펙 §3.3 페이로드 형태 규칙).

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/
  package.json                      # exports에 "./extensions": "./src/extensions/index.ts" 추가
  src/extensions/
    manifest.ts          # ExtensionManifestSchema, ExtensionManifest, 하위 스키마, defineManifest, EXTENSION_NAME_PATTERN
    points.ts            # Fold, PointKind, TapSig/FirstSig/ChainSig, PointSignatures, PointName(+Schema),
                         # PointDecl, PiSource, POINTS(46행), FIRST_DENY, CHAIN_RULES, COLLECT_RULES, GUARD_POINTS, LIFECYCLE_POINTS, FirstPointName, ChainPointName, CollectPointName
    points/
      input.ts           # input, user_bash, before_agent_start 페이로드·결정·패치
      request.ts         # context, context_with_system, cache_warming_decision, before_provider_request,
                         # before_provider_headers, after_provider_response, provider_stream_event,
                         # model_select, thinking_level_select
      tool.ts            # CapabilityRef, tool_call, tool_result, tool_execution_*
      boundary.ts        # BoundaryValue, BoundaryPatch, BoundaryContextPreview, agent_*, turn_*, message_*
      session.ts         # project_trust … ui_prompt_end
    ops.ts               # HandlerContext, Handler, Unsubscribe, PostWhen, PostContent, PostItem, PostOptions,
                         # PostReceipt, ExtensionOps
    drive.ts             # DriveLimits, DriveOptions, LeaseBudget, TurnInput, TurnOutcome, SpawnSpec,
                         # SpawnOutcome, LoopHandle, DriveFn, LeaseId, DriveLease
    scope.ts             # ScopeId(+PATTERN), StateDecl, ScopeDef, RecordQuery, ScopeApi, ScopeSetup,
                         # ScopeStatus, ScopeHandle, ScopeFn, ExtensionEntry
    ports.ts             # PortKey, PortLookup, 호스트 포트 9종과 키, 로더 포트, RecordCommitPort 재노출(스펙 §3.2.1)
    group-record.ts      # RecordKind(+PATTERN), GroupId, RecordSubject, GroupRecord(+Schema), RecordKindDecl,
                         # RecordKindDeclJsonSchema, isRecordKindOf
    validate.ts          # ManifestIssue(+Code), validateManifest, validateUsage, validateManifestSet, validateGroupRecord
    index.ts             # 재export
  test/extensions/
    points.test.ts  manifest.test.ts  validate.test.ts  group-record.test.ts  chain-rules.test.ts
    ops.type-test.ts
    fixtures/smoke-group.manifest.json   # M1 스모크 테스트 그룹 매니페스트
xeon/scripts/check-points-doc.ts         # 스펙 §3.4 표와 POINTS 대조 [제안, eng.toolchain 담당과 조율]
```

- import 방향: `group-record`·`points/*` ← `points` ← `ops`·`drive`·`scope` ← `manifest` ← `validate`. `manifest.ts`는 `points.ts`(`PointNameSchema`)와 `group-record.ts`를 import하고, `validate.ts`만 모든 파일을 import한다. `../capabilities`는 `manifest.ts`, `scope.ts`, `points/tool.ts`가 import한다. `ports.ts`는 `ops.ts`·`drive.ts`·`scope.ts`·`manifest.ts`의 타입과 `../conversation`, `../capabilities`(`ToolName`), `../records`(`RecordCommitPort`, `ProjectorRegistry`, `StoreService`)만 `import type`으로 가져온다.
- `xeon/scripts/`는 이 문서의 binds 밖이다. 스크립트 위치와 `just verify` 연결은 eng.toolchain.guide 작업자와 조율한다. 조율이 안 되면 같은 검사를 `test/extensions/points.doc.test.ts`로 두고 저장소 상대 경로로 스펙 파일을 읽는다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| E1 | `points.ts` 기본 타입: `Fold`, `PointKind`, `TapSig`·`FirstSig`·`ChainSig`, `OnError`, `FoldOnError`, `PiSource`, `PointDecl`, `FirstPointName`, `ChainPointName` | F.capabilities.plan P1 | S |
| E2 | `points/<kind>.ts` 페이로드 스키마: pi 이벤트 인터페이스에서 `type`을 빼고 필드 이름을 유지한다. M1 지점 11개는 스펙 §3.5 형태로 정확화하고, 나머지는 pi 고유 하위 타입을 `Type.Unknown()`으로 둔다. ID 필드는 F.conversation의 브랜드 ID를 쓴다 | E1, F.records.plan R1(`DurableEventDraft`)·R2(`EventKind`), F.conversation.plan C1(`ThreadId` 등 ID)·C2(메시지 재노출) | L |
| E3 | 반환 타입: first 결정(`ToolCallDecision`의 deny 형태, `UserBashDecision`, `ProjectTrustDecision`, `SessionCancelDecision` 등), chain 값·패치(`InputPatch`, `ContextPatch`, `HeadersPatch`, `ToolResultPatch`, `BoundaryValue`·`BoundaryPatch`(entries + continue), `ResourcesPatch` 등)와 각 스키마 | E2 | M |
| E4 | pi 이벤트 → 지점 매핑 표 코드화: `PointSignatures` 46행, `POINTS` 46행(kind, fold, failure, dispatch, payload, result, finalize, m1, pi 출처), `FIRST_DENY` 9행, `CHAIN_RULES` 10행(merge, stop), `COLLECT_RULES` 2행(merge). `PointNameSchema` | E1, E2, E3 | M |
| E5 | `ops.ts`: `HandlerContext`, `Handler`(fold별 조건부 타입), `PostItem`, `PostOptions`, `PostReceipt`, `ExtensionOps` | E4, F.conversation.plan C2(`TextContent`, `ImageContent`, `JsonValue`). `requestId`는 `string`이다(스펙 §2) | S |
| E6 | `drive.ts`와 `scope.ts`: `DriveFn`, `LoopHandle`, `LeaseBudget`, `DriveLease`, `DriveLimits`, `TurnInput`·`TurnOutcome`, `SpawnSpec`·`SpawnOutcome`, `ScopeDef`, `StateDecl`, `ScopeApi`(`capability(key)`, `recordPrivate(kind, payload)` 포함. `recordPrivate`는 review.decisions-2 T-21), `ScopeHandle`, `ScopeFn`, `ExtensionEntry` | E5, F.capabilities.plan P3(`ServiceKey`) | M |
| E7 | `manifest.ts`: `ExtensionManifestSchema`와 하위 스키마, `defineManifest`. Claude Code `plugin.json` 메타 필드 + Xeon 필드 | E4, E8, F.capabilities.plan P1 | M |
| E8 | `group-record.ts`: `RecordKind`(= F.records `ExtensionEventKind`)와 패턴, `GroupRecord`, `RecordSubject`, `RecordKindDecl`, `RecordKindDeclJsonSchema`, `isRecordKindOf` | E1, F.records.plan R2(`ExtensionEventKind`, `EXTENSION_KIND_PATTERN`) | S |
| E10 | `ports.ts`: 스펙 §3.2.1 블록을 그대로 코드로 옮긴다. `PortKey`(`member` 포함), `PortLookup`, `LoopPort`, `InputQueuePort`, `ProjectorRegistryPort`, `ScopedStorePort`, `ProcessPort`(`IsolationProcessPort`, `HookProcessPort`, `HookRunSpec`, `HookRawRun`), `LeaseArbiterPort`, `ToolsPort`, `ModelsPort`, `McpPort`와 부속 타입·키, 로더 포트(`LoaderFs`, `LoaderPaths`, `TrustStoreBackend`, `TrustPrompter`와 부속 타입), `RecordCommitPort` 재노출. 스펙 §9 12~14의 값·타입 테스트를 둔다. 정본은 F다. X 문서(`X.primitives.spec` §3.6, `X.loading-trust.spec`, `X.operations.spec`)와 ext-host는 자기 정의를 두지 않고 이 이름을 `import type`으로 가져와 다시 export한다 | E5, F.records.plan R12(`RecordCommitPort`, `ProjectorRegistry`, `StoreService`) | M |
| E9 | `validate.ts`: `validateManifest`(알 수 없는 키 제거 포함), `validateUsage`, `validateManifestSet`(`drive_conflict`), `validateGroupRecord`. 문서 표와 코드 `POINTS` 일치 검사 스크립트(`check-points-doc.ts`): 스펙 §3.4 표에서 `` | <n> | `<이름>` | <kind> | <fold> | `` 행을 읽어 이름·kind·fold·M1 표시를 `POINTS`와 비교한다 | E4, E7, E8 | M |

- E2가 가장 크다. M1 지점부터 끝내고 E4로 넘긴 뒤 나머지 30개 페이로드를 채우는 순서로 나눌 수 있다.
- 합성 규칙 형식은 pi durable 훅 표(`~/projects/_ref/pi-src/packages/durable/docs/spec.md` 2636-2660)처럼 "지점 이름 → 합성 → 실패"를 한 표로 둔다. `POINTS`와 `CHAIN_RULES`가 그 표의 코드형이다.

## 4. 채택 코드

| 대상 | 버전 | 쓰는 방식 |
|---|---|---|
| `typebox` | 1.3.27 (워크스페이스 catalog) | 그대로. 스키마 정의, `Value.Check`(테스트) |
| `@earendil-works/pi-ai` | 1.3.0 정확 고정 | 그대로. 페이로드가 참조하는 메시지·스트림 타입을 F.conversation 재노출을 거쳐 `import type` |
| `@earendil-works/pi-agent-core` | 의존하지 않음(adr.0009) | `AgentMessage`는 F.conversation `agent.ts` 정의를 쓴다 |
| pi coding-agent 확장 타입 | 소스 1.1.0 (`~/projects/_ref/pi-src/packages/coding-agent/src/core/extensions/types.ts`) | 참고만. 이벤트 페이로드 형태와 결과 타입의 필드 이름을 옮겨 적는다. 패키지(`@earendil-works/pi-coding-agent`) 전체에 의존하지 않는다 |
| pi durable 훅 표 | `durable/docs/spec.md` 2636-2660 | 참고만. 합성 규칙을 표 하나로 선언하는 방식 |
| Cordis `events.ts` | vendored 4.0.0-rc.x | X에서 쓴다. F는 import하지 않는다 |

- 포크 없음.
- pi 1.1.0 소스와 npm 1.3.0의 이벤트 정의 차이는 확인하지 않았다 [가정]. F-2 조사는 pi-ai와 agent-core만 대조했다(`_research/notes/F-2.md` §3). E4에서 `npm pack @earendil-works/pi-coding-agent@1.3.0`의 `dist/core/extensions/types.d.ts`로 41개 이름을 대조하고 차이를 보고한다(코드는 실행하지 않는다).

## 5. 단위 테스트 목록

| 파일 | 테스트 | 확인할 동작 |
|---|---|---|
| `points.test.ts` | `every row has fold and payload` | `POINTS` 46행 모두 `fold`, `kind`, `payload`, `failure`, `dispatch`가 있다(`pi`는 pi 출처 41행만) |
| | `failure follows the fold default except the declared exception` | tap·collect→`open`, first→`closed`, chain→`skip`. 다른 행은 `session.compact.before`(`open`) 하나 |
| | `names unique and complete` | 이름 중복이 없고 pi 41개 이름 목록(테스트 안 상수, `types.ts:1377-1409`를 펼친 것)과 집합이 같다 |
| | `pi mapping complete` | 모든 행의 `pi.event`가 지점 이름과 같고 `pi.def`, `pi.emit`이 비어 있지 않다 |
| | `kind and fold counts` | kind 3/9/5/9/15, fold tap 22·first 7·chain 12 |
| | `first and chain tables` | first 행은 모두 `FIRST_DENY`에, chain 행은 모두 `CHAIN_RULES`에 있고 그 밖의 키는 없다 |
| | `detached only for tap` | `dispatch: "detached"`인 행은 모두 tap이고 5개다 |
| | `finalize only on boundary chain` | `finalize`가 있는 행은 `boundary.step.after`, `boundary.settle.before` 둘뿐이다 |
| `chain-rules.test.ts` | `tool_result content drops structured` | `content`만 바꾸면 `structuredContent` 제거, 둘 다 주면 유지 |
| | `input handled stops` | `handled` 패치 뒤 `stop`이 참 |
| | `resources append` | 두 패치의 경로가 순서대로 이어진다 |
| | `cache warming last defined` | 패치 두 개 중 뒤의 값, 패치 없음이면 초기값 |
| | `boundary replace` | `entries` 패치는 교체, `continue` 생략은 유지 |
| | `message_end role mismatch rejected` | role이 다른 패치는 merge가 예외를 던진다(디스패처가 skip 처리) |
| | `headers null deletes` | `HeadersPatch`의 `null` 값은 헤더를 지운다 |
| `manifest.test.ts` | `required fields` | `schemaVersion`, `name`, `version`, `layer`, `kind`, `entry`, `points`, `usesDrive` 누락은 `schema` 오류 |
| | `version and range` | `version: "1.0"`은 오류, `requires[].range: "^1.2.0"`은 통과, `"1.x"`·`"^1 || ^2"`는 `range_invalid` |
| | `unknown keys` | 최상위 미지 키는 경고 후 제거, `userConfig` 항목 안 미지 키는 오류 |
| | `capability schema shared` | `requires[].id` 스키마가 `CapabilityIdSchema`와 같은 참조 |
| | `name pattern` | `acme-notes`는 통과, 밑줄(`acme_notes`), 대문자, 33자 이름은 `schema` 오류(`EXTENSION_NAME_PATTERN` `^[a-z][a-z0-9-]{1,31}$`, review.decisions-2 U-18) |
| | `smoke group fixture valid` | `fixtures/smoke-group.manifest.json`이 이슈 0건 |
| `validate.test.ts` | `undeclared point` | 사용 기록의 `on`에 선언 밖 지점이 있으면 `point_undeclared` |
| | `undeclared capability` | `capability(key)` 대상이 `requires`·`optional`에 없으면 `capability_undeclared` |
| | `drive rules` | plugin의 `usesDrive: true`는 `drive_requires_group`, 선언 없이 `drive`를 쓰면 `drive_undeclared` |
| | `drive conflict` | 기본 활성 drive 그룹 둘이면 `drive_conflict` 경고, 하나가 `defaultEnabled: false`면 경고 없음 |
| | `layer kind` | `kind: "group"`·`layer: "L2"`는 `layer_kind_mismatch` |
| | `reserved names` | 외부 확장 이름 `web`, `core`는 `name_reserved` |
| | `entry outside root` | `entry`가 `/abs/index.ts`이거나 `../x.ts`이면 `entry_invalid` |
| | `provides reserved` | `provides[].id`가 `core.x`처럼 예약 접두면 `provides_reserved` |
| | `record kind duplicate` | `recordKinds`에 같은 `kind` 두 번이면 `record_kind_duplicate` |
| | `user config invalid` | `userConfig` 항목의 빈 `setting`은 `user_config_invalid` |
| | `isolation and trust values` | `isolation: "vm"`은 `isolation_invalid`, `trust.level: "root"`는 `trust_invalid` |
| | `name conflict` | 같은 `name`의 매니페스트 둘을 `validateManifestSet`에 넣으면 `name_conflict` |
| | `capability unprovided` | `requires` 능력을 집합 안의 누구도 `provides`하지 않으면 `capability_unprovided` 경고 |
| `group-record.test.ts` | `prefix violation rejected` | 그룹 `learning`이 `grp.helm.item.tagged`를 선언하면 `record_kind_prefix`, 플러그인이 `grp.` 접두를 쓰면 같은 오류, 3마디 `grp.learning.proposed`도 같은 오류 |
| | `record kind is event kind` | `grp.learning.skill.proposed`, `x.acme-notes.note.synced`가 `RECORD_KIND_PATTERN`과 F.records `parseEventKind`를 모두 통과한다 |
| | `read pattern` | `grp.learning.*`, `grp.learning.skill.*`는 통과, `grp.*`와 형식 위반은 `read_kind_invalid` |
| | `read own prefix rejected` | 그룹 `learning`의 `readsRecordKinds`에 `grp.learning.*`가 있으면 `read_kind_invalid` |
| | `payload validated` | 선언된 payload 스키마 위반은 `record_payload_invalid`, 미등록 종류는 `record_kind_unregistered` |
| | `version unknown` | 선언보다 큰 `version`의 레코드는 `record_version_unknown` 경고 |
| `ops.type-test.ts` | `handler narrows by fold` | `Handler<"tool.call.before">` 반환이 `ToolCallDecision \| undefined`(Promise 포함), `Handler<"boundary.step.after">`가 `(payload, current: BoundaryValue, ctx)`를 받고 `BoundaryPatch \| undefined`를 반환, `Handler<"session.start">`가 `void`를 반환 |
| | `wrong return rejected` | tap 핸들러가 값을 반환하거나 first 핸들러가 패치를 반환하면 `// @ts-expect-error` |
| | `capability typed by key` | `ScopeApi.capability(WebSearchKey)`의 반환 타입이 `ApiOf<typeof WebSearchKey>`와 같다 |
| | `drive fn signature` | `DriveFn<S>`가 `(loop: LoopHandle, state: Readonly<S>) => Promise<void>` |

- `*.type-test.ts`는 `tsc -b`로만 검사한다. 실행 규칙은 eng.testing.guide를 따른다 [가정].

## 6. 완료 기준

1. F.extensions.spec §9 수용 기준 1~11을 위 테스트와 대조 스크립트가 모두 확인하고 통과한다.
2. 스펙 §3.4 표와 `POINTS`의 이름·kind·fold·M1 표시가 대조 검사에서 차이 0건이다.
3. `just verify`의 `tsc -b`, oxlint(type-aware), check-layers, oxfmt 검사가 통과한다. `@xeon/contracts/extensions`에서 `cordis`와 `@earendil-works/pi-coding-agent` import가 0건이다.
4. `@xeon/contracts/extensions` 서브패스로 공개 이름 전부를 import할 수 있다.
5. 정합성 검사 입력으로 다음 교차 확인 항목을 남긴다(P2 검토자용).
   - X.primitives.plan이 `Handler`, `PointDecl`, `POINTS`, `FIRST_DENY`, `CHAIN_RULES`, `ExtensionOps`, `DriveFn`, `LoopHandle`, `ScopeApi`, `ScopeFn`을 `@xeon/contracts/extensions`에서 import하고 다시 정의하지 않는지.
   - L1 각 plan이 지점을 발화할 때 `POINTS`의 이름을 문자열 상수로 쓰지 않고 `PointName` 타입으로 쓰는지.
   - `CapabilityIdSchema`가 F.capabilities와 같은 객체인지.
   - `DurableEventDraft`, `EventKind`, `ExtensionEventKind`, ID 브랜드(`ThreadId` 등), `AgentMessage` 재노출을 F.records.spec, F.conversation.spec의 위치에서 import하고 다시 정의하지 않는지.
   - L3.helm.spec과 L3.learning.spec의 매니페스트가 `usesDrive`(Helm 참, 학습 거짓)를 쓰고, `recordKinds`를 자기 접두로만 선언하며, 다른 그룹의 비공개 기록을 읽는 선언이 없는지(스펙 §4.8).

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| pi 이벤트 41종 매핑 오류(줄 번호, fold, 페이로드 필드) | L1이 잘못된 합성으로 발화하거나 pi 확장 이식 시 동작이 달라진다 | `_research/notes/F-1.md` 대조 결과를 그대로 코드화하고, E4에서 npm 1.3.0 선언 파일로 다시 대조한다. `points.test.ts`의 이름 집합 테스트로 누락을 막는다 |
| boundary fold가 chain 교체로 부족해 4번째 fold가 필요해짐 | `Fold`, `Handler`, `POINTS` 구조가 바뀌어 X·L1 코드가 함께 바뀐다 | `CHAIN_RULES`와 `finalize` 표지로 pi 합성을 모두 표현할 수 있음을 `chain-rules.test.ts`로 고정한다. 사용자 결정이 바뀌면 `Fold`에 값을 추가하는 하위 호환 변경으로 처리할 수 있게 `Handler`를 조건부 타입 한 곳에 둔다 |
| drive 재생 규율을 타입으로 막지 못함 | 클로저 상태를 쓰는 drive 함수가 재개 뒤 다르게 동작한다 | `loop.turn`·`loop.spawn` 기본 `requestId`를 결정적으로 정해 중복 실행을 막고, 결정성 lint는 L3.group-kit에 요청한다. 스펙 §4.6에 규율을 명시한다 |
| 지점 이름 표기 불일치(snake_case 대 점 표기) | 문서·코드·조사 자료 사이에서 이름이 달라 검색과 대조가 실패한다 | 정본을 pi snake_case로 두고 `PointName` 타입 밖의 문자열은 컴파일 오류가 되게 한다. 별칭 허용 여부는 [미결]로 사용자 확인 |
| first fail-closed가 `session_before_*`에서 과도함 | 결함 있는 확장 하나가 세션 전환·컴팩션을 계속 막는다 | 거부값을 `FIRST_DENY`에 지점별로 두어 결정이 바뀌면 값만 바꾸도록 한다. 반복 거부 기록은 X.operations의 안전 모드 근거로 넘긴다 |
| F.records·F.conversation 이름(`DurableEventDraft`, `ExtensionEventKind`, ID 브랜드) 변경 | E2·E8의 import가 깨진다 | 이름은 두 spec에서 확정했다. 바뀌면 두 spec을 먼저 고치고 import만 바꾼다. 해당 필드를 `points/*.ts` 안의 타입 별칭 한 곳으로 모은다 |
