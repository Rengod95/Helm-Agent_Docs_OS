import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  GroupId,
  LeaseArbiterPort,
  LeaseCandidate,
  ScopeId,
} from "@xeon/contracts/extensions";
import type { DriveHolderSetting } from "@xeon/contracts/services";

export interface DriveCandidate {
  readonly scopeId: ScopeId;
  readonly groupId: GroupId;
  /** LeaseCandidate.loadIndex. 0부터 */
  readonly loadOrder: number;
  /** 그 thread 활성 가지의 마지막 scope.changed{status:"enabled"} 이벤트의 seq. 기록이 없으면 null */
  readonly requestSeq: number | null;
}

export interface ArbiterInput {
  /** X가 넘긴 후보. 켜져 있고 drive를 등록했고 오류·idle 반납 대기가 아닌 그룹 */
  readonly candidates: readonly DriveCandidate[];
  /** 설정 x.primitives.activeDriveGroup의 유효 값(thread 범위) */
  readonly holderSetting: DriveHolderSetting;
}

export type ArbiterReason =
  /** 설정 null(auto): 요청 순서로 부여 */
  | "first-request"
  /** activeDriveGroup 지정 그룹 */
  | "named"
  /** 지정 그룹이 후보가 아님. 아무도 받지 않음 */
  | "named-unavailable"
  | "no-candidate";

export interface ArbiterDecision {
  /** 임대를 받을 그룹. null이면 아무도 받지 않는다(사용자 입력이 루프를 소유) */
  readonly holder: ScopeId | null;
  /** 받지 못한 후보. 요청 순서대로 */
  readonly waiting: readonly ScopeId[];
  readonly reason: ArbiterReason;
}

/** 순수 함수 객체. 같은 입력이면 같은 결정 */
export interface DriveArbiter {
  decide(input: ArbiterInput): ArbiterDecision;
}

/**
 * 요청 순서. requestSeq가 작은 쪽이 앞이고, 같으면 loadOrder가 작은 쪽이 앞이다.
 * requestSeq가 null이면(활성 가지에 enabled 기록이 없는 기본 켜짐 그룹) 어떤 enabled 기록보다 앞선 것으로 보고
 * null끼리는 loadOrder로 정한다. 쌍마다 판정이 달라지지 않도록 전체 순서를 하나로 둔다.
 */
function byRequestOrder(a: DriveCandidate, b: DriveCandidate): number {
  if (a.requestSeq !== b.requestSeq) {
    if (a.requestSeq === null) return -1;
    if (b.requestSeq === null) return 1;
    return a.requestSeq - b.requestSeq;
  }
  return a.loadOrder - b.loadOrder;
}

/** L3.group-kit.spec §3.5 규칙 1~3. 선점 판단은 X가 한다(규칙 4) */
export const defaultDriveArbiter: DriveArbiter = {
  decide({ candidates, holderSetting }) {
    const ordered = candidates.toSorted(byRequestOrder);
    if (ordered.length === 0) return { holder: null, waiting: [], reason: "no-candidate" };
    if (holderSetting !== null) {
      const named = ordered.find((candidate) => candidate.scopeId === holderSetting);
      if (named === undefined) {
        return {
          holder: null,
          waiting: ordered.map((candidate) => candidate.scopeId),
          reason: "named-unavailable",
        };
      }
      return {
        holder: named.scopeId,
        waiting: ordered
          .filter((candidate) => candidate.scopeId !== named.scopeId)
          .map((candidate) => candidate.scopeId),
        reason: "named",
      };
    }
    const [first, ...rest] = ordered;
    return {
      holder: first?.scopeId ?? null,
      waiting: rest.map((candidate) => candidate.scopeId),
      reason: "first-request",
    };
  },
};

export interface LeaseArbiterPortDeps {
  /** 설정 x.primitives.activeDriveGroup의 thread 범위 유효 값. 조립 루트가 설정 서비스에 연결한다 */
  readonly holderSetting: (threadId: ThreadId) => DriveHolderSetting;
  /** 후보의 요청 순번. 기본은 LeaseCandidate.enabledAtSeq */
  readonly requestSeq?: (threadId: ThreadId, candidate: LeaseCandidate) => number | null;
}

/** DriveArbiter를 X LeaseArbiterPort로 옮기는 어댑터. 설정 읽기와 requestSeq 조회만 더한다 */
export function leaseArbiterPort(
  arbiter: DriveArbiter,
  deps: LeaseArbiterPortDeps,
): LeaseArbiterPort {
  return {
    choose(threadId, candidates) {
      const mapped: DriveCandidate[] = candidates.map((candidate) => ({
        scopeId: candidate.scopeId,
        groupId: candidate.extension,
        loadOrder: candidate.loadIndex,
        requestSeq:
          deps.requestSeq === undefined
            ? candidate.enabledAtSeq
            : deps.requestSeq(threadId, candidate),
      }));
      return arbiter.decide({ candidates: mapped, holderSetting: deps.holderSetting(threadId) })
        .holder;
    },
  };
}
