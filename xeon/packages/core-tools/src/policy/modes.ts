import type { PermissionMode, ToolRisk } from "@fresnel/contracts/services";
import { assertNever } from "@fresnel/contracts";

// L1.tools.spec §4.6 모드 기본값 표. 규칙이 정하지 않은 호출에 적용한다.
export type ModeEffect = "allow" | "ask" | "deny";

export function modeDefault(mode: PermissionMode, risk: ToolRisk): ModeEffect {
  switch (mode) {
    case "default":
      return risk === "read" ? "allow" : "ask";
    case "acceptEdits":
      return risk === "exec" ? "ask" : "allow";
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

/**
 * 모드가 "실행 허가" 성격의 승인을 덮는가(L1.tools.spec §4.5). bypass이고 managed가 막지 않았을 때만 참이다.
 * bypass 여부를 비교하는 곳은 정책 평가기와 이 함수 두 군데뿐이다 [결정: 2026-11-13 사용자]
 */
export function modeCoversRunApprovals(mode: PermissionMode, bypassAllowed: boolean): boolean {
  return mode === "bypass" && bypassAllowed;
}
