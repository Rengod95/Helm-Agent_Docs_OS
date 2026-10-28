import { assertNever } from "@xeon/contracts";
import type { AssistantMessage, StepId, ThreadId } from "@xeon/contracts/conversation";
import type { ModelBinding, OverflowRecovery } from "@xeon/contracts/services";
import { projectBranch, readBranchEvents } from "./branch.ts";
import { compactThread, hasCompactionFor, type CompactDeps } from "./compaction/compact.ts";

// L1.context.spec §4.7 오버플로우 복구, plan C-8. 단계당 한 번만 컴팩션하고 재시도하게 한다.
// "이미 했는가"는 가지 위 thread.compacted의 details.xeon.stepId로 판정하므로 서비스를 다시 만들거나 재개해도 같다.

export function disabledOverflowRecovery(): OverflowRecovery {
  return { action: "fail", reason: "disabled" };
}

export async function recoverOverflow(
  deps: CompactDeps & { readonly contextWindowOf: (binding: ModelBinding) => number },
  threadId: ThreadId,
  stepId: StepId,
  _failed: AssistantMessage,
  binding: ModelBinding,
): Promise<OverflowRecovery> {
  if (!deps.settings().autoCompact) return disabledOverflowRecovery();
  const read = await readBranchEvents(deps, threadId, undefined, undefined);
  if (!read.ok) return { action: "fail", reason: "compaction_failed" };
  const projected = projectBranch(read.value);
  if (!projected.ok) return { action: "fail", reason: "compaction_failed" };
  if (hasCompactionFor(projected.value, "overflow", stepId)) {
    return { action: "fail", reason: "second_overflow" };
  }
  const outcome = await compactThread(deps, threadId, {
    reason: "overflow",
    binding,
    contextWindow: deps.contextWindowOf(binding),
    stepId,
    willRetry: true,
  });
  if (!outcome.ok) return { action: "fail", reason: "compaction_failed" };
  switch (outcome.value.status) {
    case "compacted":
      return { action: "retry", compactedEventId: outcome.value.eventId };
    case "cancelled":
      return { action: "fail", reason: "compaction_cancelled" };
    case "skipped":
      // 요약할 것이 없거나 직전 항목이 컴팩션이면 줄일 방법이 없다
      return outcome.value.why === "disabled"
        ? disabledOverflowRecovery()
        : { action: "fail", reason: "compaction_failed" };
    default:
      return assertNever(outcome.value, "recoverOverflow");
  }
}
