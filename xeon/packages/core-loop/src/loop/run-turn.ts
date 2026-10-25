// Derived from pi-agent-core 1.3.0 agent-loop.ts runLoop inner iteration (MIT, Copyright (c) 2025 Mario Zechner). See LICENSE.pi.
import { assertNever, ok, type Result } from "@xeon/contracts";
import type { AgentToolCall, AssistantMessage } from "@xeon/contracts/conversation";
import type {
  PlacedMessage,
  LoopFailure,
  StepNext,
  TurnRunResult,
  TurnRunSpec,
  ToolsResume,
} from "./types.ts";
import { beforeAgentStart } from "./before-start.ts";
import { commitResponse } from "./commit-response.ts";
import { recoverFromOverflow } from "./compaction.ts";
import { finishTurn } from "./finish-turn.ts";
import { openStep } from "./open-step.ts";
import { prepareRequest } from "./prepare-request.ts";
import { endStep } from "./step-end.ts";
import { streamResponse } from "./stream-response.ts";
import { resultMessagesOf, runToolBatch, type BatchResult } from "./tool-batch.ts";
import {
  createTurnRun,
  currentStep,
  failureText,
  resolveModel,
  toolRunContext,
  type TurnRun,
} from "./turn-run.ts";
import { failureDetail } from "./types.ts";
import type { LoopContext } from "../types.ts";

// L1.loop.spec §3.2 `runTurn(entry)`. turn 하나의 실행: 진입 분기 → 단계 반복 → 정착 → T6.
// XEON-PATCH: entry-points — 원본의 새 프롬프트·이어가기 두 진입점을 재개 판별자 네 가지(fresh, request, tools, turn_end)로 바꿨다.
// XEON-PATCH: no-outer-loop — 원본의 follow-up 바깥 반복은 없다. followUp은 새 turn이다.
// XEON-PATCH: step-functions — 단계 경계마다 커밋 지점과 확장 지점을 명시 단계 함수가 부른다(콜백 훅 없음).

function toolCallsOf(message: AssistantMessage): AgentToolCall[] {
  return message.content.filter((block): block is AgentToolCall => block.type === "toolCall");
}

/** 요청 단계 하나: 단계 열기 → 요청 → 응답 커밋 → 도구 배치 → 단계 끝. 다음 행동을 돌려준다 */
async function requestStep(
  run: TurnRun,
  placed: readonly PlacedMessage[],
): Promise<Result<StepNext, LoopFailure>> {
  const opened = await openStep(run, placed);
  if (!opened.ok) return opened;
  const preludeMark = run.state.prelude.length;
  const request = await prepareRequest(run);
  if (!request.ok) return request;
  let streamed = await streamResponse(run, request.value);
  // 오버플로우는 단계당 한 번 컴팩션하고 같은 단계의 요청을 다시 보낸다. 앞 시도가 쌓은 prelude는 다시 조립해서 채운다
  if (await recoverFromOverflow(run, request.value.model, streamed)) {
    run.state.prelude.splice(preludeMark);
    const again = await prepareRequest(run);
    if (!again.ok) return again;
    streamed = await streamResponse(run, again.value);
  }
  const responded = await commitResponse(run, streamed);
  if (!responded.ok) return responded;
  const message = responded.value;
  const calls = toolCallsOf(message);
  const hardStop = message.stopReason === "error" || message.stopReason === "aborted";

  let batch: BatchResult | undefined;
  if (calls.length > 0 && !hardStop) {
    const ran = await runToolBatch(run, {
      step: currentStep(run),
      assistant: message,
      calls,
      resume: null,
    });
    if (!ran.ok) return ran;
    batch = ran.value;
  }
  return endStep(run, {
    message,
    outcomes: batch?.outcomes ?? [],
    terminate: batch?.terminate ?? false,
    contextMessages: [
      ...request.value.messages,
      message,
      ...resultMessagesOf(batch?.outcomes ?? []),
    ],
  });
}

/** 단계 끝이 다음 요청 단계를 열라고 했고 멈출 이유(상한, 외부 중단 등)가 기록되지 않았으면 그 단계에 넘길 배치 입력을 돌려준다 */
function nextPlaced(run: TurnRun, next: StepNext): readonly PlacedMessage[] | undefined {
  return next.kind === "request" && run.state.endReason === null ? next.placed : undefined;
}

/**
 * 요청 단계를 반복한다. 단계는 앞 단계의 커밋이 끝나야 시작하므로 차례대로 기다린다.
 * 단계마다 await를 이어 붙이는 재귀 대신 반복문을 쓴다
 */
export async function requestLoop(
  run: TurnRun,
  first: readonly PlacedMessage[],
): Promise<Result<void, LoopFailure>> {
  let placed: readonly PlacedMessage[] | undefined = first;
  while (placed !== undefined) {
    // oxlint-disable-next-line no-await-in-loop -- 다음 단계는 앞 단계의 커밋과 단계 끝 결정을 기다려야 시작할 수 있다 (L1.loop.spec §4.5)
    const next = await requestStep(run, placed);
    if (!next.ok) return next;
    placed = nextPlaced(run, next.value);
  }
  return ok(undefined);
}

/** 도구 단계 중간에서 재개한다. 주 경로와 같은 도구 배치·단계 끝 함수를 쓴다(L1.loop.spec §4.5 tools 행) */
async function resumeTools(run: TurnRun, resume: ToolsResume): Promise<Result<void, LoopFailure>> {
  const { mapper, state, running } = run;
  mapper.restoreStep({
    stepId: resume.stepId,
    stepIndex: resume.stepIndex,
    assistantItemId: resume.assistantItemId,
  });
  state.assistant = resume.assistant;
  state.assistantItemId = resume.assistantItemId;
  const step = currentStep(run);
  running.phase = "tools";
  const resolved = resolveModel(run);
  if (!resolved.ok) return resolved;
  const batch = await runToolBatch(run, {
    step,
    assistant: resume.assistant,
    calls: toolCallsOf(resume.assistant),
    resume: resume.calls,
  });
  if (!batch.ok) return batch;
  const next = await endStep(run, {
    message: resume.assistant,
    outcomes: batch.value.outcomes,
    terminate: batch.value.terminate,
    contextMessages: [],
  });
  if (!next.ok) return next;
  const placed = nextPlaced(run, next.value);
  return placed === undefined ? ok(undefined) : requestLoop(run, placed);
}

async function runEntry(run: TurnRun): Promise<Result<void, LoopFailure>> {
  const entry = run.spec.entry;
  switch (entry.kind) {
    case "fresh": {
      if (!entry.skipBeforeStart) {
        const started = await beforeAgentStart(run, entry);
        if (!started.ok) return started;
      }
      return requestLoop(run, []);
    }
    case "request":
      return requestLoop(run, []);
    case "tools":
      return resumeTools(run, entry.resume);
    case "turn_end": {
      // 요청 없이 T6부터. 결과 없이 남은 호출은 먼저 닫는다
      if (entry.closing !== null && entry.closing.calls.length > 0) {
        await run.ctx.tools.settleRejected(
          entry.closing.calls,
          "not_executed",
          toolRunContext(run, entry.closing.step),
        );
      }
      return ok(undefined);
    }
    default:
      return assertNever(entry, "TurnEntry");
  }
}

/** turn 하나를 끝까지 실행한다. T1은 호출자가 이미 커밋했다. 마지막에 T6(또는 열어 둔 채 반환)까지 한다 */
export async function runTurn(ctx: LoopContext, spec: TurnRunSpec): Promise<TurnRunResult> {
  const run = createTurnRun(ctx, spec);
  let rejection: { readonly reason: string } | null = null;
  try {
    // 열린 turn을 닫는 재진입(`turn_end`)은 먼저 turn 노드를 취소하고, 소유 작업이 없던 노드는 그 자리에서 정착한다.
    // 정착한 노드에는 작업을 등록할 수 없으므로 이 경우만 등록 없이 닫는 작업을 직접 기다린다(open-issues N-03)
    const finished =
      spec.scope.state === "settled" ? await runEntry(run) : await spec.scope.track(runEntry(run));
    if (!finished.ok) {
      // 단계 실패는 값으로 돌아온다. run을 멈추고 T6를 failed로 쓴다
      rejection = { reason: failureDetail(finished.error) };
    }
  } catch (error) {
    // 불변식 위반(Bug)이나 도구·모델 계약 위반. 같은 경로로 T6 failed에 이른다
    rejection = { reason: failureText(error) };
  }
  if (rejection !== null) {
    ctx.logger.error("loop.run_rejected", {
      threadId: run.threadId,
      turnId: run.turnId,
      reason: rejection.reason,
    });
  }
  return finishTurn(run, rejection);
}
