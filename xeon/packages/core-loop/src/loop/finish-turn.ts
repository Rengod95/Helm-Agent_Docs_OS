import type { TurnCompletedPayload } from "@xeon/contracts/conversation";
import { commitWithRetry, describeCommitFailure } from "../commit.ts";
import { turnEndRequest } from "../commits.ts";
import { abortCodeOf, boundarySignal, failureText, tapOptions, type TurnRun } from "./turn-run.ts";
import type { TurnRunResult } from "./types.ts";

// L1.loop.spec §4.2 규칙 7, §4.3 T6. 단계 반복이 끝나고 turn 범위 노드의 소유 작업이 정착한 뒤 `turn.completed`를 커밋한다.

function noop(): Promise<void> {
  return Promise.resolve();
}

/** run 거부(단계 실패나 불변식 위반)로 끝난 turn의 원인. 없으면 null */
export type RunRejection = {
  readonly reason: string;
  /** `turn.completed.error`에 그대로 쓸 문장. 사용자가 고칠 수 있는 원인(모델을 해석하지 못함)만 싣고, 없으면 `loop_rejected`다 */
  readonly userError?: string;
} | null;

export async function finishTurn(run: TurnRun, rejection: RunRejection): Promise<TurnRunResult> {
  const { ctx, scope, state, mapper, spec, threadId, turnId } = run;
  run.emitter.flush();
  if (state.endReason === "stopped" || state.endReason === "deferred") {
    // 안전 경계 정지·지연 응답: turn을 열어 둔다(T6 없음). 재개 후보로 남는다
    await scope.settle();
    const totals = mapper.totals();
    return {
      status: "open",
      usage: totals.usage,
      finalItemId: totals.lastAssistantItemId ?? spec.priorFinalItemId,
      error: null,
      afterIdle: noop,
    };
  }
  if (rejection !== null && !scope.signal.aborted) {
    // run 거부: 남은 소유 작업을 멈추고 정착을 기다린다
    await ctx.tasks.abort(scope, { code: "error", message: rejection.reason });
  }
  await scope.settle();
  const totals = mapper.totals();
  const abortCode = abortCodeOf(scope.signal);
  const lastStop = totals.lastStopReason;
  const finalItemId = totals.lastAssistantItemId ?? spec.priorFinalItemId;

  let status: TurnCompletedPayload["status"];
  let error: string | null;
  if (rejection !== null && abortCode === "error") {
    status = "failed";
    error = rejection.userError ?? "loop_rejected";
  } else if (state.endReason === "step_limit" || state.endReason === "child_limit") {
    status = "interrupted";
    error = state.endReason;
  } else if (state.endReason === "external") {
    status = "interrupted";
    error = abortCodeOf(spec.driveSignal) ?? "aborted";
  } else if (abortCode !== null) {
    status = "interrupted";
    error = abortCode;
  } else if (lastStop === "aborted") {
    status = "interrupted";
    error = totals.lastErrorMessage;
  } else if (lastStop === "error") {
    status = "failed";
    error = totals.lastErrorMessage ?? "error";
  } else if (rejection !== null) {
    status = "failed";
    error = rejection.userError ?? "loop_rejected";
  } else {
    status = "completed";
    error = null;
  }

  const turnScope = { threadId, turnId, stepId: null } as const;
  const signal = boundarySignal(run, "turn_settled", undefined);
  const open = (): TurnRunResult => ({
    status: "open",
    usage: totals.usage,
    finalItemId,
    error,
    afterIdle: noop,
  });
  try {
    const contribution = await ctx.ext.boundary.prepare(signal);
    const payload: TurnCompletedPayload = {
      status,
      stepCount: totals.stepCount,
      usage: totals.usage,
      error: error === null ? null : error.slice(0, 4000),
    };
    const outcome = commitWithRetry(
      ctx.session,
      turnEndRequest(ctx.drafter, turnScope, payload, contribution.drafts),
    );
    if (!outcome.ok) {
      ctx.logger.error("loop.turn_end_commit_failed", {
        threadId,
        turnId,
        failure: describeCommitFailure(outcome.error),
      });
      // 같은 turn이 열려 있는 채로 남으면 재개 후보가 된다(L1.loop.spec §5 "T3 커밋 실패")
      await ctx.ext.boundary.settle(signal, "failed");
      return open();
    }
  } catch (failure) {
    ctx.logger.error("loop.turn_end_failed", { threadId, turnId, reason: failureText(failure) });
    try {
      await ctx.ext.boundary.settle(signal, "failed");
    } catch (settleFailure) {
      ctx.logger.error("loop.turn_end_settle_failed", {
        threadId,
        turnId,
        reason: failureText(settleFailure),
      });
    }
    return open();
  }

  // agent_end tap은 T6 커밋 뒤(L1.loop.spec §7)
  await ctx.ext.dispatch(
    "boundary.turn.after",
    { turnId, messages: structuredClone([...state.newMessages]) },
    tapOptions(run, `${turnId}:boundary.turn.after`),
  );

  return {
    status,
    usage: totals.usage,
    finalItemId,
    error,
    afterIdle: async () => {
      // settle은 thread가 유휴로 보일 때 불러야 drive 재호출이 시작된다
      await ctx.ext.boundary.settle(signal, "committed");
      await ctx.ext.dispatch(
        "boundary.settle.after",
        { turnId, aborted: status === "interrupted" },
        tapOptions(run, `${turnId}:boundary.settle.after`),
      );
    },
  };
}
