import type { AssistantMessage, EventId } from "@xeon/contracts/conversation";
import type { ResolvedModel } from "@xeon/contracts/services";
import { emitNotifications, currentStep, type TurnRun } from "./turn-run.ts";

// L1.loop.spec §4.2 규칙 2a·2b. 컴팩션 두 길을 `xeon.context`에 잇는다(M2 마감 G2-01, 감사 L1-01).
//  - 요청 전 임계 검사: 창이 차 가면 요청을 만들기 전에 컴팩션한다(`shouldCompact` → `compact{reason:"threshold"}`).
//  - 오버플로우 복구: 종결 메시지가 `context_overflow`면 단계당 한 번 컴팩션하고 같은 단계의 요청을 다시 보낸다(`recoverOverflow`).
// 컴팩션 커밋은 `core.context` 생산자가 하고, 루프는 커밋 피드로 새 leaf를 따라간다(`LoopServiceHandle`의 `onCommit`).

/**
 * 요청을 만들기 전에 임계를 넘었으면 컴팩션한다. 실패는 turn을 멈추지 않는다: 경고만 남기고 이 turn에서는 다시 시도하지
 * 않는다(단계마다 실패하는 요약 호출을 반복하지 않는다). 그 요청이 창을 넘으면 오버플로우 복구가 한 번 더 시도한다
 */
export async function compactBeforeRequest(
  run: TurnRun,
  resolved: ResolvedModel,
  leaf: EventId,
): Promise<void> {
  const { ctx, state, threadId, scope } = run;
  if (state.compactionBlocked) return;
  const check = await ctx.context.shouldCompact(threadId, leaf, resolved.binding);
  if (!check.should) return;
  const outcome = await ctx.context.compact(threadId, {
    reason: "threshold",
    binding: resolved.binding,
    contextWindow: resolved.model.contextWindow,
    willRetry: false,
    signal: scope.signal,
  });
  if (!outcome.ok) {
    state.compactionBlocked = true;
    if (outcome.error.kind !== "aborted") {
      ctx.logger.warn("loop.compaction_failed", {
        threadId,
        turnId: run.turnId,
        kind: outcome.error.kind,
        tokens: check.tokens,
        threshold: check.threshold,
      });
    }
    return;
  }
  const result = outcome.value;
  if (result.status !== "compacted") {
    state.compactionBlocked = true;
    ctx.logger.info("loop.compaction_not_done", {
      threadId,
      turnId: run.turnId,
      status: result.status,
    });
    return;
  }
  ctx.logger.info("loop.compacted", {
    threadId,
    turnId: run.turnId,
    reason: "threshold",
    tokensBefore: result.tokensBefore,
  });
}

/**
 * 종결 메시지가 `context_overflow`이면 단계당 한 번 컴팩션을 시도한다. 참이면 호출자는 실패한 응답을 버리고 같은 단계의
 * 요청을 다시 만들어 보낸다. 실패한 시도는 커밋하지 않으므로 매퍼가 열어 둔 item만 닫는다(휘발 알림에만 남는다).
 * 복구할 수 없으면(`second_overflow`, 설정 꺼짐, 요약 실패) 거짓이고 호출자는 오류 응답을 그대로 커밋한다
 */
export async function recoverFromOverflow(
  run: TurnRun,
  model: ResolvedModel["model"],
  failed: AssistantMessage,
): Promise<boolean> {
  const { ctx, state, threadId, turnId } = run;
  if (failed.stopReason !== "error") return false;
  if (state.binding === null) return false;
  if (ctx.models.classify(failed, model.contextWindow) !== "context_overflow") return false;
  const step = currentStep(run);
  const recovery = await ctx.context.recoverOverflow(threadId, step.stepId, failed, state.binding);
  if (recovery.action === "fail") {
    ctx.logger.warn("loop.overflow_not_recovered", { threadId, turnId, reason: recovery.reason });
    return false;
  }
  ctx.logger.info("loop.overflow_recovered", {
    threadId,
    turnId,
    stepId: step.stepId,
    compactedEventId: recovery.compactedEventId,
  });
  emitNotifications(run, run.mapper.map({ type: "message_end", message: failed }));
  return true;
}
