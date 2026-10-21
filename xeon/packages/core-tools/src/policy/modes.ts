import type { PermissionMode, ToolRisk } from "@xeon/contracts/services";
import { assertNever } from "@xeon/contracts";

// L1.tools.spec §4.6 모드 기본값 표. 규칙이 정하지 않은 호출에 적용한다.
export type ModeEffect = "allow" | "ask" | "deny";

export function modeDefault(mode: PermissionMode, risk: ToolRisk): ModeEffect {
  switch (mode) {
    case "default":
      return risk === "read" ? "allow" : "ask";
    case "acceptEdits":
      return risk === "exec" ? "ask" : "allow";
    case "plan":
      return risk === "read" ? "allow" : "deny";
    case "bypass":
      return "allow";
    default:
      return assertNever(mode, "modeDefault");
  }
}

/** 도구가 선언한 등급. 선언이 없으면 hints.readOnly로 유도하고 그것도 없으면 가장 위험한 exec다 */
export function deriveRisk(
  declared: ToolRisk | undefined,
  hints: { readonly readOnly?: boolean } | undefined,
): ToolRisk {
  if (declared !== undefined) return declared;
  return hints?.readOnly === true ? "read" : "exec";
}
