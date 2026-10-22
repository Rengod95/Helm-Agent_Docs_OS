import type { LeaseOwnerInfo, RecoveryMarker } from "@xeon/contracts/records";

// L0.process.spec §3.2·§4.6, L0.process.plan PR-16. 복구 표식('이어서 실행')을 제시 항목으로 바꾸는 순수 함수.
// 이 패키지는 DB를 읽지 않는다. 호스트(L4)가 표식이 있는 thread를 모아 넘긴다.

/** 표식이 있는 thread 하나 */
export interface ResumeCandidate {
  readonly threadId: string;
  readonly marker: RecoveryMarker;
}

export type ResumeAction = "auto_resume" | "offer" | "exhausted";

export interface ResumeOffer {
  readonly threadId: string;
  readonly runningSince: number;
  readonly resumeAttempts: number;
  readonly action: ResumeAction;
  /** 다른 프로세스가 지금 그 세션을 쥐고 있으면 그 소유 정보. 제시만 하고 재개하지 않는다 */
  readonly heldBy: LeaseOwnerInfo | null;
}

export interface ResumePolicyInput {
  readonly serviceMode: boolean;
  /** l1.persistence.autoResume */
  readonly autoResumeEnabled: boolean;
  /** l1.persistence.maxResumeAttempts */
  readonly maxAttempts: number;
}

function actionFor(marker: RecoveryMarker, policy: ResumePolicyInput): ResumeAction {
  if (marker.resumeAttempts >= policy.maxAttempts) return "exhausted";
  // 사용자가 없는 동안 비용과 부작용이 나는 일은 서비스 모드로 한정한다(adr.0006 §3.6 5번)
  if (policy.serviceMode && policy.autoResumeEnabled) return "auto_resume";
  return "offer";
}

export function buildResumeOffers(
  candidates: readonly ResumeCandidate[],
  heldBy: (threadId: string) => LeaseOwnerInfo | null,
  policy: ResumePolicyInput,
): readonly ResumeOffer[] {
  return candidates.map((candidate) => {
    const owner = heldBy(candidate.threadId);
    const action = actionFor(candidate.marker, policy);
    return {
      threadId: candidate.threadId,
      runningSince: candidate.marker.runningSince,
      resumeAttempts: candidate.marker.resumeAttempts,
      // 남이 쥔 세션은 자동 재개하지 않는다. 제시만 한다
      action: owner !== null && action === "auto_resume" ? "offer" : action,
      heldBy: owner,
    };
  });
}
