---
id: F.capabilities.plan
layer: F
domain: capabilities
kind: plan
status: draft
depends_on: [F.capabilities.spec, F.conversation.plan]
binds: [xeon/packages/contracts/src/capabilities/**, xeon/packages/contracts/src/services/**]
---

# F 능력 계약 구현 계획

대상 스펙: F.capabilities.spec. 패키지: `@xeon/contracts`, 서브패스 `./capabilities`, `./services`(스펙 §3.12).

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 소비자 |
|---|---|---|
| M0 | `CapabilityId`·`SemVer`·`SemVerRange`·`ToolName` 스키마, `MethodDef`, `ToolSpec`(기계 이름 `name`과 표시 제목 `label` 포함), `CapabilityDef`, `defineCapability`, `ServiceKey`·`serviceKey`, `CapabilityError`, `validateCapability`·`validateCapabilitySet`, `toJsonSchema`, `toolOrderKey`·`orderTools`·`canonicalToolset`·`toolsetFingerprint`·`diffToolsets`, `web.search` 예시 픽스처, `./services`의 서비스 인터페이스 14종과 `SERVICE_NAMES`(스펙 §3.12, review.decisions-2 D-04) | X(ext-host 최소형), F.extensions(매니페스트가 ID 스키마를 import), L0 `platform-*`, L1 `core-*`(서비스 구현과 주입) |
| M1 | 걷는 골격의 도구 `read`, `ls`, `bash`를 이 정의 형식으로 정의한다. 정의는 F.capabilities.spec §3.9의 배치 제안에 따라 `capabilities/defs/workspace.ts`에 둔다 | L1 core-tools(도구 어댑터, `AgentTool` 생성), L2 cap-workspace(provider) |
| M2 이후 | 내장 L2 능력 정의 추가(`web.*`, `knowledge.*`, `mcp` 정적 메서드 등. 각 L2 plan이 정의 내용을 제공), 네임스페이스·충돌 규칙 확정 반영, Cordis 선언 병합 결정 반영 | 모든 L2, L3 group-kit |

- 기계 이름·표시 제목 분리는 계획 v2에서 2차 항목이다(`_research/layer-plan-v2.json` F3). pi-ai `Tool.name`과 agent-core `AgentTool.label`에 이미 있으므로 M0에 같이 넣는다.
- M1 스모크(`_research/foundation-plan.md` §5 P4)의 도구 3종은 이 형식을 거쳐야 한다. L1 core-tools가 `ToolSpec`을 `AgentTool`로 바꾸는 어댑터를 M1에 만든다(L1.tools.plan).

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/
  package.json                      # exports에 "./capabilities": "./src/capabilities/index.ts" 추가
  src/capabilities/
    ids.ts            # CapabilityId, SemVer, SemVerRange, ToolName, 패턴 상수, isCapabilityId, isSemVerRange
    tool-spec.ts      # ToolSpec, ToolSpecFor, ToolHints, ToolContent, ToolWire, ToolRef, OrderedTool
    capability.ts     # MethodDef, ErrorDecl, MethodMap, ServiceDef, CallOptions, CapabilityDef, AnyCapabilityDef,
                      # CapabilityApi, defineCapability
    service-key.ts    # ServiceKey, ApiOf, serviceKey
    errors.ts         # COMMON_ERROR_CODES, CapabilityErrorData(+Schema), CapabilityError, isCapabilityError, DEFAULT_RETRYABLE
    validate.ts       # validateCapability, validateCapabilitySet, toJsonSchema, CapabilityIssue(+Code)
    ordering.ts       # toolOrderKey, orderTools, canonicalToolset, toolsetFingerprint, diffToolsets, MAX_TOOLS_PER_REQUEST
    secrets.ts        # SecretRef·SecretName(브랜드) 형식, SecretRefError, parseSecretRef·secretRef·findForeignSecretSyntax, SecretMeta·SecretUsePolicy·SecretAuditRecord와 부속 타입(스펙 §3.10)
    provider.ts       # ProviderId, ProviderSelectionMeta, orderProviderCandidates(스펙 §3.11)
    defs/             # M1부터. 내장 능력 정의(workspace.ts …). M0에는 만들지 않는다
    index.ts          # 위 공개 이름 재export
  src/services/       # 스펙 §3.12. 서브패스 "./services"
    names.ts          # SERVICE_NAMES, ServiceName
    tasks.ts loop.ts models.ts tools.ts approvals.ts agents.ts context.ts
    sandbox-report.ts exec.ts sandbox.ts process.ts os.ts secrets.ts secret-admin.ts mcp.ts groups.ts
    index.ts          # 재export
  test/capabilities/
    fixtures/web-search.ts          # 스펙 §3.9 예시 정의 그대로
    capability.test.ts  tool-order.test.ts  fingerprint.test.ts  validate.test.ts  jsonschema.test.ts
    contract.type-test.ts
```

- `package.json`의 `exports` 수정은 contracts 패키지 골격을 만드는 작업자와 조율한다. 이 문서 작성 시점에 `exports`에는 `"."`만 있다.
- `index.ts`는 재export만 한다. 순환을 막기 위해 파일 사이 import 방향은 `ids` ← `tool-spec` ← `capability` ← `service-key`·`errors` ← `validate`·`ordering`이다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| P1 | `ids.ts`: `CAPABILITY_ID_PATTERN`, `SEMVER_PATTERN`, `TOOL_NAME_PATTERN`, `TOOL_NAME_WIRE_PATTERN`, 각 TypeBox 스키마, `isCapabilityId`, `isSemVerRange`(스펙 §4.1 부분 집합 파서). 예약 접두 상수 `RESERVED_CAPABILITY_PREFIXES` | F.conversation.plan C2(`JsonValue` 재노출) | S |
| P2 | `tool-spec.ts`: `ToolSpec`, `ToolSpecFor`, `ToolHints`, `ToolContent`, `ToolWire`, `ToolRef`, `OrderedTool`. pi-ai `Tool`·`ToolReference`는 `import type`만 쓰고, `ToolExecutionMode`는 F.conversation `agent.ts` 정의를 쓴다(adr.0009). `ReplayPolicy`는 F.conversation(`tool-result.ts`)에서 import한다 | P1, F.conversation.plan C7(`ReplayPolicy`) | M |
| P3 | `capability.ts`, `service-key.ts`, `errors.ts`: `MethodDef`, `CapabilityDef`, `CapabilityApi`, `defineCapability`(항등), `ServiceKey`(팬텀 필드는 `declare const … : unique symbol`), `serviceKey`, 오류 타입과 클래스 | P2 | M |
| P4 | `defineCapability` 추론 검증: `const` 타입 매개변수가 `method` 리터럴과 스키마 타입을 보존하는지 타입 테스트로 고정한다. 추론이 부족하면 `ToolSpecFor` 분배 형태를 조정한다 | P3 | S |
| P5 | `validate.ts`: `toJsonSchema`(`~` 접두 키·비JSON 값 제거, 정규화), 스키마 순회(깊이, 크기, `$ref`, 순환, refine 탐지), `validateCapability`의 스펙 §4.6 규칙 전부, `validateCapabilitySet`. 순수 함수이며 입력을 복제 없이 읽기만 한다 | P3 | M |
| P6 | `ordering.ts`: `toolOrderKey`(코드 단위 비교, `localeCompare` 금지), `orderTools`, `canonicalToolset`(키 정렬 JSON), `toolsetFingerprint`, `diffToolsets` | P2, P5(`toJsonSchema`) | M |
| P7 | 예시 정의 `web.search` 픽스처와 이를 쓰는 테스트. 정의 본문은 스펙 §3.9를 그대로 옮긴다 | P3, P5 | S |
| P8 | `secrets.ts`: 스펙 §3.10 첫 블록(`SecretName` 브랜드, `SecretHandle`, `SecretRefError`, 순수 함수 `parseSecretRef`·`secretRef`·`findForeignSecretSyntax`, 거부 규칙은 `L0.secrets.spec` §3.1 표)과 두 번째 블록(`SecretMeta`, `SecretUsePolicy`, `SecretAuditRecord`, `RedactionHit` 등과 스키마)을 코드로 옮기고 스펙 §9 13·16·17의 테스트를 둔다(review.decisions-2 U-08) | P1 | S |
| P9 | `src/services/`: 스펙 §3.12 표의 인터페이스 15종과 `<X>ServiceName`, `SERVICE_NAMES`, 파일별 이름 표의 타입(`sandbox-report.ts`, `secrets.ts`, `secret-admin.ts`, `os.ts`의 `NotifyKind` 포함). 각 소유 문서(L0·L1·L2.mcp spec §3)의 블록을 옮겨 확정하고 소유 문서에 F 이름 인용을 요청한다. `LoopService`, `TaskService`, `ToolService`, `ModelService`, `ProcessService`, `McpService`, `GroupService`는 F.extensions.plan E10의 포트를 확장한다(스펙 §9 15). `package.json` `exports`에 `"./services"`를 더한다 | P3, F.records.plan R12, F.extensions.plan E10 | L |

P6 해시 선택 [제안]:

| 안 | 장점 | 단점 |
|---|---|---|
| Web Crypto `crypto.subtle.digest("SHA-256")` (채택 제안) | 패키지 의존 없음. Bun 1.4, Tauri WebView, 브라우저 공통 표준. 구현 코드 몇 줄 | 비동기라 `toolsetFingerprint`가 `Promise`를 반환한다 |
| 순수 TS SHA-256 (약 80줄) | 동기 함수. 런타임 전역에 의존하지 않음 | 직접 유지할 암호 코드가 생긴다. 테스트 벡터 검증 필요 |

- 두 안 모두 F에 런타임 의존을 늘리지 않는다. 호출자(L1.context)는 요청을 만들 때 이미 비동기이므로 Web Crypto 안을 제안한다.

## 4. 채택 코드

| 대상 | 버전 | 쓰는 방식 |
|---|---|---|
| `typebox` | 1.3.27 (워크스페이스 catalog, `_research/foundation-plan.md` §2) | 그대로. `Type`, `Static`, `TSchema`, `TUnsafe`, `typebox/value`의 `Value.Check`(테스트) |
| `@earendil-works/pi-ai` | 1.3.0 정확 고정 | 그대로. `Tool`, `ToolReference`, `SystemMessage` 타입만 `import type` |
| `@earendil-works/pi-agent-core` | 의존하지 않음(adr.0009) | `AgentTool`, `ToolExecutionMode`는 F `conversation/agent.ts` 정의를 쓴다 |
| Cordis | — | F에서 import하지 않는다 |

- 포크 없음.
- 참고만 하는 코드: pi durable `ToolRegistration`(`~/projects/_ref/pi-src/packages/durable/src/harness/types.ts`). 서비스와 도구를 한 쌍으로 정의한 선례가 없어 형식은 자체 설계다(`_research/packages.md` §4.1 F3 능력 정의 행).
- TypeBox 버전은 [미결]이다. pi-ai·agent-core 1.3.0이 `typebox` 1.3.27을 정확 고정하므로 1.3.27를 쓰면 설치본이 두 벌일 수 있다(`_research/notes/F-2.md` §5.3, §7). F가 쓰는 `TSchema`, `Static` 선언은 두 버전에서 같다. 결정 전까지 catalog 값(1.3.27)을 따르고, 두 벌 설치 여부를 P2에서 `bun pm ls`로 확인해 보고한다.

## 5. 단위 테스트 목록

| 파일 | 테스트 | 확인할 동작 |
|---|---|---|
| `capability.test.ts` | `required fields` | `id`, `version`, `description`, `service.methods`, `tools`가 빠진 정의는 `validateCapability` 오류 |
| | `version format` | `1.0`, `v1.0.0`, `01.0.0`은 `version_invalid`. `1.0.0-rc.1`은 통과 |
| | `id format and reserved prefixes` | `web`, `Web.search`, `ext.foo`, `a.b.c.d.e`는 오류. `web.search`, `acme-notes.sync`는 통과 |
| | `defineCapability is identity` | 반환값이 입력과 같은 참조 |
| | `serviceKey carries id and version` | 런타임 값이 `{ capability, version }`뿐 |
| | `CapabilityError data` | `data`가 `CapabilityErrorDataSchema`를 통과. `DEFAULT_RETRYABLE.rate_limited === true` |
| `tool-order.test.ts` | `permutation invariant` | 정의 3개·도구 7개의 모든 순열에서 `orderTools` 결과가 같다 |
| | `byte order` | `web.search`가 `web.search-x`보다 앞, `a_b`가 `ab`보다 앞(코드 단위 비교) |
| | `stable on equal capability` | 같은 능력의 도구는 name 순 |
| | `duplicate key throws` | 같은 (capability, name) 두 개면 예외 |
| `fingerprint.test.ts` | `same set same fingerprint` | 순열이 달라도 같은 값 |
| | `label and hints excluded` | `label`, `hints`, `replay`만 바꾸면 값이 같다 |
| | `description change` | 설명 한 글자 변경 시 값이 바뀐다 |
| | `diff on add` | 도구 1개 추가 시 `added`가 그 도구 하나, `removed`가 비고, `firstChangedIndex`가 정렬 목록의 삽입 위치 |
| | `diff on redefine` | 같은 이름 정의 변경은 `added`에만 있고 `removed`에 없다 |
| | `format` | 값이 `sha256:` + 소문자 hex 64자 |
| `validate.test.ts` | `method missing` | `tools[0].method = "nope"`(타입 단언으로 우회)이면 `method_missing` |
| | `duplicate tool name` | 한 정의 안 중복은 `tool_name_duplicate` |
| | `invalid tool name` | `web:search`, 65자 이름은 `tool_name_invalid`. 내장 능력 도구의 `WebSearch`, `web-search`는 `tool_name_style` 경고. 확장 도구 `web-exa__search`는 경고 없음 |
| | `input mismatch` | `toInput` 없이 파라미터가 다르면 `tool_input_mismatch`. `toInput`이 있으면 통과 |
| | `replay widened` | 메서드 생략·도구 `safe`이면 `replay_widened` |
| | `schema limits` | 33 KiB 파라미터, 깊이 13 스키마, 외부 `$ref`는 각각 오류. `Type.Cyclic`은 경고 |
| | `set conflicts` | 두 능력의 같은 도구 이름은 `tool_name_conflict`, 같은 id는 `capability_duplicate` |
| | `web.search fixture clean` | 픽스처 이슈 0건 |
| `jsonschema.test.ts` | `object params emit 2020-12 JSON` | `Type.Object` 파라미터의 `toJsonSchema` 결과에 `~` 접두 키, 함수, `$schema`가 없고 `type: "object"`가 있다 |
| | `lossless against Value.Check` | 표본 입력 20개에 대해 TypeBox `Value.Check`(원본 스키마)와 `toJsonSchema` 결과를 다시 TypeBox로 감싼 스키마의 판정이 같다. refine 없는 스키마로 한정 |
| | `refine dropped warning` | `Type.Refine` 스키마는 `schema_refine_dropped` 경고 |
| `contract.type-test.ts` | `consumer infers from definition only` | provider 패키지 import 없이 `ApiOf<typeof WebSearchKey>["search"]`의 매개변수·반환 타입이 기대 타입과 같다(`expectTypeOf` 대신 조건부 타입 단언) |
| | `method key checked at compile time` | 없는 메서드 이름은 `// @ts-expect-error` |
| | `ToolWire assignable to pi Tool` | `ToolWire`가 pi-ai `Tool`에 할당 가능 |
| `secrets.test.ts` | `secret ref parse` | `secret://github-token`은 `ok`, `$GITHUB_TOKEN`은 `unsupported_ref_syntax`(`env_var`), `secret://A`는 `invalid_ref`(`name_pattern`). `secretRef("A")`는 `Bug`를 던진다. `findForeignSecretSyntax("{{token}} op://v/i")`는 `template`, `provider_uri` 두 건이다(스펙 §9 13·17) |
| | `secret meta schema` | `SecretMetaSchema`·`SecretUsePolicySchema`와 인터페이스가 서로 대입 가능하다(스펙 §9 16, 타입 테스트) |
| `services.test.ts` | `service names match` | `SERVICE_NAMES`의 값과 각 파일의 `<X>ServiceName` 값이 같고 15개이며 모두 `xeon.` 접두다(스펙 §9 14) |
| | `type-only imports` | `src/services/`의 모든 import가 `import type`이고 `cordis`, `@xeon/platform-*`, `@xeon/core-*` import가 0건이다 |

- `contract.type-test.ts`는 `tsc -b`로만 검사한다(실행하지 않는다). 파일 이름 규칙과 실행 방법은 eng.testing.guide를 따른다 [가정].

## 6. 완료 기준

1. F.capabilities.spec §9 수용 기준 1~17을 위 테스트가 모두 확인하고 통과한다.
2. `just verify`의 `tsc -b`, oxlint(type-aware), check-layers, oxfmt 검사가 통과한다. contracts 패키지에서 `cordis` import가 0건이다.
3. `@xeon/contracts/capabilities` 서브패스로 공개 이름 전부를 import할 수 있다.
4. 정합성 검사 입력으로 다음 항목을 남긴다(P2 검토자용).
   - `web.search` 정의 파일(`defs/web.ts`)이 `L2.web.spec` §3.2와 같은지. 스펙 §3.9 예시 픽스처는 형식 설명용으로 간추린 것이라 이 대조에서 뺀다.
   - `ReplayPolicy`, `ResultStatus`, `JsonValue`를 F.conversation.spec(§3.1, §3.6)의 위치에서 import하는지, `requestId`를 브랜드 없는 `string`으로 쓰는지, 오류 결과를 `ResultStatus`가 아닌 `isError`로 표현하는지.
   - `CapabilityId` 형식이 F.extensions.spec 매니페스트 필드와 같은 스키마를 import하는지.
   - L1.tools.spec의 도구 어댑터가 스펙 §4.2 환원 규칙과 같은 순서를 쓰는지.
   - L0·L1 각 plan이 서비스 인터페이스를 `@xeon/contracts/services`에서 import하고 자기 패키지에 다시 정의하지 않는지, `SERVICE_NAMES`와 `eng.context-map.design` §5.3 표가 같은지.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 도구 이름 네임스페이스(`플러그인:이름`)와 provider 도구 이름 허용 문자 충돌 | 외부 플러그인 도구가 provider 요청에서 거부되거나, 충돌 해소 규칙이 늦게 정해져 이름 변경(major)이 생긴다 | M0는 `TOOL_NAME_WIRE_PATTERN`만 오류로 강제하고 충돌은 `tool_name_conflict` 오류로 등록을 막는다. 접두 규칙은 [미결]로 사용자 확인 뒤 M2에 반영 |
| Cordis 타입 결합 요구가 F 순수성과 충돌 | 그룹 코드가 `ctx.get` 직접 호출로 타입 없이 서비스를 쓰게 된다 | `ScopeApi.capability(key)` 경로만 문서화하고, X에 `ctx.get` 직접 사용 금지 lint를 제안한다. 선언 병합 여부는 [미결] |
| 능력 정의 선례 없음 | `ToolSpecFor` 분배 타입의 추론이 기대와 다르거나 컴파일 비용이 크다 | P4를 별도 작업으로 두고 타입 테스트로 먼저 고정한다. dur `ToolRegistration`은 형태 참고만 한다 |
| TypeBox 두 벌 설치 | `TSchema` 동일성 검사(`instanceof`, 심볼 키)가 버전 사이에서 어긋날 수 있다 | F 코드는 TypeBox 내부 심볼에 의존하지 않고 JSON 구조만 읽는다. 버전 [미결] 해소 전까지 P2에서 설치 상태를 보고 |
| `isolatedDeclarations`와 추론형 정의 | export 상수마다 타입 주석이 필요해 정의 파일이 길어진다 | `xeon/tsconfig.base.json`에서 contracts 전체에 켜져 있다(`_research/foundation-plan.md` §2). 정의 파일도 예외 없이 명시 주석을 단다. 주석이 지나치게 길면 메서드·도구 스키마를 별도 export 상수로 나누고 `typeof`로 참조한다 |
| 크기 한도 수치의 근거 부족 | provider가 실제로는 더 작은 한도를 둘 수 있다 | 한도 상수를 한곳(`validate.ts`)에 두고 L1.models 계약 테스트에서 provider별 한도를 확인한다 |
