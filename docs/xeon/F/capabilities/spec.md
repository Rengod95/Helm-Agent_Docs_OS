---
id: F.capabilities.spec
layer: F
domain: capabilities
kind: spec
status: draft
depends_on: [F.conversation.spec, eng.domain-types.guide]
binds: [xeon/packages/contracts/src/capabilities/**, xeon/packages/contracts/src/services/**]
---

# F 능력 계약 (capabilities)

서브패스: `@xeon/contracts/capabilities`, `@xeon/contracts/services`(§3.12)

## 1. 목적과 범위

L2 능력(capability)의 정의 형식을 정한다. 능력 하나는 서비스 API와 모델 도구를 한 쌍으로 묶은 정의 데이터다. 능력을 구현하는 쪽(provider)과 능력을 호출하는 쪽(consumer)은 모두 이 정의만 참조한다.

근거:

- 층 구성 계획 v2의 F3 "능력 계약"(`_research/layer-plan-v2.json` F3, `_research/layer-plan-v2-notes.md` 층별 구성).
- 층 사이 규칙 2: L3 그룹은 L2 능력의 정의(F3)만 참조하고 provider 구현은 참조하지 않는다(`_research/layer-plan-v2-notes.md` 층 사이 규칙).
- 패키지 판정 F3 4행(`_research/packages.md` §4.1): 도구 스키마는 TypeBox 그대로, 능력 정의는 자체, 기계 이름과 표시 제목은 pi 그대로, 도구 목록 순서는 설계.

정하는 것:

- `CapabilityDef`, `MethodDef`, `ToolSpec`의 TypeScript·TypeBox 형식
- 모델 도구를 서비스 메서드 호출로 환원하는 규칙
- `ServiceKey<Api>` 브랜드 토큰과 `defineCapability()` 항등 함수
- 도구 스키마 규칙(JSON Schema 2020-12 방언, `$ref`, 크기 한도)
- 도구 이름 형식과 표시 제목
- 도구 목록의 결정적 순서, `toolsetFingerprint`, 중간 추가·제거의 표현
- 능력 호출 오류 형태와 결과 상태 연계
- 정적 검증 함수 `validateCapability`, `validateCapabilitySet`
- 형식 설명용으로 간추린 예시 정의 `web.search`
- 호출 문맥 `CallOptions.context`(§3.2), 비밀 참조 형식과 그 순수 함수(`parseSecretRef` 등), 비밀 값 타입(§3.10), provider 선택 공통 타입(§3.11)
- 서비스 인터페이스 서브패스 `@xeon/contracts/services`(L0·L1 서비스, `McpService`, `GroupService`)의 배치 규칙과 서비스 이름 상수(§3.12)

다루지 않는 것:

- 도구 실행, 권한, 승인, 샌드박스: `L1.tools.spec`
- provider 구현과 탐침, 도메인별 선택 세부: 각 `L2.<domain>.spec`
- Cordis 서비스 등록, 주입, 수명: `X.primitives.spec`, `X.loading-trust.spec`
- 도구 호출 전후의 확장 지점: `F.extensions.spec`의 tool 지점
- MCP 서버처럼 실행 중에 도구 목록이 바뀌는 동적 도구 집합: `L2.mcp.spec` (§5.6 참조)

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 능력 (capability) | 서비스 API와 모델 도구를 한 쌍으로 묶은 기능 단위. 예: `web.search` |
| definition (정의) | F에 있는 `CapabilityDef` 값. 타입과 스키마와 순수 어댑터 함수만 담는다. 실행 코드와 외부 의존이 없다 |
| provider | 정의를 구현해 Cordis 서비스로 등록하는 L2 패키지나 플러그인. 한 능력에 provider가 여럿일 수 있다(예: `web.search`의 내장 검색 래퍼, SearXNG, Exa) |
| consumer | 서비스 API를 호출하는 쪽. L3 그룹, 다른 L2 능력, L1 도구 실행(모델 도구 호출을 서비스 호출로 바꾸는 어댑터)이 해당한다 |
| 서비스 메서드 (method) | 능력의 서비스 API를 이루는 비동기 함수 하나. 입력과 출력이 TypeBox 스키마로 정의된다 |
| 모델 도구 (tool) | 모델에게 광고되는 도구 하나. 서비스 메서드 하나에 대응한다 |
| 기계 이름 (`name`) | 모델 provider 요청과 도구 호출에 쓰는 도구 이름. pi-ai `Tool.name` |
| 표시 제목 (`label`) | UI에 보이는 도구 제목. F `AgentTool.label`(pi-agent-core 1.3.0에서 온 필드) |
| 도구 집합 (toolset) | 한 요청에서 모델에게 광고되는 도구 목록 |
| fingerprint | 도구 집합의 모델 노출 내용에서 계산한 해시. 프롬프트 캐시 키에 쓴다 |

이 문서는 F.conversation.spec의 다음 이름을 쓴다.

- `ReplayPolicy = "safe" | "unsafe"`, 기본 `"unsafe"`(F.conversation.spec §3.6). 효과의 결과가 불명일 때 재실행해도 되는지를 뜻한다(`_research/notes/F-3.md` §5). F.records.spec은 같은 심볼을 다시 export한다. F `AgentTool.replay`(pi-agent-core에서 온 필드)의 `"never" | "safe"`와 이름 통일은 F.records.spec §10 미결 4다. core-tools는 능력 도구의 `ReplayPolicy`를 그대로 쓰고, `DirectToolRegistration`의 `AgentTool.replay`만 `toReplayPolicy`로 바꾼다(`"never"`·미선언 → `"unsafe"`, L1.tools.spec §4.3).
- `ResultStatus = "complete" | "input_required"`(F.conversation.spec §3.6). 오류는 `ToolResultRecord.isError`로 표현하고 상태 태그 값에는 넣지 않는다.
- 멱등 키 `requestId`는 브랜드 없는 문자열(1~64자)이다 [제안]. F.conversation.spec의 `requestId: string | null` 필드(`TurnStartedPayload`, 사용자 `ItemRecord`)와 같은 뜻이고, `RequestId` 타입 이름은 두지 않는다(F.wire-settings.spec §3.0).
- `JsonValue`, `TextContent`, `ImageContent`: F.conversation.spec §3.1이 pi-ai에서 재노출하는 이름.

## 3. 인터페이스

모든 이름은 `@xeon/contracts/capabilities`에서 export한다. TypeBox는 `typebox` 패키지의 `Type`, `Static`, `TSchema`를 쓴다.

이 문서의 `~/projects/_ref/pi-src` 경로와 줄 번호는 로컬 pi 1.1.0 소스 기준이다. 계약 대상은 npm 1.3.0이다. pi-ai `types.ts`는 1.3.0에서 `ToolCall` 이후 줄이 5줄 밀리고(예: `Tool` 749-754 → 754-759), agent-core `types.ts`는 두 버전의 줄이 같다(`_research/notes/F-2.md` §4).

### 3.1 식별자 (`ids.ts`)

```ts
import { Type, type TString } from "typebox";

/** 능력 ID. 점으로 이은 소문자 세그먼트 2~4개. 예: "web.search", "knowledge.memory.read" */
export type CapabilityId = `${string}.${string}`;
export const CAPABILITY_ID_PATTERN = "^[a-z][a-z0-9-]{0,31}(\\.[a-z][a-z0-9-]{0,31}){1,3}$";
export const CapabilityIdSchema: TString = Type.String({ pattern: CAPABILITY_ID_PATTERN, maxLength: 96 });

/** semver 2.0 정확 버전. 예: "1.2.0" */
export type SemVer = `${number}.${number}.${number}` | `${number}.${number}.${number}-${string}`;
export const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$";
export const SemVerSchema: TString = Type.String({ pattern: SEMVER_PATTERN });

/** semver 범위. 허용 형식은 §4.1의 부분 집합만 */
export type SemVerRange = string;
export const SemVerRangeSchema: TString = Type.String({ minLength: 1, maxLength: 64 });
export function isSemVerRange(value: string): boolean;

/** 도구 기계 이름 */
export type ToolName = string;
export const TOOL_NAME_PATTERN = "^[a-z][a-z0-9_]{0,63}$";          // 내장 능력 도구의 작성 규칙 (경고 기준)
export const TOOL_NAME_WIRE_PATTERN = "^[a-zA-Z0-9_-]{1,64}$";      // provider 허용 문자 (오류 기준)
/** 확장 모델 도구의 정식 이름 "<확장 이름>__<이름>"(X.operations.spec §4.5). 전체 길이는 TOOL_NAME_WIRE_PATTERN의 64자 */
export const EXTENSION_TOOL_NAME_PATTERN = "^[a-z][a-z0-9-]{1,31}__[a-z][a-z0-9_]*$";
export const ToolNameSchema: TString = Type.String({ pattern: TOOL_NAME_WIRE_PATTERN });

/** 능력 ID 문자열 검사. 동적 입력(매니페스트, 와이어)에서 쓴다 */
export function isCapabilityId(value: string): value is CapabilityId;
```

- [제안] `CapabilityId`는 브랜드 없이 템플릿 리터럴 타입으로 둔다. 정의는 리터럴로 작성되므로 브랜드를 두면 정의마다 단언이 필요해진다. 런타임 형식은 `validateCapability`와 `isCapabilityId`가 정규식으로 검사한다. [가정] eng.domain-types.guide의 브랜드 규칙은 런타임 발급 ID(세션, 아이템 등)에 적용되고, 작성자가 선언하는 이름에는 리터럴 타입을 허용한다고 본다. 배치 1·engineering 문서 완료 뒤 대조한다.
- [제안] 네임스페이스 규칙:
  - 첫 세그먼트가 L2 도메인 이름(`workspace`, `mcp`, `web`, `knowledge`, `work`, `dialog`, `artifacts`, `schedule`)인 ID는 내장 능력 전용이다(`_routing/routes.yaml` layout L2).
  - `core`, `ext`, `grp`, `x`로 시작하는 ID는 예약한다.
  - 외부 플러그인이 새 능력을 정의할 때는 첫 세그먼트를 자기 확장 이름으로 쓴다. 예: 확장 `acme-notes`의 `acme-notes.sync`.
  - 외부 플러그인이 내장 능력의 provider가 되는 것은 허용한다. 예: Exa 플러그인이 `web.search`를 provide한다.
  - 이 규칙의 확정은 [미결]이다(§10).
- [제안] 도구 이름 네임스페이스: 내장 능력(`defs/<domain>.ts`)의 도구는 `TOOL_NAME_PATTERN`을 따른다. 확장이 등록하는 모델 도구의 정식 이름은 `<확장 이름>__<이름>`이다(`X.operations.spec` §4.5, §10 후보 b). 확장 이름에 하이픈이 허용되므로 `tool_name_style` 검사는 내장 능력 도구에만 하고, 확장 도구는 `EXTENSION_TOOL_NAME_PATTERN`으로 검사한다. 둘 다 `TOOL_NAME_WIRE_PATTERN`을 지켜야 한다.
- `ExtensionManifest`(F.extensions.spec)의 필요·선택·제공 능력 필드는 이 `CapabilityIdSchema`와 `SemVerRangeSchema`를 그대로 import한다. 두 문서의 ID 형식은 이 절 하나를 정본으로 한다.

### 3.2 서비스 메서드 (`capability.ts`)

```ts
import type { Static, TSchema } from "typebox";
import type { ReplayPolicy, ThreadId, TurnId } from "../conversation/index.ts";   // F.conversation.spec §3.2, §3.6

/** 메서드 고유 오류 선언. 공통 오류 코드(§3.6)는 선언하지 않아도 된다 */
export interface ErrorDecl {
  readonly description: string;
  readonly retryable: boolean;
  /** CapabilityErrorData.detail의 스키마 */
  readonly detail?: TSchema;
}

export interface MethodDef<I extends TSchema = TSchema, O extends TSchema = TSchema> {
  readonly description: string;
  /** 입력. 루트는 Type.Object여야 한다(§4.3) */
  readonly input: I;
  readonly output: O;
  /** 메서드 고유 오류 코드 → 선언. 키 형식 ^[a-z][a-z0-9_]{0,47}$ */
  readonly errors?: Readonly<Record<string, ErrorDecl>>;
  /** 서비스 호출 자체의 재생 정책. 생략하면 "unsafe" */
  readonly replay?: ReplayPolicy;
}

export type MethodMap = Readonly<Record<string, MethodDef>>;

export interface ServiceDef<Ms extends MethodMap = MethodMap> {
  readonly methods: Ms;
}

/** 호출 주체. 값은 L1.tools(도구 경로)와 X(그룹·확장 경로)가 채운다 */
export interface CallerInfo {
  readonly kind: "model" | "extension" | "host";
  /** model일 때: 주 대화, 서브에이전트, 백그라운드 포크 */
  readonly agent?: "main" | "subagent" | "background";
  /** extension일 때 확장 이름(그룹이면 그룹 이름) */
  readonly extension?: string;
  /** 이번 turn에서 untrusted 도구 결과를 이미 읽었는지. L1.tools가 계산한다 */
  readonly afterUntrusted?: boolean;
}

/** 호출 문맥. consumer가 직접 채우지 않는다 */
export interface CallContext {
  readonly threadId?: ThreadId;        // 호출이 일어난 세션
  readonly turnId?: TurnId;
  readonly toolCallId?: string;        // 도구 경로면 있다
  readonly caller: CallerInfo;
}

/** 서비스 호출 옵션. consumer가 넘긴다 */
export interface CallOptions {
  readonly signal?: AbortSignal;
  /** 같은 대화에서 같은 효과를 한 번만 내기 위한 키(1~64자). 도구 어댑터는 toolCallId에서 만든다 */
  readonly requestId?: string;
  /** L1.tools 어댑터(도구 경로)와 X의 capability 래퍼(그룹·확장 경로)가 덮어써서 채운다 */
  readonly context?: CallContext;
}

/** 정의에서 유도되는 서비스 API 타입. consumer는 이 타입만 쓴다 */
export type CapabilityApi<D extends AnyCapabilityDef> = {
  readonly [K in keyof D["service"]["methods"] & string]: (
    input: Static<D["service"]["methods"][K]["input"]>,
    options?: CallOptions,
  ) => Promise<Static<D["service"]["methods"][K]["output"]>>;
};
```

- [제안] 서비스 메서드는 입력 객체 하나를 받는다. 위치 인자(`search(query, opts)`)는 쓰지 않는다. 모델 도구의 파라미터가 JSON 객체 하나이므로 메서드 입력도 객체 하나로 두면 도구를 얇은 어댑터로 유지할 수 있다(§4.2). 예시의 `search(query, opts)`는 `search({ query, ...opts })`로 표현한다.
- [제안] `CallOptions.context`는 `L2.readme` §5.8의 요청을 받은 것이다. `context`가 없으면 provider는 `{ caller: { kind: "host" } }`로 본다. 대상 세션 해석: 메서드 입력에 `threadId`가 있으면 그것을, 없으면 `context.threadId`를 쓰고 둘 다 없으면 `invalid_input`이다. 도구 경로(`context.toolCallId`가 있음)에서 입력 `threadId`가 `context.threadId`와 다르면 `denied`다.
- 서비스 메서드는 실패 시 `CapabilityError`로 거부(reject)한다(§3.6). F `AgentTool.execute`(`F.conversation.spec` §3.1.1)도 도구가 실패하면 거부하고 core-tools가 오류 결과로 바꾸므로 같은 규약을 쓴다. [가정] eng.typescript.guide의 Result 규약은 층 내부 함수에 적용되고, Cordis 서비스 경계는 예외 기반으로 둔다고 본다.

### 3.3 모델 도구 (`tool-spec.ts`)

```ts
import type { Static, TSchema } from "typebox";
import type { Tool, ToolReference } from "@earendil-works/pi-ai";
import type { ToolExecutionMode } from "../conversation/index.ts";   // F agent.ts(F.conversation.spec §3.1.1). pi-agent-core는 import하지 않는다(adr.0009)

/** 정책 힌트. 의미는 MCP tool annotations와 pi ToolAnnotations를 따른다. 검증되지 않는 작성자 선언이다 */
export interface ToolHints {
  readonly readOnly?: boolean;      // 환경을 바꾸지 않는다
  readonly destructive?: boolean;   // 데이터를 지우거나 덮어쓸 수 있다 (readOnly가 아닐 때만 의미)
  readonly idempotent?: boolean;    // 같은 인자로 반복해도 추가 효과가 없다
  readonly openWorld?: boolean;     // 웹처럼 열린 외부 대상에 접근한다
}

/** 모델에게 돌려줄 도구 결과 내용. F AgentToolResult(F.conversation.spec §3.1.1)의 부분 집합 */
export interface ToolContent {
  readonly content: readonly (TextContent | ImageContent)[];
  readonly structuredContent?: JsonValue;
  readonly details?: JsonValue;
}

export interface ToolSpec<
  K extends string = string,
  P extends TSchema = TSchema,
  Md extends MethodDef = MethodDef,
> {
  /** 기계 이름. TOOL_NAME_WIRE_PATTERN을 만족해야 한다 */
  readonly name: ToolName;
  /** 표시 제목. 1~64자 */
  readonly label: string;
  /** 모델에게 보내는 설명 */
  readonly description: string;
  /** 대응하는 서비스 메서드 이름 */
  readonly method: K;
  /** 모델 도구 파라미터. 루트는 Type.Object */
  readonly parameters: P;
  /** structuredContent 스키마. 생략하고 toContent도 없으면 메서드 output을 쓴다 */
  readonly outputSchema?: TSchema;
  /**
   * 파라미터 → 메서드 입력. 생략하면 parameters가 메서드 input과 같아야 한다(§4.2). 순수 함수.
   * 메서드 문법으로 선언한다(매개변수 이변). ToolSpecFor가 P를 TSchema로 두므로, 속성 문법이면 도구별로 좁은 params 타입을 쓰는
   * toInput을 대입할 수 없다. [결정: open-issues D-04]
   */
  toInput?(params: Static<P>): Static<Md["input"]>;
  /** 메서드 출력 → 모델용 결과. 생략하면 기본 렌더링(§4.2). 순수 함수. toInput과 같은 이유로 메서드 문법이다 */
  toContent?(output: Static<Md["output"]>): ToolContent;
  /** 재생 정책. 생략하면 "unsafe" */
  readonly replay?: ReplayPolicy;
  /** 병렬 실행 허용 여부. 생략하면 L1.tools 기본값 */
  readonly executionMode?: ToolExecutionMode;
  readonly hints?: ToolHints;
}

/** 메서드 맵 Ms에 대해 가능한 ToolSpec의 합집합. method 키와 toInput/toContent 타입이 맞물린다 */
export type ToolSpecFor<Ms extends MethodMap> = {
  readonly [K in keyof Ms & string]: ToolSpec<K, TSchema, Ms[K]>;
}[keyof Ms & string];

/** provider 요청에 실리는 부분. pi-ai Tool과 구조가 같다 */
export type ToolWire = Pick<Tool, "name" | "description" | "parameters">;
export type { ToolReference };

/** 순서·fingerprint 계산에 쓰는 도구 참조 */
export interface ToolRef {
  /** 능력 ID. 능력 밖 도구는 §4.5의 순서 키 접두를 쓴다 */
  readonly capability: string;
  readonly name: ToolName;
}

export interface OrderedTool extends ToolRef {
  readonly wire: ToolWire;
}
```

- 기계 이름과 표시 제목의 분리는 pi 형태를 그대로 쓴다. pi-ai `Tool.name`(`~/projects/_ref/pi-src/packages/ai/src/types.ts:749-754`)과 F `AgentTool.label`(출처는 pi-agent-core `AgentTool.label`, `~/projects/_ref/pi-src/packages/agent/src/types.ts:466-469`)이다. 계획 v2는 이 항목을 2차로 두었지만 pi에 이미 있으므로 M0에 같이 넣는다(F.capabilities.plan).
- `ToolSpec`은 `execute`를 갖지 않는다. 실행 함수는 L1.tools가 `ToolSpec`과 provider 서비스로부터 만든다(§4.2). 그래서 `ToolSpec`은 F `AgentTool`의 상위 형식이 아니다. core-tools는 `ToolSpec`을 `AgentTool`로 바꾸지 않고 내부 도구 항목(`ToolEntry`, `entries.ts`)으로 바꾼다. 필드 대응은 다음과 같다.

| `ToolSpec` 필드 | `AgentTool` 필드 | 변환 |
|---|---|---|
| `name`, `description`, `parameters` | 같은 이름 | 그대로 |
| `label` | `label` | 그대로 |
| `outputSchema` 또는 메서드 `output` | `outputSchema` | §4.2 규칙 |
| `replay` | `replay` | 도구 항목은 F `ReplayPolicy`를 그대로 쓴다. `AgentTool.replay`(`"never" \| "safe"`)에 대응시키면 `"unsafe"`는 `"never"`다 |
| `executionMode` | `executionMode` | 그대로 |
| `hints` | (pi coding-agent `ToolDefinition.annotations`) | `readOnly` → `readOnlyHint` 등 이름만 바꿈 |
| `toInput`, `toContent`, `method` | `execute` | L1.tools 어댑터가 합성 |

### 3.4 능력 정의와 `defineCapability`

```ts
export interface CapabilityDef<
  Ms extends MethodMap = MethodMap,
  Ts extends readonly ToolSpecFor<Ms>[] = readonly ToolSpecFor<Ms>[],
> {
  readonly id: CapabilityId;
  readonly version: SemVer;
  readonly description: string;
  readonly service: ServiceDef<Ms>;
  /** 모델 도구 목록. 빈 배열 허용(§4.4) */
  readonly tools: Ts;
  /** 이 능력의 정의가 전제하는 다른 능력. provider 등록 시 X가 해석한다 */
  readonly requires?: readonly CapabilityId[];
}

export type AnyCapabilityDef = CapabilityDef<MethodMap, readonly ToolSpec[]>;

/** 항등 함수. 타입 추론만 한다. 런타임 검사를 하지 않는다 */
export function defineCapability<
  const Ms extends MethodMap,
  const Ts extends readonly ToolSpecFor<Ms>[],
>(def: CapabilityDef<Ms, Ts>): CapabilityDef<Ms, Ts>;
```

- `defineCapability`는 인자를 그대로 돌려준다. 런타임 검증은 `validateCapability`(§3.7)가 맡고, 호출 시점은 X의 provider 등록과 단위 테스트다.
- `const` 타입 매개변수로 `method` 리터럴과 스키마 타입을 보존한다. `tools[i].method`가 `service.methods`의 키가 아니면 컴파일 오류가 난다. JS 플러그인처럼 타입 검사를 거치지 않은 정의는 `validateCapability`의 `method_missing`이 잡는다.

### 3.5 서비스 키 (`service-key.ts`)

```ts
declare const serviceApiType: unique symbol;

/** 서비스 API 타입을 실어 나르는 브랜드 토큰. 런타임 값은 id와 version뿐이다 */
export interface ServiceKey<Api> {
  readonly capability: CapabilityId;
  readonly version: SemVer;
  /** 팬텀 필드. 런타임에는 없다 */
  readonly [serviceApiType]?: Api;
}

export type ApiOf<K> = K extends ServiceKey<infer Api> ? Api : never;

/** 정의에서 서비스 키를 만든다. 순수 함수 */
export function serviceKey<const D extends AnyCapabilityDef>(def: D): ServiceKey<CapabilityApi<D>>;
```

- [제안] F는 Cordis를 import하지 않는다. F의 런타임 의존은 TypeBox와 pi 타입(type-only import)으로 한정한다. Cordis 서비스 등록, 주입, 도구 생성은 X(`X.primitives.spec`)와 L1.tools가 `ServiceKey`를 받아서 한다.
- consumer는 `ScopeApi.capability(key)`(F.extensions.spec §3.2)로 서비스 API를 얻는다. 반환 타입은 `ApiOf<typeof key>`다. consumer 코드는 provider 패키지를 import하지 않는다.
- Cordis 서비스 이름은 X가 `CapabilityId`에서 유도한다. 유도 규칙은 `X.primitives.spec` §3.7이고 능력마다 `cap:<id>` 바인딩 하나다. L0·L1 서비스 이름 `xeon.*`(§3.12, `eng.context-map.design` §5.3)와 이름 공간이 겹치지 않는다.
- [제안] 도메인 서비스 묶음 타입(예: `WebService`)은 같은 도메인 능력 API를 모은 TypeScript 타입일 뿐이고 Cordis 서비스로 등록하지 않는다. consumer는 능력 단위 `ServiceKey`로 API를 얻는다(`L2.readme` §5.6과의 정리).
- [결정: review.decisions-2 D-04] 예외는 `xeon.mcp` 하나다. L2 서비스 이름 중 Cordis에 등록되는 것은 `xeon.mcp`뿐이고, 인터페이스는 `McpService`(`McpPort` 확장, §3.12 `services/mcp.ts`)다. X가 확장의 MCP 서버 등록을 `McpPort`로 넘겨야 하기 때문이다(`F.extensions.spec` §3.2.1). `xeon.workspace`, `xeon.web`, `xeon.knowledge`, `xeon.work`, `xeon.dialog`, `xeon.artifacts`, `xeon.schedule`은 등록하지 않는 묶음 이름이다.
- [미결] Cordis `Context` 타입에 대한 선언 병합을 F가 해야 하는지. 아래 장단을 사용자 확인 항목으로 남긴다(§10).

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A (현재 제안) | F는 `ServiceKey<Api>`만 둔다. X가 `ctx.capability(key)` 같은 래퍼로 타입을 복원한다 | F가 Cordis rc API에 묶이지 않는다. F를 쓰는 모든 층(L0 포함)이 vendored Cordis 타입을 끌어오지 않는다. 키가 값이므로 정적 검사(매니페스트 선언 대조)가 쉽다 | Cordis의 `ctx.get('name')` 직접 호출은 타입이 없다. 래퍼를 거치지 않는 코드가 생기면 타입 안전이 빠진다 |
| B | F가 `declare module "cordis" { interface Context { "web.search": ... } }`로 선언 병합한다 | Cordis 관용 코드(`ctx.inject`, `ctx.get`)에 타입이 그대로 붙는다 | F가 `xeon/vendor/cordis` 타입에 의존한다. Cordis rc 변경이 F를 깨뜨린다. 전역 병합이라 능력 정의를 추가할 때마다 F의 선언이 늘어나고, 외부 플러그인 능력은 F 밖에서 병합해야 한다 |
| C | X 패키지가 선언 병합을 맡는다 | F 순수성을 지키면서 Cordis 관용 코드에 타입이 붙는다 | 병합 대상 목록을 X가 F 정의에서 유도해야 한다. 외부 플러그인 능력은 여전히 각자 병합한다 |

### 3.6 오류 (`errors.ts`)

```ts
import { Type, type TUnsafe } from "typebox";

export const COMMON_ERROR_CODES = [
  "invalid_input", "not_found", "unsupported", "unavailable", "denied",
  "rate_limited", "timeout", "upstream_error", "aborted", "internal",
] as const;
export type CommonErrorCode = (typeof COMMON_ERROR_CODES)[number];

export interface CapabilityErrorData {
  readonly capability: CapabilityId;
  readonly method: string;
  /** 공통 코드 또는 MethodDef.errors의 키 */
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  /** rate_limited 등에서 다시 시도해도 되는 최소 대기 시간 */
  readonly retryAfterMs?: number;
  /** 응답을 만든 provider 식별자. 정보용 */
  readonly provider?: string;
  readonly detail?: JsonValue;
}

/** 와이어(격리 프로세스, 도구 결과 details)로 오갈 때 쓰는 스키마 */
export const CapabilityErrorDataSchema: TUnsafe<CapabilityErrorData> = Type.Unsafe<CapabilityErrorData>(
  Type.Object({
    capability: CapabilityIdSchema,
    method: Type.String({ minLength: 1 }),
    code: Type.String({ pattern: "^[a-z][a-z0-9_]{0,47}$" }),
    message: Type.String(),
    retryable: Type.Boolean(),
    retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
    provider: Type.Optional(Type.String()),
    detail: Type.Optional(Type.Unknown()),
  }),
);

export class CapabilityError extends Error {
  readonly data: CapabilityErrorData;
  constructor(data: CapabilityErrorData);
}
export function isCapabilityError(value: unknown): value is CapabilityError;

/** 공통 코드의 기본 retryable 값 */
export const DEFAULT_RETRYABLE: Readonly<Record<CommonErrorCode, boolean>>;
```

공통 오류 코드 [제안]:

| 코드 | 기본 retryable | 뜻 | 도구 결과 표현(§4.2 규칙 5) |
|---|---|---|---|
| `invalid_input` | false | 입력이 스키마나 의미 검사를 통과하지 못함 | `isError: true` |
| `not_found` | false | 대상이 없음 | `isError: true` |
| `unsupported` | false | 활성 provider가 이 입력 조합을 지원하지 않음 | `isError: true` |
| `unavailable` | true | 활성 provider가 없거나 일시적으로 쓸 수 없음 | `isError: true` |
| `denied` | false | 정책이 거부함. L1.tools와 L0 정책 계층이 만든다 | `isError: true` |
| `rate_limited` | true | 상대 서비스의 호출 한도 초과. `retryAfterMs`를 채운다 | `isError: true` |
| `timeout` | true | 시간 초과 | `isError: true` |
| `upstream_error` | true | 외부 서비스 5xx나 네트워크 오류 | `isError: true` |
| `aborted` | false | `CallOptions.signal`로 취소됨 | `isError: true`, 중단 결과(L1.tools) |
| `internal` | false | provider 내부 결함 | `isError: true` |

- `retryable`은 consumer에게 주는 힌트다. 재시도 여부와 횟수는 consumer가 정한다. provider 안의 재시도(예: provider 체인 fallback)는 provider 몫이다.
- 메서드 고유 코드는 `MethodDef.errors`에 선언한다. 고유 코드는 공통 코드와 같은 이름을 쓸 수 없다(`validateCapability`의 `error_code_shadow`).
- 표의 "도구 결과 표현" 열: 모든 공통 오류는 `ToolResultRecord.isError: true`이고 `status`는 생략(`"complete"`)이다. `aborted`만 L1.tools가 중단 결과로 처리한다. `ResultStatus`에는 오류 값이 없다(F.conversation.spec §3.6).
- `input_required`는 오류가 아니다. 메서드가 추가 입력을 요구하는 경우는 출력 스키마의 변형으로 표현하고 도구 어댑터가 `ToolResultRecord.status: "input_required"`와 `inputRequired: InputRequiredInfo`로 옮긴다(F.conversation.spec §3.6). 출력 변형의 모양과 변환 규칙은 L1.tools.spec이 정한다.

### 3.7 정적 검증 (`validate.ts`)

```ts
export type IssueSeverity = "error" | "warning";

export interface CapabilityIssue {
  readonly severity: IssueSeverity;
  readonly code: CapabilityIssueCode;
  /** 정의 안의 JSON Pointer. 예: "/tools/0/method" */
  readonly path: string;
  readonly message: string;
}

export type CapabilityIssueCode =
  | "id_invalid" | "id_reserved" | "version_invalid" | "description_empty"
  | "service_empty" | "method_name_invalid" | "method_input_not_object"
  | "error_code_invalid" | "error_code_shadow"
  | "tool_name_invalid" | "tool_name_style" | "tool_name_duplicate" | "tool_label_invalid"
  | "method_missing" | "tool_input_mismatch" | "replay_widened" | "parameters_not_object"
  | "schema_ref_external" | "schema_cyclic" | "schema_too_large" | "schema_too_deep"
  | "schema_not_json" | "schema_refine_dropped" | "description_too_long"
  | "requires_invalid" | "requires_self";

/** 정의 하나를 검사한다. 순수 함수. 입력을 바꾸지 않는다 */
export function validateCapability(def: AnyCapabilityDef): readonly CapabilityIssue[];

export type CapabilitySetIssueCode = "capability_duplicate" | "tool_name_conflict" | "requires_unresolved";

export interface CapabilitySetIssue {
  readonly severity: IssueSeverity;
  readonly code: CapabilitySetIssueCode;
  readonly capabilities: readonly CapabilityId[];
  readonly message: string;
}

/** 정의 집합을 검사한다(같은 id 중복, 도구 이름 충돌, requires 미해결). 순수 함수 */
export function validateCapabilitySet(defs: readonly AnyCapabilityDef[]): readonly CapabilitySetIssue[];

/** TypeBox 스키마를 JSON Schema 2020-12 문서(순수 JSON)로 바꾼다. §4.3 규칙 */
export function toJsonSchema(schema: TSchema): JsonValue;
```

검사 규칙 목록은 §4.6에 있다.

### 3.8 순서와 fingerprint (`ordering.ts`)

```ts
/** 도구 순서 비교 함수. 능력 ID, 그다음 도구 name을 UTF-8 바이트 순으로 비교한다 */
export function toolOrderKey(a: ToolRef, b: ToolRef): -1 | 0 | 1;

/** 정의 집합에서 모델에게 광고할 도구 목록을 만든다. 입력 순서와 무관하게 같은 결과를 낸다 */
export function orderTools(defs: readonly AnyCapabilityDef[]): readonly OrderedTool[];

/** fingerprint 입력 문자열. 키 정렬 JSON(공백 없음). 테스트와 디버깅용으로 공개한다 */
export function canonicalToolset(tools: readonly OrderedTool[]): string;

export type ToolsetFingerprint = `sha256:${string}`;

/** canonicalToolset의 SHA-256. Web Crypto(globalThis.crypto.subtle)를 쓴다 */
export function toolsetFingerprint(tools: readonly OrderedTool[]): Promise<ToolsetFingerprint>;

export interface ToolsetDiff {
  /** 새로 광고할 도구. toolOrderKey 순 */
  readonly added: readonly ToolWire[];
  /** 광고를 멈출 도구 */
  readonly removed: readonly ToolReference[];
  /** prev와 next를 정렬 목록으로 비교했을 때 처음 달라지는 위치. 같으면 null */
  readonly firstChangedIndex: number | null;
}

/** 두 도구 집합의 차이. 같은 name에 정의가 바뀐 도구는 added에만 넣는다(재정의) */
export function diffToolsets(prev: readonly OrderedTool[], next: readonly OrderedTool[]): ToolsetDiff;
```

### 3.9 예시 정의: `web.search`

[제안] 이 예시는 정의 형식을 설명하려고 줄인 것이다. `web.search`의 정본은 정의 파일 `xeon/packages/contracts/src/capabilities/defs/web.ts`이고 내용은 `L2.web.spec` §3.2가 정한다. 이 예시는 L2 정의와의 일치 검사 대상이 아니다. 줄인 점: 정본은 provider 정보를 최상위 `provider` 대신 `meta: WebCallMeta`(§3.11 `ProviderSelectionMeta` 포함)에 싣고, 출력에 `sources`·`answer`를, 결과에 `sourceId`와 발췌 위치·점수를, 입력에 `objective`·`freshness`·`provider`를 더하며(도구 파라미터는 `provider`를 빼고 `toInput`을 쓴다), 렌더링 표지를 `[${sourceId}]`로 쓰고, 고유 오류 `session_limit`와 `hints.idempotent`를 더한다(`L2.web.spec` §3.2 차이 표). 입력 필드는 `_research/web-tools.md` §4.2의 부분 집합이다.

[결정: m2-plan F.2] 정의 파일은 M2 기준으로 `defs/workspace.ts`, `defs/web.ts`, `defs/web-provider.ts`, `defs/mcp.ts`, `defs/knowledge.ts`, `defs/work.ts`, `defs/dialog.ts`다. 모두 `capabilities/index.ts`가 재노출하고 `@xeon/contracts/capabilities` 하나로 import한다. `defs/` 아래 깊은 경로는 `package.json` exports에 없다. 규칙은 다음과 같다.

- 객체·유니온 스키마는 `isolatedDeclarations` 때문에 export마다 타입이 필요하다. 읽기 전용 정적 타입을 손으로 적고 `Type.Unsafe<T>(shape satisfies SchemaProof<T, typeof shape>)`로 내보낸다(`eng.typescript.guide` TY-26 U5). 모양이 어긋나면 컴파일 오류다. 스키마를 이루는 하위 객체는 export하지 않는 `const`로 둔다. 정적 타입은 `type` 별칭이다. `interface`는 `ToolContent.structuredContent`(`JsonValue`)에 대입할 수 없기 때문이다.
- 모델에 가는 텍스트를 만드는 렌더러(`renderSearch`, `renderFetch`, `renderBrowse`, `renderTaskList`, `renderPlanSubmit`, `renderAsk` 등)와 경계 감싸기(`wrapUntrusted`, `wrapUntrustedMcp`, `wrapUntrustedSession`)는 순수 함수로 정의 파일에 둔다. 경계 표지를 닫는 문자열은 본문 안에서 `<`를 `&lt;`로 바꿔 무력화한다. 도메인별 표지 이름은 `<untrusted_web_content>`, `<untrusted_mcp_content>`, `<untrusted_session_content>`다.
- 정의 파일은 `records/`를 import하지 않는다(같은 순서, `F.readme` §3). BlobRef가 필요하면 `defs/workspace.ts`의 `ImageBlobRefSchema`(같은 모양)를 쓴다. 이 모양은 `records/blob.ts`와 일치하는지 시험이 확인한다.
- 도구가 없는 능력(`knowledge.ledger`, `work.goals`, `work.reports`, `dialog.commands`, `dialog.status`, `dialog.attachments`, `dialog.aside`, `dialog.styles`, `dialog.notify`)은 `tools: []`로 `validateCapability` 이슈 0건을 통과한다. §3.4가 도구 없는 능력을 허용한다.
- 경로를 다루는 스키마의 한계: `SkillFilePathSchema`(`defs/knowledge.ts`)의 패턴은 `references/../x`를 받아들인다. 서비스는 파일 시스템을 읽거나 쓰기 전에 `isSkillFilePath`로 점 마디를 다시 거른다. 패턴을 좁힐지는 `L2.knowledge.spec` 소관이다.

```ts
import { Type, type Static } from "typebox";
import { defineCapability, serviceKey, type ToolContent } from "@xeon/contracts/capabilities";

const Recency = Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")]);
const ContentMode = Type.Union([
  Type.Literal("none"), Type.Literal("snippets"), Type.Literal("highlights"), Type.Literal("full"),
]);

export const WebSearchInput = Type.Object({
  query: Type.String({
    minLength: 1, maxLength: 512,
    description: "검색어. site:, -site:, after:, before:, filetype:, 따옴표 지시어를 쓸 수 있다.",
  }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })),
  recency: Type.Optional(Recency),
  domains: Type.Optional(Type.Object({
    allow: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
    deny: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
  })),
  content: Type.Optional(ContentMode),
});

const Passage = Type.Object({
  text: Type.String(),
  kind: Type.Union([Type.Literal("highlight"), Type.Literal("snippet"), Type.Literal("excerpt"), Type.Literal("full")]),
});

export const WebSearchOutput = Type.Object({
  results: Type.Array(Type.Object({
    rank: Type.Integer({ minimum: 1 }),
    url: Type.String(),
    title: Type.Optional(Type.String()),
    publishedAt: Type.Optional(Type.String()),
    passages: Type.Array(Passage),
  })),
  /** 간추린 표기: 실제로 응답한 provider. 정본은 meta.provider(§3.11 ProviderSelectionMeta) */
  provider: Type.String(),
  /** 결과를 얻으려고 완화한 필터 차원. 예: ["recency"] */
  relaxed: Type.Optional(Type.Array(Type.String())),
});

function renderSearch(out: Static<typeof WebSearchOutput>): ToolContent {
  const lines = out.results.map((r) =>
    [`[s${r.rank}] ${r.title ?? r.url}${r.publishedAt ? ` (${r.publishedAt})` : ""} ${r.url}`,
      ...r.passages.map((p) => `  ${p.text}`)].join("\n"));
  return {
    content: [{ type: "text", text: `<untrusted_web_content>\n${lines.join("\n\n")}\n</untrusted_web_content>` }],
    structuredContent: out,
  };
}

export const WebSearch = defineCapability({
  id: "web.search",
  version: "1.0.0",
  description: "웹 검색. 모델 도구와 그룹 코드가 같은 서비스를 쓴다.",
  service: {
    methods: {
      search: {
        description: "검색어로 웹 문서를 찾아 순위와 발췌를 돌려준다.",
        input: WebSearchInput,
        output: WebSearchOutput,
        replay: "safe",
        errors: {
          query_rejected: { description: "provider가 검색어를 거부함(금칙어, 길이 등)", retryable: false },
        },
      },
    },
  },
  tools: [
    {
      name: "web_search",
      label: "웹 검색",
      description: "웹을 검색해 결과 목록과 발췌를 받는다. 결과 텍스트는 신뢰하지 않는 외부 내용이다.",
      method: "search",
      parameters: WebSearchInput,
      toContent: renderSearch,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, openWorld: true },
    },
  ],
});

export const WebSearchKey = serviceKey(WebSearch);   // ServiceKey<{ search(input, options?): Promise<...> }>
```

- 위 코드는 읽기 쉽도록 export 상수의 타입 주석을 생략했다. 생략은 이 예시에만 해당한다. `isolatedDeclarations`는 `xeon/tsconfig.base.json`에서 contracts 전체에 켜져 있으므로(`_research/foundation-plan.md` §2 언어 행) 실제 정의 파일은 export 상수마다 명시 타입 주석을 단다(`_research/notes/eng-2.md` §8).
- 모델 경로: 모델이 `web_search`를 호출하면 L1.tools가 `tool_call` 지점(F.extensions.spec, fold first)을 거쳐 `search(params, { signal, requestId })`를 호출한다. 결과는 `renderSearch`로 바꾸고 `tool_result` 지점(fold chain)을 거쳐 모델에게 돌아간다.
- 그룹 경로: L3 그룹(예: Helm)은 매니페스트 `requires`에 `{ id: "web.search", range: "^1.0.0" }`을 선언한다. 그룹 코드는 `g.capability(WebSearchKey)`로 API를 얻고, 모델 턴 밖(예: `drive` 함수 안의 병렬 탐색 준비, 경계 처리)에서 `await web.search({ query })`를 호출한다. 이 호출은 tool 지점을 거치지 않는다. 서비스 호출 정책은 X와 L1.tools가 정한다.
- 정의 파일의 위치 [제안, 확정]: 내장 L2 능력의 정의는 F의 `xeon/packages/contracts/src/capabilities/defs/<domain>.ts`에 둔다. 층 사이 규칙 2에 따라 L3가 provider 패키지(`cap-web`)를 import하지 않고 정의를 쓸 수 있어야 하기 때문이다. `L2.readme` §3·§5.1과 L2 plan의 첫 작업이 이 경로를 전제하므로 대안(각 cap 패키지가 구현 없는 `def` 서브패스를 export)은 쓰지 않는다. 정의의 내용은 각 `L2.<domain>.spec`이 정하고, F에는 데이터만 둔다. 외부 플러그인의 능력 정의는 구현과 분리된 정의 전용 모듈로 배포한다 [제안].

### 3.10 비밀 참조 형식 (`secrets.ts`)

[제안] 비밀 참조 형식의 정본을 이곳 하나에 둔다. `F.wire-settings.spec` §3.8.1 `SecretRef`는 이 스키마를 다시 export한다(settings가 capabilities보다 높은 순서라 import할 수 있다, `F.readme` §3). `L0.secrets.spec` §3.1은 아래 이름(`SECRET_REF_PATTERN`, `SecretName`, `SecretRefError`, `parseSecretRef` 등)을 import해 쓰고 같은 이름을 다시 정의하지 않는다.

```ts
import { Type, type TString, type TSchema } from "typebox";
import type { Brand, Result } from "../base/index.ts";

/** 비밀 이름. 소문자로 시작, 소문자·숫자·하이픈 2~64자 */
export const SECRET_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,63}$";
/** 비밀 참조. "secret://<이름>" */
export const SECRET_REF_PATTERN: string = "^secret://[a-z][a-z0-9-]{1,63}$";
/** 검사를 통과한 비밀 이름 */
export type SecretName = Brand<string, "SecretName">;
export type SecretRef = `secret://${string}`;
/** 검사를 통과한 비밀 참조. 런타임 모양은 SecretRef("secret://<name>")와 같다 */
export type SecretHandle = Brand<string, "SecretHandle">;
/** 정적 타입을 SecretName으로 좁힌 스키마(TY-26 U1). 같은 패턴을 검사하고 `parse`가 브랜드 타입을 돌려준다. [결정: open-issues D-04] */
export const SecretNameSchema: TUnsafe<SecretName> = Type.Unsafe<SecretName>(
  Type.String({ pattern: SECRET_NAME_PATTERN }),
);
export const SecretRef: TString = Type.String({ pattern: SECRET_REF_PATTERN });

/** 참조 구문 오류. 거부 규칙 표는 L0.secrets.spec §3.1이다 */
export type SecretRefError =
  | { readonly kind: "invalid_ref"; readonly reason: "scheme" | "name_pattern" | "trailing" }
  | { readonly kind: "unsupported_ref_syntax"; readonly syntax: "env_var" | "template" | "percent" | "provider_uri" };

/** 순수 함수. 문자열 하나가 비밀 참조이면 핸들과 이름을 돌려준다 */
export function parseSecretRef(input: string): Result<{ readonly handle: SecretHandle; readonly name: SecretName }, SecretRefError>;
/** 순수 함수. secretRef("exa-key") → "secret://exa-key". 이름 규칙 위반은 호출 결함이므로 Bug를 던진다 */
export function secretRef(name: string): SecretHandle;
/** 순수 함수. 입력 단계 검사. 문자열 안의 다른 비밀 구문($VAR, {{…}}, %…%, op:// 등)을 찾아 거부 사유를 돌려준다 */
export function findForeignSecretSyntax(text: string): readonly SecretRefError[];
```

- [결정: review.decisions-2 U-08] `SecretName`은 브랜드 타입이다. 문자열을 `SecretName`으로 바꾸는 경로는 `parseSecretRef`와 `SecretNameSchema` 검증(`parse`, `eng.typescript.guide` §1.2) 둘이다. `parseSecretRef`, `secretRef`, `findForeignSecretSyntax`는 입출력과 전역 상태를 쓰지 않으므로 F 런타임 로직 예외 1번(`F.readme` §1)에 든다. 구현은 이 파일에 두고, `SecretRefError`도 이 파일이 정본이다(`services/secrets.ts`에 두지 않는다).

[결정: review.decisions-2 U-08] 여러 층(L0.secrets, L1.tools, L2.workspace, L4 설정 화면)이 함께 쓰는 값 타입이다. 아래 블록이 정본이다. `L0.secrets.spec` §3.2(메타), §3.5(`RedactionHit`), §3.9(감사 레코드)의 블록을 옮겼고, 그 문서는 이 이름을 인용한다.

```ts
// secrets.ts (계속). import는 앞 블록과 같다

// ── 메타 (L0.secrets.spec §3.2) ─────────────────────────────────────
export const SecretUseModeSchema: TSchema = Type.Union([
  Type.Literal("env"),            // 사용 모드 M1. 마일스톤 M1: bash 도구 env 주입, 실행마다 승인(review.decisions-2 U-19)
  Type.Literal("sentinel"),       // 사용 모드 M2. 구현은 후속
  Type.Literal("runtime-http"),   // 사용 모드 M3. 마일스톤 M1: 모델 provider 키를 core-models의 프로세스 안 HTTP 클라이언트에 lease(L0.secrets.spec §4.3)
  Type.Literal("browser-input"),  // 사용 모드 M4. 마일스톤 M2
]);
export type SecretUseMode = "env" | "sentinel" | "runtime-http" | "browser-input";

/** 1차 내장은 sops. op·bws·keychain은 2차 플러그인 */
export const SecretProviderIdSchema: TSchema = Type.Union([
  Type.Literal("sops"), Type.Literal("op"), Type.Literal("bws"), Type.Literal("keychain"),
]);
export type SecretProviderId = "sops" | "op" | "bws" | "keychain";

export const SecretApprovalSchema: TSchema = Type.Union([Type.Literal("none"), Type.Literal("per-session"), Type.Literal("per-use")]);
export type SecretApproval = "none" | "per-session" | "per-use";
export const SecretScopeSchema: TSchema = Type.Union([Type.Literal("user"), Type.TemplateLiteral("project:${string}")]);
export type SecretScope = "user" | `project:${string}`;

export const SecretUsePolicySchema: TSchema = Type.Object({
  modes: Type.Array(SecretUseModeSchema, { uniqueItems: true }),        // 빈 배열 = 사용 불가
  tools: Type.Array(Type.String({ minLength: 1, maxLength: 128 })),     // "http.request", "bash:gh", "web.search"
  hosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 })),     // runtime-http, sentinel. "api.github.com", "*.example.com"
  origins: Type.Optional(Type.Array(Type.String({ pattern: "^https://[^/]+$" }))),     // browser-input
  commands: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),  // env에서만. "gh api *"
}, { additionalProperties: false });
export interface SecretUsePolicy {
  readonly modes: readonly SecretUseMode[];
  readonly tools: readonly string[];
  readonly hosts: readonly string[];
  readonly origins?: readonly string[];
  readonly commands?: readonly string[];
}

export const SecretMetaSchema: TSchema = Type.Object({
  name: SecretNameSchema,
  desc: Type.String({ minLength: 1, maxLength: 500 }),
  provider: SecretProviderIdSchema,
  ref: Type.String({ minLength: 1, maxLength: 512 }),                   // 제공자 안의 위치. sops는 "<env>/<KEY>"
  scope: SecretScopeSchema,
  expiresAt: Type.Union([Type.String({ format: "date" }), Type.Null()]),
  use: SecretUsePolicySchema,
  approval: SecretApprovalSchema,
  ttlSeconds: Type.Integer({ minimum: 1, maximum: 86_400 }),
  maxUses: Type.Integer({ minimum: 1, maximum: 100_000 }),
}, { additionalProperties: false });
export interface SecretMeta {
  readonly name: SecretName;
  readonly desc: string;
  readonly provider: SecretProviderId;
  readonly ref: string;
  readonly scope: SecretScope;
  readonly expiresAt: string | null;
  readonly use: SecretUsePolicy;
  readonly approval: SecretApproval;
  readonly ttlSeconds: number;
  readonly maxUses: number;
}

// ── 마스킹 결과와 감사 레코드 (L0.secrets.spec §3.5, §3.9) ────────────
export interface RedactionHit {
  /** "known:<name>" | 접두 패턴 kind("github_pat", "jwt", …) | "kv" */
  readonly kind: string;
  readonly count: number;
}
export type RedactionLayer = "human-input" | "tool-result" | "outbound" | "model-projection" | "ops-log";
export type SecretDenyReason =
  | "host_mismatch" | "origin_mismatch" | "command_mismatch"
  | "approval_missing" | "expired" | "lease_expired" | "lease_exhausted"
  | "mode_not_allowed" | "tool_not_allowed" | "scope_mismatch";
/** 사람 재확인 방법. tty-confirm은 OS 인증 재확인을 쓸 수 없는 터미널(CLI reveal 전용) */
export type ReauthMethod = "os-auth" | "passphrase" | "tty-confirm";

/** 값, 값의 일부, 값의 해시를 싣지 않는다. commandHash는 명령줄 문자열의 SHA-256 hex 앞 16자 */
export type SecretAuditRecord =
  | { readonly type: "secret.used"; readonly handle: SecretHandle; readonly mode: SecretUseMode; readonly toolCallId: string | null;
      readonly threadId: string | null; readonly host: string | null; readonly commandHash: string | null;
      readonly decision: "allow"; readonly leaseId: string; readonly at: number }
  | { readonly type: "secret.denied"; readonly handle: SecretHandle; readonly mode: SecretUseMode; readonly reason: SecretDenyReason;
      readonly purpose: string; readonly toolCallId: string | null; readonly threadId: string | null; readonly at: number }
  | { readonly type: "secret.approved"; readonly handle: SecretHandle; readonly scope: "per-session" | "per-use";
      readonly approvalId: string; readonly expiresAt: number | null; readonly threadId: string | null; readonly at: number }
  | { readonly type: "secret.created" | "secret.updated" | "secret.deleted" | "secret.rotated"; readonly handle: SecretHandle;
      readonly fields: readonly string[]; readonly actor: "human"; readonly at: number }
  | { readonly type: "secret.revealed"; readonly handle: SecretHandle; readonly reauth: ReauthMethod; readonly actor: "human"; readonly at: number }
  | { readonly type: "secret.masked"; readonly hits: readonly RedactionHit[]; readonly layer: RedactionLayer;
      readonly threadId: string | null; readonly at: number };
```

- [결정] 비밀 참조 형식은 `secret://<name>`이다(`_research/secrets.md` §6.1, `_research/decisions-log.md` 2026-10-21 2차).
- [결정: review.decisions-2 U-08] 값 타입의 정본은 위 블록이다. `SecretMeta`·`SecretUsePolicy`는 TS 인터페이스와 스키마(`*Schema`)를 함께 두고, 두 모양이 같은지 타입 테스트로 확인한다(§9). 세션 이벤트로 남는 감사 레코드 네 종류(`used`, `denied`, `approved`, `masked`)는 `F.records.spec` §3.3.1 `secret.*` payload가 정본이고, `SecretAuditRecord`의 같은 `type` 변형과 필드가 같아야 한다. 관리 레코드(`created`·`updated`·`deleted`·`rotated`·`revealed`)는 세션 이벤트가 아니다.
- 서비스 인터페이스(`SecretService`, `SecretProvider`, `Redactor`, `UseCtx`, `SecretLease`, `SecretError` 등)와 관리 서비스(`SecretAdminService`)는 이 파일에 두지 않고 `@xeon/contracts/services`의 `services/secrets.ts`, `services/secret-admin.ts`에 둔다(§3.12 표). `Redactor` 구현, SOPS 래퍼, `KeyProvider`는 `platform-secrets` 내부다.

### 3.11 provider 선택 공통 타입 (`provider.ts`)

[제안] provider가 여럿인 능력의 선택 체인 공통 타입을 둔다(`L2.readme` §5.2의 요청). 순수 함수 하나와 타입만 있으므로 F 런타임 로직 예외 1번(`F.readme` §1)에 든다. 탐침과 호출은 각 `cap-*`가 한다.

```ts
import { Type, type TString } from "typebox";

/** 내장 provider는 소문자 이름, 플러그인 provider는 "plugin:<확장 이름>" */
export const PROVIDER_ID_PATTERN: string = "^(plugin:[a-z][a-z0-9-]{1,31}|[a-z][a-z0-9-]{0,63})$";
export const ProviderIdSchema: TString = Type.String({ pattern: PROVIDER_ID_PATTERN });
export type ProviderId = string;
export type ProviderOrigin = "plugin" | "detected" | "builtin";
export type ProviderAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };
export interface ProviderFallback {
  readonly provider: ProviderId;
  readonly stage: "probe" | "call";    // probe = isAvailable 실패, call = 호출 중 오류(safe 메서드만)
  readonly reason: string;             // probe면 ProviderAvailability.reason, call이면 CapabilityErrorData.code
  readonly detail?: string;
}
/** provider 체인을 거친 메서드 출력의 meta에 싣는다 */
export interface ProviderSelectionMeta {
  readonly provider: ProviderId;
  readonly selectedBy: "call" | "setting" | "auto";
  readonly fallbacks: readonly ProviderFallback[];
}
export interface ProviderCandidate { readonly id: ProviderId; readonly origin: ProviderOrigin }
export interface ProviderOrderInput {
  readonly candidates: readonly ProviderCandidate[];
  readonly callProvider?: ProviderId;
  readonly settingProvider: "auto" | ProviderId;   // 설정 l2.<domain>.<능력>.provider
  readonly pluginOrder: readonly ProviderId[];      // 설정 l2.<domain>.<능력>.pluginOrder
}
/** 시도할 순서. 순수 함수. 명시 선택이면 원소 하나, 후보에 없으면 빈 배열 */
export function orderProviderCandidates(input: ProviderOrderInput): {
  readonly selectedBy: "call" | "setting" | "auto";
  readonly order: readonly ProviderId[];
};
```

- 순서 규칙: plugin은 `pluginOrder` 순(목록에 없는 플러그인은 그 뒤에 id 바이트 순), 그다음 detected, builtin은 각각 id 바이트 순이다. 명시 선택(호출 인자, 설정)은 다른 후보로 내려가지 않는다. 세부 규칙은 `L2.readme` §5.2다.
- provider 체인을 거치는 메서드의 출력은 `meta: ProviderSelectionMeta`(또는 이를 포함하는 도메인 메타)를 갖는다. 최상위 `provider` 필드는 쓰지 않는다. §3.9 예시의 최상위 `provider`는 간추린 표기다.

### 3.12 서비스 인터페이스 서브패스 (`@xeon/contracts/services`)

[결정: review.decisions-2 D-04] L0·L1 서비스 인터페이스, X 포트를 확장하는 L2·L3 서비스 인터페이스(`McpService`, `GroupService`, 규칙 7), 서비스 이름 상수를 F 서브패스 `@xeon/contracts/services`(`src/services/`)에 둔다. DR-02·DR-14·CM-05는 층 사이와 같은 층 패키지 사이의 협력을 F 인터페이스로만 하게 한다. 그래서 구현 패키지(`platform-*`, `core-*`)는 이 인터페이스를 구현해 Cordis 서비스로 등록하고, 소비 쪽은 구현 패키지를 import하지 않고 이 인터페이스로 주입받는다. 이 서브패스는 도메인을 새로 만들지 않는다. 능력과 같은 "서비스 계약" 범주라 이 문서가 배치 규칙을 정한다(`F.readme` §3).

| 인터페이스 | 서비스 이름 상수 | 서비스 이름 | 파일 | 구현 | 확장하는 포트 | 시그니처 초안(정본으로 옮길 블록) |
|---|---|---|---|---|---|---|
| `TaskService` | `TaskServiceName` | `xeon.tasks` | `services/tasks.ts` | `core-tasks` | `InputQueuePort` | `L1.tasks.spec` §3 |
| `LoopService` | `LoopServiceName` | `xeon.loop` | `services/loop.ts` | `core-loop` | `LoopPort` | `L1.loop.spec` §3 |
| `ModelService` | `ModelServiceName` | `xeon.models` | `services/models.ts` | `core-models` | `ModelsPort` | `L1.models.spec` §3.3 |
| `ToolService` | `ToolServiceName` | `xeon.tools` | `services/tools.ts` | `core-tools` | `ToolsPort` | `L1.tools.spec` §3.3 |
| `ApprovalService` | `ApprovalServiceName` | `xeon.approvals` | `services/approvals.ts` | `core-tools` | 없음 | `L1.tools.spec` §3.6 |
| `AgentService` | `AgentServiceName` | `xeon.agents` | `services/agents.ts` | `core-agents` | 없음 | `L1.agents.spec` §3.3 |
| `ContextService` | `ContextServiceName` | `xeon.context` | `services/context.ts` | `core-context` | 없음 | `L1.context.spec` §3 |
| `ExecService`(`ExecutionEnv` 확장) | `ExecServiceName` | `xeon.exec` | `services/exec.ts` | `platform-exec` | 없음 | `L0.exec.spec` §3.1, §3.6, §3.9 |
| `SandboxService` | `SandboxServiceName` | `xeon.sandbox` | `services/sandbox.ts` | `platform-sandbox` | 없음 | `L0.sandbox.spec` §3 |
| `ProcessService` | `ProcessServiceName` | `xeon.process` | `services/process.ts` | `platform-process` | `ProcessPort` | `L0.process.spec` §3 |
| `OsService` | `OsServiceName` | `xeon.os` | `services/models.ts` | `ModelService`, `ModelServiceName`, 역할·참조·바인딩 값 타입. hosted 검색 포트 `HostedSearchPort`와 `HostedSearchRequest`, `HostedSearchResponse`, `HostedSearchError`, `HostedSearchSupport`, `HostedSearchContinuation`(불투명 문자열). `ModelService.hostedSearch`는 선택 필드이고 core-models가 L1C.3에서 구현하면 필수로 올린다. 요청은 hosted 검색 도구 하나만 단 단일 턴이며 대화 기록에 남지 않는다 [결정: m2-plan F.4, L2.web.spec §4.8.4] | `L1.models.spec` §3, `L2.web.spec` §8 |
| `services/os.ts` | `platform-os` | 없음 | `L0.os.spec` §3 |
| `SecretService` | `SecretServiceName` | `xeon.secrets` | `services/secrets.ts` | `platform-secrets` | 없음 | `L0.secrets.spec` §3.3~§3.6, §3.10 |
| `SecretAdminService` | `SecretAdminServiceName` | `xeon.secretAdmin` | `services/secret-admin.ts` | `platform-secrets` | 없음 | `L0.secrets.spec` §3.8 |
| `McpService` | `McpServiceName` | `xeon.mcp` | `services/mcp.ts` | `cap-mcp` | `McpPort` | `L2.mcp.spec` §3.2 |
| `GroupService` | `GroupServiceName` | `xeon.groups` | `services/groups.ts` | `group-kit` | `LeaseArbiterPort` | `L3.group-kit.spec` §3.8 |

파일별 이름. 위 표의 인터페이스와 이름 상수 외에 각 파일에 두는 이름이다. 필드는 오른쪽 열 블록을 옮겨 확정한다(규칙 1).

| 파일 | 이름 | 초안 블록 |
|---|---|---|
| `services/sandbox-report.ts` | `SandboxViolation`, `SandboxRunReport`, `SandboxRunReportSchema`. 아무 파일도 import하지 않는다 | `L0.sandbox.spec` §3.1 |
| `services/exec.ts` | `CancelScope`, `FileKind`, `FileErrorCode`, `ExecutionErrorCode`, `FileError`, `ExecutionError`, `FileInfo`, `TextLine`, `TextLineReader`, `LineScan`, `BinaryReader`, `DirReader`, `WatchTarget`, `WatchChange`, `FileWatcher`, `FileSystem`, `ShellSpillOptions`, `ShellOutputWindow`, `ShellOutputSkip`, `ShellOutputInfo`, `ShellExecOptions`(`secretEnv?: SecretEnvRequest` 포함), `SecretEnvRequest`, `ShellExecResult`(`sandbox?: SandboxRunReport` 포함), `Shell`, `ExecutionEnv`, `BackgroundExecHandle`, `ExecService`, `ExecServiceName`, `SENSITIVE_ENV_PATTERNS`. `sandbox-report.ts`, `secrets.ts`(`UseCtx`), `../capabilities`(`SecretRef`)를 import한다 | `L0.exec.spec` §3.1, §3.5, §3.6, §3.9 |
| `services/sandbox.ts` | `L0.sandbox.spec` §8 F 요청 표의 이름 전부(`SandboxPolicy`, `SandboxStatus`, `describeSandboxStatus`, `matchProtectedPath` 등). `exec.ts`, `sandbox-report.ts`를 import한다 | `L0.sandbox.spec` §3.1 |
| `services/session.ts` | `SessionPortKey`만 둔다. `SessionService`는 records가 소유한다(규칙 9). `../extensions`, `../records`를 import type으로 가져온다 | `L1.persistence.spec` §3.3 |
| `services/store.ts` | `StoreServicePortKey`만 둔다. `StoreService`는 records가 소유한다(규칙 9). `../extensions`, `../records`를 import type으로 가져온다 | `L0.store.spec` §8 |
| `services/os.ts` | `OsPlatform`, `OsArch`, `OsInfo`, `OsDirs`, `FsKind` 등 `L0.os.spec` §3이 `src/services/os.ts`로 표시한 이름과 알림 타입 `NotifyKind`, `OsNotification`, `NotifyError`(아래 블록) | `L0.os.spec` §3.1~§3.3, §3.7 |
| `services/process.ts` | `ProcessService`, `BackgroundRegistry`와 관련 타입, `ShutdownCoordinator`, `ShutdownReason` | `L0.process.spec` §3.1(그 문서 FR-P7) |
| `services/secrets.ts` | `SecretService`, `SecretServiceName`, `UseCtx`, `SecretUseTarget`, `ApprovalEvidence`, `SecretValueView`, `SecretLease`, `SecretProviderCapabilities`, `ProviderEntry`, `SecretProvider`, `RegisterKnownError`, `Redactor`, `SecretStatus`, `SecretListing`, `UseDecision`, `ApprovalPrompt`, `HttpTemplate`, `ConcreteHttpRequest`, `HttpResponseLike`, `SecretDiagnostics`, `SecretError`, `KeyProviderIdPublic`. 값 타입과 참조 형식(`SecretName`, `SecretHandle`, `SecretRefError`, `SecretUseMode`, `SecretProviderId`, `SecretMeta`, `SecretDenyReason`, `RedactionHit`, `SecretAuditRecord`)은 `../capabilities`에서 가져온다(§3.10) | `L0.secrets.spec` §3.3~§3.6, §3.10 |
| `services/secret-admin.ts` | `SecretAdminService`, `SecretAdminServiceName`, `SecretValueSource`, `HumanReauth`(`method: ReauthMethod`), `SecretMetaPatch`, `SecretTestResult`, `SecretReferenceReport`. in-process 값 전달 통로 `SecretOutOfBandPort`, `SecretEntryOffer`, `SecretRevealOffer`, `SecretEntryAction`(wire `secret.beginEntry`·`secret.beginReveal`이 값 없이 시작만 알리고 CLI가 입력·열람 수단을 wire 밖으로 맡긴다, `F.wire-settings.spec` §3.3.1). `secrets.ts`를 import한다 | `L0.secrets.spec` §3.8, `L4.cli.spec` §4.7 |
| `services/tools.ts` | `ToolService`, `ToolServiceName`, 도구 메타(`ToolRisk`, `ToolClass`, `ToolMeta`, `ToolPolicyMeta`), 정책 값 타입(`PolicyRule`, `TieredRule`, `PolicyInput`, `PolicyDecision`, `PolicyCeiling`, `PolicyRuleSchema`, `CallerId`, `PermissionMode`), `ToolRunContext`, `ToolRunDrafts`(`ToolRunContext.drafts`: 소유 컨텍스트가 낙인한 toolResult 초안과 승인 대기 체크포인트 초안을 만드는 생성기), 광고 타입. 정책 평가 함수(`evaluatePolicy`, `ruleMatches`, `validateRules`)는 core-tools가 구현하고 F에는 두지 않는다. 도구 인자를 이벤트에 그대로 싣는 한도(192 KiB, 넘으면 blob)는 core-tools 상수다. F는 `ToolApprovalBody.args`가 `BlobRef`를 받을 수 있게만 한다 [결정: open-issues V-08] | `L1.tools.spec` §3 |
| `services/policy.ts` | `PolicyEvaluator`(평가기 함수 모양), `ChildPolicyView`, `stricter`, `matchToolGlob`, `childDecision`. 자식 대화의 권한 상한을 계산하는 순수 함수다. 평가기를 인자로 받으므로 core-tools와 core-agents가 서로를 import하지 않고 쓴다 [결정: m2-plan F.4, L1.tools·L1.agents F 요청 9] | `L1.tools.spec` §4.5, `L1.agents.spec` §4.3 |
| `services/approvals.ts` | `ApprovalService`, `ApprovalServiceName`, 승인 값 타입(`ApprovalKind`, `ApprovalBody`, `ApprovalRequest`, `ApprovalResolution`, `ApprovalRequestError` 등). L2 공통 승인 포트 `L2ApprovalsPort`와 `L2ApprovalKind`, `L2ApprovalSnapshot`, `L2ApprovalRequest`, `L2ApprovalRespondInput`, `L2_APPROVAL_REQUEST_ID_MAX`(48). 실패는 `Result` 오류 값이다. cap-*가 `ApprovalService`를 이 모양으로 감싼다 [결정: m2-plan F.4, L2.readme §5.7] | `L1.tools.spec` §3.6, `L2.readme` §5.7 |
| `services/agents.ts` | `AgentService`, `AgentServiceName`. `SpawnRequest` 등 값 타입의 위치는 `L1.agents.spec` §8.3 8번을 따른다 | `L1.agents.spec` §3.3 |
| `services/mcp.ts` | `McpService`, `McpServiceName`. `McpClient` 능력 정의는 `capabilities/defs/mcp.ts`(§3.9)에 두고 이 파일이 import한다 | `L2.mcp.spec` §3.2 |
| `services/groups.ts` | `GroupService`, `GroupServiceName`, `DriveRole`, `GroupError`, `GroupStatus`, `GroupCommandError`, `GroupResult`, `ToggleReceipt`, `HolderReceipt`, `DriveHolderSetting`, `GroupMetricsSummary`. `GroupId`·`ScopeId`·`ScopeStatus`·`LeaseId`·`RecordKind`·`Unsubscribe`·`LeaseArbiterPort`는 `../extensions`에서 가져온다. settings를 import하지 않으므로 `setDriveHolder`의 `scope` 옵션과 `HolderReceipt.scope`는 `SettingScope`와 같은 모양(`"managed" \| "user" \| "project" \| "local" \| "session"`)으로 적는다 | `L3.group-kit.spec` §3.8 |

```ts
// src/services/names.ts
/** 서비스 이름 상수 모음. 각 파일의 <X>ServiceName과 같은 값이다 */
export const SERVICE_NAMES: {
  readonly tasks: "xeon.tasks"; readonly loop: "xeon.loop"; readonly models: "xeon.models";
  readonly tools: "xeon.tools"; readonly approvals: "xeon.approvals"; readonly agents: "xeon.agents";
  readonly context: "xeon.context"; readonly exec: "xeon.exec"; readonly sandbox: "xeon.sandbox";
  readonly process: "xeon.process"; readonly os: "xeon.os"; readonly secrets: "xeon.secrets";
  readonly secretAdmin: "xeon.secretAdmin"; readonly mcp: "xeon.mcp"; readonly groups: "xeon.groups";
};
export type ServiceName = (typeof SERVICE_NAMES)[keyof typeof SERVICE_NAMES];

// src/services/tasks.ts (포트를 확장하는 다른 파일도 같은 모양)
import type { InputQueuePort } from "../extensions/index.ts";
export const TaskServiceName: "xeon.tasks" = "xeon.tasks";
export interface TaskService extends InputQueuePort { /* L1.tasks.spec §3의 메서드 */ }

// src/services/loop.ts, tools.ts, models.ts, process.ts, mcp.ts, groups.ts
export interface LoopService extends LoopPort { /* L1.loop.spec §3 */ }
export interface ToolService extends ToolsPort { /* L1.tools.spec §3.3 */ }
export interface ModelService extends ModelsPort { /* L1.models.spec §3.3 */ }
export interface ProcessService extends ProcessPort { /* L0.process.spec §3.1 */ }
export interface McpService extends McpPort {
  /** 능력 API. 같은 객체를 cap:mcp.client 바인딩(g.capability(McpClientKey))으로도 얻는다 */
  readonly client: CapabilityApi<typeof McpClient>;
}
export interface GroupService extends LeaseArbiterPort { /* L3.group-kit.spec §3.8 */ }

// src/services/exec.ts (발췌)
export interface ExecService extends ExecutionEnv {
  withCwd(cwd: string): ExecutionEnv;
  startBackground(command: string | readonly string[], options: Omit<ShellExecOptions, "timeout" | "spill"> | undefined, context: CancelScope): Promise<Result<BackgroundExecHandle, ExecutionError>>;
}
export const ExecServiceName: "xeon.exec" = "xeon.exec";

// src/services/os.ts (알림 발췌. 1차 M3)
/** 알림 종류. L2.dialog.spec의 NoticeKind 5종을 이 4종으로 옮긴다(L2.dialog.spec 대응표) */
export type NotifyKind = "done" | "approval" | "question" | "error";
export interface OsNotification {
  readonly kind: NotifyKind;
  readonly title: string;     // 1~80자
  readonly body: string;      // 0~400자. 마스킹을 거친 문자열만
  readonly threadId?: ThreadId;
}
export type NotifyError =
  | { readonly kind: "disabled" }
  | { readonly kind: "unavailable"; readonly provider: string; readonly reason: string }
  | { readonly kind: "failed"; readonly provider: string; readonly code: string }
  | { readonly kind: "cancelled" };
```

규칙:

1. 인터페이스와 그 서비스만 쓰는 인자·결과·오류 타입은 위 표의 파일에 둔다. 메서드 모양의 정본은 F다. 표의 소유 문서 블록은 F로 옮기기 전의 초안이고, 옮긴 뒤 소유 문서는 F 이름을 인용한다. 옮기는 작업은 `F.capabilities.plan` P9가 맡는다.
2. 서비스 이름은 `xeon.<이름>` 형식이고 `eng.context-map.design` §5.3 표와 같다. 능력 서비스 이름 `cap:<id>`(§3.5)와 이름 공간이 겹치지 않는다. [결정: review.decisions-2 D-04] 같은 서비스 이름의 X 포트(`F.extensions.spec` §3.2.1 `ports.ts`)가 있으면 서비스 인터페이스가 포트를 확장한다. 대상은 `LoopService extends LoopPort`, `TaskService extends InputQueuePort`, `ToolService extends ToolsPort`, `ModelService extends ModelsPort`, `ProcessService extends ProcessPort`, `McpService extends McpPort`, `GroupService extends LeaseArbiterPort`다(위 표 "확장하는 포트" 열). records에 있는 `StoreService`는 `ScopedStorePort`(`Pick<StoreService, "scoped">`)를 그대로 만족하고, `SessionService`는 `ext`·`projectors` 속성이 `RecordCommitPort`·`ProjectorRegistryPort`다(`F.records.spec` §3.9). Cordis에는 서비스 인터페이스 하나로 등록한다.
3. 여러 서비스가 함께 쓰는 값 타입은 원래 도메인 파일에 둔다. 예: 저장·투영 포트(`StoreService`, `SessionService`)는 `F.records.spec` §3.9, 비밀 값 타입은 §3.10, provider 선택 타입은 §3.11이다. [제안] 모델·컨텍스트 값 타입(`ModelBinding`, `CachePolicy` 등)은 `services/models.ts`에 두고 `services/context.ts`가 import한다. `L1.models.spec`·`L1.context.spec`이 요청한 `capabilities/models.ts`·`context.ts` 위치는 이 규칙으로 바꾼다.
4. import 순서는 `F.readme` §3 표의 순서 4다. `services/`는 base, conversation, records, capabilities, extensions를 `import type`으로만 import한다. settings·wire와는 서로 import하지 않는다. 같은 서브패스 안의 파일 사이 import는 아래 방향만 허용하고, 서브패스 안에 순환이 없어야 한다(`test/services/imports.test.ts`가 그래프를 검사한다). [결정: open-issues D-05] 여러 서비스가 쓰는 공용 값 타입은 그 타입을 정의한 파일(규칙 3)에 두고, 쓰는 쪽이 import한다. 새 방향은 이 목록을 먼저 고친다.

   | 쓰는 파일 | 가져오는 파일 | 가져오는 이름의 부류 |
   |---|---|---|
   | `agents.ts`, `approvals.ts`, `loop.ts`, `policy.ts` | `tools.ts` | 도구·정책 값 타입(`CallerId`, `PermissionMode`, `PolicyRule`, `PolicyInput`, `PolicyCeiling`, `ToolRisk` 등) |
   | `loop.ts` | `agents.ts`, `tasks.ts` | 에이전트 값 타입, 소유 트리 값 타입 |
   | `context.ts` | `models.ts` | 모델·캐시 값 타입 |
   | `exec.ts` | `sandbox-report.ts`, `secrets.ts` | 샌드박스 보고, `UseCtx` |
   | `sandbox.ts` | `exec.ts`, `sandbox-report.ts` | 실행 환경 값 타입, 샌드박스 보고 |
   | `secret-admin.ts` | `secrets.ts` | 비밀 서비스 값 타입 |

   `sandbox-report.ts`, `secrets.ts`, `groups.ts`, `models.ts`, `tools.ts`, `tasks.ts`, `names.ts`, `mcp.ts`, `process.ts`, `os.ts`, `session.ts`, `store.ts`는 같은 서브패스의 다른 파일을 import하지 않는다. 이 밖의 파일끼리는 import하지 않는다. L1 문서가 요청한 `capabilities/tools.ts`·`policy.ts`·`approvals.ts` 위치는 이 규칙으로 `services/tools.ts`, `services/policy.ts`, `services/approvals.ts`가 된다.
5. 문서 라우팅: `_routing/routes.yaml`의 F layout은 도메인 경로 `src/<도메인>/**`와 services 경로 `src/services/**`를 둔다. 이 문서와 `F.capabilities.plan`의 binds에 `xeon/packages/contracts/src/services/**`가 있으므로 `src/services/**`는 이 두 문서로 라우팅된다.
6. 런타임 값은 서비스 이름 상수, 서비스 전체 모양의 포트 키(규칙 9), F 런타임 로직 예외에 드는 순수 함수(`describeSandboxStatus`, `matchProtectedPath`)뿐이다. 구현, 기본 구현, 테스트 대역은 두지 않는다(`F.readme` §1, review.decisions-2 U-03).
7. [결정: review.decisions-2 D-04] `ApprovalService`, `AgentService`, `SecretService`(`L0.secrets.spec` §8.3 R1-a), `SecretAdminService`(같은 문서 R2), `McpService`, `GroupService`도 이 서브패스에 둔다. `McpService`는 L2 서비스지만 `McpPort`(extensions)를 확장해야 하고 capabilities는 extensions보다 낮아(`F.readme` §3) `capabilities/defs/mcp.ts`에 둘 수 없다. 그래서 `services/mcp.ts`에 두고 능력 정의 `McpClient`만 capabilities에 둔다. `GroupService`는 L3 `group-kit`이 구현하는 서비스지만 `LeaseArbiterPort`(extensions)를 확장하고 X가 그 포트로 주입받으므로 같은 이유로 `services/groups.ts`에 둔다. `L3.group-kit.spec` §3.8의 블록은 F로 옮기기 전의 초안이다(규칙 1). 다른 L2 서비스(`WorkspaceService` 등)는 포트를 확장하지 않으므로 지금처럼 capabilities에 둔다.
8. `SERVICE_NAMES`는 위 표의 서비스 이름 15개와 같다(§9).
9. 서비스 전체 모양의 포트 키(`PortKey<XService>`, 값은 `{ name: <X>ServiceName }`)는 서비스 이름 상수 옆에 둔다: `TaskServicePortKey`(`services/tasks.ts`), `ModelServicePortKey`(`models.ts`), `ToolServicePortKey`(`tools.ts`), `ApprovalServicePortKey`(`approvals.ts`), `ContextPortKey`(`context.ts`), `ExecPortKey`(`exec.ts`), `OsPortKey`(`os.ts`), `SecretServicePortKey`(`secrets.ts`), `SessionPortKey`(`services/session.ts`), `StoreServicePortKey`(`services/store.ts`). `ModelService`, `TaskService`, `ToolService`는 각각 `ModelsPort`, `InputQueuePort`, `ToolsPort`를 확장하지만 키는 둘이다: 확장 지점이 등록 부분형만 볼 때는 extensions의 `ModelsPortKey`, `InputQueuePortKey`, `ToolsPortKey`를, 서비스 전체를 쓸 때는 위 키를 쓴다(이름은 같다). `SessionService`와 `StoreService`는 records가 소유하는데 records(순서 2)는 `PortKey`(extensions, 순서 3)를 import할 수 없어 키만 `services/session.ts`, `services/store.ts`에 두고, 이름은 `SessionServiceName`, `StoreServiceName`과 같아야 한다(`names.test.ts`가 지킨다). 소비 패키지는 키를 자기 쪽에 다시 만들지 않고 `@xeon/contracts/services`에서 가져온다. 남은 지역 키는 `platform-exec`의 `SecretsPortKey`(`SecretEnvSource` 부분형)뿐이며 F 서비스의 전체 모양이 아니다.
10. [결정: open-issues D-03] 자식 프로세스 env 거부 목록 `SENSITIVE_ENV_PATTERNS`의 위치는 `@xeon/contracts/services`의 `services/exec.ts` 하나다. `capabilities` 서브패스에 두지 않는다. `L0.exec.spec`, `L0.sandbox.spec`(자가 시험), `L0.secrets.spec`(sops 호출 env)과 각 plan은 이 위치를 인용한다.
11. [결정: m2-plan F.4] 정책 상한 계산(`childDecision`)처럼 두 L1 패키지가 함께 써야 하는 순수 함수는 F `services/`에 두되, 구현 패키지만 아는 평가기는 인자로 받는다. F는 구현 패키지를 import하지 않는다.

## 4. 동작 규칙

### 4.1 버전과 범위

- `CapabilityDef.version`은 semver 정확 버전이다. 메서드 추가, 선택 입력 필드 추가, 출력 필드 추가는 minor다. 필드 삭제, 필수 입력 추가, 타입 변경, 도구 이름 변경은 major다.
- `SemVerRange`가 허용하는 형식 [제안]: `x.y.z`, `^x.y.z`, `~x.y.z`, `>=x.y.z`, `>=x.y.z <a.b.c`. 와일드카드와 `||`는 쓰지 않는다. 범위 만족 계산은 X가 하고, F는 `isSemVerRange`로 형식만 검사한다.

### 4.2 도구 → 서비스 메서드 환원 규칙

[제안] 모델 도구는 서비스 메서드의 얇은 어댑터다. L1.tools가 `ToolSpec`과 서비스 API로 실행 함수를 만들 때 아래 순서를 지킨다.

1. 모델이 보낸 인자를 `parameters`로 검증한다(L1.tools). 실패하면 메서드를 호출하지 않는다.
2. 메서드 입력 `input = toInput ? toInput(params) : params`를 만든다.
3. `api[method](input, { signal, requestId })`를 호출한다. `requestId`는 `toolCallId`에서 결정적으로 만든다.
4. 메서드 출력으로 결과를 만든다.
   - `toContent`가 있으면 그 반환값을 쓴다.
   - 없으면 기본 렌더링을 쓴다. `content`는 출력의 키 정렬 JSON 텍스트 하나이고, `structuredContent`는 출력 그대로다.
5. `CapabilityError`가 나면 `isError: true` 결과로 바꾼다. `content`는 `"[<code>] <message>"` 텍스트, `details`는 `CapabilityErrorData`다. `code`가 `aborted`면 중단 결과로 처리한다(L1.tools).

부속 규칙:

- `toInput`과 `toContent`는 순수 결정 함수여야 한다. 재생 때 다시 실행되기 때문이다. 시각, 난수, I/O를 쓰지 않는다.
- `toInput`이 없으면 `parameters`와 메서드 `input`의 정규화 JSON(§4.3)이 같아야 한다. 다르면 `tool_input_mismatch` 오류다.
- `outputSchema`는 `structuredContent`의 스키마다. `toContent`가 없으면 메서드 `output`이 `outputSchema`가 된다. `toContent`가 `structuredContent`를 채우면 `outputSchema`를 명시해야 하고, `outputSchema`가 없으면 `toContent`의 `structuredContent`는 메서드 `output` 스키마를 만족해야 한다. 결과 검증은 L1.tools가 한다.
- 도구의 `replay`는 메서드의 `replay`보다 넓을 수 없다. 메서드가 `"unsafe"`(생략 포함)인데 도구가 `"safe"`를 선언하면 `validateCapability`가 `replay_widened` 오류를 낸다 [제안]. 도구 재실행은 결국 메서드 재호출이기 때문이다.

### 4.3 도구 스키마

- 단일 원천: TypeBox 스키마 하나가 JSON Schema와 TS 타입을 함께 정한다. TypeBox 값이 곧 JSON Schema이므로 별도 생성 단계와 drift 검사 단계를 두지 않는다(`_research/layer-plan-v2.json` F3 "도구 스키마", `_research/packages.md` §4.1 F3 도구 스키마 행). `_research/item-catalog.md` F절 "스키마 단일 원천 생성과 drift 검사" 행의 생성·CI diff 단계는 이 능력 계약에는 적용하지 않는다.
- 방언: JSON Schema 2020-12를 쓴다(`_research/item-catalog.md` F절 "도구 스키마 정의" 행). [가정] TypeBox 1.3.27가 내는 키워드는 2020-12 어휘 안에 있다. `typebox` 1.3.27가 2020-12 메타 스키마 모듈을 포함한다는 점까지만 확인했다(`_research/notes/F-2.md` §5.3).
- `toJsonSchema(schema)` 규칙 [제안]:
  - 열거 가능한 문자열 키만 남긴다. `~`로 시작하는 TypeBox 내부 키(`~kind`, `~optional`, `~refine` 등)는 지운다.
  - 함수, `RegExp`, `undefined`, 심볼은 지운다. 이 과정에서 무언가 지워지면 `schema_not_json` 경고다.
  - `Type.Refine`의 검사 함수는 JSON Schema로 표현되지 않으므로 모델에게 보이지 않는다. `schema_refine_dropped` 경고를 낸다. 런타임 검증(L1.tools의 `Value.Check`)에서는 그대로 적용된다.
  - `$schema` 키는 넣지 않는다. 방언은 계약으로 고정한다.
- 루트: `parameters`와 메서드 `input`의 루트는 `type: "object"`여야 한다(`parameters_not_object`, `method_input_not_object`).
- `$ref` [제안]: 같은 스키마 안의 `#/$defs/<이름>`만 허용한다. 외부 URI와 `$id` 기반 참조는 `schema_ref_external` 오류다. 순환 참조(`Type.Cyclic`)는 허용하되 `schema_cyclic` 경고를 낸다. 순환을 지원하지 않는 provider를 위한 인라인 전개는 L1.models 어댑터 몫이다.
- 크기 한도 [제안]. 수치는 provider 공식 한도를 확인하지 않은 보수값이다 [가정].

| 대상 | 한도 | 위반 시 |
|---|---|---|
| 도구 하나의 `parameters` 정규화 JSON | 32 KiB | `schema_too_large` 오류 |
| 스키마 중첩 깊이 | 12 | `schema_too_deep` 오류 |
| 도구 `description` | 4,096자 (1,024자 초과는 경고) | `description_too_long` |
| `label` | 1~64자 | `tool_label_invalid` 오류 |
| 한 도구 집합의 도구 수 | 128 | L1.tools가 거부. F는 상수 `MAX_TOOLS_PER_REQUEST = 128`만 둔다 |

- 정규화 JSON: 객체 키를 UTF-16 코드 단위 순으로 정렬하고 공백 없이 직렬화한다. 배열 순서는 유지한다. ID와 이름은 ASCII로 제한되므로 이 순서는 UTF-8 바이트 순과 같다.

### 4.4 도구 없는 능력, 서비스 없는 도구

- [제안] 도구 없는 능력은 허용한다(`tools: []`). 그룹이나 다른 능력만 쓰는 서비스(예: 지식 저장소 쓰기)가 있기 때문이다. 허용 여부의 확정은 [미결]이다(§10).
- 서비스 메서드가 없는 능력은 허용하지 않는다(`service_empty` 오류).
- 서비스 없는 도구는 `CapabilityDef`에 둘 수 없다. 모든 `ToolSpec.method`는 `service.methods`의 키여야 한다(`method_missing` 오류). 서비스 없이 모델에게만 노출되는 도구(pi 확장의 `registerTool` 도구 등)는 능력이 아니다. 이런 도구는 X의 리소스 등록 경로로 등록하며 이 문서의 대상이 아니다.
- 도구가 없는 메서드는 허용한다. 서비스 API가 모델 도구보다 넓은 경우가 흔하다.

### 4.5 도구 목록의 결정적 순서

- `toolOrderKey(a, b)`: `a.capability`와 `b.capability`를 바이트 순으로 비교하고, 같으면 `a.name`과 `b.name`을 비교한다. `localeCompare`를 쓰지 않는다.
- 능력 밖의 도구도 같은 비교 함수에 넣는다 [제안]. 순서 키의 `capability` 자리에 확장 도구는 `ext.<확장 이름>`, MCP 도구는 `mcp.<서버 이름>`을 쓴다.
- `orderTools(defs)`는 입력 배열 순서와 무관하게 같은 결과를 낸다. 같은 키가 두 번 나오면 결과를 만들지 않고 예외를 던진다. 이 경우는 `validateCapabilitySet`의 `tool_name_conflict`로 먼저 걸러야 한다.
- `toolsetFingerprint`는 모델에게 보이는 부분만 해시한다. 입력은 순서대로 늘어놓은 `{ name, description, parameters: toJsonSchema(parameters) }` 배열의 정규화 JSON이다. `label`, `hints`, `replay`, `version`은 포함하지 않는다.
- 해시는 Web Crypto SHA-256을 쓴다 [제안]. Bun 1.4, Tauri WebView, 브라우저에 모두 있는 표준 API이므로 F에 패키지 의존이 늘지 않는다. 비동기라서 반환 타입이 `Promise`다. 대안인 순수 TS 구현은 F.capabilities.plan §3 P6에서 비교한다.
- 대화 중간의 추가·제거: 첫 요청의 도구 집합은 정렬 목록 전체를 앞머리에 둔다. 그 뒤의 변경은 정렬 목록을 다시 만들지 않는다. L1.context가 `diffToolsets(prev, next)`의 `added`와 `removed`를 pi-ai `SystemMessage.toolsAdded`, `toolsRemoved`로 대화 기록의 그 위치에 넣는다(`~/projects/_ref/pi-src/packages/ai/src/types.ts:541-557`). Anthropic API에서는 pi-ai가 이 메시지를 `tool_addition`, `tool_removal` 블록으로 바꾼다(`~/projects/_ref/pi-src/packages/ai/src/api/anthropic-messages.ts:1325-1352`). 같은 이름의 재정의는 제거 없이 추가만 보낸다(같은 파일 1340-1343행). 이렇게 하면 앞머리 접두가 유지되어 프롬프트 캐시가 깨지지 않는다(`_research/item-catalog.md` 진보된 설계 10번).
- `firstChangedIndex`는 정렬 목록 전체를 다시 광고할 경우 캐시 접두가 깨지는 위치를 알려 준다. L1.context가 재광고와 시스템 메시지 추가 중 하나를 고르는 근거로 쓴다.

### 4.6 정적 검증 규칙

`validateCapability(def)`가 내는 이슈:

| 코드 | 심각도 | 조건 |
|---|---|---|
| `id_invalid` | error | `id`가 `CAPABILITY_ID_PATTERN`을 만족하지 않음 |
| `id_reserved` | error | 첫 세그먼트가 `core`, `ext`, `grp`, `x` |
| `version_invalid` | error | `version`이 `SEMVER_PATTERN`을 만족하지 않음 |
| `description_empty` | error | 능력, 메서드, 도구의 `description`이 빈 문자열 |
| `service_empty` | error | `service.methods`가 비어 있음 |
| `method_name_invalid` | error | 메서드 이름이 `^[a-z][a-zA-Z0-9]{0,47}$`를 만족하지 않음 |
| `method_input_not_object` | error | 메서드 `input` 루트가 객체가 아님 |
| `error_code_invalid` / `error_code_shadow` | error | 고유 오류 코드 형식 위반 / 공통 코드와 같은 이름 |
| `tool_name_invalid` | error | `name`이 `TOOL_NAME_WIRE_PATTERN` 위반 |
| `tool_name_style` | warning | 내장 능력(`defs/<domain>.ts`) 도구의 `name`이 `TOOL_NAME_PATTERN`(소문자 snake_case) 위반. 확장 도구는 `EXTENSION_TOOL_NAME_PATTERN`으로 검사한다(§3.1) |
| `tool_name_duplicate` | error | 한 정의 안에서 같은 `name`이 두 번 |
| `tool_label_invalid` | error | `label`이 비었거나 64자 초과 |
| `method_missing` | error | `tools[i].method`가 `service.methods`에 없음 |
| `tool_input_mismatch` | error | `toInput`이 없는데 `parameters`와 메서드 `input`이 다름 |
| `replay_widened` | error | 도구 `replay`가 `"safe"`인데 메서드 `replay`가 `"unsafe"`(생략 포함) |
| `parameters_not_object` | error | `parameters` 루트가 객체가 아님 |
| `schema_ref_external` | error | §4.3 `$ref` 규칙 위반 |
| `schema_cyclic` | warning | 순환 참조 |
| `schema_too_large` / `schema_too_deep` | error | §4.3 한도 초과 |
| `schema_not_json` | warning | JSON으로 표현되지 않는 값이 지워짐 |
| `schema_refine_dropped` | warning | `Type.Refine` 검사가 모델 노출 스키마에서 빠짐 |
| `description_too_long` | warning 또는 error | §4.3 한도 |
| `requires_invalid` | error | `requires` 원소가 ID 형식 위반 |
| `requires_self` | error | `requires`에 자기 `id`가 있음 |

`validateCapabilitySet(defs)`가 내는 이슈:

| 코드 | 심각도 | 조건 |
|---|---|---|
| `capability_duplicate` | error | 같은 `id`의 정의가 둘 이상 |
| `tool_name_conflict` | error | 서로 다른 능력이 같은 도구 `name`을 씀. 해소 규칙은 [미결](§10) |
| `requires_unresolved` | warning | `requires`의 능력이 집합 안에 없음. 설치 상태에 따라 달라지므로 경고로 둔다 |

## 5. 실패와 경계 사례

1. 같은 능력에 provider가 여럿 등록됨: 정의는 하나이고 provider 선택은 X와 각 L2 spec이 정한다. 정의의 `version`이 provider가 선언한 제공 버전과 major가 다르면 X가 등록을 거부한다(F.extensions.spec `provides`).
2. provider가 없는 능력을 consumer가 호출함: X가 `unavailable` `CapabilityError`로 거부한다. 매니페스트에 선택 능력(`optional`)으로 선언한 consumer는 호출 전에 사용 가능 여부를 확인해야 한다. 확인 API는 X.primitives.spec이 정한다.
3. 메서드 출력이 `output` 스키마를 위반함: consumer 쪽 검증 여부는 X가 정한다. 도구 경로에서는 L1.tools가 `outputSchema`로 검증하고 위반 시 `internal` 오류 결과로 바꾼다 [제안].
4. 도구 이름이 provider 허용 문자 밖임: `validateCapability`가 `tool_name_invalid`로 거부한다. pi-ai는 도구 호출 ID를 `[^a-zA-Z0-9_-]` 치환과 64자 절단으로 맞춘다(`~/projects/_ref/pi-src/packages/ai/src/api/anthropic-messages.ts:1291`, `ai/src/api/transform-messages.ts:62`). [가정] 도구 이름에도 같은 문자 제약이 있다고 본다. provider별 공식 이름 제약은 확인하지 않았다.
5. 대화 중간에 능력이 꺼짐: 그 능력의 도구는 다음 step 경계에서 `toolsRemoved`로 빠진다. 이미 시작한 도구 호출은 끝까지 실행된다(F.extensions.spec §4.5 켜기·끄기 규칙).
6. 동적 도구 집합(MCP 서버 도구): 정의가 실행 중에 생기므로 정적 `CapabilityDef.tools`로 표현하지 않는다. `mcp` 능력의 서비스 메서드(목록 조회, 호출)는 정적 정의로 두고, 서버별 도구 광고는 L2.mcp가 X 리소스 등록으로 한다. 이 도구들도 §4.5의 순서 키(`mcp.<서버>`)와 `diffToolsets`를 쓴다.
7. `toolsetFingerprint` 실행 환경에 `crypto.subtle`이 없음: 예외를 던진다. 지원 대상 런타임(Bun 1.4, Tauri WebView)에는 있으므로 대체 경로를 두지 않는다 [제안].

## 6. 설정 노출

해당 없음. 이 문서는 정의 형식만 정하며 F5 설정 키를 추가하지 않는다. provider 선택, 도구 노출 켜기·끄기는 각 `L2.<domain>.spec`, `L1.tools.spec`, `L4.settings-ui.spec`이 정한다.

## 7. 확장 지점

- 이 문서는 지점을 새로 정의하지 않는다.
- 능력의 모델 도구 호출은 F.extensions.spec의 tool 지점을 지난다. 호출 전 `tool_call`(fold first), 결과 후 `tool_result`(fold chain), 관찰용 `tool_execution_start`, `tool_execution_update`, `tool_execution_end`(fold tap)다. 두 지점의 페이로드에는 `capability?: { id: CapabilityId; method: string }`가 실려서 핸들러가 도구 이름 대신 능력으로 대상을 고를 수 있다(F.extensions.spec §3.5).
- 그룹 코드가 서비스를 직접 호출하는 경로(§3.9 그룹 경로)는 tool 지점을 지나지 않는다.
- 확장이 능력을 쓰려면 매니페스트 `requires`나 `optional`에 선언해야 한다. 선언하지 않은 능력의 `capability(key)` 호출은 `validateUsage` 오류다(F.extensions.spec §4.7).

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `CapabilityId`, `CapabilityIdSchema`, `SemVer`, `SemVerSchema`, `SemVerRange`, `SemVerRangeSchema` | F.extensions.spec(매니페스트), X.loading-trust.spec |
| `CapabilityDef`, `MethodDef`, `ToolSpec`, `ToolSpecFor`, `defineCapability`, `CapabilityApi` | 모든 L2 spec, L1.tools.spec |
| `ServiceKey`, `serviceKey`, `ApiOf` | X.primitives.spec, F.extensions.spec(`ScopeApi.capability`), L3 spec |
| `CapabilityError`, `CapabilityErrorData`, `COMMON_ERROR_CODES` | L1.tools.spec, 모든 L2 spec |
| `validateCapability`, `validateCapabilitySet`, `toJsonSchema` | X.loading-trust.spec, L1.tools.spec |
| `toolOrderKey`, `orderTools`, `toolsetFingerprint`, `diffToolsets`, `ToolWire` | L1.context.spec, L1.models.spec |
| `CallOptions.context`, `CallContext`, `CallerInfo` | L1.tools.spec, X.primitives.spec, L2 spec(`L2.readme` §5.8) |
| `SecretRef`, `SecretName`, `SecretNameSchema`, `SECRET_REF_PATTERN`, `SECRET_NAME_PATTERN`, `SecretRefError`, `parseSecretRef`, `secretRef`, `findForeignSecretSyntax` | F.wire-settings.spec §3.8.1, L0.secrets.spec, L4.settings-ui.spec |
| `SecretHandle`, `SecretUseMode`, `SecretProviderId`, `SecretApproval`, `SecretScope`, `SecretMeta`, `SecretUsePolicy`, `SecretDenyReason`, `RedactionHit`, `RedactionLayer`, `ReauthMethod`, `SecretAuditRecord`와 스키마 | L0.secrets.spec, L1.tools.spec, L2.workspace.spec, L4.settings-ui.spec |
| `@xeon/contracts/services`의 서비스 인터페이스와 `SERVICE_NAMES`(§3.12) | 구현: L0 `platform-*`, L1 `core-*`, L2 `cap-mcp`(`McpService`), L3 `group-kit`(`GroupService`). 소비: X, L1~L4 |
| `SecretService`, `SecretAdminService`와 부속 타입(`services/secrets.ts`, `services/secret-admin.ts`) | 구현: L0.secrets.spec. 소비: L0.exec.spec(`UseCtx`), L1.tools.spec, L1.models.spec, L2.web.spec, L2.mcp.spec, L4 |
| `ProviderId`, `ProviderSelectionMeta`, `orderProviderCandidates` 등 | L2 spec(`L2.readme` §5.2) |
| `EXTENSION_TOOL_NAME_PATTERN` | X.operations.spec §4.5 |

요구:

| 이름 | 출처 |
|---|---|
| `ReplayPolicy`, `ResultStatus`, `InputRequiredInfo`, `JsonValue`, `TextContent`, `ImageContent`, `requestId` 필드의 뜻 | F.conversation.spec |
| 브랜드·리터럴 이름 규칙 [가정] | eng.domain-types.guide |
| pi-ai `Tool`, `ToolReference`, `SystemMessage` 타입 | `@earendil-works/pi-ai` 1.3.0 (type-only) |
| `ToolExecutionMode` 타입 | F `conversation/agent.ts`(F.conversation.spec §3.1.1) |

## 9. 수용 기준

1. 같은 `CapabilityDef` 집합을 어떤 순열로 넣어도 `orderTools`의 결과와 `toolsetFingerprint`가 같다.
2. `tools[i].method`가 `service.methods`에 없는 정의는 `validateCapability`가 `method_missing` 오류를 낸다. 타입 검사 단계에서도 컴파일 오류가 난다.
3. `Type.Object` 파라미터를 `toJsonSchema`에 넣으면 `~` 접두 키가 없는 JSON이 나오고, 그 JSON을 다시 JSON Schema 2020-12 검증기로 검사한 결과와 TypeBox `Value.Check` 결과가 표본 입력 집합에서 같다(손실 없음).
4. consumer 코드가 provider 패키지를 import하지 않고 정의와 `serviceKey`만으로 `search({ query })` 호출의 입력·출력 타입을 추론해 타입 검사를 통과한다.
5. 한 정의 안의 중복 도구 이름, `TOOL_NAME_WIRE_PATTERN` 위반 이름은 오류다. 내장 능력 도구에서 대문자나 하이픈을 쓴 이름은 경고다. 확장 도구 이름 `web-exa__search`는 `EXTENSION_TOOL_NAME_PATTERN`을 통과하고 경고가 없다.
12. `orderProviderCandidates`는 `callProvider`가 있으면 그 하나만, `settingProvider`가 `"auto"`면 plugin(`pluginOrder` 순) → detected → builtin 순서를 낸다. 같은 입력에 같은 결과를 낸다.
13. `SecretRef`는 `secret://a`(이름 1자)와 `secret://A-b`를 거부하고 `secret://openai-key`를 통과시킨다. `F.wire-settings.spec`의 `SecretRef`는 이 스키마와 같은 참조다.
6. `toInput` 없이 `parameters`와 메서드 `input`이 다르면 `tool_input_mismatch` 오류다.
7. 도구 하나를 추가하면 `diffToolsets`의 `added`에 그 도구만 있고 `removed`는 비며, `firstChangedIndex`는 정렬 목록에서 그 도구가 들어간 위치다.
8. 같은 이름의 도구 정의가 바뀌면 `added`에만 나타나고 `removed`에는 나타나지 않는다.
9. `CapabilityError`의 `data`는 `CapabilityErrorDataSchema`를 통과하고, `rate_limited`의 기본 `retryable`은 참이다.
10. §3.9 `web.search` 정의는 `validateCapability` 이슈 0건이다.
11. `@xeon/contracts/capabilities`의 어떤 파일도 `cordis`를 import하지 않는다(check-layers 또는 lint 규칙으로 확인).
14. `@xeon/contracts/services`의 `SERVICE_NAMES` 값(15개)과 각 파일의 `<X>ServiceName` 값이 같고, `eng.context-map.design` §5.3 표의 서비스 이름과 집합이 같다. `src/services/`의 파일은 값 import 없이 `import type`만 쓰고 `cordis`와 구현 패키지를 import하지 않는다.
15. `LoopService`, `TaskService`, `ToolService`, `ModelService`, `ProcessService`, `McpService`, `GroupService`는 각각 `LoopPort`, `InputQueuePort`, `ToolsPort`, `ModelsPort`, `ProcessPort`, `McpPort`, `LeaseArbiterPort`에 대입 가능하고 `ExecService`는 `ExecutionEnv`에 대입 가능하다(타입 테스트).
16. `SecretMetaSchema`·`SecretUsePolicySchema`의 `Static` 타입과 `SecretMeta`·`SecretUsePolicy` 인터페이스는 서로 대입 가능하다. `SecretAuditRecord`의 `secret.used`·`secret.denied`·`secret.approved`·`secret.masked` 변형은 `F.records.spec` §3.3.1 `secret.*` payload와 필드 이름이 같다(타입 테스트).
17. `parseSecretRef("secret://github-token")`은 `ok`이고 `name`이 `github-token`이다. `parseSecretRef("$GITHUB_TOKEN")`은 `unsupported_ref_syntax`(`env_var`), `parseSecretRef("secret://A")`는 `invalid_ref`(`name_pattern`)다. 같은 입력에 같은 결과를 내고, `SecretName`에 검사 없는 `string`을 대입하면 타입 오류다.

## 10. 미결 사항

- [미결] 능력 ID 네임스페이스 규칙(§3.1): 내장 도메인 예약, 외부 플러그인의 확장 이름 접두, 예약 접두 목록을 확정해야 한다.
- 닫음: 도구 이름 네임스페이스. 후보 (b) `<확장 이름>__<이름>`으로 정했다(§3.1, `X.operations.spec` §4.5). 내장 능력끼리의 충돌은 `tool_name_conflict` 오류로 거부한다.
- [미결] Cordis 선언 병합을 F에서 할지(§3.5 표의 A·B·C).
- [미결] 도구 없는 능력 허용(§4.4).
- 닫음: 내장 L2 능력 정의의 위치는 F `capabilities/defs/<domain>.ts`다(§3.9).
- [결정: review.decisions-2 U-08] 비밀 값 타입(`SecretMeta`, `SecretUsePolicy`, `SecretAuditRecord`와 부속 타입)은 §3.10 `secrets.ts` 블록이 정본이다. `SECRET_REF_PATTERN` 정본도 F다.
- [결정: review.decisions-2 D-04] L0·L1 서비스 인터페이스와 `McpService`, `GroupService`는 `@xeon/contracts/services`에 둔다. 같은 이름의 X 포트가 있으면 서비스 인터페이스가 포트를 확장한다(§3.12 표, 규칙 2·7).
- [미결] `ReplayPolicy` 값 이름(`safe|unsafe` 대 `never|safe`). F.records.spec §10 미결 4의 결정을 따른다(정의는 F.conversation.spec §3.6).
- [결정: review.decisions-2 U-24] TypeBox 버전은 1.3.27(catalog 정확 고정)이다. pi-ai 1.3.0이 고정한 판과 같다.
