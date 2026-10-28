---
id: F.readme
layer: F
domain: readme
kind: readme
status: draft
depends_on: [F.conversation.spec, F.records.spec, F.capabilities.spec, F.extensions.spec, F.wire-settings.spec]
binds: [xeon/packages/contracts/**]
---

# F 계약 층

## 1. 목적

F는 모든 층이 쓰는 이름의 기준이다. 메시지, 이벤트, 능력, 확장, 호스트 계약, 설정의 타입과 스키마와 규약을 한 패키지 `@xeon/contracts`에 둔다. 다른 층 문서와 코드는 이름을 F 문서에서 가져온다(`_templates/README.md` 문체 규칙 마지막 항목).

- F에는 타입, TypeBox 스키마, 상수, 규약만 있다. 런타임 로직은 두지 않는다.
- 런타임 로직 예외 [제안]: 아래 다섯 종류는 F에 둘 수 있다. 공통 조건은 셋이다. 입출력, 시계, 난수, 전역 가변 상태를 쓰지 않는다. 여러 층이 같은 규칙을 써야 해서 F보다 위에 두면 같은 층끼리 import가 생긴다. 함수 하나가 한 규칙만 계산한다.
  1. 순수 함수: 입력만 보고 결과를 낸다. 예: `parseEventKind`, `checkEnvelopeSize`, `decideEffectRecovery`, `upcastEvent`(records), `validateCapability`, `orderTools`, `diffToolsets`, `parseSecretRef`, `findForeignSecretSyntax`(capabilities), `validateManifest`, `validateUsage`, `validateGroupRecord`(extensions), `checkEnvelope`, `classifyMethodName`, `resolveSetting`, `checkSettingWrite`, `settingsJsonSchema`(wire-settings).
  2. 주입받은 발급기를 부르는 함수: 발급기를 인자로 받고 그 밖의 상태를 쓰지 않는다. 예: `assignPartIds(input, ids)`가 `ids.next("prt")`를 부른다(`F.conversation.spec` §3.4). 발급기 구현(`IdFactory`의 시계·난수)은 F 밖에 있다.
  3. Web Crypto 해시: `globalThis.crypto.subtle`의 SHA-256만 쓴다. 같은 입력에 같은 값을 내므로 순수 함수로 본다. 비동기라 `Promise`를 돌려준다. 예: `toolsetFingerprint`(`F.capabilities.spec` §3.8). 그 밖의 전역 API는 쓰지 않는다.
  4. 오류 클래스와 선언 함수: 오류를 나타내는 `Error` 하위 클래스(`CapabilityError`, `WireError`, `SettingDefError`, 루트의 `Bug`)와, 선언을 받아 그대로 또는 정규화해 돌려주는 `define*` 함수(`defineCapability`, `defineManifest`, `defineSettings`). `define*`는 규칙 위반이면 오류 클래스를 던질 수 있다(`defineSettings` → `SettingDefError`, `F.wire-settings.spec` §3.8.3). 호출 결함과 선언 결함은 `Result` 대신 예외로 알린다(`eng.typescript.guide` TY-11).
  5. 데이터 상수: 케이스 표나 선언 표 같은 값만 있는 상수. 예: `POINTS`, `CORE_EVENT_CATALOG`, `WIRE_METHODS`, `WIRE_CONFORMANCE_CASES`. 케이스를 돌리는 실행기 틀은 `src/`가 아닌 `test/`에 둔다(`F.wire-settings.plan` W14).
- 발급(`IdFactory`·`LocalIdFactory` 구현), 저장, 전송, 로딩은 F 밖에서 구현한다. `createIdFactory(clock, random)` 같은 발급기 구현과 테스트 대역(`manualClock`, `seededRandom`, `fixedIdFactory`)은 시계·난수를 쓰므로 위 다섯 예외에 들지 않는다. 운영 구현은 `platform-os`에 두고, 테스트 대역은 쓰는 패키지마다 자기 `test/` 안에 둔다 [결정: review.decisions-2 U-03](§8 10번).
- 층 순위는 F → X → L0 → L1 → L2 → L3 → L4이고 F가 가장 낮다(`_research/foundation-plan.md` §3). 그래서 `@xeon/contracts`는 다른 xeon 패키지를 import하지 않는다. `scripts/check-layers.ts`가 `package.json`의 `xeon.layer = "F"`로 이를 검사한다.
- 허용하는 외부 의존:
  - `typebox` 1.3.27(워크스페이스 catalog). 값 import 허용.
  - `@earendil-works/pi-ai` 1.3.0. `import type`, `export type`만 허용(`F.conversation.spec` §3.1 규칙 1). `@earendil-works/pi-agent-core`에는 의존하지 않는다(adr.0009).
  - `@opentelemetry/api` 1.10.0. 2차, `import type`만(`F.wire-settings.spec` §3.6).
  - Cordis는 import하지 않는다(`F.capabilities.spec` §3.5).

## 2. 도메인

계획 v2의 F 하위 층 5개(`_research/layer-plan-v2.json` F1~F5)가 도메인 5개에 1:1로 대응한다.

| 도메인 | 한 줄 요약 | 계획 v2 | 서브패스 | 문서 | M0 |
|---|---|---|---|---|---|
| conversation | 브랜드 ID 8종, pi 메시지·스트림·도구 타입 재노출과 런타임 스키마, 파트 id, thread/turn/step/item 계층과 수명주기 알림, 도구 결과 3채널, 재생 정책 `ReplayPolicy` | F1 대화 모델 | `@xeon/contracts/conversation` | `F.conversation.spec`, `F.conversation.plan` | 포함 |
| records | 이벤트 envelope(내구/휘발), kind 이름 규칙과 코어 카탈로그, blob 분리, 효과 3단과 복구 규칙, 단계 체크포인트, 업캐스터·마이그레이션 | F2 기록 계약 | `@xeon/contracts/records` | `F.records.spec`, `F.records.plan` | 포함(`SessionStore`는 2차) |
| capabilities | 능력 정의(서비스 메서드 + 모델 도구 쌍), `ServiceKey`, 도구 이름·제목, 결정적 도구 순서, 능력 오류, 정적 검증 | F3 능력 계약 | `@xeon/contracts/capabilities` | `F.capabilities.spec`, `F.capabilities.plan` | 포함(내장 능력 정의는 M1부터) |
| extensions | 확장 매니페스트, 지점 선언 표(on fold, post, drive, scope), 그룹 레코드 형식(kind 접두, `GroupRecord`, 종류 등록), 열거형 확장 예약 | F4 확장 계약 | `@xeon/contracts/extensions` | `F.extensions.spec`, `F.extensions.plan` | 포함(열거형 확장 예약은 2차) |
| wire-settings | 호스트 계약(JSON-RPC, 메서드 레지스트리, seq 커서, 오류, 전송 인터페이스, 버전 정책)과 설정 스키마 단일 원천(`SettingDef`, 범위 우선순위, JSON Schema 출력) | F5 연결·설정 계약 | `@xeon/contracts/wire`, `@xeon/contracts/settings` | `F.wire-settings.spec`, `F.wire-settings.plan` | 포함(오류 구간, `_meta`, 소켓 전송은 M2) |

- 서비스 인터페이스 서브패스 `@xeon/contracts/services`는 도메인을 새로 만들지 않는다. L0·L1 서비스 인터페이스, X 포트를 확장하는 `McpService`(L2)와 `GroupService`(L3), 서비스 이름 상수를 모으는 서브패스이고 정의는 `F.capabilities.spec` §3.12가 정한다 [결정: review.decisions-2 D-04]. 층 사이 협력은 이 인터페이스로만 한다(DR-02, DR-14, CM-05).

[결정] M0 범위에 `contracts`(F 전 도메인의 TypeBox 타입)가 들어간다(`_research/foundation-plan.md` §5 P4).

## 3. 패키지 배치

| 서브패스 | 소스 디렉터리 | 진입 파일 |
|---|---|---|
| `@xeon/contracts/conversation` | `src/conversation/` | `src/conversation/index.ts` |
| `@xeon/contracts/records` | `src/records/` | `src/records/index.ts` |
| `@xeon/contracts/capabilities` | `src/capabilities/` | `src/capabilities/index.ts` |
| `@xeon/contracts/extensions` | `src/extensions/` | `src/extensions/index.ts` |
| `@xeon/contracts/wire` | `src/wire-settings/wire/` | `src/wire-settings/wire/index.ts` |
| `@xeon/contracts/settings` | `src/wire-settings/settings/` | `src/wire-settings/settings/index.ts` |
| `@xeon/contracts/services` | `src/services/` | `src/services/index.ts` |

- 패키지는 `xeon/packages/contracts`다. 도메인은 5개이고 서브패스는 7개다. wire-settings 도메인 하나가 서브패스 둘을 만든다. 설정 선언은 X~L4 모두 쓰고 wire는 L4만 쓰기 때문이다(`F.wire-settings.spec` 첫 표). `./services`는 L0·L1 서비스 인터페이스와 X 포트를 확장하는 `McpService`·`GroupService`, `SERVICE_NAMES`(15개)의 모음이다(`F.capabilities.spec` §3.12).
- `package.json`은 다음 모양을 목표로 한다. 각 도메인 plan이 자기 항목을 더한다.

  ```json
  {
    "name": "@xeon/contracts",
    "exports": {
      ".": "./src/index.ts",
      "./conversation": "./src/conversation/index.ts",
      "./records": "./src/records/index.ts",
      "./capabilities": "./src/capabilities/index.ts",
      "./extensions": "./src/extensions/index.ts",
      "./wire": "./src/wire-settings/wire/index.ts",
      "./settings": "./src/wire-settings/settings/index.ts",
      "./services": "./src/services/index.ts"
    },
    "xeon": { "layer": "F", "domain": "contracts" }
  }
  ```

- 루트 진입점 `src/index.ts` [제안]: 공용 기반 이름만 내보낸다. 대상은 `Brand`, `Result`, `ok`, `err`, `Bug`, `assertNever`, `parse`(`eng.typescript.guide` §1.2)와 주입 인터페이스 `Clock`, `Scheduler`, `TimerHandle`, `RandomSource`, `Logger`, `LogLevel`, `LogValue`, `LogFields`다(§8 미결 10 정리). 인터페이스만 두고 구현은 두지 않는다. 정의는 `src/base/`에 두고(`eng.domain-types.guide` DT-12 순서 0) `src/index.ts`는 `src/base/index.ts`를 다시 export한다. 도메인 서브패스는 다시 내보내지 않는다. 루트 import 하나로 모든 도메인이 딸려 오지 않게 하기 위해서다. 도메인 이름(ID, `IdFactory`, 메시지 등)은 항상 서브패스로 import한다.
- [결정] 내부 패키지는 TS 소스를 그대로 export한다. 빌드 산출물을 두지 않는다(`_research/foundation-plan.md` §2 빌드 행).
- `isolatedDeclarations`: `tsconfig.base.json`에 켜져 있다(`_research/foundation-plan.md` §2 언어 행). 그래서 export하는 상수와 함수에 명시 타입 주석이 필요하다. F 문서들은 정적 타입 `X`와 스키마 상수 `XSchema: TUnsafe<X>`(또는 `TObject<…>`) 짝으로 쓴다(`F.conversation.spec` §3 첫 단락, `_research/notes/eng-2.md` §3-3). `satisfies`로는 주석을 대신할 수 없다.
- 도메인 사이 import: 같은 패키지 안이라 상대 경로로 한다. [제안] 순서는 아래 표와 같고, 각 소스 디렉터리는 자기보다 순서가 낮은 것만 import한다(`import type` 포함). 순서가 같은 것끼리는 import하지 않는다.

  | 순서 | 소스 | import하는 것(근거) |
  |---|---|---|
  | 0 | `src/base/` (루트 `.`) | `typebox`만 |
  | 1 | `src/conversation/` | base(`Brand`, `Result`, `Bug`) |
  | 2 | `src/capabilities/` | base, conversation(`ReplayPolicy`, `JsonValue`, 콘텐츠 타입) |
  | 2 | `src/records/` | base, conversation(ID, `ItemRecord`, `PartRecord`, 알림 payload, `ReplayPolicy`) |
  | 3 | `src/extensions/` | base, conversation(ID, 메시지), capabilities(`CapabilityIdSchema`, `SemVerSchema`, `ServiceKey`), records(`ExtensionEventKind`, `DurableEventDraft`) |
  | 4 | `src/wire-settings/settings/` | base, capabilities(`SemVer`, `toJsonSchema`), extensions(`ExtensionManifest`, `import type`). 테스트는 records 정합 확인에 records를 쓴다 |
  | 4 | `src/services/` | base, conversation(ID, pi 재노출), records(`CommitRequest`, `StoreError` 등), capabilities(`ServiceKey`, 모델·도구 값 타입), extensions(`LoopPort`, `InputQueuePort`, `ToolsPort`, `ModelsPort`, `ProcessPort`, `McpPort`, `LeaseArbiterPort`, `PostItem`, `GroupId`). 모두 `import type`이다(`F.capabilities.spec` §3.12) |
  | 5 | `src/wire-settings/wire/` | 위 전부(`EventKind`, envelope, `SettingKey`, `EffectiveSetting` 등) |

  - settings와 services는 같은 순서라 서로 import하지 않는다. wire는 services를 import하지 않는다.
  - capabilities와 records는 서로 import하지 않는다. 둘이 함께 쓰는 `ReplayPolicy`를 conversation에 둔 이유다(`F.conversation.spec` §3.6).
  - records는 settings·extensions보다 낮다. 그래서 `settings.changed`의 `key`·`scope`, scope·lease·post payload는 정본 타입을 import하지 않고 같은 모양을 적는다(`F.records.spec` §3.3).
  - `eng.domain-types.guide` DT-12와 다른 점: DT-12는 settings 1 < conversation 2 < capabilities 3 < records 4 < extensions 5 < wire 6이다. F에서는 settings가 `SemVer`·`toJsonSchema`(capabilities)와 `ExtensionManifest`(extensions)를 쓰므로 settings를 extensions 위에 둔다. capabilities와 records는 같은 순서다. DT-12의 [미결]("F 트랙 스펙과 맞춰야 한다")에 대한 F 쪽 답이 이 표이고, DT-12 표와 `check-layers.ts`의 서브패스 순서 검사는 이 표로 고치도록 요청한다(P2 정합성 검토 ①). settings를 낮은 순위로 되돌리려면 `SemVer`를 base로 옮기고 `settingsFromManifest`를 X로 옮겨야 한다.

## 4. 이름 규칙 모음

| 대상 | 규칙 | 정본 |
|---|---|---|
| 브랜드 ID | `<접두>_<ULID>` 30자. 접두 `thr`, `trn`, `stp`, `itm`, `prt`, `evt`, `efx`, `ckp` | `F.conversation.spec` §3.2 |
| 저장소 ID | `sto_<ULID>`. `IdPrefix`에 넣지 않는 저장소 정체성 부류 | `F.wire-settings.spec` §3.4.1, `F.conversation.spec` §3.2.1 |
| 도메인 지역 ID | `<세 글자>_<ULID>`(`LocalIdPrefix`, `LOCAL_ID_PREFIXES` 표). 순번·해시형 ID는 접두 없음 | `F.conversation.spec` §3.2.1 |
| 멱등 키 `requestId` | 브랜드 없는 문자열(1~64자). `RequestId` 타입 이름은 두지 않는다. wire의 JSON-RPC id는 `RpcId`다 | `F.conversation.spec` §3.5, `F.wire-settings.spec` §3.0 |
| 스키마 상수 | 타입 `X`, 스키마 `XSchema` | `F.conversation.spec` §3 |
| 이벤트 kind | 코어 `<영역>.<이름>`(snake_case, 점 하나). 내장 L2 도메인 `<도메인 영역>.<이름>`(`DomainArea`: `work`, `dialog`, `artifact`, `schedule`). 확장 `x.<extId>.<영역>.<이름>`, 의도 그룹 `grp.<groupId>.<영역>.<이름>`(`ExtensionEventKind`) | `F.records.spec` §3.2, §3.3.2 |
| 그룹 레코드 kind, 커스텀 메시지 `customType` | 확장 이벤트 kind와 같은 형식(`RecordKind` = `ExtensionEventKind`). 예: `grp.learning.skill.proposed` | `F.extensions.spec` §3.6, `F.conversation.spec` §3.5.2 |
| 확장 이름 | `^[a-z][a-z0-9-]{1,31}$`(`ExtensionName`, 소문자·숫자·하이픈, 밑줄 없음). 매니페스트 `kind`는 `plugin` 또는 `group`. 확장 테이블 접두는 `x_<이름의 하이픈을 밑줄로>_`이고 지역 테이블 이름에는 밑줄을 쓰지 않는다 [결정: review.decisions-2 U-18] | `F.extensions.spec` §3.1 |
| 확장 지점 이름 | 자체 규칙 `<종류>.<대상>[.<시점>]`(예: `tool.call.before`, `boundary.step.before`)이고 pi 이름은 별칭 없이 대응 열에만 남긴다 [결정: adr.0017]. 46종, 지점 종류 input·request·tool·boundary·session·lifecycle·guard. fold는 tap, first, chain, collect. 실패 정책은 지점 선언의 `failure` 필드 | `F.extensions.spec` §3.3~§3.4 |
| 능력 id | `<도메인>.<이름>` 소문자·하이픈, 2~4마디(예: `web.search`) | `F.capabilities.spec` §3.1 |
| 도구 이름 | 내장 능력 작성 규칙 `^[a-z][a-z0-9_]{0,63}$`, 확장 도구 `<확장 이름>__<이름>`, 허용 문자 `^[a-zA-Z0-9_-]{1,64}$`. 표시 제목은 `label` | `F.capabilities.spec` §3.1, §3.3 |
| wire 메서드 | `<영역>.<동사>` 소문자 낙타, `$/` 제어 예약, 확장은 `ext.<id>.<동사>`(M2 이후) | `F.wire-settings.spec` §3.2 |
| 설정 키 | `<층>.<도메인>.<이름>`(층은 `f`, `x`, `l0`~`l4`), 확장·외부 그룹은 `ext.<name>.<이름>`. 확장 공통 키 `ext.<name>.enabled`, `ext.<name>.isolation`, drive 상한 `x.primitives.driveDefaultLimits`(기본값)·`x.primitives.driveLimits`(천장) | `F.wire-settings.spec` §3.8.1, §3.8.3, `F.extensions.spec` §6 |
| 비밀 참조 | `secret://<name>`, name은 `[a-z][a-z0-9-]{1,63}`(`SECRET_REF_PATTERN`) | `F.capabilities.spec` §3.10(정본), `F.wire-settings.spec` §3.8.1(재노출), `_research/secrets.md` §6.1 |

확장 접두가 두 가지인 이유: 기록 쪽 이름(이벤트 kind, 그룹 레코드 kind, `customType`)은 `x.`/`grp.`로 확장과 그룹을 나눈다. 설정 키에서 `x.`는 X 층 코어 키와 겹치므로 설정 키, wire 메서드, wire 오류 kind는 확장과 외부 그룹 모두 `ext.<id>.`를 쓴다(`F.wire-settings.spec` §3.8.1, §3.5.3). 도구 순서 키의 능력 자리도 확장 도구는 `ext.<확장 이름>`이다(`F.capabilities.spec` §4.5). 대응은 `x.<id>.…`(기록) ↔ `ext.<id>.…`(설정·메서드)다.

### 4.1 대화 계층 용어

| Xeon | 뜻 | pi 대응 |
|---|---|---|
| thread | 대화 하나. 분기 트리 포함 | 세션 파일 하나 |
| turn | 사용자 입력 하나에 대한 작업 전체 | run(`boundary.turn.before`~`boundary.turn.after`) |
| step | 모델 응답 1회와 그 도구 결과 묶음. 체크포인트 단위 | turn(`boundary.step.before`~`boundary.step.after`) |
| item | 입출력 단위(메시지, 도구 호출, 도구 결과) | message, tool_execution |
| part | 어시스턴트 메시지 블록 하나의 id 레코드 | `contentIndex` |

[결정: review.decisions-2 U-01] pi turn = Xeon step이다. 지점 이름은 pi 이름을 그대로 쓰므로 `boundary.step.before` 지점은 Xeon step 경계에서 발화한다. 켜기·끄기와 drive 임대 교대의 적용 시점은 "단계 경계"(step 종료 직후, 도구 결과 커밋 뒤)로 쓴다(`F.conversation.spec` §2.1).

### 4.2 대표 타입

| 이름 | 종류 | 도메인 |
|---|---|---|
| `ThreadId`, `TurnId`, `StepId`, `ItemId`, `PartId`, `EventId` | 브랜드 ID | conversation |
| `IdFactory`, `LocalIdFactory`, `LocalIdPrefix` | 발급 인터페이스(구현은 L0·L1)와 지역 ID 접두 | conversation |
| `Clock`, `Scheduler`, `RandomSource`, `Logger` | 주입 인터페이스(구현은 `platform-os`) | base(루트) |
| `Message`, `AssistantMessageEvent`, `AgentTool`, `AgentToolResult`, `AgentEvent` | pi 타입 재노출 | conversation |
| `MessageSchema`, `AgentMessageSchema` | 런타임 스키마 | conversation |
| `PartRecord`, `PartDelta`, `assignPartIds` | 파트 | conversation |
| `LifecycleEvent`, `ItemRecord`, `ToolResultRecord`, `ResultStatus` | 계층·결과 | conversation |
| `ReplayPolicy`, `toReplayPolicy` | 재생 정책(records가 재export) | conversation |
| `EventEnvelope`, `DurableEventEnvelope`, `VolatileEventEnvelope` | 이벤트 envelope | records |
| `EventKind`, `ExtensionEventKind`, `parseEventKind`, `CORE_EVENT_CATALOG` | kind와 카탈로그 | records |
| `BlobRef`, `DetachedField` | 큰 값 분리 | records |
| `DurableEventDraft`, `decideEffectRecovery`, `StepCheckpoint`, `upcastEvent` | 초안·효과 복구·체크포인트·마이그레이션 | records |
| `StoreDb`, `SqlTx`, `StoreService`, `CommitRequest`, `SessionService`, `Projector` | 저장·투영 포트 | records |
| `TaskService`, `LoopService`, `ModelService`, `ToolService`, `ApprovalService`, `AgentService`, `ContextService`, `ExecService`(`ExecutionEnv` 확장), `SandboxService`, `ProcessService`, `OsService`, `SecretService`, `SecretAdminService`, `McpService`, `GroupService`, `SERVICE_NAMES` | L0·L1 서비스 인터페이스, X 포트를 확장하는 `McpService`·`GroupService`, 서비스 이름 상수 | services(`./services`) |
| `CapabilityDef`, `MethodDef`, `ToolSpec`, `defineCapability` | 능력 정의 | capabilities |
| `ServiceKey`, `serviceKey`, `ApiOf` | 서비스 키 | capabilities |
| `CapabilityError`, `CapabilityErrorData`, `validateCapability`, `orderTools`, `toJsonSchema` | 오류·검증·순서 | capabilities |
| `CallOptions`, `CallContext`, `SecretRef`, `SecretName`, `SecretRefError`, `parseSecretRef`, `ProviderSelectionMeta`, `orderProviderCandidates` | 호출 문맥·비밀 참조·provider 선택 | capabilities |
| `SemVer`, `SemVerSchema` | 버전 문자열 | capabilities |
| `ExtensionManifest`, `ExtensionManifestSchema`, `ExtensionName`, `defineManifest`, `validateManifest` | 확장 매니페스트 | extensions |
| `POINTS`, `PointName`, `PointDecl`, `Handler`, `FIRST_DENY`, `CHAIN_RULES` | 지점 선언 표와 fold 규칙 | extensions |
| `ExtensionOps`, `DriveLease`, `ScopeApi`, `PostItem` | 4연산 타입 | extensions |
| `PortKey`, `PortLookup`, `LoopPort`, `InputQueuePort`, `ProjectorRegistryPort`, `ScopedStorePort`, `ProcessPort`, `HookProcessPort`, `LeaseArbiterPort`, `ToolsPort`, `ModelsPort`, `McpPort`, `LoaderFs`, `LoaderPaths`, `TrustStoreBackend`, `TrustPrompter`, `RecordCommitPort`(재노출) | X 호스트 포트와 로더 포트(`ports.ts`, `F.extensions.spec` §3.2.1) | extensions |
| `GroupRecord`, `RecordKind`, `RecordKindDecl` | 그룹 간 레코드 | extensions |
| `JsonRpcRequest`, `JsonRpcMessage`, `RpcId`, `checkEnvelope` | JSON-RPC envelope | wire |
| `WireMethodMap`, `WIRE_METHODS`, `WireParams`, `WireResult` | 메서드 레지스트리 | wire |
| `HostConnection`, `Transport`, `WireHandlers` | 연결과 전송 | wire |
| `StreamPosition`, `EventWire`, `VolatileEventWire`, `WireErrorData`, `WIRE_PROTOCOL_VERSION` | 커서·이벤트·오류·버전 | wire |
| `SettingDef`, `defineSettings`, `SettingScope`, `EffectiveSetting`, `resolveSetting`, `settingsJsonSchema` | 설정 | settings |


## 5. 소비 지도

| 소비 층·도메인 | 주로 쓰는 F 도메인 | 대표 이름 |
|---|---|---|
| X `ext-host` | extensions, records, capabilities, settings | `ExtensionManifest`, 지점 선언 표, 호스트 포트(`ports.ts`), `EventKindRegistration`, `ServiceKey`, `settingsFromManifest`, `buildCatalog` |
| L0 `platform-store` | records, conversation | `DurableEventEnvelopeSchema`, `CORE_EVENT_CATALOG`, `StepCheckpointSchema`, `BlobRef`, ID 타입, `StoreDb`·`SqlTx`·`StoreService` |
| L0 `platform-os` | base(루트), conversation | `Clock`, `Scheduler`, `RandomSource`, `Logger`, `IdFactory`, `LocalIdFactory` |
| L0 `platform-secrets` | capabilities, services | `SecretRef`, `SECRET_REF_PATTERN`, `SecretName`, `SecretNameSchema`, `parseSecretRef`, `SecretRefError`, `SecretService`, `SecretAdminService`, `SecretMeta`, `SecretUsePolicy`, `SecretAuditRecord`(review.decisions-2 U-08) |
| L1 `core-loop` | conversation, records, extensions | `AgentEvent`, `LifecycleEvent`, `PartDelta`, 효과 3단, 지점 이름 |
| L1 `core-tools` | capabilities, conversation, records | `ToolSpec`, `AgentToolResult`, `ResultStatus`, `ReplayPolicy` |
| L1 `core-persistence` | records, settings | `upcastEvent`, 재개 규칙, `resolveSetting` |
| L1 `core-context`, `core-models` | capabilities, conversation | `orderTools`, `toolsetFingerprint`, `Message` |
| L2 `cap-*` | capabilities | `CapabilityDef`, `defineCapability`, `CapabilityError` |
| L3 `group-kit`, `group-helm`, `group-learning` | extensions, capabilities, records | 매니페스트, 지점, `ServiceKey`, `grp.*` kind |
| L4 `apps/host`, `apps/cli`, `apps/desktop` | wire, settings | `HostConnection`, `WireHandlers`, `WIRE_METHODS`, `EventWire`, `checkSettingWrite` |
| L4 설정 화면 | settings | `SettingDefWire`, `SettingsTab`, `EffectiveSetting` |
| L0·L1 서비스 구현과 소비(L1~L4 `core-*`, `cap-*`, `group-*`, `apps/*`) | services | 서비스 인터페이스와 서비스 이름 상수(`F.capabilities.spec` §3.12). 구현 패키지는 인터페이스를 구현하고, 소비 쪽은 구현 패키지를 import하지 않고 이 인터페이스로 주입받는다 |
| 모든 층의 설정 선언 | settings | `defineSettings`, `SettingDef` |

## 6. 층 경계

F가 정하지 않는 것:

| 대상 | 정하는 곳 |
|---|---|
| 확장 로딩, 신뢰 등급, 4연산(on, post, drive, scope)의 실행 | X(`X.loading-trust.spec`, `X.primitives.spec`, `X.operations.spec`) |
| 저장 구현(테이블, DDL, PRAGMA, 잠금, blob 파일, seq 발급) | `L0.store.spec`, `L1.persistence.spec` |
| ID 발급 구현(시계, 난수, ULID 단조성) | L0·L1 |
| 도구 실행, 권한, 승인 프로토콜 | `L1.tools.spec` |
| 능력 provider 구현과 선택 | 각 `L2.<domain>.spec` |
| 설정 키 카탈로그(어떤 키가 있는지) | 각 층 spec의 "설정 노출" 절. F 자신의 키는 없다 |
| 전송 구현, 메서드 처리기, 설정 파일 위치·읽기 | L4(`L4.host-service.spec`, `L4.cli.spec`, `L4.desktop.spec`) |
| 설정 화면과 UI | `L4.settings-ui.spec` |

변경 규칙:

- F 변경은 모든 층에 영향이 있다. 변경은 `F.wire-settings.spec` §3.7의 버전 정책(semver, 상태 Active·Deprecated·Removed, 폐기 기간)을 따른다.
- 이름을 바꾸거나 지울 때는 F 문서를 먼저 고치고, 소비 층 문서와 코드를 같은 변경에서 고친다. 이벤트 kind는 이름을 바꾸지 않고 `version`과 업캐스터로 진화한다(`F.records.spec` §3.2 규칙 5).
- 문서 표와 코드 표의 일치 검사가 있다. 이벤트 카탈로그(`check-event-catalog.ts`, `F.records.plan`), 지점 선언 표(`check-points-doc.ts`, `F.extensions.plan` E9), wire 메서드 표(`F.wire-settings.plan` W15).

## 7. 결정 근거

| 결정 | 근거 |
|---|---|
| [결정] pi-ai provider와 타입은 그대로 쓰고 부족분만 포크한다. F는 pi 타입을 재노출만 한다 | `_research/decisions-log.md` 2026-10-21 결정(2차), `_research/foundation-plan.md` §2 모델·루프 행 |
| [결정] 스키마는 TypeBox 하나로 쓰고 JSON Schema와 TS 타입의 단일 원천으로 삼는다 | `_research/foundation-plan.md` §2 스키마 행, `_research/layer-plan-v2.json` F3 도구 스키마 |
| [결정] 세션 저장은 C안이다. SQLite 이벤트 소싱 + 투영, 단일 DB, 확장 접두사 테이블 | `_research/decisions-log.md` 2026-10-21 결정(2차) |
| [결정] 확장 지점은 on(fold tap/first/chain), post, drive(배타 임대), scope 4연산이다 | `_research/decisions-log.md` 2026-10-21 계획 v2 |
| [결정] DI는 Cordis 하나다. F는 Cordis를 import하지 않는다 | `_research/decisions-log.md` 2026-10-21 결정(3차), `_research/foundation-plan.md` §1 1번 |
| [결정] 호스트 계약은 하나이고 전송만 바꾼다(CLI in-process, 데스크톱 stdio) | `_research/foundation-plan.md` §1 3번, `_research/decisions-log.md` 2026-10-21 계획 v2 |
| [결정] 모든 설정은 F5 스키마 하나에서 화면·파일·명령을 만든다 | `_research/layer-plan-v2-notes.md` 층 사이 규칙 6 |

## 8. 미결 사항

하위 spec의 미결 가운데 층 전체에 걸리는 것만 모은다. 세부와 선택지는 각 spec의 "미결 사항" 절에 있다.

1. [결정: review.decisions-2 U-01] 용어: pi turn = Xeon step, pi run = Xeon turn(`F.conversation.spec` §10 1번). scope 켜기·끄기와 drive 임대 교대는 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에 적용한다(`F.extensions.spec` §4.5). 사용자 확인 대상이다.
2. [미결] boundary fold: `F.extensions.spec`은 fold 3종을 유지하고 chain 교체 + `finalize` 표지로 표현하자고 제안한다. 4번째 fold(collect)나 지점별 예외 표를 둘지 결정이 필요하다(`F.extensions.spec` §4.1, §10, `_research/notes/F-1.md` §3).
3. [미결] Cordis 선언 병합을 F, X 중 어디서 할지(`F.capabilities.spec` §3.5 A·B·C안).
4. [미결] 설정 우선순위 표: 관리 > 세션 > 로컬 > 프로젝트 > 사용자 > 기본값 제안과 관리 기본값 여부(`F.wire-settings.spec` §4.7).
5. [결정: review.decisions-2 U-02] 승인 요청 방향은 A안(내구 이벤트 `approval.requested` + 호스트 메서드 `approval.respond`)이다(`F.wire-settings.spec` §4.6). `F.records.spec` §3.3.1 코어 카탈로그의 승인 kind가 이 결정을 따른다. 사용자 확인 대상이다.
6. [미결] 재생 정책 이름: `safe|unsafe`와 F `AgentTool.replay`의 `never|safe` 통일(`F.records.spec` §10 미결 4). 정의 위치는 `F.conversation.spec` §3.6이다.
7. [결정: review.decisions-2 U-24] TypeBox 버전은 1.3.27(catalog 정확 고정)이다. pi-ai가 고정한 판과 같다.
8. [결정: M2 마감 G5-03] ULID 단조성은 L0 `IdFactory` 구현이 지킨다(`F.conversation.spec` §10 3, `F.records.spec` §10 3).
9. [미결] `UserConfigEntry`에 값 스키마 필드를 둘지(`F.wire-settings.spec` §10 미결 8). 확장 설정 키 접두는 `ext.<name>.`로 맞췄다. 예전 제안 키 `extensions.<name>.enabled`, `extensions.<name>.isolation`, `groups.drive.limits`는 키 문법에 맞지 않아 `ext.<name>.enabled`, `ext.<name>.isolation`, `x.primitives.driveLimits`로 바꿨다(`F.extensions.spec` §6, `F.wire-settings.spec` §3.8.3).
10. [결정: review.decisions-2 U-03] 시계·난수·로그 인터페이스와 테스트 대역의 위치는 (a)안이다. `L0.os`, `L0.store`, `L0.process`, `L4.host-service`가 이미 루트 import를 전제하고, X는 순위상 L0를 import할 수 없어 (b)안은 성립하지 않는다. 루트 base(`src/base/`)에 `Clock`, `Scheduler`, `TimerHandle`, `RandomSource`, `Logger`, `LogLevel`, `LogValue`, `LogFields` 인터페이스만 둔다. 모양은 `eng.typescript.guide` §1.2와 `L0.os.spec` §3.5 초안을 따른다. `IdSource`·`Random`(`eng.best-practices.guide` BP-05)은 `IdFactory`·`RandomSource`로 읽는다. `IdFactory`는 루트가 아닌 `./conversation` 서브패스다. `./testing` 서브패스는 두지 않는다. `createIdFactory`는 F에 두지 않고 `platform-os`에 둔다. 테스트 대역(`manualClock`, `seededRandom`, `fixedIdFactory`)은 각 패키지 `test/` 안에 둔다(§1). 이 정리에 맞춰 고칠 소비 문서: `eng.typescript.guide` §1.2("createIdFactory는 contracts base"), `eng.testing.guide`의 import 경로, `L0.os.spec` §3, `L0.readme` §9 미결 3, `L4.host-service.spec` §3.1(`IdFactory` import 경로).

## 9. M2 요청 창구 처리 기록

`review.m2-plan` §4.2는 F.2~F.6이 병합된 뒤 F 레인을 요청 창구로 둔다. 병합 뒤 모인 요청을 한 묶음(F.8)으로 처리했고, 본문에는 `[결정: m2 F.8]`로 표시했다.

| 처리한 요청 | 위치 |
|---|---|
| `ApprovalService.open`·`wait`·`get`(`L1.tools.spec` §8.3 11) | `F.capabilities.spec` §3.12 `services/approvals.ts` |
| `CallOptions.continuation`과 `McpQuestion` → `QuestionBody` 규칙(§8.3 12) | `F.capabilities.spec` §3.2, §3.9 `defs/mcp-questions.ts` |
| `CallContext.approval`(§8.3 13)과 `CallContext.interactive`(`L2.dialog.spec` D-3 2) | `F.capabilities.spec` §3.2 |
| `ToolService.suspendWhile`(§8.3 14) | 이미 반영됨(`M2 검토 3`). 이번 묶음에서 바꾼 것 없음 |
| `LoopService.runUserBash`, `TurnUpdatedPayload.notice`(`L1.loop.spec` FR-L5) | `F.capabilities.spec` §3.12 `services/loop.ts`, `F.conversation.spec` §3.5 |
| `$/connectionReset` 동작과 `HostConnection.notify` | `F.wire-settings.spec` §3.1, §4.1 5~7번 |
| `approval.respond`의 `answer` 정본 모양(`QuestionAnswer`, `{ mode?, note? }`, `{ feedback }`) | `F.wire-settings.spec` §3.3.1, `F.records.spec` §3.3.1 |
| 런타임 중립 `createHostConnection`, JSON Lines stdio 전송 | `F.wire-settings.spec` §3.1 |
| `QuestionItem.header`, `QuestionOption.recommended`(`L2.dialog.spec` D-3 3) | `F.records.spec` §3.3.1 |
| `SkillFilePathSchema` 패턴 좁히기(`L2.knowledge.spec` KN.1) | `F.capabilities.spec` §3.9 |
| `ModelService.hostedSearch` 필수화(`L2.web.plan` WEB.6) | `F.capabilities.spec` §3.12 `services/models.ts` |
| `AgentServicePortKey`, `LoopServicePortKey` | `F.capabilities.spec` §3.12 규칙 9 |

받지 않고 남긴 요청은 소유 문서에 [미결]로 남아 있다: 동적 MCP 도구의 연속 정보와 `input_required` 질문 목록(`L2.mcp.plan` MCP.4), 부모 쓰기 토큰 조회(`L1.agents.spec` §4.1), `ChildTurnRequest`의 `tools.deny`, `ThreadLifecycle.list`·`SessionSettingsStore.layer`의 `Result`화, 투영 재구성 실패 변형, 설정 쓰기의 키 재사용 값 변환, 자식 생성 때 부모 초안을 같은 커밋에 싣는 자리.

## 10. M2 마감 요청 처리 기록

`review.m2-plan`의 M2 마감 재점검(T1 F 계약)에서 모인 요청을 처리했다. 본문에는 `[결정: m2c <항목>]`로 표시했다. 항목 번호는 재점검 보고서의 통합 항목이다.

| 항목 | 처리한 요청 | 위치 |
|---|---|---|
| G1-08 | U-04 호스트 계약 요청 판정표, 서버 알림 `settings.invalidated` | `F.wire-settings.spec` §3.3.2, §3.3.4 |
| G1-01 | `command.list`, `command.run`, `command.list`의 선택 params `threadId` | `F.wire-settings.spec` §3.3.1 |
| G2-07 | `host.status`의 선택 params `includeBinaries`와 결과 `binaries`(외부 바이너리 점검) | `F.wire-settings.spec` §3.3.1 |
| G1-02 | `turn.resume` | `F.wire-settings.spec` §3.3.1 |
| G1-03 | `trust.get`, `trust.decide`, `session.trust.before`의 `threadless` 표시 | `F.wire-settings.spec` §3.3.1, `F.extensions.spec` §3.4, §7 |
| G1-07 | `secret.references`, `secret.test` 결과 확장, `secret.*` 오류 kind 3201~3212, `thread.closed` 3007 | `F.wire-settings.spec` §3.3.1, §3.5.2 |
| G1-09 | 승인 origin 필드별 공급 규칙, `ApprovalCaller`와 `approvalCallerOf`, `CallerInfo.agentName`, 직접 등록 도구의 호출 문맥, `approval.respond` 결과의 `reason` | `F.records.spec` §3.3.1, `F.capabilities.spec` §3.2, §3.12, `F.wire-settings.spec` §3.3.1 |
| G1-11 | 승인 만료 계약 필드 `expiresAt`, `onExpire`, 해결자 `expired`(구현은 M3) | `F.records.spec` §3.3.1, `F.capabilities.spec` §3.12 |
| G2-11 | `thread.read`의 fork 연속성 규칙(`before`·`limit`은 이미 있었다) | `F.wire-settings.spec` §3.4.6 |
| G2-12 | `thread.rename` | `F.wire-settings.spec` §3.3.1 |
| G2-01 | `thread.compact`, `thread.compactFailed` 3008, `thread.cancelledByExtension`의 `session.compact.before` | `F.wire-settings.spec` §3.3.1, §3.5.2 |
| G5-04 | `SettingDef.stage`, `settings.reserved` 3106, `settings.list`의 `includeReserved` | `F.wire-settings.spec` §3.8.2 |
| G2-06 | 저장소 열기 실패 분류(`future_version`, `corrupt`, `migration_failed`, `unavailable`), `store.corrupt` 5007 | `F.records.spec` §3.7, `F.wire-settings.spec` §3.5.2 |

받지 않고 M3로 넘긴 요청: 판정표(`F.wire-settings.spec` §3.3.4)의 보류 항목, `SecretEntryOffer`의 `add`용 메타 일부 필드, `status.list`와 첨부(G1-01), 도구 메타 `risk`·`hints`·`caller`와 효과 목록(G1-05, G1-06).
