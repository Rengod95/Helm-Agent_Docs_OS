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
 * pi 타입의 런타임 스키마(F.conversation.spec §3.3). role(또는 type) 판별과 필수 최상위 필드만 얕게 검사한다.
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

const textShape = open({ type: Type.Literal("text"), text: Type.String() });
const thinkingShape = open({ type: Type.Literal("thinking"), thinking: Type.String() });
const imageShape = open({
  type: Type.Literal("image"),
  data: Type.String(),
  mimeType: Type.String(),
});
const toolCallShape = open({
  type: Type.Literal("toolCall"),
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});

const textOrImage = Type.Union([textShape, imageShape]);
const assistantBlock = Type.Union([textShape, thinkingShape, toolCallShape]);

const systemShape = open({
  role: Type.Literal("system"),
  content: Type.Union([Type.String(), Type.Array(textShape)]),
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
  usage: usageShape,
  stopReason: stopReasonShape,
  timestamp: Type.Number(),
});
const toolResultShape = open({
  role: Type.Literal("toolResult"),
  toolCallId: Type.String(),
  toolName: Type.String(),
  content: Type.Array(textOrImage),
  isError: Type.Boolean(),
  timestamp: Type.Number(),
});
/** 모든 JSON 값. 저장 경로는 JSON 왕복을 거치므로 얕게 통과시킨다(깊은 검사는 하지 않는다). */
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
