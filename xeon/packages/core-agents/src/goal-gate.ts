// 완료 게이트가 판정 결과를 소비하는 규칙(L1.loop.spec §4.9, L1.agents.spec §4.8, D-M3-15).
// `boundary.settle.before` chain 핸들러는 L2.work가 걸고, 결과를 이 순수 함수로 BoundaryValue의 `continue`와 안내로 바꾼다.
import { assertNever } from "@xeon/contracts";
import type { JudgeOutcome } from "@xeon/contracts/services";

export type GoalGateReason = "met" | "not_met" | "undecidable" | "capped" | "failed";

export interface GoalGateDecision {
  /** 참이면 turn을 정착시키지 않고 한 단계 더 돈다 */
  readonly continue: boolean;
  readonly reason: GoalGateReason;
  /** continue가 참일 때 모델에 보낼 지시 문장(영어). 아니면 null */
  readonly instruction: string | null;
  /** 사용자에게 알릴 문장(휘발 알림). 알릴 것이 없으면 null */
  readonly notice: string | null;
}

/**
 * - met: 끝낸다.
 * - not_met, undecidable: 이어서 돈다. 횟수는 판정 상한이 막는다.
 * - capped: turn을 끝내고 사용자에게 알린다(M3-new-02).
 * - failed: 판정 없이 계속 돌지 않는다. 끝낸다(D-M3-15, `stop`).
 */
export function goalGateDecision(outcome: JudgeOutcome): GoalGateDecision {
  switch (outcome.kind) {
    case "capped":
      return {
        continue: false,
        reason: "capped",
        instruction: null,
        notice: `The goal judge reached its limit of ${String(outcome.maxRuns)} runs, so the turn ended without a verdict.`,
      };
    case "failed":
      return {
        continue: false,
        reason: "failed",
        instruction: null,
        notice: `The goal judge failed (${outcome.message}), so the turn stopped.`,
      };
    case "judged":
    case "recorded": {
      const { verdict, missing, rationale } = outcome.record;
      if (verdict === "met") {
        return { continue: false, reason: "met", instruction: null, notice: null };
      }
      const gaps = missing.length === 0 ? "" : ` Missing: ${missing.join("; ")}.`;
      return {
        continue: true,
        reason: verdict,
        instruction: `The goal is not yet shown to be met. ${rationale}${gaps} Continue working, and show evidence for each criterion.`,
        notice: null,
      };
    }
    default:
      return assertNever(outcome, "goalGateDecision");
  }
}
