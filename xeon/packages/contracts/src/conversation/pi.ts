/**
 * pi-ai·pi-agent-core 1.3.0 타입 재노출 자리(F.conversation.spec §3.1).
 *
 * 스펙은 `export type { ... } from "@earendil-works/pi-ai"`를 요구하지만 이 패키지에는 pi 패키지가
 * 연결되어 있지 않다(package.json 의존 없음, node_modules 없음, bun install 금지). 그래서 같은 이름과
 * 같은 모양의 타입을 여기에 선언해 둔다. 값은 하나도 없다. 소비 층은 `@xeon/contracts/conversation`에서만
 * 이 이름을 가져오므로, pi 의존이 연결되면 이 파일만 스펙의 재노출 형태로 바꾸면 된다.
 * 원본과 다른 점: `any`를 `unknown`으로 적었고, `ToolResultMessage`의 조건부 타입을 풀었다.
 */
import type { TSchema } from "typebox";

// ── pi-ai ──────────────────────────────────────────────────────────────
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type StopReason =
  | "pending"
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
  | "deferred";

export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  /** 안전 필터가 가린 사고 블록이면 true. 암호화 payload는 thinkingSignature에 있다. */
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;
  thoughtSignature?: string;
  namespace?: string;
  /** 모델이 보낸 인자 텍스트가 JSON 객체가 아니면 설명이 들어간다. 이때 arguments는 `{}`다. */
  argumentsError?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
  constrainedSampling?: false | JsonObject;
}

export interface ToolReference {
  name: string;
}

export interface SystemMessage {
  role: "system";
  content: string | TextContent[];
  sections?: Record<string, string | null>;
  toolsAdded?: Tool[];
  toolsRemoved?: ToolReference[];
  timestamp: number;
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface DiagnosticErrorInfo {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export interface AssistantMessageDiagnostic {
  type: string;
  timestamp: number;
  error?: DiagnosticErrorInfo;
  details?: JsonObject;
}

export interface DeferredHandle {
  provider: string;
  modelId: string;
  api: string;
  id: string;
  expiresAt?: number;
  pollAfterMs?: number;
  data?: JsonValue;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: string;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  providerThinkingLevel?: string;
  thinkingLevel?: ModelThinkingLevel;
  diagnostics?: AssistantMessageDiagnostic[];
  usage: Usage;
  stopReason: StopReason;
  deferred?: DeferredHandle;
  errorMessage?: string;
  rawStopReason?: string;
  endTurn?: boolean;
  timestamp: number;
  durationMs?: number;
}

export interface NestedToolCallRecord {
  id: string;
  name: string;
  arguments?: JsonObject;
  argumentsBytes?: number;
  status: "ok" | "error" | "unfinished";
  durationMs?: number;
  error?: string;
}

export interface NestedToolCalls {
  calls: NestedToolCallRecord[];
  complete: boolean;
}

export interface ToolResultMessage<TDetails extends JsonValue = JsonValue> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  usage?: Usage;
  nestedCalls?: NestedToolCalls;
  isError: boolean;
  timestamp: number;
  durationMs?: number;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse" | "deferred">;
      message: AssistantMessage;
    }
  | {
      type: "error";
      reason: Extract<StopReason, "aborted" | "error">;
      error: AssistantMessage;
    };

// ── pi-agent-core ──────────────────────────────────────────────────────
export type ToolExecutionMode = "sequential" | "parallel";

/** 확장이 `declare module`로 늘리는 사용자 지정 메시지 표. F는 hierarchy.ts에서 "xeon.custom" 하나만 더한다. */
export interface CustomAgentMessages {}

export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

export interface AgentToolResult<T = JsonValue | undefined> {
  content: (TextContent | ImageContent)[];
  details: T;
  structuredContent?: JsonValue;
  usage?: Usage;
  isError?: boolean;
  terminate?: boolean;
}

export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => unknown;
  outputSchema?: TSchema;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  replay?: "never" | "safe";
  executionMode?: ToolExecutionMode;
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
      durationMs?: number;
    };

// ── pi-agent-core 훅 타입 (L1.tools.spec §3.3, §8.3 F 요청 7) ───────────────
// ToolService.hooks()가 돌려주는 beforeToolCall·afterToolCall의 모양이다. agent-core types.ts의 같은 이름을 옮겼다.

/** 어시스턴트 메시지의 toolCall 블록 하나 */
export type AgentToolCall = ToolCall;

/** 저수준 루프에 넘기는 컨텍스트 스냅샷. 원본의 `AgentTool<any>`는 기본 매개변수로 적었다 */
export interface AgentContext {
  messages: AgentMessage[];
  tools?: AgentTool[];
}

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
  /** 이 배치의 모든 결과가 terminate면 배치 뒤 멈춘다 */
  terminate?: boolean;
}

export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  structuredContent?: JsonValue;
  isError?: boolean;
  usage?: Usage;
  terminate?: boolean;
}

export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  /** 도구 스키마로 검증된 인자 */
  args: unknown;
  context: AgentContext;
}

export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  /** afterToolCall이 덮어쓰기 전의 실행 결과 */
  result: AgentToolResult<unknown>;
  isError: boolean;
  context: AgentContext;
}

/** agent-core AgentLoopConfig의 beforeToolCall·afterToolCall 쌍(둘 다 필수로 좁힌 모양) */
export interface AgentToolHooks {
  beforeToolCall: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
}

// ── pi-ai 호출 타입 (L1.models.spec §3.2 재노출) ───────────────────────────
// ModelService가 쓰는 이름이다. pi-ai의 같은 이름 타입에서 이 계약이 읽는 필드만 옮겼다. pi-ai의 실제 값은 이 모양에
// 대입할 수 있다(필드가 더 많다). pi 의존이 연결되면 이 블록을 스펙의 재노출 형태로 바꾼다.

/** `KnownApi | (string & {})` */
export type Api = string;

/** 프롬프트 캐시 보존 기간 */
export type CacheRetention = "none" | "short" | "long";

/** 추론 레벨별 토큰 예산(토큰 기반 provider 전용) */
export interface ThinkingBudgets {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** 채팅 모델 카탈로그 항목 */
export interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: string;
  baseUrl: string;
  input: ("text" | "image")[];
  cost: ModelCost;
  headers?: Record<string, string>;
  reasoning: boolean;
  /** 추론 레벨 → provider별 값. null은 지원하지 않는 레벨 */
  thinkingLevelMap?: Partial<Record<ModelThinkingLevel, string | null>>;
  contextWindow: number;
  maxTokens: number;
}

/** 모델 호출 입력. systemPrompt와 tools는 맨 앞 시스템 메시지의 줄임 표기다 */
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

declare const transcriptContextBrand: unique symbol;

/** provider에 넘기는 정규화된 컨텍스트. normalizeContext만 만든다 */
export type TranscriptContext = {
  messages: Message[];
  readonly [transcriptContextBrand]: true;
};

/** 스트림 호출 옵션 중 이 계약이 읽는 것 */
export interface SimpleStreamOptions {
  signal?: AbortSignal;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  sessionId?: string;
  cacheRetention?: CacheRetention;
  reasoning?: ModelThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
}

/** 어시스턴트 응답 하나의 이벤트 스트림. 종결 이벤트 뒤 result()가 최종 메시지를 낸다 */
export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  result(): Promise<AssistantMessage>;
}

/** agent-core가 모델 호출에 쓰는 함수. 요청·모델·런타임 실패는 던지지 않고 스트림의 종결 이벤트로 낸다 */
export type StreamFn = (
  model: Model,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/** 구체 provider 하나. 이 계약은 식별과 모델 목록만 읽는다 */
export interface Provider<TApi extends Api = Api> {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  /** 현재 알려진 채팅 모델. 던지지 않는다 */
  getModels(): readonly Model<TApi>[];
}
