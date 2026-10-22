/**
 * pi-ai·pi-agent-core 1.3.0 타입 재노출 자리(F.conversation.spec §3.1).
 *
 * 타입 재노출만 둔다. 값 import·export는 0건이다. 소비 층은 `@xeon/contracts/conversation`에서만 이 이름을
 * 가져오므로, pi 버전을 올릴 때는 이 파일과 message-schema.ts의 스키마만 고친다.
 * 원본과 같은 타입인지는 `test/conversation/pi-types.test.ts`의 항등 검사가 판정한다.
 */
import type { AgentLoopConfig } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";

// ── pi-ai ──────────────────────────────────────────────────────────────
export type {
  Api,
  AssistantMessage,
  AssistantMessageDiagnostic,
  AssistantMessageEvent,
  CacheRetention,
  Context,
  DeferredHandle,
  DiagnosticErrorInfo,
  ImageContent,
  JsonObject,
  JsonValue,
  Message,
  Model,
  ModelCost,
  ModelThinkingLevel,
  NestedToolCallRecord,
  NestedToolCalls,
  Provider,
  SimpleStreamOptions,
  StopReason,
  SystemMessage,
  TextContent,
  ThinkingBudgets,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolReference,
  ToolResultMessage,
  TranscriptContext,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";

// ── pi-agent-core ──────────────────────────────────────────────────────
// CustomAgentMessages는 확장이 `declare module "@earendil-works/pi-agent-core"`로 늘리는 사용자 지정 메시지 표다.
// F는 hierarchy.ts에서 "xeon.custom" 하나만 더한다.
export type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
  BeforeToolCallContext,
  BeforeToolCallResult,
  CustomAgentMessages,
  ToolExecutionMode,
} from "@earendil-works/pi-agent-core";

/**
 * agent-core AgentLoopConfig의 beforeToolCall·afterToolCall 쌍(둘 다 필수로 좁힌 모양).
 * ToolService.hooks()가 돌려준다(L1.tools.spec §3.3, §8.3 F 요청 7). pi에 같은 이름의 타입은 없다.
 */
export type AgentToolHooks = Required<Pick<AgentLoopConfig, "beforeToolCall" | "afterToolCall">>;

// ── 재노출하지 않는 두 이름 ─────────────────────────────────────────────────
// pi-ai의 AssistantMessageEventStream은 `#private`을 가진 클래스라 구조 대입이 안 되고 만들려면 값 import가 필요하다.
// 값 import는 core-models만 한다(DR-07). core-loop처럼 스트림을 만들거나 감싸는 쪽이 pi 값 없이 쓸 수 있도록
// 소비에 쓰는 두 멤버만 적은 인터페이스를 둔다. pi의 클래스는 이 인터페이스를 만족한다(pi-types.test.ts).
// StreamFn은 이 인터페이스를 쓰므로 agent-core 원본과 정확히 같지 않고, 원본 StreamFn은 이 StreamFn에 대입할 수 있다.

/** 어시스턴트 응답 하나의 이벤트 스트림. 종결 이벤트 뒤 result()가 최종 메시지를 낸다 */
export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  result(): Promise<AssistantMessage>;
}

/** agent-core가 모델 호출에 쓰는 함수. 요청·모델·런타임 실패는 던지지 않고 스트림의 종결 이벤트로 낸다 */
export type StreamFn = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
