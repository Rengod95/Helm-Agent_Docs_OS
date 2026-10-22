import { Type, type TUnsafe } from "typebox";
import {
  AssistantMessageSchema,
  ImageContentSchema,
  SystemMessageSchema,
  TextContentSchema,
  ToolResultMessageSchema,
  UserMessageSchema,
} from "./message-schema.ts";
import type { AgentMessage, AgentToolResult } from "./agent.ts";

// 에이전트 타입(agent.ts)의 얕은 런타임 스키마. message-schema.ts와 같은 규칙(role 판별과 필수 최상위 필드만, 열린 객체).
// message-schema.ts는 agent.ts를 import하지 않는다(agent.ts → hierarchy.ts → message-schema.ts 순환을 막는다, DR-06).

const textOrImage = Type.Union([TextContentSchema, ImageContentSchema]);

const customShape = Type.Object(
  {
    role: Type.Literal("custom"),
    customType: Type.String({ minLength: 1 }),
    content: Type.Union([Type.String(), Type.Array(textOrImage)]),
    display: Type.Boolean(),
    details: Type.Unknown(),
    timestamp: Type.Number(),
  },
  { additionalProperties: true },
);

/** Message + XeonCustomMessage(role "custom"). */
export const AgentMessageSchema: TUnsafe<AgentMessage> = Type.Unsafe<AgentMessage>(
  Type.Union([
    SystemMessageSchema,
    UserMessageSchema,
    AssistantMessageSchema,
    ToolResultMessageSchema,
    customShape,
  ]),
);

/** 도구 결과(부분 결과 포함)의 얕은 검사. details는 undefined일 수 있어 JSON 왕복 뒤에는 키가 없을 수 있다. */
export const AgentToolResultSchema: TUnsafe<AgentToolResult> = Type.Unsafe<AgentToolResult>(
  Type.Object(
    { content: Type.Array(textOrImage), details: Type.Optional(Type.Unknown()) },
    { additionalProperties: true },
  ),
);
