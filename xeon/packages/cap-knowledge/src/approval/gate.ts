import { assertNever } from "@xeon/contracts";
import type { ApprovalEvidence, ApprovedBy, KnowledgeActor } from "@xeon/contracts/capabilities";

// L2.knowledge.spec §4.5.1 게이트 표. 쓰기 하나가 바로 적용되는지, 사람에게 승인을 묻는지, 제안 대기열로 가는지를 정하는 순수 함수다.

/** 쓰기를 일으킬 수 있는 행위자. `external`(바깥 편집)과 `system`(복구, 재색인)은 게이트를 지나지 않는다 */
export type WritingActor = Extract<KnowledgeActor, { kind: "user" | "agent" | "extension" }>;

export type GateDecision =
  | { readonly action: "apply"; readonly approvedBy: ApprovedBy }
  | { readonly action: "ask" }
  | { readonly action: "queue" };

export interface GateInput {
  readonly actor: WritingActor;
  /** 호출 문맥에 세션(thread)이 있는가. 사람에게 물을 곳이 있는지를 정한다 */
  readonly hasSession: boolean;
  /** 파괴적 연산인가(spec §4.4.2) */
  readonly destructive: boolean;
  /** `l2.knowledge.write.approval` */
  readonly approvalRequired: boolean;
  /** 호출 확장이 낸 증거가 유효한가 */
  readonly evidenceValid: boolean;
  /** 이번 turn에 untrusted 도구 결과를 읽었는가(`CallerInfo.afterUntrusted`) */
  readonly afterUntrusted: boolean;
}

/**
 * - 사용자는 바로 적용한다.
 * - 확장: 유효한 증거가 있으면 바로 적용(`evidence`). 없으면 승인 요청 또는 대기열(세션이 있으면 요청). 설정이 꺼져 있으면
 *   비파괴 연산은 적용(`policy`)하고 파괴적 연산만 묻는다.
 * - 에이전트: 주 대화는 승인 요청, 서브에이전트는 대기열, 백그라운드 포크는 비파괴 연산도 대기열이다. 설정이 꺼져 있으면
 *   비파괴 연산만 적용한다. 백그라운드 포크의 파괴적 연산은 설정과 무관하게 대기열이다.
 * - 웹·외부 결과를 읽은 turn의 에이전트 쓰기(`afterUntrusted`)는 설정과 무관하게 적용하지 않는다. 주 대화는 묻고 나머지는 대기열이다.
 */
export function decideGate(input: GateInput): GateDecision {
  const { actor } = input;
  switch (actor.kind) {
    case "user":
      return { action: "apply", approvedBy: "user" };
    case "extension": {
      if (input.evidenceValid) return { action: "apply", approvedBy: "evidence" };
      if (!input.approvalRequired && !input.destructive) {
        return { action: "apply", approvedBy: "policy" };
      }
      return input.hasSession ? { action: "ask" } : { action: "queue" };
    }
    case "agent": {
      const needsHuman = input.approvalRequired || input.destructive || input.afterUntrusted;
      if (!needsHuman) return { action: "apply", approvedBy: "policy" };
      switch (actor.agent) {
        case "main":
          return input.hasSession ? { action: "ask" } : { action: "queue" };
        case "subagent":
        case "background":
          return { action: "queue" };
        default:
          return assertNever(actor.agent, "AgentKind");
      }
    }
    default:
      return assertNever(actor, "WritingActor");
  }
}

/**
 * 증거가 유효한가: `source`가 설정의 신뢰 목록에 있고 `source`의 첫 마디가 호출 확장 이름과 같아야 한다.
 * 아무 확장이 남의 source를 꾸며 게이트를 건너뛰지 못하게 하기 위해서다.
 */
export function isEvidenceValid(
  evidence: ApprovalEvidence | undefined,
  actor: KnowledgeActor,
  trustedSources: readonly string[],
): boolean {
  if (evidence === undefined || actor.kind !== "extension") return false;
  if (!trustedSources.includes(evidence.source)) return false;
  // 확장 이름에 점이 들어갈 수 있어 첫 마디가 아니라 `<확장 이름>.` 접두로 맞춘다
  return evidence.source.startsWith(`${actor.extension}.`);
}
