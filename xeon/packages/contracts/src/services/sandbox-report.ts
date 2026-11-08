import { Type, type TUnsafe } from "typebox";
import type { SchemaProof, SchemaSound } from "../base/index.ts";
import type { SandboxBlock } from "../capabilities/index.ts";

// L0.sandbox.spec §3.1. 막은 것의 분류(SandboxBlock 타입과 SandboxBlockSchema)는 capabilities/sandbox-block.ts다.
// services는 다른 F 디렉터리에서 타입만 가져온다(test/services/imports.test.ts), 그래서 아래 blocks 모양은 같은 유니온을 여기에 한 번 더 쓴다.
// 두 스키마가 같은 값을 받고 거르는지는 test/services/sandbox.test.ts가 값으로 확인한다.
// 나머지는 아무것도 import하지 않는다(exec.ts와 sandbox.ts가 함께 쓴다, F.capabilities.spec §3.12 규칙 4).

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
  /** 막은 것의 분류. 막은 것이 없으면 키가 없다 */
  blocks?: SandboxBlock[];
}

const sandboxBlockShape = Type.Union([
  Type.Object(
    {
      code: Type.Literal("sandbox.network_blocked"),
      domain: Type.String({ maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      code: Type.Literal("sandbox.write_blocked"),
      path: Type.String({ maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      code: Type.Literal("sandbox.read_blocked"),
      path: Type.String({ maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
]);

const sandboxRunReportShape = Type.Object(
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
    blocks: Type.Optional(
      Type.Array(sandboxBlockShape satisfies SchemaSound<SandboxBlock, typeof sandboxBlockShape>, {
        maxItems: 256,
      }),
    ),
  },
  { additionalProperties: false },
);

export const SandboxRunReportSchema: TUnsafe<SandboxRunReport> = Type.Unsafe<SandboxRunReport>(
  sandboxRunReportShape satisfies SchemaProof<SandboxRunReport, typeof sandboxRunReportShape>,
);
