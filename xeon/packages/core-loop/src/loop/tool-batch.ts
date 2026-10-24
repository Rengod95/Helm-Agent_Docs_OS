// Derived from pi-agent-core 1.3.0 agent-loop.ts executeToolCalls, executeToolCallsSequential, executeToolCallsParallel,
// failToolCallsFromTruncatedMessage, shouldTerminateToolBatch (MIT, Copyright (c) 2025 Mario Zechner). See LICENSE.pi.
import { Bug, err, ok, type Result } from "@xeon/contracts";
import type {
  AgentToolCall,
  AssistantMessage,
  ToolResultMessage,
} from "@xeon/contracts/conversation";
import type { ReadFailure } from "@xeon/contracts/records";
import type { ToolCallOutcome, ToolRunContext } from "@xeon/contracts/services";
import type { StepRef } from "../commits.ts";
import { forEachSequential } from "../sequence.ts";
import { noteActivations } from "./activation.ts";
import { emitEvent, emitMessageStart } from "./sink.ts";
import { toolRunContext, type TurnRun } from "./turn-run.ts";
import type { LoopFailure, ToolCallResume } from "./types.ts";

// L1.loop.spec §3.3 도구 배치. 원본의 순차·병렬 규칙을 옮기고, 한 호출의 준비·실행·마감은 `xeon.tools`의 단계 계약으로 넘긴다.
// XEON-PATCH: batch-cancel — 취소되면 남은 호출을 같은 배치 안에서 `settleRejected(…, "not_executed")`로 닫는다(원본은 break로 결과가 없다).
// XEON-PATCH: batch-length — `stopReason: "length"`면 호출을 실행하지 않고 `settleRejected(…, "truncated")`로 닫는다.
// XEON-PATCH: batch-record — 결과 기록은 core-tools가 한다. 루프는 돌려받은 `ToolCallOutcome`을 이벤트로 낸다.

export interface BatchInput {
  readonly step: StepRef;
  readonly assistant: AssistantMessage;
  /** 어시스턴트 메시지의 도구 호출 전부(원래 순서) */
  readonly calls: readonly AgentToolCall[];
  /** 도구 단계 중간에서 재개한 배치면 호출별 상태. 주 경로는 null */
  readonly resume: readonly ToolCallResume[] | null;
}

export interface BatchResult {
  /** 호출 순서대로 마감한 결과 */
  readonly outcomes: readonly ToolCallOutcome[];
  /** 모든 결과가 `terminate: true`일 때만 참이다(원본 shouldTerminateToolBatch) */
  readonly terminate: boolean;
}

/** 배치의 모든 결과가 terminate일 때만 멈춘다 */
function shouldTerminateToolBatch(outcomes: readonly ToolCallOutcome[]): boolean {
  return outcomes.length > 0 && outcomes.every((outcome) => outcome.result.terminate === true);
}

function resultMessagesOf(outcomes: readonly ToolCallOutcome[]): ToolResultMessage[] {
  return outcomes.map((outcome) => outcome.message);
}

export { resultMessagesOf };

function emitToolStart(run: TurnRun, call: AgentToolCall): void {
  emitEvent(run, {
    type: "tool_execution_start",
    toolCallId: call.id,
    toolName: call.name,
    args: call.arguments,
  });
}

function emitToolEnd(run: TurnRun, outcome: ToolCallOutcome): void {
  emitEvent(run, {
    type: "tool_execution_end",
    toolCallId: outcome.toolCall.id,
    toolName: outcome.toolCall.name,
    result: outcome.result,
    isError: outcome.isError,
    ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
  });
}

/** 결과 메시지를 이벤트로 낸다. 기록된 item id를 매퍼에 알린 뒤 시작·끝을 낸다 */
async function emitResultMessage(run: TurnRun, outcome: ToolCallOutcome): Promise<void> {
  if (outcome.itemId !== null) {
    run.mapper.bindItem({ toolCallId: outcome.toolCall.id }, outcome.itemId);
  }
  run.state.newMessages.push(outcome.message);
  await emitMessageStart(run, outcome.message);
  emitEvent(run, { type: "message_end", message: outcome.message });
}

function recordedOutcome(
  call: AgentToolCall,
  resume: Extract<ToolCallResume, { kind: "recorded" }>,
): ToolCallOutcome {
  const message = resume.message;
  return {
    toolCall: call,
    state: "executed",
    result: {
      content: [...message.content],
      details: message.details ?? null,
      isError: message.isError,
    },
    isError: message.isError,
    ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
    message,
    itemId: resume.itemId,
  };
}

/** 취소 확인: 턴 범위 노드의 신호다 */
function cancelled(run: TurnRun): boolean {
  return run.scope.signal.aborted;
}

/** 호출 하나를 이유와 함께 닫는다. `settleRejected`는 호출마다 결과를 돌려주므로 비면 불변식 위반이다 */
async function settleOne(
  run: TurnRun,
  call: AgentToolCall,
  reason: "not_executed" | "truncated",
  toolRun: ToolRunContext,
): Promise<ToolCallOutcome> {
  const [closed] = await run.ctx.tools.settleRejected([call], reason, toolRun);
  if (closed === undefined) throw new Bug(`loop.settle_rejected_returned_nothing: ${call.id}`);
  return closed;
}

/**
 * 아직 실행하지 않은 호출을 이유와 함께 닫고, 호출마다 시작·끝 이벤트를 낸다(원본 failToolCallsFromTruncatedMessage와 같은 순서).
 * `withMessages`면 호출마다 끝 이벤트 바로 뒤에 결과 메시지도 낸다
 */
async function settleEach(
  run: TurnRun,
  calls: readonly AgentToolCall[],
  reason: "not_executed" | "truncated",
  toolRun: ToolRunContext,
  withMessages: boolean,
): Promise<ToolCallOutcome[]> {
  const outcomes: ToolCallOutcome[] = [];
  await forEachSequential(calls, async (call) => {
    emitToolStart(run, call);
    const closed = await settleOne(run, call, reason, toolRun);
    emitToolEnd(run, closed);
    if (withMessages) await emitResultMessage(run, closed);
    outcomes.push(closed);
  });
  return outcomes;
}

/** 결과 메시지를 호출 순서대로 낸다 */
function emitResultMessages(run: TurnRun, outcomes: readonly ToolCallOutcome[]): Promise<void> {
  return forEachSequential(outcomes, (outcome) => emitResultMessage(run, outcome));
}

function updateSink(run: TurnRun, call: AgentToolCall) {
  return (partial: ToolCallOutcome["result"]): void => {
    emitEvent(run, {
      type: "tool_execution_update",
      toolCallId: call.id,
      toolName: call.name,
      args: call.arguments,
      partialResult: partial,
    });
  };
}

async function runSequential(
  run: TurnRun,
  assistant: AssistantMessage,
  calls: readonly AgentToolCall[],
  toolRun: ToolRunContext,
): Promise<ToolCallOutcome[]> {
  const { tools } = run.ctx;
  const outcomes: ToolCallOutcome[] = [];
  let restFrom = calls.length;
  await forEachSequential([...calls.entries()], async ([index, call]) => {
    // 취소되면 이 호출부터는 건드리지 않는다. 남은 호출은 아래에서 한꺼번에 닫는다
    if (index >= restFrom) return;
    emitToolStart(run, call);
    const preparation = await tools.prepare(call, assistant, toolRun);
    let outcome: ToolCallOutcome;
    if (preparation.kind === "settled") {
      outcome = preparation.outcome;
    } else if (cancelled(run)) {
      outcome = await settleOne(run, call, "not_executed", toolRun);
    } else {
      outcome = await tools.execute(preparation.call, updateSink(run, call), toolRun);
    }
    emitToolEnd(run, outcome);
    await emitResultMessage(run, outcome);
    outcomes.push(outcome);
    if (cancelled(run)) restFrom = index + 1;
  });
  const rest = await settleEach(run, calls.slice(restFrom), "not_executed", toolRun, true);
  return [...outcomes, ...rest];
}

async function runParallel(
  run: TurnRun,
  assistant: AssistantMessage,
  calls: readonly AgentToolCall[],
  toolRun: ToolRunContext,
): Promise<ToolCallOutcome[]> {
  const { tools } = run.ctx;
  type Entry = ToolCallOutcome | (() => Promise<ToolCallOutcome>);
  const entries: Entry[] = [];
  let restFrom = calls.length;

  // 준비는 항상 원래 순서대로 하나씩 한다. 허용된 호출만 함께 실행한다
  await forEachSequential([...calls.entries()], async ([index, call]) => {
    if (index >= restFrom) return;
    emitToolStart(run, call);
    const preparation = await tools.prepare(call, assistant, toolRun);
    if (preparation.kind === "settled") {
      emitToolEnd(run, preparation.outcome);
      entries.push(preparation.outcome);
    } else {
      entries.push(async () => {
        if (cancelled(run)) {
          const closed = await settleOne(run, call, "not_executed", toolRun);
          emitToolEnd(run, closed);
          return closed;
        }
        const outcome = await tools.execute(preparation.call, updateSink(run, call), toolRun);
        emitToolEnd(run, outcome);
        return outcome;
      });
    }
    if (cancelled(run)) restFrom = index + 1;
  });

  const finished = await Promise.all(
    entries.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
  );
  const rest = await settleEach(run, calls.slice(restFrom), "not_executed", toolRun, false);
  const outcomes = [...finished, ...rest];
  // 결과 메시지는 원래 순서로 낸다. tool_execution_end는 완료 순이었다
  await emitResultMessages(run, outcomes);
  return outcomes;
}

export async function runToolBatch(
  run: TurnRun,
  input: BatchInput,
): Promise<Result<BatchResult, LoopFailure>> {
  const { ctx } = run;
  const toolRun = toolRunContext(run, input.step);
  const resolved = new Map<string, ToolCallOutcome>();
  const pending: AgentToolCall[] = [];

  // 재개한 배치: 기록된 결과는 그대로 쓰고, 결과 불명 효과는 재실행하고, 나머지는 주 경로로 돌린다
  const resumeById = new Map((input.resume ?? []).map((entry) => [callIdOf(entry), entry]));
  const rerunFault: { current: ReadFailure | undefined } = { current: undefined };
  await forEachSequential(input.calls, async (call) => {
    if (rerunFault.current !== undefined) return;
    const resume = resumeById.get(call.id);
    if (resume === undefined || resume.kind === "run") {
      pending.push(call);
    } else if (resume.kind === "recorded") {
      const outcome = recordedOutcome(call, resume);
      run.mapper.bindItem({ toolCallId: call.id }, resume.itemId);
      run.state.newMessages.push(outcome.message);
      resolved.set(call.id, outcome);
    } else {
      const rerun = await ctx.tools.rerun(resume.intent, toolRun);
      if (!rerun.ok) {
        rerunFault.current = rerun.error;
        return;
      }
      const outcome = rerun.value;
      if (outcome.itemId !== null) run.mapper.bindItem({ toolCallId: call.id }, outcome.itemId);
      run.state.newMessages.push(outcome.message);
      resolved.set(call.id, outcome);
    }
  });
  // 재실행 전에 효과 상태를 읽지 못했다. 이 단계를 멈추고 turn을 열어 둔 채 실패로 알린다(재개 후보로 남는다)
  if (rerunFault.current !== undefined) {
    return err({ kind: "read_failed", detail: `tool rerun: ${rerunFault.current.kind}` });
  }

  let live: ToolCallOutcome[];
  if (input.assistant.stopReason === "length") {
    // 출력 한도에서 잘린 응답의 인자는 불완전할 수 있다. 실행하지 않고 모두 실패로 닫는다
    live = await settleEach(run, pending, "truncated", toolRun, true);
  } else if (pending.length === 0) {
    live = [];
  } else {
    // 호출 중 하나라도 도구 executionMode가 "sequential"이면 배치 전체를 순차로 돈다(원본 executeToolCalls)
    const sequential = pending.some(
      (call) => ctx.tools.meta(call.name)?.executionMode === "sequential",
    );
    live = sequential
      ? await runSequential(run, input.assistant, pending, toolRun)
      : await runParallel(run, input.assistant, pending, toolRun);
  }

  const liveById = new Map(live.map((outcome) => [outcome.toolCall.id, outcome]));
  const outcomes: ToolCallOutcome[] = [];
  for (const call of input.calls) {
    const outcome = resolved.get(call.id) ?? liveById.get(call.id);
    if (outcome !== undefined) outcomes.push(outcome);
  }
  noteActivations(run, outcomes);
  const unrecorded = outcomes.find((outcome) => outcome.itemId === null);
  if (unrecorded !== undefined) {
    return err({
      kind: "commit_failed",
      detail: `the result of tool call ${unrecorded.toolCall.id} was not recorded`,
    });
  }
  return ok({ outcomes, terminate: shouldTerminateToolBatch(outcomes) });
}

function callIdOf(resume: ToolCallResume): string {
  return resume.kind === "run" ? resume.toolCall.id : resume.toolCallId;
}
