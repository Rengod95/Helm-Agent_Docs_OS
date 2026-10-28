import { Type, type TSchema, type TUnsafe } from "typebox";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  JsonObject,
  JsonValue,
  Message,
  ModelThinkingLevel,
  StopReason,
  SystemMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "./pi.ts";

/**
 * pi 타입의 런타임 스키마(F.conversation.spec §3.3, M3-REQ-20). role(또는 type) 판별과 필수 필드에 더해
 * 선택 필드(서명, 진단, 지연 핸들, 중첩 호출 기록, 도구 선언)의 타입까지 깊게 검사한다.
 * 모든 객체는 additionalProperties: true라 pi가 선택 필드를 더해도 옛 기록과 새 기록이 통과한다.
 * 정적 타입과 스키마의 일치는 컴파일러가 보장하지 않는다. 픽스처 왕복 테스트와 판별 값 목록 테스트로 확인한다.
 */

// ── 판별 값 목록. pi 유니온과의 완전성은 test/conversation/discriminants.test.ts가 타입으로 검사한다 ──
export const MODEL_THINKING_LEVELS: readonly [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export const MESSAGE_ROLES: readonly ["system", "user", "assistant", "toolResult"] = [
  "system",
  "user",
  "assistant",
  "toolResult",
];
export const CONTENT_BLOCK_TYPES: readonly ["text", "thinking", "image", "toolCall"] = [
  "text",
  "thinking",
  "image",
  "toolCall",
];
export const STOP_REASONS: readonly [
  "pending",
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
  "deferred",
] = ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"];
export const ASSISTANT_EVENT_TYPES: readonly [
  "start",
  "text_start",
  "text_delta",
  "text_end",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
  "done",
  "error",
] = [
  "start",
  "text_start",
  "text_delta",
  "text_end",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
  "done",
  "error",
];

/** 재귀 JSON 값. 깊은 검사의 바탕이며 NaN·무한대는 통과하지 못한다 */
const jsonValueShape = Type.Cyclic(
  {
    JsonValue: Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Type.Ref("JsonValue")),
      Type.Record(Type.String(), Type.Ref("JsonValue")),
    ]),
  },
  "JsonValue",
);
const jsonObjectShape = Type.Record(Type.String(), jsonValueShape);

function open<P extends Parameters<typeof Type.Object>[0]>(
  properties: P,
): ReturnType<typeof Type.Object<P>> {
  return Type.Object(properties, { additionalProperties: true });
}

function literalUnion(values: readonly string[]): TSchema {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const NonNegativeNumber = Type.Number({ minimum: 0 });

const stopReasonShape = literalUnion(STOP_REASONS);

const usageShape = open({
  input: NonNegativeNumber,
  output: NonNegativeNumber,
  cacheRead: NonNegativeNumber,
  cacheWrite: NonNegativeNumber,
  cacheWrite1h: Type.Optional(NonNegativeNumber),
  reasoning: Type.Optional(NonNegativeNumber),
  totalTokens: NonNegativeNumber,
  cost: open({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    total: Type.Number(),
  }),
});

const textShape = open({
  type: Type.Literal("text"),
  text: Type.String(),
  textSignature: Type.Optional(Type.String()),
});
const thinkingShape = open({
  type: Type.Literal("thinking"),
  thinking: Type.String(),
  thinkingSignature: Type.Optional(Type.String()),
  redacted: Type.Optional(Type.Boolean()),
});
const imageShape = open({
  type: Type.Literal("image"),
  data: Type.String(),
  mimeType: Type.String(),
});
const toolCallShape = open({
  type: Type.Literal("toolCall"),
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  arguments: jsonObjectShape,
  thoughtSignature: Type.Optional(Type.String()),
  namespace: Type.Optional(Type.String()),
  argumentsError: Type.Optional(Type.String()),
});

const textOrImage = Type.Union([textShape, imageShape]);
const assistantBlock = Type.Union([textShape, thinkingShape, toolCallShape]);

const toolDeclShape = open({
  name: Type.String(),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
});
const diagnosticShape = open({
  type: Type.String(),
  timestamp: Type.Number(),
  error: Type.Optional(
    open({
      name: Type.Optional(Type.String()),
      message: Type.String(),
      stack: Type.Optional(Type.String()),
      code: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    }),
  ),
  details: Type.Optional(jsonObjectShape),
});
const deferredShape = open({
  provider: Type.String(),
  modelId: Type.String(),
  api: Type.String(),
  id: Type.String(),
  expiresAt: Type.Optional(Type.Number()),
  pollAfterMs: Type.Optional(Type.Number()),
  data: Type.Optional(jsonValueShape),
});
const nestedCallShape = open({
  id: Type.String(),
  name: Type.String(),
  arguments: Type.Optional(jsonObjectShape),
  argumentsBytes: Type.Optional(NonNegativeNumber),
  status: Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("unfinished")]),
  durationMs: Type.Optional(NonNegativeNumber),
  error: Type.Optional(Type.String()),
});

const systemShape = open({
  role: Type.Literal("system"),
  content: Type.Union([Type.String(), Type.Array(textShape)]),
  sections: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
  toolsAdded: Type.Optional(Type.Array(toolDeclShape)),
  toolsRemoved: Type.Optional(Type.Array(open({ name: Type.String() }))),
  timestamp: Type.Number(),
});
const userShape = open({
  role: Type.Literal("user"),
  content: Type.Union([Type.String(), Type.Array(textOrImage)]),
  timestamp: Type.Number(),
});
const assistantShape = open({
  role: Type.Literal("assistant"),
  content: Type.Array(assistantBlock),
  api: Type.String(),
  provider: Type.String(),
  model: Type.String(),
  responseModel: Type.Optional(Type.String()),
  responseId: Type.Optional(Type.String()),
  providerThinkingLevel: Type.Optional(Type.String()),
  thinkingLevel: Type.Optional(literalUnion(MODEL_THINKING_LEVELS)),
  diagnostics: Type.Optional(Type.Array(diagnosticShape)),
  usage: usageShape,
  stopReason: stopReasonShape,
  deferred: Type.Optional(deferredShape),
  errorMessage: Type.Optional(Type.String()),
  rawStopReason: Type.Optional(Type.String()),
  endTurn: Type.Optional(Type.Boolean()),
  timestamp: Type.Number(),
  durationMs: Type.Optional(NonNegativeNumber),
});
const toolResultShape = open({
  role: Type.Literal("toolResult"),
  toolCallId: Type.String(),
  toolName: Type.String(),
  content: Type.Array(textOrImage),
  details: Type.Optional(jsonValueShape),
  usage: Type.Optional(usageShape),
  nestedCalls: Type.Optional(
    open({ calls: Type.Array(nestedCallShape), complete: Type.Boolean() }),
  ),
  isError: Type.Boolean(),
  timestamp: Type.Number(),
  durationMs: Type.Optional(NonNegativeNumber),
});
/** 끝까지 검사하는 JSON 값. 확장 지점 페이로드처럼 `$ref`가 필요 없는 곳에서 쓴다(M3-REQ-05) */
export const DeepJsonValueSchema: TUnsafe<JsonValue> = Type.Unsafe<JsonValue>(jsonValueShape);
export const DeepJsonObjectSchema: TUnsafe<JsonObject> = Type.Unsafe<JsonObject>(jsonObjectShape);

/**
 * 정적 타입은 `unknown`으로 두고 런타임에서만 JSON 객체·값을 끝까지 검사한다. 정적 타입을 `JsonObject`·`JsonValue`로 좁히면
 * `unknown`을 넘기던 호출자(core-models의 제공자 요청)가 컴파일되지 않아서 두는 호환 형태다. 호출자가 좁힌 뒤 `Deep*`로 바꾼다 [제안].
 */
export const CheckedJsonObjectSchema: TUnsafe = Type.Unsafe(jsonObjectShape);
export const CheckedJsonValueSchema: TUnsafe = Type.Unsafe(jsonValueShape);

/**
 * 모든 JSON 값. 능력 정의의 JSON Schema 생성에도 쓰이므로 `$ref` 없는 얕은 스키마로 둔다.
 * 메시지 안의 JSON 필드는 재귀 검사(jsonValueShape)를 쓴다(M3-REQ-20).
 */
export const JsonValueSchema: TUnsafe<JsonValue> = Type.Unsafe<JsonValue>(Type.Unknown());
export const JsonObjectSchema: TUnsafe<JsonObject> = Type.Unsafe<JsonObject>(
  Type.Record(Type.String(), Type.Unknown()),
);

export const StopReasonSchema: TUnsafe<StopReason> = Type.Unsafe<StopReason>(stopReasonShape);

/** Usage는 작아서 필드 전체를 검사한다. cacheWrite1h, reasoning은 선택. */
export const UsageSchema: TUnsafe<Usage> = Type.Unsafe<Usage>(usageShape);

export const TextContentSchema: TUnsafe<TextContent> = Type.Unsafe<TextContent>(textShape);
export const ThinkingContentSchema: TUnsafe<ThinkingContent> =
  Type.Unsafe<ThinkingContent>(thinkingShape);
export const ImageContentSchema: TUnsafe<ImageContent> = Type.Unsafe<ImageContent>(imageShape);
export const ToolCallSchema: TUnsafe<ToolCall> = Type.Unsafe<ToolCall>(toolCallShape);

export const SystemMessageSchema: TUnsafe<SystemMessage> = Type.Unsafe<SystemMessage>(systemShape);
export const UserMessageSchema: TUnsafe<UserMessage> = Type.Unsafe<UserMessage>(userShape);
export const AssistantMessageSchema: TUnsafe<AssistantMessage> =
  Type.Unsafe<AssistantMessage>(assistantShape);
export const ToolResultMessageSchema: TUnsafe<ToolResultMessage> =
  Type.Unsafe<ToolResultMessage>(toolResultShape);

/** role 판별 유니온. 변형마다 확인하는 필드는 위 shape 선언을 따른다. */
export const MessageSchema: TUnsafe<Message> = Type.Unsafe<Message>(
  Type.Union([systemShape, userShape, assistantShape, toolResultShape]),
);

/** type 판별만 한다. 휘발 경로 디버깅용이며 저장 경로에서는 쓰지 않는다. */
export const AssistantMessageEventSchema: TUnsafe<AssistantMessageEvent> =
  Type.Unsafe<AssistantMessageEvent>(open({ type: literalUnion(ASSISTANT_EVENT_TYPES) }));

/** 추론 수준 7종(off 포함). 체크포인트가 재개 후 첫 요청의 수준으로 쓴다. */
export const ModelThinkingLevelSchema: TUnsafe<ModelThinkingLevel> =
  Type.Unsafe<ModelThinkingLevel>(literalUnion(MODEL_THINKING_LEVELS));
