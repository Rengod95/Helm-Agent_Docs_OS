import { WorkPlans, type CapabilityApi, type PlanVersion } from "@fresnel/contracts/capabilities";
import type { WorkPlansDeps } from "../deps.ts";
import { orThrow as orThrowIn, scopeOf } from "../call.ts";
import { planNotFound } from "../errors.ts";
import { readPlans, type PlanRow } from "../projection/read.ts";
import { createThreadQueue } from "../tasks/queue.ts";

// L2.work.spec §3.3. work.plans 서비스. 계획 모드와 계획 승인은 없앴다 [결정: 2026-11-13 사용자].
// 남는 일은 옛 계획 기록(work.plan_* 이벤트, 승인 해결 기록)을 투영에서 읽어 판 목록을 돌려주는 `versions`뿐이다. 쓰지 않는다.

const CAPABILITY = WorkPlans.id;

function toPlanVersion(row: PlanRow): PlanVersion {
  return {
    planId: row.planId,
    version: row.version,
    title: row.title,
    body: row.body,
    status: row.status,
    artifact: row.artifact,
    approvalId: row.approvalId,
    feedback: row.feedback,
  };
}

/** 옛 계획 기록을 읽는 work.plans 서비스를 만든다. 쓰기 메서드는 없다 */
export function createPlans(deps: WorkPlansDeps): CapabilityApi<typeof WorkPlans> {
  // 읽기도 스레드 큐를 지난다: 같은 스레드의 다른 메서드와 같은 순서로 투영을 본다(작업 목록, 목표 읽기와 같은 방식)
  const queue = createThreadQueue();
  return {
    async versions(input, options) {
      const scope = scopeOf(CAPABILITY, "versions", options);
      return await queue.run(scope.threadId, () => {
        const plans = orThrowIn(CAPABILITY, "versions", readPlans(deps.reader, scope.threadId));
        const versions = plans.filter((plan) => plan.planId === input.planId).map(toPlanVersion);
        if (versions.length === 0) throw planNotFound(CAPABILITY, "versions", input.planId);
        return { versions };
      });
    },
  };
}
