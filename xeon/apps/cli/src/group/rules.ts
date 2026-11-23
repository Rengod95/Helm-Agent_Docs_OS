import { err, ok, type Result } from "@fresnel/contracts";

// L3.slots.spec §3.3.4(이름 규칙)과 예약 이름. `author scaffold`가 플러그인 이름을 검사할 때 쓴다.
// L4는 orchestration-sdk을 import하지 않는다(DR-14). 그래서 이름 상수를 여기 복사해 둔다.
// test/group-rules.test.ts가 orchestration-sdk 소스 텍스트와 비교해 두 목록이 갈라지면 실패한다.

/** 확장 id 규칙(review.decisions-2 U-18). orchestration-sdk의 GROUP_NAME_PATTERN과 같은 문자열이다 */
export const ORCHESTRATION_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,31}$";

/** orchestration-sdk의 RESERVED_GROUP_NAMES와 같은 목록이다. 순서도 같게 둔다 */
export const RESERVED_ORCHESTRATION_NAMES: readonly string[] = [
  "core",
  "cap",
  "xh",
  "sys",
  "p",
  "ext",
  "x",
  "grp",
  "fresnel",
  "workspace",
  "mcp",
  "web",
  "knowledge",
  "work",
  "dialog",
  "artifacts",
  "schedule",
  "auto",
  "all",
  "none",
  "group",
  "groups",
  "kit",
];

export interface OrchestrationNameProblem {
  readonly kind: "orchestration_name";
  /** 형식 위반(pattern)인지 예약 이름(reserved)인지 */
  readonly reason: "pattern" | "reserved";
}

/** 그룹 이름을 검사한다(L3.slots.spec §3.3.4). 설치된 확장과의 충돌은 여기서 보지 않는다 */
export function checkOrchestrationName(name: string): Result<string, OrchestrationNameProblem> {
  if (!new RegExp(ORCHESTRATION_NAME_PATTERN).test(name)) {
    return err({ kind: "orchestration_name", reason: "pattern" });
  }
  if (RESERVED_ORCHESTRATION_NAMES.includes(name))
    return err({ kind: "orchestration_name", reason: "reserved" });
  return ok(name);
}
