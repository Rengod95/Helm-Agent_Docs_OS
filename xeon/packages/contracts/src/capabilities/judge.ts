import type { ItemId, StepId, ThreadId, TurnId, Usage } from "../conversation/index.ts";

// 목표 판정의 값(L1.agents.spec §4.8). 서비스 `AgentService.judge`와 공개 기능 `agents.judge`가 같이 쓰므로 capabilities에 둔다
// (services/agents.ts는 같은 이름을 다시 내보낸다). 기능 정의는 defs/agents.ts가 이 타입으로 모양을 맞춘다.

export interface JudgeEvidence {
  readonly kind: "assistant_text" | "tool_result" | "work_item" | "note";
  readonly text: string;
  /** 증거 원본 위치. item, effect, L2.work 레코드 */
  readonly ref?: {
    readonly itemId?: ItemId;
    readonly effectId?: string;
    readonly workRef?: string;
  };
}

export interface JudgeInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  /**
   * 판정을 요청한 단계. 있으면 같은 단계의 재호출(재개)을 알아보고 기록된 판정을 `recorded`로 돌려준다.
   * 한 turn 안에서 게이트가 여러 번 판정할 수 있어 `turnId`만으로는 구분하지 못한다
   */
  readonly stepId?: StepId | null;
  /** L2.work의 목표 참조. 상한 집계 단위 */
  readonly goalRef: string;
  readonly goal: { readonly text: string; readonly criteria: readonly string[] };
  readonly evidence: readonly JudgeEvidence[];
}

export type JudgeVerdict = "met" | "not_met" | "undecidable";

export interface JudgeRecord {
  readonly goalRef: string;
  /** 1부터 */
  readonly run: number;
  readonly verdict: JudgeVerdict;
  readonly rationale: string;
  /** 충족되지 않은 기준 */
  readonly missing: readonly string[];
  readonly usage: Usage | null;
  readonly model: { readonly provider: string; readonly modelId: string };
}

export type JudgeOutcome =
  /** 이번 호출이 판정하고 agent.judged를 커밋했다 */
  | { readonly kind: "judged"; readonly record: JudgeRecord }
  /** 이미 기록된 판정(재개) */
  | { readonly kind: "recorded"; readonly record: JudgeRecord }
  | { readonly kind: "capped"; readonly runs: number; readonly maxRuns: number }
  | { readonly kind: "failed"; readonly message: string };
