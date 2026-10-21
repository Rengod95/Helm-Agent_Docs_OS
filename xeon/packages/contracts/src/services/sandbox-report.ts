import { Type, type TUnsafe } from "typebox";

// L0.sandbox.spec §3.1. 아무것도 import하지 않는다(exec.ts와 sandbox.ts가 함께 쓴다, F.capabilities.spec §3.12 규칙 4).

export interface SandboxViolation {
  source: "proxy" | "seatbelt" | "seccomp";
  operation: "file_read" | "file_write" | "network" | "other";
  /** 경로나 호스트. 200자에서 자른다. 파일 내용과 env 값은 넣지 않는다 */
  target?: string;
  count: number;
}

/** ShellExecResult.sandbox(L0.exec.spec §3.1)의 값. 값 없는 실행 정보다 */
export interface SandboxRunReport {
  sandboxed: boolean;
  level: "srt" | "none";
  /** sandboxed가 거짓인 이유 */
  unsandboxedBy?: "escape" | "run_unsandboxed" | "disabled";
  violations: SandboxViolation[];
  /** 위반 기록이 상한에서 잘렸는가 */
  violationsTruncated: boolean;
}

export const SandboxRunReportSchema: TUnsafe<SandboxRunReport> = Type.Unsafe<SandboxRunReport>(
  Type.Object(
    {
      sandboxed: Type.Boolean(),
      level: Type.Union([Type.Literal("srt"), Type.Literal("none")]),
      unsandboxedBy: Type.Optional(
        Type.Union([
          Type.Literal("escape"),
          Type.Literal("run_unsandboxed"),
          Type.Literal("disabled"),
        ]),
      ),
      violations: Type.Array(
        Type.Object(
          {
            source: Type.Union([
              Type.Literal("proxy"),
              Type.Literal("seatbelt"),
              Type.Literal("seccomp"),
            ]),
            operation: Type.Union([
              Type.Literal("file_read"),
              Type.Literal("file_write"),
              Type.Literal("network"),
              Type.Literal("other"),
            ]),
            target: Type.Optional(Type.String({ maxLength: 200 })),
            count: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 256 },
      ),
      violationsTruncated: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
);
