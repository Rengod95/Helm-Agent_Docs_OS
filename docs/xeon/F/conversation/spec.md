---
id: F.conversation.spec
layer: F
domain: conversation
kind: spec
status: draft
depends_on: [eng.domain-types.guide, eng.typescript.guide, adr.0009]
binds: [xeon/packages/contracts/src/conversation/**]
---

# F 대화 모델 계약 (conversation)

서브패스: `@xeon/contracts/conversation`. 소스: `xeon/packages/contracts/src/conversation/`.

## 1. 목적과 범위

### 1.1 정하는 것

- 대화 모델의 공용 이름과 형태를 정한다. 메시지, 콘텐츠 블록, 스트림 이벤트는 pi-ai 1.3.0 타입을 그대로 쓴다. 루프가 내고 받는 에이전트 타입(`AgentMessage`, `AgentEvent`, `AgentTool`, `AgentToolResult`)은 F가 정의한다(adr.0009). pi-agent-core는 참조하지 않는다.
- 새로 정의하는 이름은 여섯 묶음이다.
  1. 브랜드 ID: `ThreadId`, `TurnId`, `StepId`, `ItemId`, `PartId`와 기록 계약이 쓰는 `EventId`, `EffectId`, `CheckpointId`. 발급 인터페이스 `IdFactory`.
  2. pi 타입의 런타임 검증 스키마: `MessageSchema`, `AgentMessageSchema`, `UsageSchema` 등.
  3. 파트 발급 ID 래퍼: `PartRecord`, `PartDelta`, `assignPartIds`.
  4. thread/turn/step/item 계층과 수명주기 알림: `ThreadEvent`, `TurnEvent`, `StepEvent`, `ItemEvent`, 상태 enum, `AgentEventMapper`.
  5. 도구 결과 3채널, 결과 상태 태그, 재생 정책: `ToolResultRecord`, `ResultStatus`, `ReplayPolicy`.
  6. 에이전트 루프 타입: `AgentMessage`, `AgentEvent`, `AgentTool`, `AgentToolResult`, `AgentToolCall`, `AgentToolUpdateCallback`, `ToolExecutionMode`, `AgentContext`(§3.1.1).

### 1.2 다루지 않는 것

- 이벤트 envelope, 내구/휘발 규칙, 이벤트 카탈로그, 영속, 체크포인트: `F.records.spec`.
- 도구 기계 이름과 표시 제목 분리 규칙, 능력 정의: `F.capabilities.spec`.
- 확장 지점 선언 표, 열거형 확장 예약 규칙, 확장 id 형식: `F.extensions.spec`.
- 클라이언트 와이어 표현(시각 형식, 프레임, 커서): `F.wire-settings.spec`.
- `AgentEvent`를 알림으로 바꾸는 구현: `L1.loop.spec`(L1-b). F는 함수 시그니처만 둔다.

## 2. 용어

| 용어 | 뜻 | pi 대응 |
|---|---|---|
| thread | 대화 하나. 분기 트리를 포함한다. 현재 가지는 leaf 포인터로 정한다 | 세션 파일 하나 |
| turn | 사용자 입력 하나(또는 예약·원격 입력 하나)에 대한 한 번의 작업. 첫 모델 호출부터 루프 종료까지다 | `agent_start` ~ `agent_end` |
| step | 모델 응답 1회와 그 응답이 부른 도구 결과 묶음. 체크포인트 단위다 | `turn_start` ~ `turn_end` |
| item | 입출력 단위. 사용자 메시지, 어시스턴트 메시지, 시스템 메시지, 도구 호출, 도구 결과, 확장 커스텀 메시지 | `message_start` ~ `message_end`, `tool_execution_start` ~ `tool_execution_end` |
| part | 어시스턴트 메시지 `content` 배열의 블록 하나(text, thinking, toolCall)에 Xeon이 붙인 id 레코드 | `contentIndex` |
| 단계 경계 | step이 끝나고 다음 step이 시작되기 전 시점(step 종료 직후, 도구 결과 커밋 뒤). 체크포인트 커밋, drive 임대 교대, scope 켜기·끄기 적용 시점이다 [결정: review.decisions-2 U-01] | `turn_end` 직후 |

### 2.1 turn과 step 용어 충돌 [결정: review.decisions-2 U-01]

- pi의 turn은 Xeon의 step이다. pi의 run(`agent_start`~`agent_end`)이 Xeon의 turn이다.
- 확장 지점 이름은 pi 이벤트 이름을 그대로 쓴다(`F.extensions.spec`의 지점 선언 표). 그래서 `turn_start`·`turn_end` 지점은 Xeon의 step 경계에서 발화한다. 지점 이름과 Xeon 계층 이름이 다르다는 점을 지점 선언 표의 설명 열에 적는다.
- `_research/foundation-plan.md` §6 M1 스모크가 정한 drive 그룹 켜기·끄기의 적용 시점은 단계 경계다. 턴은 여러 단계로 이어질 수 있어 턴이 끝날 때까지 기다리면 긴 턴에서 토글이 늦게 적용된다. 단계 경계는 커밋된 상태만 보이는 가장 이른 안전 지점이고, 턴의 끝은 그 부분집합이다. 모든 문서는 적용 시점을 "단계 경계"로 쓴다.
- 이 매핑은 `review.decisions-2` U-01의 결정이다(2026-10-22 사용자 확인). 번복하면 이 절과 §10 1번을 고친다.

## 3. 인터페이스

모든 코드는 `isolatedDeclarations`를 켠 상태로 컴파일된다(`_research/foundation-plan.md` §2). 그래서 export되는 상수와 함수에는 명시 타입 주석을 단다. 스키마 선언 형식은 다음과 같다 [제안].

- Xeon이 소유한 레코드·알림·enum 스키마는 TypeBox 명시 타입 주석(`TObject<{...}>`, `TUnion<[...]>` 등)으로 선언하고, 도메인 타입은 `export type X = Static<typeof XSchema>`로 파생한다(`eng.typescript.guide` §1.1 도메인 타입, `_research/notes/eng-2.md` §3-5). 주석과 값이 다르면 tsc가 TS2322로 알린다.
- 이 문서의 코드 블록은 형태를 읽기 쉽게 `interface X`로 적고 스키마 상수 타입을 `Schema<X>`로 줄여 적는다. `Schema<X>`는 실제 타입 이름이 아니다. 코드에서는 "`Static<typeof XSchema>`가 X와 같은 TypeBox 명시 타입"을 뜻한다.
- `TUnsafe<X>`는 실제 타입이다. 브랜드 ID 스키마(§3.2)와 pi 타입 래핑 스키마(§3.3)에만 쓴다. 브랜드와 외부 인터페이스는 TypeBox 구조에서 파생할 수 없기 때문이다.
- `Brand`, `Result`, `ok`, `err`, `Bug`, `parse`는 `@xeon/contracts` 루트 진입점의 것을 쓴다(`eng.typescript.guide` §1.2). 소스 위치는 `src/base/`이고 루트 `src/index.ts`가 이 이름만 다시 export한다(`F.readme` §3). 예상 가능한 실패는 `Result`로 돌려주고, 호출 결함에는 `Bug`를 던진다(TY-11).
- pi 소스 줄 번호: pi-ai `types.ts`는 1.3.0 줄 번호로 적는다. 로컬 소스(`~/projects/_ref/pi-src`, 1.1.0)보다 `ToolCall` 이후가 5줄 밀린다. agent-core `types.ts`는 1.1.0과 1.3.0의 줄이 같다(`_research/notes/F-2.md` §4). agent-core 줄 번호는 §3.1.1 타입의 출발점을 가리키는 참고 인용이다.

### 3.1 pi 재사용 범위

[결정] pi-ai provider와 타입은 그대로 쓰고 부족분만 포크한다(`_research/decisions-log.md` 2026-10-21 결정 2차). 모델 패키지는 `@earendil-works/pi-ai` 1.3.0 정확 고정이다(`_research/foundation-plan.md` §2). [결정] `@earendil-works/pi-agent-core`에는 의존하지 않는다. 루프는 그 1.3.0 루프를 포크한 core-loop 자체 루프이고, 에이전트 타입은 F가 정의한다(adr.0009, §3.1.1). 판정 근거는 `_research/packages.md` §4.1 F1이다. `_research/item-catalog.md` F절은 메시지 스키마를 "설계 채택, 우리 스키마로 재정의"로 적었으나 결정 로그 2차가 뒤의 판단이므로 이를 따른다.

| 구성 | 그대로 (pi-ai 타입 re-export) | 자체 (Xeon 정의) | 설계 (모양만 참고) |
|---|---|---|---|
| 메시지 | `Message`, `SystemMessage`, `UserMessage`, `AssistantMessage`, `ToolResultMessage` (pi-ai 1.3.0 `types.ts:546-644`) | 런타임 검증 스키마 `MessageSchema` 등(§3.3) | — |
| 콘텐츠 블록 | `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall` | 파트 id 래퍼 `PartRecord`(§3.4) | ACP 메시지 chunk id |
| 스트림 이벤트 | `AssistantMessageEvent` 12종(pi-ai 1.3.0 `types.ts:806-822`: start, text_start/delta/end, thinking_start/delta/end, toolcall_start/delta/end, done, error) | 휘발 파트 델타 `PartDelta` | — |
| 종료·사용량 | `StopReason`, `Usage` | `UsageSchema` | — |
| 도구 | `Tool` | `AgentTool`(§3.1.1. `label`, `replay`, `executionMode`) | pi-agent-core `AgentTool`(agent `types.ts:463-500`) |
| 도구 결과 | — | `AgentToolResult`(§3.1.1. `content`, `details`, `structuredContent`, `usage`, `isError`, `terminate`), 저장용 `ToolResultRecord`, `ResultStatus`(§3.6) | pi-agent-core `AgentToolResult`(agent `types.ts:424-445`), MCP 2026-07-28 `resultType` |
| 에이전트 이벤트 | — | `AgentEvent` 10종(§3.1.1), 대응 함수 시그니처 `AgentEventMapper`(§3.5.5) | pi-agent-core `AgentEvent`(agent `types.ts:516`) |
| 에이전트 메시지 | — | `AgentMessage = Message \| XeonCustomMessage`(§3.1.1, 선언 병합 없음) | pi-agent-core `AgentMessage`·`CustomAgentMessages`(agent `types.ts:365-374`) |
| 추론 수준 | `ModelThinkingLevel`(7종, `off` 포함) | — | — |
| JSON 값 | `JsonValue`, `JsonObject` | — | — |
| 계층 | — | ID, 상태 enum, 알림 유니온(§3.5) | Codex app-server thread/turn/item, pi durable conversation/entry/task |

재노출하지 않는 이름 [제안]:

- `ThinkingLevel`: pi-ai 쪽은 `off` 없는 6종, agent-core 쪽은 `off` 포함 7종으로 이름은 같고 집합이 다르다. F는 `ModelThinkingLevel`만 쓴다(`_research/notes/F-2.md` §6-3).
- `AssistantMessageFrame`: 1.3.0에서 제거됐다(`_research/notes/F-2.md` §4).
- `Context`, `TranscriptContext`: 모델 호출 입력이라 L1-c(`L1.models.spec`) 몫이다.

```ts
// src/conversation/pi.ts — 타입 re-export만 둔다. 값 import·export 0건.
export type {
  Message, SystemMessage, UserMessage, AssistantMessage, ToolResultMessage,
  TextContent, ThinkingContent, ImageContent, ToolCall,
  AssistantMessageEvent, StopReason, Usage, Tool,
  ModelThinkingLevel, JsonValue, JsonObject,
  // 이 밖에 구현이 재노출하는 이름(구성 표 밖): ToolReference, DiagnosticErrorInfo, AssistantMessageDiagnostic, DeferredHandle,
  // NestedToolCallRecord, NestedToolCalls, ModelCost, Api, CacheRetention, ThinkingBudgets, Model, Context, TranscriptContext,
  // SimpleStreamOptions, Provider (L1.models.spec §3.2가 쓴다)
} from "@earendil-works/pi-ai";
// pi-agent-core 재노출은 없다(adr.0009). 에이전트 타입은 agent.ts(§3.1.1)
```

재노출하지 않고 F가 적는 이름 둘 [결정(잠정)]: pi-ai의 `AssistantMessageEventStream`은 `#private`을 가진 클래스라 구조 대입이 안 되고 만들려면 값 import가 필요한데, 값 import는 core-models만 한다(`eng.dependency-rules.guide` DR-07). 그래서 소비 계약(`AsyncIterable<AssistantMessageEvent>`와 `result()`)만 적은 인터페이스를 F `pi.ts`에 두고, 이를 쓰는 `StreamFn`도 F가 적는다. pi-ai 원본 `AssistantMessageEventStream` 클래스는 F 인터페이스에 대입할 수 있다(타입 테스트 `pi-types.test.ts`). core-loop 자체 루프도 F `StreamFn`을 받으므로 둘 사이에 단언이 필요 없다(adr.0009 §3.2). `StreamFn`의 컨텍스트 인자는 `Context`다. `TranscriptContext`는 pi-ai `normalizeContext`(값 함수)만 만들 수 있어 루프가 만들 수 없으므로, 정규화는 core-models의 pi-ai 호출 안에서 한다(adr.0009 §3.5). 나머지 재노출 이름은 같은 테스트가 pi-ai 원본과의 항등(`Equal`)을 컴파일 시점에 판정한다. 이전 판의 `AgentToolHooks`는 없앴다.

규칙:

1. [제안] F 소스는 pi-ai를 `import type`·`export type`으로만 참조한다. pi-ai 런타임 코드(`stream`, `Type` 재수출 등)를 import하지 않는다. `@earendil-works/pi-agent-core`는 타입으로도 참조하지 않는다(adr.0009). TypeBox는 `typebox`에서 직접 import한다.
2. [제안] 1.3.0의 `ToolCall.argumentsError?: string`(인자 JSON이 객체가 아닐 때 설명)은 re-export된 타입에 이미 들어 있다. 저장되는 어시스턴트 메시지에도 그대로 남는다(`_research/notes/F-2.md` §4).
3. [제안] pi 버전을 올릴 때는 이 파일과 §3.3 스키마만 고친다. 소비 층은 `@xeon/contracts/conversation`에서만 이 이름을 가져온다(별칭 re-export). L1 이상이 pi 패키지를 직접 import해 대화 타입을 얻는 것은 `eng.dependency-rules.guide`가 금지한다 [가정: 해당 가이드가 이 규칙을 둔다].

#### 3.1.1 에이전트 루프 타입 [결정: adr.0009]

루프가 내고 받는 타입은 F가 정의한다. pi-agent-core는 import하지 않는다(타입 import 포함). 이름과 필드는 pi-agent-core 1.3.0 `types.ts`에서 출발했고, 기록된 메시지·결과 payload가 pi 메시지 모양을 그대로 담으므로 같은 필드 이름을 쓴다. 다른 점은 `any`를 쓰지 않는다는 것과 `AgentMessage`가 닫힌 유니온이라는 것이다.

```ts
// src/conversation/agent.ts — 타입만 둔다. 값 export 0건
import type { Static, TSchema } from "typebox";
import type {
  AssistantMessage, AssistantMessageEvent, ImageContent, JsonObject, JsonValue,
  Message, TextContent, Tool, ToolResultMessage, Usage,
} from "./pi.ts";
import type { XeonCustomMessage } from "./hierarchy.ts";

/** 대화 기록에 들어가는 메시지. 닫힌 유니온이고 선언 병합은 없다. 확장 구분은 XeonCustomMessage.customType */
export type AgentMessage = Message | XeonCustomMessage;

/** 어시스턴트 메시지의 도구 호출 블록 하나 */
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/** 도구 결과. 필드 뜻은 pi-agent-core 1.3.0 AgentToolResult와 같다(§3.6 3채널) */
export interface AgentToolResult<TDetails extends JsonValue | undefined = JsonValue | undefined> {
  content: (TextContent | ImageContent)[];
  details: TDetails;
  structuredContent?: JsonValue;
  usage?: Usage;
  isError?: boolean;
  terminate?: boolean;
}

export type AgentToolUpdateCallback<TDetails extends JsonValue | undefined = JsonValue | undefined> =
  (partial: AgentToolResult<TDetails>) => void;

export type ToolExecutionMode = "sequential" | "parallel";

/** 실행할 수 있는 도구. pi-ai Tool(이름·설명·parameters)에 실행 정보를 더한다 */
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails extends JsonValue | undefined = JsonValue | undefined>
  extends Tool<TParameters> {
  label: string;
  outputSchema?: TSchema;
  replay?: "never" | "safe";
  executionMode?: ToolExecutionMode;
  execute(
    toolCallId: string,
    params: Static<TParameters>,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback<TDetails>,
  ): Promise<AgentToolResult<TDetails>>;
}

/** 요청 하나의 입력. 루프는 이 값을 요청마다 새로 받고 고치지 않는다 */
export interface AgentContext {
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentTool[];
}

/** 루프 이벤트. 변형 이름은 pi와 같다(확장 지점 이름, §3.5.4) */
export type AgentEvent =
  | { readonly type: "agent_start" }
  | { readonly type: "agent_end"; readonly messages: readonly AgentMessage[] }
  | { readonly type: "turn_start" }
  | { readonly type: "turn_end"; readonly message: AssistantMessage; readonly toolResults: readonly ToolResultMessage[] }
  | { readonly type: "message_start"; readonly message: AgentMessage }
  | { readonly type: "message_update"; readonly message: AssistantMessage; readonly assistantMessageEvent: AssistantMessageEvent }
  | { readonly type: "message_end"; readonly message: AgentMessage }
  | { readonly type: "tool_execution_start"; readonly toolCallId: string; readonly toolName: string; readonly args: JsonObject }
  | { readonly type: "tool_execution_update"; readonly toolCallId: string; readonly toolName: string; readonly args: JsonObject; readonly partialResult: AgentToolResult }
  | { readonly type: "tool_execution_end"; readonly toolCallId: string; readonly toolName: string; readonly result: AgentToolResult; readonly isError: boolean; readonly durationMs?: number };
```

- pi-agent-core의 `AgentTool.prepareArguments`(인자 호환 변환)는 두지 않는다. 인자 준비와 검증은 L1.tools가 한다(`L1.tools.spec` §3.3, adr.0009 §3.4).
- `turn_end.message`, `message_update.message`는 pi에서 `AgentMessage`였으나 실제 값은 항상 어시스턴트 메시지라 `AssistantMessage`로 좁혔다.
- `beforeToolCall`·`afterToolCall` 훅 타입, `AgentToolHooks`, `AgentLoopConfig`, `CustomAgentMessages`는 두지 않는다. 도구 단계 계약은 `F.capabilities.spec` §3.12 `services/tools.ts`(`L1.tools.spec` §3.3)가 정한다.
- `agent.ts`가 `hierarchy.ts`의 `XeonCustomMessage`를 import하고 `hierarchy.ts`는 `agent.ts`를 import하지 않는다(DR-06 순환 금지).

### 3.2 브랜드 ID

```ts
// src/conversation/ids.ts
import { Type, type TUnsafe } from "typebox";
import { type Brand } from "../base/index.ts"; // 루트 진입점 "."이 다시 export하는 Brand (eng.typescript.guide §1.2, F.readme §3)

export type ThreadId = Brand<string, "ThreadId">;         // thr_<ULID>
export type TurnId = Brand<string, "TurnId">;             // trn_<ULID>
export type StepId = Brand<string, "StepId">;             // stp_<ULID>
export type ItemId = Brand<string, "ItemId">;             // itm_<ULID>
export type PartId = Brand<string, "PartId">;             // prt_<ULID>
export type EventId = Brand<string, "EventId">;           // evt_<ULID>  (F.records.spec)
export type EffectId = Brand<string, "EffectId">;         // efx_<ULID>  (F.records.spec)
export type CheckpointId = Brand<string, "CheckpointId">; // ckp_<ULID>  (F.records.spec)

export type IdPrefix = "thr" | "trn" | "stp" | "itm" | "prt" | "evt" | "efx" | "ckp";
export interface IdByPrefix {
  thr: ThreadId; trn: TurnId; stp: StepId; itm: ItemId; prt: PartId;
  evt: EventId; efx: EffectId; ckp: CheckpointId;
}

/** ULID 26자. 첫 글자는 48비트 시각 상한 때문에 0-7, Crockford base32 대문자. */
export const ULID_PATTERN: string = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
export const ID_LENGTH: number = 30; // 접두 3 + "_" + 26

export function idPattern(prefix: IdPrefix): string;          // `^${prefix}_${ULID_PATTERN}$`
export function isId<P extends IdPrefix>(prefix: P, value: unknown): value is IdByPrefix[P];

export const ThreadIdSchema: TUnsafe<ThreadId>;
export const TurnIdSchema: TUnsafe<TurnId>;
export const StepIdSchema: TUnsafe<StepId>;
export const ItemIdSchema: TUnsafe<ItemId>;
export const PartIdSchema: TUnsafe<PartId>;
export const EventIdSchema: TUnsafe<EventId>;
export const EffectIdSchema: TUnsafe<EffectId>;
export const CheckpointIdSchema: TUnsafe<CheckpointId>;
// 구현 예: Type.Unsafe<ThreadId>(Type.String({ pattern: idPattern("thr"), minLength: 30, maxLength: 30 }))

/** 발급은 F 밖에서 한다. 구현은 L0(시계·난수)과 L1(주입)이 맡는다. */
export interface IdFactory {
  next<P extends IdPrefix>(prefix: P): IdByPrefix[P];
}
```

- [제안] 여덟 접두를 한 파일에 둔다. 기록 계약의 `EventId`, `EffectId`, `CheckpointId`도 여기서 정의하고 `@xeon/contracts/records`가 같은 심볼을 다시 export한다. `IdFactory` 하나로 모든 ID를 발급하려는 선택이다.
- [제안] `Brand`는 `eng.typescript.guide` §1.2가 정한 루트 진입점의 것을 쓴다. 정의 위치는 `src/base/`(`eng.domain-types.guide` DT-12 순서 0, `F.readme` §3)다. 같은 패키지 안이라 `../base/index.ts`를 상대 경로로 import한다.
- [제안] 발급 인터페이스 이름은 `IdFactory`다. `eng.typescript.guide` TY-06·TY-09가 이 이름과 `next(prefix)` 모양을 인용한다. 조정 브리프의 `IdGenerator`는 `IdFactory`로 확정한다.
- [제안] 소문자 ULID, 접두 대문자, 접두 없는 ULID, 다른 접두는 모두 스키마 검증에서 거부된다.
- ULID 단조성(같은 밀리초 안 증가 보장)을 어느 층이 소유할지는 [미결]이다(§10 미결 3). 이벤트 순서는 `seq`(`F.records.spec`)로 정하므로 ULID 단조성은 ID 정렬의 편의 문제다.

#### 3.2.1 `IdPrefix` 밖의 ID 정책 [제안]

`IdPrefix` 8종은 이벤트 소속과 재생 대상 ID 전용으로 닫아 둔다. 그 밖의 ID는 아래 세 부류 중 하나로 만든다. 부류마다 형식과 발급 위치가 정해져 있고, 문서마다 따로 정하지 않는다.

| 부류 | 형식 | 정의 위치 | 발급 | 해당 ID |
|---|---|---|---|---|
| ① 저장소 정체성 | `sto_<ULID>` 30자 | `F.wire-settings.spec` §3.4.1 `StoreId` 스키마, `F.records.spec` §3.9 `StoreService.storeId` | `platform-store` 내부 ULID 생성기(`IdFactory`를 쓰지 않는다) | `storeId` |
| ② 도메인 지역 ID | `<세 글자>_<ULID>` 30자. `idPattern`과 같은 ULID 규칙 | 아래 `local-ids.ts`와 `LOCAL_ID_PREFIXES` 표 | `LocalIdFactory`. 구현은 `IdFactory`와 같은 시계·난수를 쓰고 F 밖(`platform-os`)에 둔다 | 아래 표 |
| ③ 순번·해시형 ID | 접두 없음. 형식은 소유 문서가 정한다 | 소유 문서 | 소유 패키지 | `L2.work`의 스레드 안 순번, `L2.knowledge`의 해시형 ID, `L1.tasks`의 입력 id(= `input.queued` `EventId` 재사용) |

```ts
// src/conversation/local-ids.ts
import type { IdPrefix } from "./ids.ts";

/** 도메인 지역 ID 접두. 세 글자 소문자. IdPrefix 8종과 "sto"는 쓸 수 없다 */
export const LOCAL_ID_PREFIX_PATTERN: string = "^[a-z]{3}$";
export const RESERVED_ID_PREFIXES: readonly (IdPrefix | "sto")[];

/** 등록된 지역 접두와 소유 문서. 새 접두는 이 표에 행을 더해서만 쓴다(데이터 상수) */
export const LOCAL_ID_PREFIXES: Readonly<Record<LocalIdPrefix, { readonly owner: string }>>;
export type LocalIdPrefix =
  | "art" | "rvw" | "cmt" | "hof"          // L2.artifacts
  | "lop" | "wak" | "tmr" | "wch"          // L2.schedule
  | "wcl" | "wbr" | "wrs"                  // L2.web: 호출, 브라우저, 결과
  | "knl" | "knp"                          // L2.knowledge: 원장, 제안
  | "bgp"                                  // L0.process: 백그라운드 프로세스
  | "sls";                                 // L0.secrets: 비밀 임대

export type LocalId<P extends LocalIdPrefix> = `${P}_${string}`;
export function localIdPattern(prefix: LocalIdPrefix): string;          // `^${prefix}_${ULID_PATTERN}$`
export function isLocalId<P extends LocalIdPrefix>(prefix: P, value: unknown): value is LocalId<P>;

/** 발급 인터페이스. 구현은 F 밖(platform-os의 createLocalIdFactory) */
export interface LocalIdFactory {
  next<P extends LocalIdPrefix>(prefix: P): LocalId<P>;
}
```

- 지역 ID는 브랜드를 두지 않는다. 브랜드가 필요하면 소유 문서가 `Brand<LocalId<P>, "...">`로 감싼다.
- 지역 ID를 이벤트 payload에 담는 것은 허용한다. envelope의 소속 필드(`threadId`, `turnId`, `stepId`, `id`)에는 쓰지 않는다.
- 소비 문서의 현재 표기와 이 표의 대응: `L2.web`의 `wc_`·`wb_`·`wr_`(정규식 `^wc_[0-9A-Za-z]{8,40}$` 등, ULID 아님)는 `wcl`·`wbr`·`wrs`, `L2.knowledge`의 `kl_`·`kp_`는 `knl`·`knp`, `L0.process`의 `bg_`는 `bgp`로 읽는다. 그 문서들의 "IdFactory로 만든다"는 `LocalIdFactory`로 읽는다. 소비 문서 수정은 그 문서의 몫이다.

### 3.3 pi 타입의 런타임 스키마 [제안]

pi 타입은 TS 인터페이스라 런타임 스키마가 없다. 이벤트 payload 검증(`F.records.spec`의 `item.recorded` 등)에는 런타임 검증이 필요하다. 방식은 다음으로 정한다.

- role(또는 `type`) 판별 + 얕은 검증을 하는 TypeBox 스키마를 직접 쓰고 `Type.Unsafe<PiType>(...)`로 감싼다. 정적 타입은 pi 타입 그대로이고, 런타임 검증은 판별 필드와 필수 최상위 필드만 본다.
- 모든 객체 스키마는 `additionalProperties: true`다. pi가 minor에서 선택 필드를 더해도 옛 기록과 새 기록이 모두 통과한다.
- 파일: `src/conversation/message-schema.ts`. `pi.ts`는 타입 전용으로 둔다(값 import 검사를 단순하게 하려는 선택).

```ts
// src/conversation/message-schema.ts
import { Type, type TUnsafe } from "typebox";
import type {
  Message, SystemMessage, UserMessage, AssistantMessage, ToolResultMessage,
  TextContent, ThinkingContent, ImageContent, ToolCall, Usage, StopReason, AssistantMessageEvent,
} from "./pi.ts";
import type { AgentMessage } from "./agent.ts";

export const StopReasonSchema: TUnsafe<StopReason>;
// "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred"

/** Usage는 작아서 필드 전체를 검사한다. cacheWrite1h, reasoning은 선택. */
export const UsageSchema: TUnsafe<Usage>;

export const TextContentSchema: TUnsafe<TextContent>;         // { type: "text", text: string }
export const ThinkingContentSchema: TUnsafe<ThinkingContent>; // { type: "thinking", thinking: string }
export const ImageContentSchema: TUnsafe<ImageContent>;       // { type: "image", data: string, mimeType: string }
export const ToolCallSchema: TUnsafe<ToolCall>;               // { type: "toolCall", id: string(min 1), name: string(min 1), arguments: object }

/** role 판별 유니온. 각 변형이 확인하는 필드:
 *  system:     role, content(string | TextContent[]), timestamp
 *  user:       role, content(string | (Text|Image)[]), timestamp
 *  assistant:  role, content((Text|Thinking|ToolCall)[]), api, provider, model, usage, stopReason, timestamp
 *  toolResult: role, toolCallId, toolName, content((Text|Image)[]), isError, timestamp */
export const MessageSchema: TUnsafe<Message>;

export const SystemMessageSchema: TUnsafe<SystemMessage>;
export const UserMessageSchema: TUnsafe<UserMessage>;
export const AssistantMessageSchema: TUnsafe<AssistantMessage>;
export const ToolResultMessageSchema: TUnsafe<ToolResultMessage>;

/** Message + XeonCustomMessage(role "custom"). */
export const AgentMessageSchema: TUnsafe<AgentMessage>;

/** type 판별만 한다. 휘발 경로 디버깅용이며 저장 경로에서는 쓰지 않는다. */
export const AssistantMessageEventSchema: TUnsafe<AssistantMessageEvent>;
```

한계:

1. 깊은 필드(예: `AssistantMessage.diagnostics`, `SystemMessage.toolsAdded`의 `Tool.parameters`, `DeferredHandle`)는 검사하지 않는다.
2. `Type.Unsafe`는 정적 타입과 스키마의 일치를 컴파일러가 보장하지 않는다. pi 타입을 비춘 이 파일들(`message-schema.ts`, `agent-schema.ts`)은 `eng.typescript.guide` TY-26의 허용 행 U2이고, 일치는 픽스처 왕복 테스트와 판별 값 목록 테스트로만 확인한다(§9 수용 기준 2, 6). Xeon이 소유한 객체 타입은 `SchemaProof`로 컴파일 시점에 증명한다(U5). `AgentToolResultSchema`는 `additionalProperties: false`이고 여섯 필드를 모두 가진다.
3. `ToolResultMessage<TDetails>`는 `TDetails`가 JSON 호환일 때만 성립하는 조건부 타입이다(`_research/notes/F-2.md` §5.1). 스키마는 기본 인자 `JsonValue`만 다룬다.
4. TypeBox 1.x의 `Value.Check`가 `Unsafe`로 감싼 객체 스키마의 키워드를 그대로 검사한다고 본다 [가정]. C3 작업의 첫 테스트가 이를 확인한다(`F.conversation.plan`).

### 3.4 파트와 발급 ID

pi-ai 콘텐츠 블록에는 id가 없다. 스트림 이벤트는 `contentIndex`로 블록을 가리키고, 블록 중 `ToolCall`만 `id`를 가진다(`_research/packages.md` §4.1 F1, pi-ai 1.3.0 `types.ts:806-822`). Xeon은 어시스턴트 메시지의 블록마다 `PartRecord`를 둔다.

```ts
// src/conversation/parts.ts
import type { ItemId, PartId, IdFactory } from "./ids.ts";

export type PartKind = "text" | "thinking" | "toolCall";
export const PartKindSchema: Schema<PartKind>;

/** 완성 파트의 내구 레코드. 내용은 담지 않는다. 내용은 소속 item의 message.content[contentIndex]다. */
export interface PartRecord {
  partId: PartId;
  itemId: ItemId;              // 소속 어시스턴트 item
  contentIndex: number;        // 정수 ≥ 0, item 안에서 유일
  kind: PartKind;
  toolCallId: string | null;   // kind === "toolCall"이면 pi ToolCall.id, 그 밖에는 null
}
export const PartRecordSchema: Schema<PartRecord>;

/** 휘발 스트림 조각. pi AssistantMessageEvent의 *_start/*_delta/*_end 하나에 대응한다. */
export interface PartDelta {
  partId: PartId;
  itemId: ItemId;
  contentIndex: number;
  kind: PartKind;
  phase: "start" | "delta" | "end";
  delta: string;               // start는 "", toolCall delta는 인자 JSON 조각
}
export const PartDeltaSchema: Schema<PartDelta>;

export interface PartAssignment {
  record: PartRecord;
  issued: boolean;             // 이번 호출에서 새로 발급했으면 true
}

/** contentIndex → PartId 대응. 순수 함수.
 *  existing에 같은 (itemId, contentIndex)가 있으면 그 partId를 그대로 쓰고 ids를 부르지 않는다.
 *  없으면 ids.next("prt")로 발급한다. kinds[i]는 contentIndex i의 블록 종류, toolCallIds[i]는 toolCall 블록의 pi id. */
export function assignPartIds(input: {
  itemId: ItemId;
  kinds: readonly PartKind[];
  toolCallIds: readonly (string | null)[];
  existing: readonly PartRecord[];
}, ids: IdFactory): readonly PartAssignment[];

/** 투영 재생용 조회. (itemId, contentIndex) → partId. */
export function partIdAt(records: readonly PartRecord[], itemId: ItemId, contentIndex: number): PartId | undefined;
```

규칙 [제안]:

1. 발급 시점: `*_start` 스트림 이벤트를 받을 때 메모리에서 `PartId`를 발급한다. 같은 블록의 `*_delta`, `*_end` 휘발 조각은 이 id를 싣는다.
2. 내구 시점: 어시스턴트 메시지가 끝날 때(`message_end`) 그 메시지의 `PartRecord` 전부를 `item.recorded`와 같은 커밋으로 기록한다(`F.records.spec`의 `part.recorded`). 스트림 중 크래시가 나면 휘발 조각과 메모리 id는 함께 사라진다.
3. 재생: 투영을 다시 만들 때는 `part.recorded`의 id를 읽는다. 새로 발급하지 않는다. 그래서 같은 기록을 재생하면 항상 같은 `PartId`가 나온다.
4. toolCall 파트는 pi `ToolCall.id`를 `toolCallId`로 보존한다. 효과 이벤트(`F.records.spec` `effect.intent`)와 도구 결과 메시지의 `toolCallId`가 이 값으로 이어진다.
5. 파트는 어시스턴트 메시지에만 둔다. 사용자·도구 결과 메시지의 이미지 블록에는 파트 id를 붙이지 않는다. 필요해지면 `PartKind`를 늘리는 변경은 M2 이후 열거형 확장 규칙(`F.extensions.spec`)을 따른다.
6. 블록 내용을 `PartRecord`에 복사하지 않는 이유: 메시지 완료 시점에 한 번에 커밋하므로(`_research/item-catalog.md` L1-f 커밋 단위) 내용을 두 곳에 저장할 이유가 없다.

### 3.5 thread/turn/step/item 계층

#### 3.5.1 상태 enum

```ts
// src/conversation/hierarchy.ts
export type ThreadStatus = "idle" | "running" | "closed";
export type TurnStatus = "running" | "waiting" | "completed" | "interrupted" | "failed";
export type StepStatus = "requesting" | "tools" | "completed" | "interrupted" | "failed";
export type ItemStatus = "in_progress" | "completed" | "failed" | "interrupted";
export type ItemKind = "user" | "assistant" | "system" | "toolCall" | "toolResult" | "custom";

export const ThreadStatusSchema: Schema<ThreadStatus>;
export const TurnStatusSchema: Schema<TurnStatus>;
export const StepStatusSchema: Schema<StepStatus>;
export const ItemStatusSchema: Schema<ItemStatus>;
export const ItemKindSchema: Schema<ItemKind>;

/** 유효 전이표. 키 상태에서 갈 수 있는 상태 목록. 종결 상태는 빈 배열. */
export const THREAD_TRANSITIONS: Readonly<Record<ThreadStatus, readonly ThreadStatus[]>>;
export const TURN_TRANSITIONS: Readonly<Record<TurnStatus, readonly TurnStatus[]>>;
export const STEP_TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>>;
export const ITEM_TRANSITIONS: Readonly<Record<ItemStatus, readonly ItemStatus[]>>;

export function canTransition<S extends string>(table: Readonly<Record<S, readonly S[]>>, from: S, to: S): boolean;
```

| 계층 | 시작 상태 | 유효 전이 [제안] | 종결 |
|---|---|---|---|
| thread | `idle` | idle→running, running→idle, idle→closed | `closed` |
| turn | `running` | running→waiting, waiting→running, running·waiting→completed·interrupted·failed | completed, interrupted, failed |
| step | `requesting` | requesting→tools, requesting→completed(도구 호출 없음), tools→completed, requesting·tools→interrupted·failed | completed, interrupted, failed |
| item | `in_progress` | in_progress→completed·failed·interrupted | completed, failed, interrupted |

- `waiting`: 승인·질문(L1-d 승인 프로토콜), `input_required` 결과, pi `deferred` 응답 대기다.
- thread는 실행 중인 turn이 있으면 `running`이다. 한 thread에서 동시에 실행되는 turn은 하나다 [제안]. 들어온 입력은 큐에 쌓이고 커서는 `StepCheckpoint`(`F.records.spec`)가 기록한다.

#### 3.5.2 item 레코드

```ts
export interface XeonCustomMessage {
  role: "custom";
  customType: string;          // "x.<extId>.<영역>.<이름>" 또는 "grp.<groupId>.<영역>.<이름>". F.records.spec §3.2 ExtensionEventKind와 같은 형식
  content: string | (TextContent | ImageContent)[];
  display: boolean;            // UI 표시 여부
  details: JsonValue | null;   // 모델에 보내지 않는다
  timestamp: number;           // ms
}

interface ItemBase { itemId: ItemId; status: ItemStatus }
export type ItemRecord =
  | ItemBase & { kind: "user"; message: UserMessage; requestId: string | null }
  | ItemBase & { kind: "assistant"; message: AssistantMessage; partIds: PartId[] }   // partIds[i] ↔ content[i]
  | ItemBase & { kind: "system"; message: SystemMessage }
  | ItemBase & { kind: "toolResult"; message: ToolResultMessage; effectId: EffectId | null }
  | ItemBase & { kind: "custom"; message: XeonCustomMessage };
export const ItemRecordSchema: Schema<ItemRecord>;

/** 도구 호출 item은 내구 레코드가 따로 없다. 기록은 효과 이벤트(effect.intent/exec/result)가 맡는다. */
export interface ToolCallItem {
  itemId: ItemId;
  kind: "toolCall";
  toolCallId: string;
  toolName: string;
  effectId: EffectId | null;
  status: ItemStatus;
}
```

- [결정: adr.0009] 확장 커스텀 메시지는 `AgentMessage = Message | XeonCustomMessage`(§3.1.1)의 한 변형이다. 선언 병합은 없다. 이전 판의 `CustomAgentMessages` 병합(`@earendil-works/pi-agent-core` 대상)은 없앴다.
- `customType`의 형식은 확장 이벤트 kind와 같다(`F.records.spec` §3.2, `F.extensions.spec` §3.6 `RecordKind`). conversation은 records를 import하지 않으므로 타입은 `string`으로 두고 형식 검사는 `F.extensions.spec`의 `PostItem.customType`(`RecordKind`)과 X가 한다. 다른 확장이 쓴 값의 충돌 처리는 `F.extensions.spec`이 정한다.

#### 3.5.3 수명주기 알림 유니온

알림은 계층마다 시작·갱신·완료 세 종류다. 공통 범위 필드는 envelope 필드와 이름이 같다(`F.records.spec`).

```ts
// src/conversation/lifecycle.ts
export interface LifecycleScope {
  threadId: ThreadId;
  turnId: TurnId | null;
  stepId: StepId | null;
}
export type Notification<K extends string, P> = { readonly type: K } & LifecycleScope & P;

// thread
export interface ThreadStartedPayload {
  title: string | null;
  forkedFrom: { threadId: ThreadId; eventId: EventId } | null;
  /**
   * thread.create가 받은 작업 폴더(절대 경로, 1~4096자). 없거나 null이면 호스트 프로세스의 cwd를 쓴다.
   * [결정: m2-plan F.6] 선택 필드로 더했다. M1이 쓴 옛 행에는 필드가 없고, 없는 값은 null과 같다. 그래서 version은 1 그대로이고 업캐스터가 없다(F.records.spec §3.2 규칙 5).
   * cap-workspace의 root 계산과 thread.list의 workspace 필터가 이 값을 쓴다(open-issues M-06).
   */
  workspace?: string | null;
}
export interface ThreadUpdatedPayload { title?: string | null; status?: ThreadStatus; leafEventId?: EventId }
export interface ThreadClosedPayload { reason: string | null }
export type ThreadStarted = Notification<"thread.started", ThreadStartedPayload>;
export type ThreadUpdated = Notification<"thread.updated", ThreadUpdatedPayload>;
export type ThreadClosed = Notification<"thread.closed", ThreadClosedPayload>;
export type ThreadEvent = ThreadStarted | ThreadUpdated | ThreadClosed;

// turn
export interface TurnStartedPayload {
  inputItemIds: ItemId[];
  requestId: string | null;
  /** drive turn이면 임대한 scope id, 그 밖은 null. drive turn 멱등 키 (scopeId, requestId)의 근거(L1.loop.spec FR-L8, L1.persistence.spec FR-P10) */
  scopeId: string | null;
}
/** 사용자에게만 보이는 휘발 알림. 모델 컨텍스트에는 넣지 않는다 [결정: m2 F.8, L1.loop.spec FR-L5] */
export interface TurnNotice {
  code: "repeat_detected" | "gate_limit";   // 반복 감지(L1.loop.spec §4.10), 완료 게이트 계속 상한 도달(§4.9)
  detail: JsonValue;                        // gate_limit: { limit: number }. repeat_detected: { kind: "action_observation" | "action_error", count: number }
}
export interface TurnUpdatedPayload { status: TurnStatus; notice?: TurnNotice }
export interface TurnCompletedPayload {
  status: "completed" | "interrupted" | "failed";
  stepCount: number;
  usage: Usage | null;         // turn 안 모델 호출 합계
  error: string | null;
}
export type TurnStarted = Notification<"turn.started", TurnStartedPayload>;
export type TurnUpdated = Notification<"turn.updated", TurnUpdatedPayload>;
export type TurnCompleted = Notification<"turn.completed", TurnCompletedPayload>;
export type TurnEvent = TurnStarted | TurnUpdated | TurnCompleted;

// step
export interface StepStartedPayload { stepIndex: number }
export interface StepUpdatedPayload { status: StepStatus }
export interface StepCompletedPayload {
  stepIndex: number;
  status: "completed" | "interrupted" | "failed";
  stopReason: StopReason;
  assistantItemId: ItemId | null;
  toolResultItemIds: ItemId[];
}
export type StepStarted = Notification<"step.started", StepStartedPayload>;
export type StepUpdated = Notification<"step.updated", StepUpdatedPayload>;
export type StepCompleted = Notification<"step.completed", StepCompletedPayload>;
export type StepEvent = StepStarted | StepUpdated | StepCompleted;

// item
export interface ItemStartedPayload {
  itemId: ItemId;
  kind: ItemKind;
  toolCallId: string | null;   // kind === "toolCall"일 때
  toolName: string | null;
}
export type ItemUpdate =
  | { kind: "part_delta"; delta: PartDelta }
  | { kind: "part_completed"; part: PartRecord }
  | { kind: "tool_progress"; partialResult: AgentToolResult<JsonValue | undefined> };
export interface ItemUpdatedPayload { itemId: ItemId; update: ItemUpdate }
export interface ItemCompletedPayload { item: ItemRecord | ToolCallItem }
export type ItemStarted = Notification<"item.started", ItemStartedPayload>;
export type ItemUpdated = Notification<"item.updated", ItemUpdatedPayload>;
export type ItemCompleted = Notification<"item.completed", ItemCompletedPayload>;
export type ItemEvent = ItemStarted | ItemUpdated | ItemCompleted;

export type LifecycleEvent = ThreadEvent | TurnEvent | StepEvent | ItemEvent;

// 페이로드 스키마(내구 기록 검증용). 이름 규칙: <Payload 타입 이름>Schema
export const ThreadStartedPayloadSchema: Schema<ThreadStartedPayload>;
export const ThreadUpdatedPayloadSchema: Schema<ThreadUpdatedPayload>;
export const ThreadClosedPayloadSchema: Schema<ThreadClosedPayload>;
export const TurnStartedPayloadSchema: Schema<TurnStartedPayload>;
export const TurnUpdatedPayloadSchema: Schema<TurnUpdatedPayload>;
export const TurnCompletedPayloadSchema: Schema<TurnCompletedPayload>;
export const StepStartedPayloadSchema: Schema<StepStartedPayload>;
export const StepUpdatedPayloadSchema: Schema<StepUpdatedPayload>;
export const StepCompletedPayloadSchema: Schema<StepCompletedPayload>;
export const ItemStartedPayloadSchema: Schema<ItemStartedPayload>;
export const ItemUpdatedPayloadSchema: Schema<ItemUpdatedPayload>;
```

- payload 스키마가 11종인 것은 의도한 수다. 알림은 12종이지만 `item.completed`는 카탈로그 kind가 아니라서(아래 예외) 기록 검증용 스키마가 필요 없다. 알림 자체의 타입은 `ItemCompletedPayload`로 정한다.
- 토큰 델타는 `item.updated`의 `update.kind: "part_delta"`로만 나른다. 델타 전용 kind(`part.delta`)는 두지 않는다(`F.records.spec` §3.3).
- 알림 `type` 문자열은 `F.records.spec` 카탈로그의 `kind`와 같다. 예외는 하나다. `item.completed` 알림의 내구 기록은 `item.recorded`(메시지 item)이거나 `effect.result`(도구 호출 item)다. 대응은 §3.5.4 표에 있다.
- `item.updated`의 `part_completed`에 대응하는 내구 기록은 `part.recorded`다.

#### 3.5.4 `AgentEvent` → Xeon 알림 대응표

`AgentEvent`는 §3.1.1의 F 정의이고 변형 이름은 pi와 같다. 이벤트를 내는 쪽은 core-loop 자체 루프다(`L1.loop.spec` §3.2).

| `AgentEvent` | Xeon 알림 | 내구 기록 (`F.records.spec`) | 비고 |
|---|---|---|---|
| (입력 접수, pi 이전) | `item.started`/`item.completed`(user), `turn.started` | `item.recorded`, `turn.started` | 입력 item은 turn 시작 전에 기록한다. `requestId` 멱등 |
| `agent_start` | `turn.updated{status:"running"}` | — | turn.started는 입력 접수 때 이미 냈다 |
| `turn_start` | `step.started` | `step.started` | 지점 `turn_start`도 여기서 발화(§2.1) |
| `message_start`(assistant) | `item.started{kind:"assistant"}`, `step.updated{status:"requesting"}` | — | |
| `message_update` + `text_start`·`thinking_start`·`toolcall_start` | `item.updated{part_delta, phase:"start"}` | — | 여기서 `PartId` 발급 |
| `message_update` + `*_delta` | `item.updated{part_delta, phase:"delta"}` | — | 휘발 |
| `message_update` + `*_end` | `item.updated{part_completed}` | — | 내구 기록은 message_end 때 함께 |
| `message_update` + `done`·`error` | — | — | message_end에서 처리 |
| `message_end`(assistant) | `item.completed` | `part.recorded`×N, `item.recorded` (같은 커밋) | 부분 스트림은 `stopReason:"aborted"`로 보존 |
| `message_start`·`message_end`(user·system·custom) | `item.started`, `item.completed` | `item.recorded` | |
| `tool_execution_start` | `item.started{kind:"toolCall"}`, `step.updated{status:"tools"}` | `effect.intent`, `effect.exec` | 의도는 실행 전에 커밋 |
| `tool_execution_update` | `item.updated{tool_progress}` | — | 휘발 |
| `tool_execution_end` | `item.completed{ToolCallItem}` | `effect.result` | |
| `message_start`·`message_end`(toolResult) | `item.started`, `item.completed{kind:"toolResult"}` | `item.recorded` | `effect.result`와 같은 커밋 |
| `turn_end` | `step.completed` | `step.completed`, `checkpoint.step` (같은 커밋, FULL) | 단계 경계. 지점 `turn_end` 발화 |
| `agent_end` | `turn.completed` | `turn.completed` | 상태는 마지막 어시스턴트 `stopReason`으로 정한다(아래) |

`turn.completed.status` 결정 [제안]:

- 마지막 어시스턴트 메시지 `stopReason`이 `stop`·`length`·`toolUse`이면 `completed`다.
- `aborted`이면 `interrupted`다.
- `error`이면 `failed`다.
- `deferred`이면 turn을 끝내지 않고 `turn.updated{status:"waiting"}`을 낸다. 지연 응답 재조회 흐름은 L1-c(`L1.models.spec`) 몫이다. `DeferredHandle`의 실제 동작은 [가정]으로 남는다(`_research/notes/F-2.md` §8).

#### 3.5.5 대응 함수 시그니처

구현은 L1-b(`L1.loop.spec`)가 한다. F는 타입만 둔다.

```ts
// src/conversation/lifecycle.ts
export interface AgentEventMapInit {
  threadId: ThreadId;
  turnId: TurnId;
  startStepIndex: number;      // 재개 시 체크포인트의 stepIndex + 1
  ids: IdFactory;
}
export interface AgentEventMapper {
  /** 루프 이벤트 하나를 받아 0개 이상의 알림을 순서대로 돌려준다. 같은 입력 열에 같은 출력 열(ids 제외). */
  map(event: AgentEvent): readonly LifecycleEvent[];
  /** 현재 열린 step과 item. 체크포인트 작성에 쓴다. */
  snapshot(): { stepId: StepId | null; stepIndex: number; openItemIds: readonly ItemId[] };
}
export type CreateAgentEventMapper = (init: AgentEventMapInit) => AgentEventMapper;
```

### 3.6 도구 결과 3채널, 결과 상태 태그, 재생 정책

[결정] 도구 결과는 F `AgentToolResult`(§3.1.1)를 쓴다. 필드는 pi-agent-core 1.3.0 `AgentToolResult`와 같다(`_research/packages.md` §4.1 F1 "도구 결과 3채널: 그대로", 결정 로그 2차, adr.0009). 채널은 다음과 같다.

| 채널 | 필드 | 받는 쪽 | 저장 위치 (`F.records.spec`) |
|---|---|---|---|
| 모델용 | `content: (TextContent \| ImageContent)[]` | 모델 | toolResult item의 `message.content` |
| UI·로그용 | `details` | UI, 로그 | toolResult item의 `message.details` |
| 구조화 | `structuredContent?: JsonValue` (`outputSchema` 일치) | 프로그램 호출자 | `effect.result.output.structuredContent` |

`isError`, `terminate`, `usage`도 함께 저장한다.

```ts
// src/conversation/tool-result.ts
export type ResultStatus = "complete" | "input_required";
export const ResultStatusSchema: Schema<ResultStatus>;

/** MCP InputRequiredResult의 내용 필드. 값 모양은 SDK를 따른다. */
export interface InputRequiredInfo {
  inputRequests: JsonObject | null;   // [가정] MCP client 2.3.1 InputRequests
  requestState: string | null;        // [가정] MCP client 2.3.1 requestState
}

/** 저장·전달용 결과 레코드. AgentToolResult의 JSON 표현에 상태 태그를 더한다. */
export interface ToolResultRecord {
  content: (TextContent | ImageContent)[];
  details: JsonValue | null;
  structuredContent: JsonValue | null;
  isError: boolean;
  terminate: boolean;
  usage: Usage | null;
  status?: ResultStatus;              // 없으면 "complete"
  inputRequired?: InputRequiredInfo;  // status === "input_required"일 때만
}
export const ToolResultRecordSchema: Schema<ToolResultRecord>;

export function resultStatusOf(record: Pick<ToolResultRecord, "status">): ResultStatus;
export function toToolResultRecord(result: AgentToolResult<JsonValue | undefined>): ToolResultRecord;

/** 결과가 불명인 효과를 다시 실행해도 되는지. 기본은 "unsafe". 효과 기록(F.records.spec §3.5)과 능력 정의(F.capabilities.spec §3.2)가 함께 쓴다. */
export type ReplayPolicy = "safe" | "unsafe";
export const ReplayPolicySchema: Schema<ReplayPolicy>;

/** AgentTool.replay("never" | "safe" | undefined, §3.1.1) → ReplayPolicy. "safe"만 "safe", 나머지는 "unsafe". 순수 함수. */
export function toReplayPolicy(replay: AgentTool["replay"]): ReplayPolicy;
```

- [제안] `status`는 선택 필드이고 없으면 `complete`다. MCP 2026-07-28의 `resultType`과 같은 규칙이다(`_research/item-catalog.md` F절 "결과 상태 태그"). 그래서 M2에서 태그를 실제로 쓰기 시작해도 기존 기록을 바꾸지 않는다.
- [가정] MCP client 2.3.1은 `InputRequiredResult{ resultType: "input_required", inputRequests?, requestState? }`와 `isInputRequiredResult`, `withInputRequired`를 공개 export한다(`_research/notes/F-2.md` §5.4). `inputRequired()` 빌더의 export 여부와 `@modelcontextprotocol/core` 쪽 정의는 확인하지 않았다. MCP 결과를 이 레코드로 바꾸는 어댑터는 `L2.mcp.spec`이 둔다.
- `toToolResultRecord`는 순수 변환이다. `details`가 `undefined`이면 `null`로 둔다.
- [제안] `ReplayPolicy`는 이 파일에 둔다. records(효과 3단)와 capabilities(`MethodDef.replay`, `ToolSpec.replay`)가 함께 쓰는데, 두 도메인이 모두 import할 수 있는 F 도메인이 conversation이기 때문이다(`F.readme` §3 의존 순서). `F.records.spec`은 같은 심볼을 다시 export한다. 값 이름 통일은 `F.records.spec` §10 미결 4다.

### 3.7 기계 이름과 표시 제목

도구의 기계 이름(`Tool.name`)과 표시 제목(`AgentTool.label`)의 분리 규칙은 `F.capabilities.spec`이 정한다. 이 문서는 두 필드가 pi-ai `Tool.name`과 F `AgentTool.label`(§3.1.1, pi-agent-core `types.ts:465`와 같은 필드)에 있다는 사실만 기록한다.

### 3.8 인덱스

```ts
// src/conversation/index.ts
export * from "./ids.ts";
export * from "./local-ids.ts";
export type * from "./pi.ts";
export type * from "./agent.ts";
export * from "./message-schema.ts";
export * from "./parts.ts";
export * from "./hierarchy.ts";
export * from "./lifecycle.ts";
export * from "./tool-result.ts";
```

`package.json` exports에 `"./conversation": "./src/conversation/index.ts"`를 더한다.

## 4. 동작 규칙

1. ID는 한 번 발급되면 바뀌지 않는다. 투영 재생은 기록된 ID를 읽고 새로 발급하지 않는다.
2. `PartRecord.contentIndex`는 소속 item 안에서 유일하고 `message.content` 배열 길이보다 작다. `ItemRecord(kind:"assistant").partIds.length`는 `message.content.length`와 같다.
3. toolCall 파트의 `toolCallId`는 `message.content[contentIndex].id`와 같다.
4. 알림 순서: 한 item의 `item.started`는 그 item의 `item.updated`, `item.completed`보다 먼저다. 한 step의 모든 item 알림은 `step.started`와 `step.completed` 사이에 있다. 한 turn의 step 알림은 `turn.started`와 `turn.completed` 사이에 있다. 입력 user item 알림만 `turn.started`보다 먼저다.
5. 상태 갱신 알림은 §3.5.1 전이표를 지킨다. 표에 없는 전이를 만든 매퍼 구현은 결함이다.
6. 한 step의 `stepIndex`는 turn 안에서 0부터 1씩 오른다. 재개된 turn은 체크포인트의 다음 번호부터 쓴다.

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| ID 문자열의 접두가 다르거나 길이가 30이 아님 | 스키마 검증 실패. `isId`는 `false` |
| pi가 새 role을 더함 | `MessageSchema` 검증 실패. pi 고정 버전을 올릴 때 스키마를 함께 고친다 |
| pi가 기존 메시지에 선택 필드를 더함 | `additionalProperties: true`라 통과한다 |
| 어시스턴트 스트림 중 abort | pi가 `stopReason:"aborted"` 메시지로 `message_end`를 낸다. 그대로 item과 파트를 기록한다 |
| 스트림 중 크래시 | 메모리 `PartId`와 휘발 조각을 잃는다. 재개 처리는 `F.records.spec`과 `L1.persistence.spec`이 정한다 |
| `ToolCall.argumentsError`가 있는 호출 | 파트와 메시지는 그대로 기록한다. 도구 실행 여부는 L1-d(`L1.tools.spec`)가 정한다 |
| `assignPartIds`의 `kinds`와 `toolCallIds` 길이가 다름 | 호출 결함. 함수는 `Bug`를 던진다 [제안] |
| `existing`에 같은 contentIndex의 다른 kind | 호출 결함. 함수는 `Bug`를 던진다 [제안] |

## 6. 설정 노출

이 도메인은 사용자 설정 키를 두지 않는다.

## 7. 확장 지점

- 지점 `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_*`은 pi 이벤트 이름을 그대로 쓴다. 선언(fold 종류, 페이로드 타입)은 `F.extensions.spec`의 지점 선언 표가 정한다. 페이로드 타입은 이 문서의 `AgentEvent`(§3.1.1) 변형과 알림 타입을 참조한다.
- `turn_start`·`turn_end` 지점은 Xeon step 경계에서 발화한다(§2.1).
- 확장은 `XeonCustomMessage.customType`으로 구분한다. `AgentMessage`는 닫힌 유니온이고 선언 병합은 없다(§3.1.1, adr.0009).
- post로 들어온 내용이 대화에 남을 때는 `custom` item으로 기록된다. post 수용 기록은 `F.records.spec`의 `input.queued`(`source.type: "extension"`)다(`post.accepted` retire, review.decisions-2 U-05).

## 8. 다른 문서와의 인터페이스

| 문서 | 제공·요구 |
|---|---|
| `F.records.spec` | 제공: 8개 ID와 스키마, `ItemRecord`, `PartRecord`, 수명주기 페이로드 스키마, `ToolResultRecord`, `ReplayPolicy`·`toReplayPolicy`. 요구: envelope의 `threadId`/`turnId`/`stepId` 이름이 `LifecycleScope`와 같을 것 |
| `F.capabilities.spec` | 제공: `ReplayPolicy`, `ResultStatus`, `InputRequiredInfo`, pi-ai 재노출 타입, `AgentTool`·`AgentToolResult`·`ToolExecutionMode`(§3.1.1). 요구: `Tool.name`/`AgentTool.label` 분리 규칙 |
| `F.extensions.spec` | 요구: 지점 선언 표에 §2.1 매핑 표기, `customType` 접두 규칙, 열거형 확장 예약 |
| `F.wire-settings.spec` | 제공: 알림 유니온. 요구: 와이어 표현은 그쪽이 정한다 |
| `L1.loop.spec` (L1-b) | 제공: §3.1.1 에이전트 루프 타입. 요구: `CreateAgentEventMapper` 구현, 자체 루프가 `AgentEvent`를 낸다 |
| `L1.persistence.spec` (L1-f), `L0.store.spec` (L0-e) | 요구: `IdFactory` 구현, ULID 단조성. `storeId`(`sto_`) 발급은 `L0.store.spec`(§3.2.1 ①) |
| `L0.os.spec`, 지역 접두 소유 문서(`L2.artifacts`, `L2.schedule`, `L2.web`, `L2.knowledge`, `L0.process`, `L0.secrets`) | 제공: §3.2.1 `LocalIdPrefix`·`LOCAL_ID_PREFIXES`. 요구: `LocalIdFactory` 구현(`L0.os`), 접두 표기를 표에 맞추기(소유 문서) |
| `L2.mcp.spec` (L2-b) | 요구: MCP `InputRequiredResult` → `ToolResultRecord` 변환 |
| `eng.typescript.guide`, `eng.domain-types.guide` | 요구: 루트의 `Brand`·`Result`·`Bug`·`parse` 제공(DT-05, DT-06), §3 머리말 스키마 선언 형식 승인 |

## 9. 수용 기준

1. 모든 ID 스키마(`ThreadIdSchema` ~ `CheckpointIdSchema`)가 접두사 위반, 소문자 ULID, 길이 위반을 거부하고 올바른 값을 통과시킨다.
2. pi 메시지 픽스처(4개 role × 대표 변형, `argumentsError`가 있는 toolCall, `aborted` 어시스턴트 포함)를 `JSON.stringify`→`JSON.parse` 한 뒤 `MessageSchema` 검증을 통과한다. role을 바꾼 변형은 실패한다.
3. `assignPartIds`에 이전 결과를 `existing`으로 넘기면 같은 `PartId`를 돌려주고 `IdFactory.next`를 부르지 않는다. 같은 `PartRecord` 목록에 대한 `partIdAt` 조회는 재생할 때마다 같은 id를 낸다.
4. F 소스(`src/**`)에 `@earendil-works/pi-ai`의 값 import가 0건이다(`import type`, `export type`만 허용). `@earendil-works/pi-agent-core`는 타입 import도 0건이고 `contracts/package.json` 의존에 없다(adr.0009).
5. `canTransition`은 §3.5.1 표의 전이만 `true`이고 종결 상태에서 나가는 전이는 모두 `false`다.
6. pi 래핑 스키마의 판별 값 목록(role 4종, 블록 `type` 4종, `StopReason` 7종, `AssistantMessageEvent.type` 12종)이 pi 타입의 해당 유니온과 같다(값 목록 상수에 대한 완전성 타입 검사와 스키마 검증 테스트).
7. `resultStatusOf`는 `status`가 없으면 `"complete"`를 돌려준다.
8. `pi.ts`의 re-export 타입이 pi-ai 원본 타입과 같다(`expectTypeOf` + `tsc -b`). pi-ai `AssistantMessageEventStream` 클래스는 F `AssistantMessageEventStream`에 대입할 수 있다.
9. `toReplayPolicy("never")`, `toReplayPolicy(undefined)`는 `"unsafe"`, `toReplayPolicy("safe")`는 `"safe"`다.
10. `LOCAL_ID_PREFIXES`의 키는 모두 `LOCAL_ID_PREFIX_PATTERN`을 만족하고 `RESERVED_ID_PREFIXES`(`IdPrefix` 8종과 `sto`)와 겹치지 않는다. `localIdPattern("art")`은 `art_` + 소문자 ULID와 두 글자 접두 값을 거부한다.
11. `AgentMessage`가 `Message | XeonCustomMessage`와 같다(`Equal` 타입 검사). §3.1.1 타입 선언에 `any`가 0건이고, `AgentEvent`의 `type` 값 목록이 §3.5.4 표 첫 열(10종)과 같다.

## 10. 미결 사항

1. [결정: review.decisions-2 U-01] 용어: pi turn = Xeon step, pi run = Xeon turn이다. 켜기·끄기와 drive 임대 교대는 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에 적용한다(§2.1). 사용자 확인 대상이다.
2. [미결] 런타임 스키마 방식: `Type.Unsafe` 래핑 + 얕은 검증(§3.3)으로 충분한지, pi 타입 전체를 TypeBox로 재정의해 깊은 검증까지 할지. 재정의안은 pi minor마다 추종 비용이 커진다. [결정: review.m2-plan §8] 이 판단은 M3로 미룬다. M2는 얕은 검증을 유지한다.
3. [결정: M2 마감 G5-03] ULID 단조성은 L0 `createIdFactory`·`createLocalIdFactory`(`L0.os.spec` §3.4, `platform-os/src/ids.ts`)가 지킨다. 같은 밀리초이거나 시계가 뒤로 가면 직전 시각을 유지하고 난수 부분을 1 올리며, 80비트가 넘치면 시각을 1ms 올린다. L1 래퍼는 두지 않는다. `platform-os/test/ids.test.ts`가 연속 발급의 사전순 증가를 확인한다.
4. [결정: review.decisions-2 U-24] TypeBox 버전은 1.3.27(catalog 정확 고정)이다. pi-ai가 고정한 판과 같아 한 사본만 설치한다.
