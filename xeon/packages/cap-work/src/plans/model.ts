import { err, ok, parse, type Result } from "@xeon/contracts";
import { PlanIdSchema, type PlanId } from "@xeon/contracts/capabilities";
import type { PermissionMode } from "@xeon/contracts/services";
import type { PlanRow } from "../projection/read.ts";
import type { PlanFailure } from "./failure.ts";

// L2.work.spec §4.2.4 1, §4.2.5. 계획 버전 번호 매기기와 계획 모드 종료 조건. 순수 함수다.

const MAX_VERSION = 999;

export interface SubmitTarget {
  readonly planId: PlanId;
  readonly version: number;
  /** 새 판이 잇는 이전 판. 새 계획이면 null */
  readonly supersedes: number | null;
  /** 이전 판들이 등록해 둔 산출물 id. 같은 산출물의 버전을 늘리는 데 쓴다 */
  readonly artifactId: string | null;
}

function maxOrd(plans: readonly PlanRow[]): number {
  return plans.reduce((max, plan) => Math.max(max, Number(plan.planId.slice(1))), 0);
}

/** 제출이 어느 계획의 몇 번째 판이 되는지 정한다. 승인 대기 중인 판이 있으면 plan_pending이다 */
export function submitTarget(
  plans: readonly PlanRow[],
  requestedPlanId: string | undefined,
): Result<SubmitTarget, PlanFailure> {
  if (requestedPlanId === undefined) {
    const planId = parse(PlanIdSchema, `p${maxOrd(plans) + 1}`);
    return planId.ok
      ? ok({ planId: planId.value, version: 1, supersedes: null, artifactId: null })
      : err({ kind: "invalid_input", message: "The thread reached its plan limit." });
  }
  const planId = parse(PlanIdSchema, requestedPlanId);
  if (!planId.ok)
    return err({ kind: "invalid_input", message: `"${requestedPlanId}" is not a plan id` });
  const versions = plans.filter((plan) => plan.planId === planId.value);
  const latest = versions[versions.length - 1];
  if (latest === undefined) return err({ kind: "not_found", id: requestedPlanId });
  if (latest.status === "submitted") return err({ kind: "plan_pending" });
  if (latest.version >= MAX_VERSION) {
    return err({ kind: "invalid_input", message: "The plan reached its version limit." });
  }
  const artifact = versions.toReversed().find((plan) => plan.artifact !== null)?.artifact;
  return ok({
    planId: planId.value,
    version: latest.version + 1,
    supersedes: latest.version,
    artifactId: artifact?.artifactId ?? null,
  });
}

/** 계획 모드에 들어온 뒤(enteredSeq 이후) 제출된 판. 모드 진입 시점을 모르면 모든 판이다 */
export function plansSinceEntry(plans: readonly PlanRow[], enteredSeq: number | null): PlanRow[] {
  const since = enteredSeq ?? 0;
  return plans.filter((plan) => plan.submittedSeq > since);
}

const MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypass"];

/** 저장된 문자열을 권한 모드로 읽는다. 모르는 값이면 undefined */
export function permissionModeOf(raw: string | null): PermissionMode | undefined {
  return MODES.find((mode) => mode === raw);
}
