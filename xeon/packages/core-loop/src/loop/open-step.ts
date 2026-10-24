import { err, ok, type Result } from "@xeon/contracts";
import { stepStartRequest } from "../commits.ts";
import { forEachSequential } from "../sequence.ts";
import { emitEvent, emitMessageStart } from "./sink.ts";
import { commitStep, currentStep, dispatchKey, emitNotifications, tapOptions } from "./turn-run.ts";
import type { TurnRun } from "./turn-run.ts";
import type { LoopFailure, PlacedMessage } from "./types.ts";

// L1.loop.spec §3.2 단계 1 `openStep`. `agent_start`(첫 단계), 단계 시작 알림, S1(T2) 커밋, `turn_start` tap,
// 앞 단계 끝(C5)이 배치한 입력의 메시지 이벤트까지 한다. 모델 바인딩과 도구 광고는 요청을 준비할 때 정한다.

export async function openStep(
  run: TurnRun,
  placed: readonly PlacedMessage[],
): Promise<Result<void, LoopFailure>> {
  const { ctx, mapper, running, state, turnId } = run;
  if (!state.agentStarted) {
    state.agentStarted = true;
    emitEvent(run, { type: "agent_start" });
    await ctx.ext.dispatch("agent_start", { turnId }, tapOptions(run, `${turnId}:agent_start`));
  }

  const notes = mapper.map({ type: "turn_start" });
  const step = currentStep(run);
  running.stepIndex = step.stepIndex;
  if (state.adoptFirstStep) {
    // 같은 단계의 요청을 다시 보낸다: step.started는 이미 기록됐다
    state.adoptFirstStep = false;
  } else {
    const committed = commitStep(run, stepStartRequest(ctx.drafter, step));
    if (!committed.ok) return err(committed.error);
    emitNotifications(
      run,
      notes.filter((note) => note.type !== "step.started"),
    );
    await ctx.ext.dispatch(
      "turn_start",
      { stepIndex: step.stepIndex, stepId: step.stepId, timestamp: ctx.clock.now() },
      tapOptions(run, dispatchKey(run, step.stepId, "turn_start")),
    );
  }

  // C5가 이미 커밋한 입력(steer 등)을 이 단계의 메시지로 낸다. 기록은 하지 않는다
  await forEachSequential(placed, async (item) => {
    state.newMessages.push(item.message);
    await emitMessageStart(run, item.message);
    emitEvent(run, { type: "message_end", message: item.message });
  });
  return ok(undefined);
}
