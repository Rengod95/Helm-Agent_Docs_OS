import {
  Type,
  type TBoolean,
  type TLiteral,
  type TObject,
  type TOptional,
  type TUnion,
  type TUnsafe,
} from "typebox";

// 도구 호출의 정책 메타 값. 정책·승인(services)과 도구 지점 페이로드(extensions)가 함께 쓰므로 둘보다 낮은 이 층에 둔다.
// services/tools.ts는 같은 이름을 다시 내보낸다(F.capabilities.spec §3.3).

/** 효과 범위. 미선언은 "exec"로 본다 */
export type ToolRisk = "read" | "write" | "exec";
export const ToolRiskSchema: TUnion<[TLiteral<"read">, TLiteral<"write">, TLiteral<"exec">]> =
  Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("exec")]);

/** 정책이 도구 이름 대신 쓰는 의미 표지. L1.agents의 자식 차단 목록이 쓴다 */
export type ToolClass = "spawn" | "user_interaction" | "shared_state_write" | "external_send";

/** 호출 주체. 정의 이름은 L1.agents의 AgentDefinition.name */
export type CallerId = "main" | `subagent:${string}`;
export const CALLER_ID_PATTERN: string = "^(main|subagent:.{1,64})$";
export const CallerIdSchema: TUnsafe<CallerId> = Type.Unsafe<CallerId>(
  Type.String({ pattern: CALLER_ID_PATTERN, maxLength: 72 }),
);

/** `ToolHints`(tool-spec.ts)의 스키마. 지점 페이로드가 싣는다 */
export const ToolHintsSchema: TObject<{
  readOnly: TOptional<TBoolean>;
  destructive: TOptional<TBoolean>;
  idempotent: TOptional<TBoolean>;
  openWorld: TOptional<TBoolean>;
}> = Type.Object(
  {
    readOnly: Type.Optional(Type.Boolean()),
    destructive: Type.Optional(Type.Boolean()),
    idempotent: Type.Optional(Type.Boolean()),
    openWorld: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
