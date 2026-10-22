import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
  type TAddOptional,
} from "typebox";
import { Nullable } from "../base/index.ts";
import {
  ImageContentSchema,
  JsonObjectSchema,
  JsonValueSchema,
  TextContentSchema,
  UsageSchema,
} from "./message-schema.ts";
import type { AgentTool, AgentToolResult } from "./agent.ts";
import type { ImageContent, JsonObject, JsonValue, TextContent, Usage } from "./pi.ts";

export const ResultStatusSchema: TUnion<[TLiteral<"complete">, TLiteral<"input_required">]> =
  Type.Union([Type.Literal("complete"), Type.Literal("input_required")]);
/** 오류는 ToolResultRecord.isError로 표현하고 상태 태그 값에는 넣지 않는다. */
export type ResultStatus = Static<typeof ResultStatusSchema>;

/** MCP InputRequiredResult의 내용 필드. 값 모양은 SDK를 따른다 [가정: MCP client 2.3.1]. */
export const InputRequiredInfoSchema: TObject<{
  inputRequests: TUnion<[TUnsafe<JsonObject>, TNull]>;
  requestState: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    inputRequests: Nullable(JsonObjectSchema),
    requestState: Nullable(Type.String({ maxLength: 65_536 })),
  },
  { additionalProperties: false },
);
export type InputRequiredInfo = Static<typeof InputRequiredInfoSchema>;

/** 저장·전달용 결과 레코드. AgentToolResult의 JSON 표현에 상태 태그를 더한다. */
export const ToolResultRecordSchema: TObject<{
  content: TArray<TUnion<[TUnsafe<TextContent>, TUnsafe<ImageContent>]>>;
  details: TUnsafe<JsonValue>;
  structuredContent: TUnsafe<JsonValue>;
  isError: TBoolean;
  terminate: TBoolean;
  usage: TUnion<[TUnsafe<Usage>, TNull]>;
  status: TAddOptional<typeof ResultStatusSchema>;
  inputRequired: TAddOptional<typeof InputRequiredInfoSchema>;
}> = Type.Object(
  {
    /** 모델용 채널 */
    content: Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), { maxItems: 4096 }),
    /** UI·로그용 채널. 없으면 null */
    details: JsonValueSchema,
    /** 구조화 채널(outputSchema 일치). 없으면 null */
    structuredContent: JsonValueSchema,
    isError: Type.Boolean(),
    terminate: Type.Boolean(),
    usage: Nullable(UsageSchema),
    /** 없으면 "complete" */
    status: Type.Optional(ResultStatusSchema),
    /** status === "input_required"일 때만 */
    inputRequired: Type.Optional(InputRequiredInfoSchema),
  },
  { additionalProperties: false },
);
export type ToolResultRecord = Static<typeof ToolResultRecordSchema>;

export function resultStatusOf(record: Pick<ToolResultRecord, "status">): ResultStatus {
  return record.status ?? "complete";
}

/** AgentToolResult의 JSON 표현. details가 undefined이면 null로 둔다. 순수 변환. */
export function toToolResultRecord(result: AgentToolResult): ToolResultRecord {
  return {
    content: result.content,
    details: result.details ?? null,
    structuredContent: result.structuredContent ?? null,
    isError: result.isError ?? false,
    terminate: result.terminate ?? false,
    usage: result.usage ?? null,
  };
}

/** 결과가 불명인 효과를 다시 실행해도 되는지. 기본은 "unsafe". */
export const ReplayPolicySchema: TUnion<[TLiteral<"safe">, TLiteral<"unsafe">]> = Type.Union([
  Type.Literal("safe"),
  Type.Literal("unsafe"),
]);
export type ReplayPolicy = Static<typeof ReplayPolicySchema>;

/** AgentTool.replay("never" | "safe" | undefined) → ReplayPolicy. "safe"만 "safe", 나머지는 "unsafe". 순수 함수. */
export function toReplayPolicy(replay: AgentTool["replay"]): ReplayPolicy {
  return replay === "safe" ? "safe" : "unsafe";
}
