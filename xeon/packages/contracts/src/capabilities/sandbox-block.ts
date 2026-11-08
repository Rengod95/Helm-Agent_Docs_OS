import { Type, type TUnsafe } from "typebox";
import type { SchemaSound } from "../base/index.ts";

// L0.sandbox.spec §4.2 11번. SandboxRunReport(services/sandbox-report.ts)와 RunOutput(defs/workspace.ts)이 같이 쓴다.
// 순서는 capabilities(2)이고 services(4)가 여기서 가져간다. 이 파일은 base만 import한다.

/**
 * 샌드박스가 막은 것 한 건의 분류(L0.sandbox.spec §4.2 11번). 위반 기록에서 L0가 정한다.
 * 종류마다 막힌 호스트나 경로 하나를 싣는다. 200자에서 자른다.
 */
export type SandboxBlock =
  | { code: "sandbox.network_blocked"; domain: string }
  | { code: "sandbox.write_blocked"; path: string }
  | { code: "sandbox.read_blocked"; path: string };

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

/** 막은 것 한 건의 스키마. 유니온이라 SchemaSound로 확인한다 */
export const SandboxBlockSchema: TUnsafe<SandboxBlock> = Type.Unsafe<SandboxBlock>(
  sandboxBlockShape satisfies SchemaSound<SandboxBlock, typeof sandboxBlockShape>,
);
