/**
 * pi-ai 1.3.0 타입 재노출 자리(F.conversation.spec §3.1). pi-agent-core는 import하지 않는다(adr.0009).
 *
 * 타입 재노출만 둔다. 값 import·export는 0건이다. 소비 층은 `@xeon/contracts/conversation`에서만 이 이름을
 * 가져오므로, pi 버전을 올릴 때는 이 파일과 message-schema.ts의 스키마만 고친다.
 * 원본과 같은 타입인지는 `test/conversation/pi-types.test.ts`의 항등 검사가 판정한다.
 */
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
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

// ── 재노출하지 않는 두 이름 ─────────────────────────────────────────────────
// pi-ai의 AssistantMessageEventStream은 `#private`을 가진 클래스라 구조 대입이 안 되고 만들려면 값 import가 필요하다.
// 값 import는 core-models만 한다(DR-07). core-loop처럼 스트림을 만들거나 감싸는 쪽이 pi 값 없이 쓸 수 있도록
// 소비에 쓰는 두 멤버만 적은 인터페이스를 둔다. pi의 클래스는 이 인터페이스를 만족한다(pi-types.test.ts).

/** 어시스턴트 응답 하나의 이벤트 스트림. 종결 이벤트 뒤 result()가 최종 메시지를 낸다 */
export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  result(): Promise<AssistantMessage>;
}

/**
 * 루프가 모델 호출에 쓰는 함수. 요청·모델·런타임 실패는 던지지 않고 스트림의 종결 이벤트로 낸다.
 * 컨텍스트는 변환을 마친 메시지(`messages`)만 담는다. `TranscriptContext`로 정규화하는 일은 pi-ai 값 함수라서
 * 값 import를 가진 core-models가 streamFn 안에서 한다(adr.0009 §3.5).
 */
export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
