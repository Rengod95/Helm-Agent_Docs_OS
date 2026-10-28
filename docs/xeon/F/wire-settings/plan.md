---
id: F.wire-settings.plan
layer: F
domain: wire-settings
kind: plan
status: draft
depends_on: [F.wire-settings.spec, F.conversation.plan, F.records.plan, F.capabilities.plan, F.extensions.plan]
binds: [xeon/packages/contracts/src/wire-settings/**]
---

# F 연결·설정 계약 구현 계획 (wire-settings)

`F.wire-settings.spec`을 코드로 옮기는 계획이다. 코드는 `xeon/packages/contracts/src/wire-settings/`에 두고 서브패스 `@xeon/contracts/wire`, `@xeon/contracts/settings`로 내보낸다. F에는 타입, 스키마, 순수 함수만 둔다. 전송 구현과 설정 파일 입출력은 L4·L1 몫이다.

## 1. 목표와 마일스톤 배치

### 1.1 M0: 계약 골격

- JSON-RPC envelope 스키마(`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcSuccess`, `JsonRpcFailure`, `JsonRpcMessage`)와 `checkEnvelope`, `WIRE_LIMITS`.
- 메서드 이름 규칙(`METHOD_NAME_PATTERN`, `classifyMethodName`).
- 메서드 레지스트리 타입(`WireMethodMap`, `WireMethodName`, `WireParams`, `WireResult`, `WIRE_METHODS`, 알림 표). 스펙 §3.3.1 표의 M1·M2 메서드 스키마 전부를 둔다. 스키마는 M0에 모두 쓰고, 구현 단계 구분은 `stage` 필드로 표시한다.
- 커서(`Seq`, `StoreId`, `StreamPosition`, `SubscribeFrom`, `EventFilter`, 구독 params/result, `EventsBatchParams`)와 `EventWire`, `VolatileEventWire`, `toEventWire`, `toVolatileEventWire`.
- 오류 객체(`WireErrorData`, `JsonRpcError`)와 M1 오류 표(`WIRE_ERRORS`의 M1 항목).
- `Transport`, `HostConnection`, `WireHandlers`, `WireRequestContext` 인터페이스와 전송 팩토리 3종의 타입.
- 버전(`WIRE_PROTOCOL_VERSION`, `FeatureStatus`, `FeatureInfo`, `isCompatible`). `SemVer`는 `F.capabilities.spec`의 것을 쓴다.
- `SettingDef`, `SettingDefWire`, `checkSettingDef`, `defineSettings`, `buildCatalog`, `settingsFromManifest`.
- 계층 병합 타입(`ScopeLayer`, `ScopeStack`, `SCOPE_PRECEDENCE`, `EffectiveSetting`, `SettingSource`)과 순수 함수 `resolveSetting`, `checkSettingWrite`, `validateSettingValue`.
- `settingsJsonSchema`.

### 1.2 M1: `xeon chat` 걸어 다니는 골격

- F 쪽 추가 작업은 전송 적합성 케이스 목록(`WIRE_CONFORMANCE_CASES`)을 M1 메서드(`host.hello`, `thread.create`, `turn.start`, `events.subscribe`, `settings.get`)와 알림(`events.batch`, `stream.chunk`, `$/cancelRequest`)으로 채우는 것이다.
- 소비자가 이 계약으로 구현하는 것(이 plan의 범위 밖):
  - `xeon/apps/host`(L4 엔진 진입점): in-process 전송 쌍과 M1 메서드 처리기. `L4.host-service.plan`.
  - `xeon/apps/cli`: `HostConnection`으로 `xeon chat` 한 턴. `L4.cli.plan`.
  - `xeon/apps/desktop`: stdio 전송. M1에서는 스캐폴드와 적합성 스위트 통과까지만. `L4.desktop.plan`.
  - 각 층 패키지: `defineSettings`로 자기 키 선언. 각 층 plan.

### 1.3 M2 이후

- 서비스 소켓 전송 계약 확정(`SocketTransportOptions`의 인증 필드, 스펙 미결 4).
- 오류 코드 구간 표(스펙 §3.5.3)를 `WIRE_ERRORS`에 반영하고 구간 검사 함수를 더한다.
- `_meta`(`WireMeta`)와 `traceparent` 직렬화 함수, `@opentelemetry/api` 1.10.0 타입 의존.
- 확장 wire 메서드(`ext.<id>.<동사>`) 등록 형식(스펙 미결 5가 풀린 뒤).
- 승인 메서드 `approval.respond` 구현. 방향은 A안이다(스펙 §4.6, review.decisions-2 U-02).
- 판정하지 않은 호스트 계약 요청(스펙 §10 10번)을 하나씩 받을지 반려할지 정한다. M1에는 넣지 않는다(review.decisions-2 U-04).

### 1.4 소비자

| 소비자 | 경로 | 쓰는 것 | 시작 단계 |
|---|---|---|---|
| L4 엔진 진입점 | `xeon/apps/host` | `WireHandlers`, `Transport`, `checkEnvelope`, `WIRE_METHODS`, `WIRE_ERRORS`, `toEventWire`, `resolveSetting`, `checkSettingWrite` | M1 |
| L4 CLI | `xeon/apps/cli` | `HostConnection`, 알림 타입, `checkSettingWrite`(`xeon config`) | M1 |
| L4 데스크톱 | `xeon/apps/desktop` | `HostConnection`, `StdioTransportFactory` 타입 | M1(스캐폴드) |
| L4 설정 화면 | `xeon/packages/client/src/settings`(view-model), `xeon/apps/desktop/src/views`(렌더러) | `SettingDefWire`, `SettingsTab`, `EffectiveSetting` | M2 |
| X 로더 | `xeon/packages/ext-host` | `settingsFromManifest`, `buildCatalog` | M1 |
| 각 층 설정 선언 | `xeon/packages/{platform,core,cap,group}-*` | `defineSettings`, `SettingDef` | M1 |

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/
  package.json                       # exports에 "./wire", "./settings" 추가
  src/wire-settings/
    wire/
      jsonrpc.ts        # envelope 스키마, WIRE_LIMITS, checkEnvelope, WireMeta(M2), Obj 도우미(비공개)
      methods.ts        # METHOD_NAME_PATTERN, classifyMethodName, 메서드별 params/result 스키마, WireMethodMap, WIRE_METHODS
      notifications.ts  # EventsBatchParams, StreamChunkParams, CancelRequestParams, EventWire, VolatileEventWire, IsoTime,
                        # toEventWire, toVolatileEventWire, 알림 표
      cursor.ts         # Seq, StoreId, StreamPosition, SubscribeFrom, SubId, EventFilter, 구독 params/result, ReplayOutOfRangeReason
      errors.ts         # WireErrorData, JsonRpcError, WireErrorSpec, WIRE_ERRORS, WireError 클래스
      transport.ts      # TransportKind, Transport, HostConnection, WireRequestContext, WireHandlers, 팩토리 타입
      version.ts        # WIRE_PROTOCOL_VERSION, FeatureStatus, FeatureInfo, isCompatible (SemVer는 capabilities/ids.ts)
      conformance.ts    # WIRE_CONFORMANCE_CASES (데이터만. 실행기는 테스트 쪽)
      index.ts
    settings/
      def.ts            # SettingKey, SETTING_KEY_PATTERN, SettingScope, RuntimeChange, SettingLayer, SecretRef(capabilities/secrets.ts 재노출),
                        # SettingsTab, SettingWidget, SettingUi, SettingRange, SettingDeprecation, SettingDef, SettingDefWire, checkSettingDef
      define.ts         # SettingNamespace, SettingDefInput, SettingGroup, defineSettings, SettingCatalog, CatalogIssue,
                        # buildCatalog, settingsFromManifest, SettingDefError
      layers.ts         # SCOPE_PRECEDENCE, ScopeLayer, ScopeStack
      effective.ts      # SettingSource, EffectiveSetting, resolveSetting, checkSettingWrite, WriteCheck, validateSettingValue
      jsonschema.ts     # SettingsJsonSchemaOptions, JsonSchemaDocument, settingsJsonSchema
      index.ts
  test/wire-settings/
    jsonrpc.test.ts  method-name.test.ts  cursor.test.ts  notifications.test.ts  methods.type-test.ts  errors.test.ts  version.test.ts
    setting-def.test.ts  define.test.ts  layers.test.ts  jsonschema.test.ts  conformance-runner.ts
```

`package.json`의 exports 계획(다른 F 도메인 서브패스와 함께):

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./wire": "./src/wire-settings/wire/index.ts",
    "./settings": "./src/wire-settings/settings/index.ts"
  },
  "xeon": { "layer": "F", "domain": "contracts" }
}
```

- [결정] 내부 패키지는 TS 소스를 그대로 export한다(`_research/foundation-plan.md` §2 빌드 행).
- [제안] `wire/`는 `settings/`를 import할 수 있다(`settings.*` 메서드 스키마가 `SettingKey`, `EffectiveSetting`을 쓴다). 반대 방향은 금지한다. 설정만 쓰는 층이 wire를 끌어오지 않게 하기 위해서다. 검사는 W13의 import 검사로 한다.
- `wire/`는 `../../records/`, `../../conversation/`, `../../capabilities/`의 스키마를 상대 경로로 import한다. `settings/jsonschema.ts`는 `../../capabilities/`의 `toJsonSchema`를 쓴다. `settings/define.ts`는 `../../extensions/`의 `ExtensionManifest` 타입을 `import type`으로 쓴다.
- 루트 `src/index.ts`는 서브패스를 다시 내보내지 않는다 [제안]. 루트 import가 모든 도메인을 끌어오지 않게 하기 위해서다. 루트 진입점의 내용은 `F.readme`가 정한다.

## 3. 작업 분해

규모: S(반나절 이하), M(1일), L(2~3일).

| id | 내용 | 파일 | 선행 | 규모 | 단계 |
|---|---|---|---|---|---|
| W1 | JSON-RPC envelope 스키마, `WIRE_LIMITS`, `checkEnvelope`(배치·깊이·배열 길이·스키마 검사) | `wire/jsonrpc.ts` | 없음(`Seq`·`StoreId`는 W4가 만든다. 스펙 §3.4.1) | M | M0 |
| W2 | 메서드 이름 규칙 `METHOD_NAME_PATTERN`, `classifyMethodName` | `wire/methods.ts` | 없음 | S | M0 |
| W3 | 버전: `WIRE_PROTOCOL_VERSION`, `FeatureStatus`, `FeatureInfo`, `isCompatible` | `wire/version.ts` | F.capabilities.plan의 `SemVerSchema` 작업 | S | M0 |
| W4 | 커서와 구독: `Seq`, `StoreId`, `StreamPosition`, `SubscribeFrom`, `EventFilter`, 구독 params/result, `EventsBatchParams` | `wire/cursor.ts` | W1, F.conversation.plan C1(`ThreadIdSchema`) | S | M0 |
| W5 | `EventWire`, `VolatileEventWire`, `toEventWire`(redact 포인터 처리), `toVolatileEventWire`, `StreamChunkParams`, `CancelRequestParams`, 알림 표 | `wire/notifications.ts` | W4, F.records.plan의 envelope·`EventKindSchema`·`DetachedFieldSchema` 작업 | M | M0 |
| W6 | 오류: `WireErrorData`, `JsonRpcError`, `WireError` 클래스, `WIRE_ERRORS`(M1 항목) | `wire/errors.ts` | W1 | S | M0 |
| W7 | `SettingDef` 계열 스키마와 `checkSettingDef`(규칙 D1~D8) | `settings/def.ts` | W3 | M | M0 |
| W8 | `defineSettings`, 키 네임스페이스 검사, `buildCatalog`(D9, 중복, 침범), `settingsFromManifest` | `settings/define.ts` | W7, F.extensions.plan의 `ExtensionManifest.userConfig` | M | M0 |
| W9 | 계층 병합: `SCOPE_PRECEDENCE`, `ScopeLayer`, `EffectiveSetting`, `resolveSetting`, `checkSettingWrite`, `validateSettingValue` | `settings/layers.ts`, `settings/effective.ts` | W7, W8 | M | M0 |
| W10 | JSON Schema 출력 `settingsJsonSchema`(2020-12, 범위별 필터, `x-xeon`, 결정적 출력) | `settings/jsonschema.ts` | W7, W8, F.capabilities.plan의 `toJsonSchema` | M | M0 |
| W11 | 레지스트리: 메서드별 params/result 스키마, `WireMethodMap`, `WIRE_METHODS`, `WIRE_NOTIFICATIONS`, 타입 추론 테스트 | `wire/methods.ts` | W2~W6, W9(settings 메서드가 `EffectiveSetting`을 씀) | L | M0 |
| W12 | 전송 인터페이스: `Transport`, `HostConnection`, `WireRequestContext`, `WireHandlers`, 팩토리 3종 타입 | `wire/transport.ts` | W11 | S | M0 |
| W13 | `package.json` exports 두 개, 각 `index.ts`, wire→settings 단방향 import 검사 | `package.json`, `*/index.ts` | W1~W12 | S | M0 |
| W14 | 전송 적합성 케이스 `WIRE_CONFORMANCE_CASES`와 테스트용 실행기 틀 | `wire/conformance.ts`, `test/wire-settings/conformance-runner.ts` | W12 | M | M1 |
| W15 | 문서 표 ↔ `WIRE_METHODS` 일치 검사(스펙 §3.3.1 표를 읽어 키·단계 비교) | `xeon/scripts/` 쪽 검사 스크립트에 항목 추가 요청 | W11 | S | M1 |
| W16 | 오류 코드 구간 표 반영, `codeRangeOf(code)` 순수 함수 | `wire/errors.ts` | W6 | S | M2 |
| W17 | `WireMeta`, `traceparent` 직렬화·역직렬화, 레지스트리가 params에 `_meta`를 더하는 처리 | `wire/jsonrpc.ts`, `wire/methods.ts` | W11 | M | M2 |
| W18 | 서비스 소켓 전송 옵션 확정(인증 필드) | `wire/transport.ts` | 스펙 미결 4 | S | M2 |
| W19 | `thread.read`(스냅샷 읽기), `approval.list`(대기 승인 읽기)와 `position` 이어 붙이기 규칙(스펙 §3.4.6) | `wire/methods.ts`, `wire/errors.ts`(3005 설명) | W11, F.records.plan의 `ApprovalRequestedPayloadSchema`, F.conversation.plan의 `ItemRecordSchema` | S | M2 |

병합 구현의 위치 [제안]:

- 규칙 함수(`resolveSetting`, `checkSettingWrite`, `validateSettingValue`, `settingsJsonSchema`)는 F의 순수 함수로 둔다. 입력은 이미 읽은 값(`ScopeStack`)이고 파일·OS 접근이 없다.
- 이유: 화면(L4), CLI(L4), 엔진(L1), 문서 검사가 같은 규칙을 써야 하는데, 이들이 함께 import할 수 있는 가장 낮은 층이 F다. 규칙을 L1에 두면 L4 설정 화면이 L1을 끌어와야 한다.
- 설정 파일 위치 결정, 읽기, 감시, 쓰기, 세션 범위 값의 저장은 L1(`L1.persistence.plan`)과 L4(`L4.host-service.plan`)가 한다. F 순수 함수의 범위는 `F.readme`의 "런타임 로직 예외" 규칙을 따른다.

## 4. 채택 코드

| 대상 | 방식 | 버전·원본 | 바꿀 점 |
|---|---|---|---|
| `typebox` | 그대로 사용 | 1.3.27(`xeon/package.json` catalog, review.decisions-2 U-24) | 없음 |
| `docs/design/19-client-protocol.md` §3.3.1 TypeBox 정의 | 이식·수정 | 문서의 코드 블록(원래 경로 `packages/protocol/src/jsonrpc.ts`는 코드가 없다. 새로 작성한다) | `HelmErrorData` → `WireErrorData`, 기기 인증·`clientKind` 제거, 프레임 1 MiB 추가, 알림 이름 `events` → `events.batch` |
| 19 §3.5.3~§3.5.4 구독 계약과 재전송 알고리즘 | 이식(계약만) | 문서 | 알고리즘 구현은 L4 host. F는 스키마와 적합성 케이스만 |
| 19 §3.3.4 오류 표 | 일부 이식 | 문서 | 1000번대 인증·페어링 코드 제거, kind 이름 재배정(스펙 §3.5.2) |
| `@agentclientprotocol/sdk` | 참고만 | 2.0.0 | 선택 façade 후보. 지금은 의존하지 않는다(`_research/packages.md` §4.1 F5) |
| pi-protocol, pi-server, pi-client | 쓰지 않음 | - | CBOR + Unix 소켓 + Chord 라우팅에 묶이고 인증이 없다(`_research/packages.md` §4.1 F5 "클라이언트 와이어") |
| omp 설정 정의(`register`) | 설계 참고 | `_research/settings.md` §3 [S36] | 키, 타입, 기본값, 열거값을 한 정의에서 화면·명령·파일로 쓰는 구조만 따른다 |
| Claude Code 설정 계층 | 설계 참고 | `_research/settings.md` §2.1 | 관리 최상위, 범위별 파일. 우선순위는 스펙 §4.7 |
| `@opentelemetry/api` | 그대로 사용(2차) | 1.10.0 | `import type`만. W17 |
| MCP `JSON_RPC_ERROR_CODES` | 설계 참고(2차) | `@modelcontextprotocol/client` 2.3.1 `protocol/jsonrpc.ts` | 구간 나누는 방식만 따른다. W16 |

의존 추가: `typebox`(catalog). M2에 `@opentelemetry/api` 1.10.0을 `devDependencies`가 아닌 `dependencies`에 `import type` 전용으로 더한다 [제안. 타입만 쓰더라도 소비 패키지 설치에 필요하다].

## 5. 단위 테스트 목록

모두 `bun test`(패키지 cwd)로 돈다. 타입 테스트는 `tsc -b`가 검사한다.

| 파일 | 테스트 | 확인할 동작 | 스펙 수용 기준 |
|---|---|---|---|
| `jsonrpc.test.ts` | `rejects batch` | 배열 메시지 → `-32600`, `issue.code: "batch"` | A5 |
| | `rejects numeric id` | `id: 1` → `-32600` | A5 |
| | `rejects null id on request` | 요청의 `id: null` → `-32600` | A5 |
| | `rejects array params` | `params: []` → `-32602` | A5 |
| | `rejects depth 65` | 중첩 65 객체 → `-32600`, `issue.code: "depth"`. 64는 통과 | A5 |
| | `rejects long array` | 길이 10,001 배열 → `-32600` | A5 |
| | `rejects extra envelope keys` | 알 수 없는 최상위 키 → `-32600` | |
| | `accepts empty params` | `params: {}` 통과 | |
| `method-name.test.ts` | `classifies core/control/extension` | `turn.start`, `$/cancelRequest`, `ext.web-exa.search` | A6 |
| | `rejects bad names` | `Turn.start`, `turn`, `turn.start.now`, `turn_start`, `$/`, 97자 이름 | A6 |
| | `registry names follow rule` | `WIRE_METHODS`와 알림 표의 모든 이름이 규칙을 통과 | A6 |
| `cursor.test.ts` | `position requires storeId and seq` | 한쪽이 없으면 실패 | |
| | `head literal` | `from: "head"` 통과, `"HEAD"` 실패 | A3 |
| | `batch interval invariant helper` | 알림 열 `[(s,a],(a,b],(b,c]]`이 이어짐을 검사하는 도우미가 구멍·겹침을 찾음 | A2 |
| | `replay boundary cases` | 적합성 케이스의 재전송 경계(`from.seq = head`, `from.seq = 0`, `storeMismatch`, `aheadOfHead`) 기대값이 스키마에 맞음 | A1, A4 |
| `notifications.test.ts` | `toEventWire converts time` | `recordedAt` ms → ISO 문자열, 나머지 필드 그대로, `redactions` 기본 `[]` | |
| | `toEventWire redacts pointers` | redact가 돌려준 포인터의 값이 지워지고 `redactions`에 같은 포인터가 남음 | |
| | `volatile wire keeps n and afterSeq` | `toVolatileEventWire`가 `n`, `afterSeq`를 보존하고 `seq`가 없음 | A11 |
| | `stream chunk has no seq` | `StreamChunkParams`에 `seq` 필드가 없음 | A11 |
| `methods.type-test.ts` | `params inferred from registry` | `WireParams<"turn.start">`가 `Static<typeof TurnStartParams>`와 같음(양방향 대입) | A8 |
| | `keys match` | `keyof WireMethodMap`과 `keyof typeof WIRE_METHODS`가 같음 | A8 |
| | `handler table exhaustive` | 처리기 하나를 빼면 `WireHandlers` 대입이 컴파일 오류(`@ts-expect-error`) | |
| `errors.test.ts` | `internal error sanitized` | 알 수 없는 예외 변환 도우미가 `-32603`, `"Internal error"`를 내고 원래 메시지를 싣지 않음 | A12 |
| | `kinds unique` | `WIRE_ERRORS`의 kind 중복 없음, code와 kind 1:1(확장 구간 제외) | |
| `version.test.ts` | `isCompatible` | 0.x는 부 버전까지 같아야 호환, 1.x 이상은 주 버전만 비교 | (A7의 전제) |
| `setting-def.test.ts` | `secret default rejected` | `secret: true` + `default` → D2 위반 | S1 |
| | `secret type must be SecretRef` | 일반 문자열 스키마 → D3 위반 | |
| | `range min>max rejected` | D5 위반 | S2 |
| | `default outside range rejected` | D4 위반 | S2 |
| | `duplicate constraint rejected` | `type`에 `minimum`과 `range.min`을 함께 둠 → D6 위반 | |
| | `restart cannot be session` | `runtimeChange: "restart"` + `session` → D7 위반 | |
| | `widget matches type` | `toggle` + integer → D8 위반 | |
| | `key prefix matches layer` | `l1.loop.x` + `layer: "L2"` → D1 위반 | |
| | `records settings.changed alignment` | F.records `SettingsChangedPayload` 픽스처의 `key`·`scope`가 `SettingKey`·`SettingScope` 스키마를 통과하고, `SettingScope` 다섯 값 모두 `SettingsChangedPayloadSchema`를 통과한다(settings → records import는 `F.readme` §3 순서상 허용) | |
| `define.test.ts` | `builds full keys` | `defineSettings("l1.loop", {maxSteps})`의 키가 `l1.loop.maxSteps`이고 리터럴 타입으로 추론됨 | |
| | `duplicate key across groups` | 두 그룹이 같은 키 → `duplicateKey` | S9 |
| | `extension cannot use core namespace` | 매니페스트 userConfig에서 온 정의가 `l1.` → `foreignNamespace` | S9 |
| | `manifest userConfig mapping` | `settingsFromManifest`가 `ext.<name>.<키>` 키, `ui.label`, `secret`(sensitive), 확장의 층을 만든다. 값 스키마가 없는 항목은 `invalidDef` issue | |
| | `reserved extension keys` | userConfig가 `enabled`, `isolation`을 쓰면 `invalidDef` | |
| `layers.test.ts` | `precedence order` | user < project < local < session 순으로 덮어씀, `shadowed` 순서 | S5 |
| | `managed locks` | managed 값이 이기고 `locked: true`, 다른 범위 쓰기 → `settings.locked` | S4 |
| | `scope not allowed` | `session`을 허용하지 않는 키의 session 쓰기 → `settings.scopeNotAllowed` | S3 |
| | `scope-limited key ignored in project file` | `allowedScopes: ["managed","user"]` 키가 project 층에 있으면 무시되고 issue가 남음 | |
| | `invalid file value skipped` | 스키마 위반 값은 건너뛰고 다음 순위 값을 씀 | |
| | `no deep merge` | 객체 값은 통째로 바뀜 | |
| | `secret value never resolved` | 비밀 키 유효 값이 `secret://` 문자열 또는 `null`. 평문 쓰기 → `settings.secretValue`, details에 값 없음 | S8 |
| `jsonschema.test.ts` | `draft 2020-12 header` | `$schema` 값 | |
| | `range merged` | `range.min/max/enum`이 `minimum/maximum/enum`으로 들어감 | |
| | `scope filter` | project 스키마에 user 전용 키가 없음 | S7 |
| | `secret has no default` | 비밀 키 속성에 `default`가 없고 `pattern`이 있음 | S1 |
| | `deterministic output` | 같은 입력 두 번 → 같은 문자열 | S10 |
| | `same verdict as validateSettingValue` | 무작위 값 생성(정수 경계, 문자열, 잘못된 타입) 1,000개에서 JSON Schema 검사와 `validateSettingValue` 결과가 같음 | S6 |
| | `cli parse same verdict` | CLI식 문자열 해석(JSON 우선, 실패 시 문자열) 뒤 `checkSettingWrite` 결과가 파일 검사와 같음 | S6 |
| `conformance-runner.ts` | (틀) | `WIRE_CONFORMANCE_CASES`를 받아 주어진 `Transport` 쌍에 돌리는 실행기. F에서는 메모리 가짜 전송으로 자기 검사만 한다. in-process와 stdio 실제 구현은 `L4.host-service.plan`이 이 실행기로 검사한다 | A10 |
| `WIRE_CONFORMANCE_CASES`(W14, M1) | `hello required`, `experimental not opted in` | hello 전 `turn.start` → 1001, opt-in하지 않은 실험 메서드 → `-32601`. 스펙 §4.1·§4.3 처리 순서는 L4 host 처리기가 구현하므로 F는 케이스와 기대값을 정의하고, 통과 확인은 `L4.host-service.plan`이 한다 | A7 |
| `methods.test.ts` | `thread.read returns items with the position they reflect` | `limit` 1..500, `before`는 ItemId, `position`·`hasMore` 필수, kind와 message가 어긋난 item 거부 | A13 |
| | `approval.list returns approval.requested payloads with the position they reflect` | `threadId` 필수, 항목은 `{approvalId, seq, request}`이고 `request`는 `approval.requested` payload, `position` 필수 | A15 |
| W15 문서 검사(M1) | `method table matches registry` | 스펙 §3.3.1 표의 메서드 이름·단계 집합과 `WIRE_METHODS`가 같다 | A9 |

JSON Schema 검사 도구 [제안]: `jsonschema.test.ts`는 출력 JSON을 `Type.Unsafe`로 다시 감싸 `Value.Check`로 검사하고 그 결과를 `validateSettingValue`와 비교한다. 별도 JSON Schema 검증기 의존을 더하지 않기 위해서다. 외부 검증기와의 교차 확인이 필요하면 [미결]로 올린다.

## 6. 완료 기준

1. 스펙 `F.wire-settings.spec` §9의 수용 기준이 위 테스트로 확인된다. 단계별로 나눈다.
   - M0 완료: A2, A3, A5, A6, A8, A11, A12, S1~S10. A1·A4는 케이스 기대값의 스키마 검사까지다.
   - M1 완료: A7(적합성 케이스, W14), A9(문서 검사, W15), A10(적합성 실행기). A1·A2·A4·A7·A10의 실제 전송 통과는 `L4.host-service.plan`의 완료 기준이다.
2. 문서 표와 코드 일치(M1): 스펙 §3.3.1 메서드 표, §3.3.2 알림 표, §3.5.2 오류 표의 이름·단계·code가 `WIRE_METHODS`, `WIRE_NOTIFICATIONS`, `WIRE_ERRORS`와 같다(W15). M0에서는 같은 대조를 리뷰 항목으로 확인한다.
3. `cd xeon && just verify`가 종료코드 0이다. 여기에 `tsc -b`, oxlint(type-aware), oxfmt 검사, `scripts/check-layers.ts`, dependency-cruiser, knip, `bun test`가 포함된다.
4. `contracts`가 다른 xeon 패키지를 import하지 않는다(check-layers). `wire-settings/settings/`가 `wire-settings/wire/`를 import하지 않는다.
5. `package.json` exports에 `./wire`, `./settings`가 있고 `F.readme`의 서브패스 표와 같다.
6. `just docs-route --check --allow-missing`이 이 문서와 스펙의 `binds`, `depends_on`을 오류 없이 해석한다.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 19번 문서의 데몬·기기 인증 전제를 함께 가져와 범위가 커진다 | 쓰지 않는 메서드·오류 코드가 계약에 남고 M1이 늦어진다 | 이식 대상을 envelope 규칙, 이름 규칙, 재전송 알고리즘 셋으로 한정한다(스펙 §1.3). 오류 표는 M1 항목만 둔다. 리뷰 때 19의 kind 이름이 새로 들어오면 근거를 묻는다 |
| 설정 우선순위 해석이 문서마다 다르다 | 층 문서와 L4 화면이 서로 다른 순서를 가정한다 | 스펙 §4.7 표를 유일한 기준으로 두고 [미결]로 사용자 확인을 받는다. `layers.test.ts`가 그 표를 그대로 검사한다. 결정이 바뀌면 `SCOPE_PRECEDENCE` 한 줄과 테스트만 고친다 |
| 승인 요청 방향은 A안으로 정했다(review.decisions-2 U-02, 2026-10-22 확인). 뒤에 B안으로 번복하는 경우 | `approval.respond` 모양, 서버 → 클라이언트 요청 허용 여부가 바뀐다 | `approval.respond`는 M2에 둔다. M1 메서드는 승인과 무관하다. B안으로 번복하면 envelope 규칙 표의 "서버 → 클라이언트 요청" 행과 `HostConnection`에 요청 처리기 등록 메서드를 더한다 |
| 설정 키 중복 소유 | 두 층이 같은 의미의 키를 각자 정의하거나 같은 키를 쓴다 | 키 접두가 소유 층·도메인을 정하므로 다른 도메인 키는 이름부터 다르다. 의미 중복은 P2 정합성 검토 ④(설정 노출) 항목으로 확인한다. 코드에서는 `buildCatalog`가 같은 키를 거부한다 |
| `isolatedDeclarations` 주석 부담 | `defineSettings` 결과와 스키마 상수마다 긴 타입 주석이 필요하다 | `xeon/tsconfig.base.json`에서 이미 켜져 있다(`_research/foundation-plan.md` §2). eng-2의 명시 주석 패턴을 따른다. 스펙 코드 블록의 주석 생략은 예시 한정이다 |
| `UserConfigEntry`에 값 스키마가 없다(키 접두는 `ext.`로 맞췄다) | W8의 `settingsFromManifest`가 만들 수 없는 정의가 생긴다 | 스펙 미결 8. W8은 값 스키마가 없는 항목을 issue로 돌려주는 동작부터 구현하고, F.extensions 쪽 결정 뒤 대응 규칙을 고친다 |
| 다른 F 도메인 이름이 바뀐다 | `EventWire` 필드, `TurnStartInput`, `PartDelta` import가 깨진다 | W4·W5·W8은 F.records.plan, F.conversation.plan, F.extensions.plan의 해당 작업 뒤에 시작한다. 이름이 다르면 스펙을 먼저 고친다 |
| TypeBox 사본 중복 | 해소했다. catalog를 pi와 같은 1.3.27로 고정했다(review.decisions-2 U-24) | pi-ai를 올릴 때 typebox 판을 함께 확인한다 |
