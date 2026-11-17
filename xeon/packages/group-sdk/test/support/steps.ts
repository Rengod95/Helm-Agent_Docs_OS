import type { StepResult } from "@fresnel/contracts/extensions";

/** 직전 명령이 `turn`이었고 그 결과가 돌아왔는가. 단계 함수가 커밋할지 정할 때 쓴다 */
export function turnFinished(last: StepResult | null): boolean {
  return last?.kind === "ok" && last.of === "turn";
}
