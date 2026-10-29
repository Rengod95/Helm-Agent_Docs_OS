import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";

// L1.tools.spec §4.12, L0.sandbox.spec §3. 샌드박스 밖에서 실행한 도구 호출의 감사 기록이다.
// 명령, 인자, 출력 값을 싣지 않는다. toolCallId로 도구 호출 기록과 잇는다.

const SandboxBypassReasonSchema: TUnion<
  [TLiteral<"escape">, TLiteral<"run_unsandboxed">, TLiteral<"disabled">]
> = Type.Union([Type.Literal("escape"), Type.Literal("run_unsandboxed"), Type.Literal("disabled")]);

export const ToolSandboxBypassedPayloadSchema: TObject<{
  toolCallId: TString;
  toolName: TString;
  reason: typeof SandboxBypassReasonSchema;
  at: TInteger;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: Type.String({ minLength: 1, maxLength: 128 }),
    reason: SandboxBypassReasonSchema,
    at: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ToolSandboxBypassedPayload = Static<typeof ToolSandboxBypassedPayloadSchema>;

// L1.tools.spec §4.3. 턴 안에서 웹·MCP 도구 결과를 읽은 기록이다. afterUntrusted가 재시작 뒤에도 이어지게 한다.
// 도구 결과 본문을 싣지 않는다.
export const ToolUntrustedReadPayloadSchema: TObject<{
  turnId: TString;
  toolCallId: TString;
  toolName: TString;
  at: TInteger;
}> = Type.Object(
  {
    turnId: Type.String({ minLength: 1, maxLength: 128 }),
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: Type.String({ minLength: 1, maxLength: 128 }),
    at: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ToolUntrustedReadPayload = Static<typeof ToolUntrustedReadPayloadSchema>;
