import { Type, type TUnsafe } from "typebox";
import type { SchemaSound } from "../base/index.ts";
import { XeonCustomMessageSchema } from "./hierarchy.ts";
import {
  AssistantMessageSchema,
  ImageContentSchema,
  JsonValueSchema,
  SystemMessageSchema,
  TextContentSchema,
  ToolResultMessageSchema,
  UsageSchema,
  UserMessageSchema,
} from "./message-schema.ts";
import type { AgentMessage, AgentToolResult } from "./agent.ts";

// 에이전트 타입(agent.ts)의 런타임 스키마. 메시지는 message-schema.ts의 pi 스키마(role 판별과 필수 최상위 필드, 열린 객체)에
// Xeon 자신의 XeonCustomMessage 스키마(닫힌 객체, 모든 필드)를 더한 유니온이다. pi 쪽 얕음은 message-schema.ts가 안고 있다
// (eng.typescript.guide TY-26 행 U2).
// message-schema.ts는 agent.ts를 import하지 않는다(agent.ts → hierarchy.ts → message-schema.ts 순환을 막는다, DR-06).

const textOrImage = Type.Union([TextContentSchema, ImageContentSchema]);

const agentMessageShape = Type.Union([
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolResultMessageSchema,
  XeonCustomMessageSchema,
]);

/** Message + XeonCustomMessage(role "custom"). */
export const AgentMessageSchema: TUnsafe<AgentMessage> = Type.Unsafe<AgentMessage>(
  agentMessageShape satisfies SchemaSound<AgentMessage, typeof agentMessageShape>,
);

/**
 * 도구 결과(부분 결과 포함). 여섯 필드를 모두 검사하고 모르는 필드는 받지 않는다.
 * 정적 타입의 `details`는 키가 항상 있지만 JSON 왕복 뒤에는 undefined인 키가 사라지므로 스키마는 선택으로 둔다.
 * 그 한 가지 차이 때문에 SchemaProof를 쓰지 못하고 TY-26 행 U2로 둔다.
 */
export const AgentToolResultSchema: TUnsafe<AgentToolResult> = Type.Unsafe<AgentToolResult>(
  Type.Object(
    {
      content: Type.Array(textOrImage),
      details: Type.Optional(JsonValueSchema),
      structuredContent: Type.Optional(JsonValueSchema),
      usage: Type.Optional(UsageSchema),
      isError: Type.Optional(Type.Boolean()),
      terminate: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
);
