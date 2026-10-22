import { expect, test } from "bun:test";
import type { AgentToolCall, AssistantMessage } from "@xeon/contracts/conversation";
import { runToolBatch } from "../../src/loop/tool-batch.ts";
import { currentStep } from "../../src/loop/turn-run.ts";
import type { ToolCallResume } from "../../src/loop/types.ts";
import type { FakeToolDef } from "../support/fake-tools.ts";
import { createHarness } from "../support/harness.ts";
import { createRig, type LoopRig } from "../support/loop-rig.ts";

// L1.loop.plan §5 tool-batch 시험. 원본 executeToolCalls* 사례(parallel 완료 순, sequential 강제, length 절단, terminate)와
// 이 루프의 변경(취소 시 같은 배치 안에서 닫기, 재개 배치)을 단계 함수 수준에서 확인한다.

function call(id: string, name: string): AgentToolCall {
  return { type: "toolCall", id, name, arguments: {} };
}

function assistantOf(
  calls: readonly AgentToolCall[],
  stopReason: AssistantMessage["stopReason"] = "toolUse",
): AssistantMessage {
  return {
    role: "assistant",
    content: [...calls],
    api: "fake-api",
    provider: "fake",
    model: "fake-1",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

async function openRig(tools: readonly FakeToolDef[]) {
  const h = await createHarness({ tools, withoutLoop: true });
  const rig = createRig(h);
  // 단계 하나를 연다(매퍼가 단계 id를 가진다)
  rig.run.mapper.map({ type: "turn_start" });
  rig.events.splice(0);
  return { h, rig };
}

async function batch(
  rig: LoopRig,
  calls: readonly AgentToolCall[],
  options: {
    readonly stopReason?: AssistantMessage["stopReason"];
    readonly resume?: readonly ToolCallResume[];
  } = {},
) {
  return runToolBatch(rig.run, {
    step: currentStep(rig.run),
    assistant: assistantOf(calls, options.stopReason),
    calls,
    resume: options.resume ?? null,
  });
}

test("parallel_batch_end_events_in_completion_order_results_in_source_order", async () => {
  const slow = Promise.withResolvers<void>();
  const { rig } = await openRig([
    {
      name: "slow",
      run: async () => {
        await slow.promise;
        return { text: "slow done" };
      },
    },
    {
      name: "fast",
      run: () => {
        // 빠른 호출이 끝난 뒤 느린 호출을 풀어 준다
        queueMicrotask(() => {
          slow.resolve();
        });
        return Promise.resolve({ text: "fast done" });
      },
    },
  ]);
  const result = await batch(rig, [call("a", "slow"), call("b", "fast")]);
  expect(result.ok).toBe(true);
  expect(rig.trace()).toEqual([
    "tool_execution_start:a",
    "tool_execution_start:b",
    "tool_execution_end:b",
    "tool_execution_end:a",
    "message_start:toolResult",
    "message_end:toolResult",
    "message_start:toolResult",
    "message_end:toolResult",
  ]);
  if (!result.ok) return;
  expect(result.value.outcomes.map((outcome) => outcome.toolCall.id)).toEqual(["a", "b"]);
  const messages = rig.events.flatMap((event) =>
    event.type === "message_start" && event.message.role === "toolResult"
      ? [event.message.toolCallId]
      : [],
  );
  expect(messages).toEqual(["a", "b"]);
});

test("sequential_mode_when_any_tool_is_sequential", async () => {
  let running = 0;
  let maxRunning = 0;
  const work = async (): Promise<{ readonly text: string }> => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await Promise.resolve();
    await Promise.resolve();
    running -= 1;
    return { text: "ok" };
  };
  const { rig } = await openRig([
    { name: "one", run: work },
    { name: "two", run: work, executionMode: "sequential" },
    { name: "three", run: work },
  ]);
  const result = await batch(rig, [call("a", "one"), call("b", "two"), call("c", "three")]);
  expect(result.ok).toBe(true);
  expect(maxRunning).toBe(1);
  // 순차 모드는 호출 하나가 결과 메시지까지 끝낸 뒤 다음 호출을 연다
  expect(rig.trace().slice(0, 4)).toEqual([
    "tool_execution_start:a",
    "tool_execution_end:a",
    "message_start:toolResult",
    "message_end:toolResult",
  ]);
});

test("parallel_mode_runs_calls_together_when_no_tool_is_sequential", async () => {
  let running = 0;
  let maxRunning = 0;
  const gate = Promise.withResolvers<void>();
  const work = async (): Promise<{ readonly text: string }> => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await gate.promise;
    running -= 1;
    return { text: "ok" };
  };
  const { rig } = await openRig([
    { name: "one", run: work },
    { name: "two", run: work },
  ]);
  const running$ = batch(rig, [call("a", "one"), call("b", "two")]);
  await Bun.sleep(5);
  gate.resolve();
  await running$;
  expect(maxRunning).toBe(2);
});

test("length_stop_settles_all_calls_as_truncated", async () => {
  const { h, rig } = await openRig([{ name: "read" }]);
  const result = await batch(rig, [call("a", "read"), call("b", "read")], {
    stopReason: "length",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(h.tools.executed).toEqual([]);
  expect(h.tools.closed).toEqual(["a", "b"]);
  expect(result.value.outcomes.map((outcome) => outcome.state)).toEqual(["truncated", "truncated"]);
  expect(result.value.outcomes.every((outcome) => outcome.itemId !== null)).toBe(true);
  // 원본과 같은 순서: 호출마다 시작, 끝, 결과 메시지
  expect(rig.trace()).toEqual([
    "tool_execution_start:a",
    "tool_execution_end:a",
    "message_start:toolResult",
    "message_end:toolResult",
    "tool_execution_start:b",
    "tool_execution_end:b",
    "message_start:toolResult",
    "message_end:toolResult",
  ]);
  expect(result.value.terminate).toBe(false);
});

test("abort_before_the_batch_settles_every_call_as_not_executed_in_the_same_batch", async () => {
  const { h, rig } = await openRig([{ name: "read" }, { name: "write" }]);
  await h.tasks.service.abort(rig.turnScope, { code: "user", message: null });
  const result = await batch(rig, [call("a", "read"), call("b", "write"), call("c", "read")]);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // 첫 호출은 준비를 마쳤으므로 의도가 있고, 실행 직전 확인에서 닫힌다. 나머지는 준비 없이 닫힌다
  expect(h.tools.executed).toEqual([]);
  expect(result.value.outcomes.map((outcome) => outcome.state)).toEqual([
    "not_executed",
    "not_executed",
    "not_executed",
  ]);
  // 결과 없는 toolCall이 남지 않는다
  expect(result.value.outcomes.every((outcome) => outcome.itemId !== null)).toBe(true);
});

test("abort_mid_batch_settles_rest_as_not_executed", async () => {
  const state: { abort: (() => Promise<unknown>) | null } = { abort: null };
  const { h, rig } = await openRig([
    {
      name: "read",
      executionMode: "sequential",
      run: async () => {
        // 첫 호출이 끝나기 전에 turn을 취소한다
        await state.abort?.();
        return { text: "A" };
      },
    },
    { name: "write", executionMode: "sequential" },
  ]);
  state.abort = () => h.tasks.service.abort(rig.turnScope, { code: "user", message: null });
  const result = await batch(rig, [call("a", "read"), call("b", "write"), call("c", "write")]);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // 첫 호출은 실행됐고 남은 호출은 같은 배치 안에서 실행하지 않고 not_executed로 닫힌다
  expect(h.tools.executed).toEqual(["a"]);
  expect(h.tools.closed).toEqual(["b", "c"]);
  expect(result.value.outcomes.map((outcome) => outcome.state)).toEqual([
    "executed",
    "not_executed",
    "not_executed",
  ]);
  // 단계 끝(C5) 전에 결과 없는 toolCall이 0개다
  expect(result.value.outcomes.every((outcome) => outcome.itemId !== null)).toBe(true);
});

test("terminate_only_when_every_result_terminates", async () => {
  const { rig } = await openRig([
    { name: "stop", run: () => Promise.resolve({ text: "bye", terminate: true }) },
    { name: "go" },
  ]);
  const mixed = await batch(rig, [call("a", "stop"), call("b", "go")]);
  expect(mixed.ok && mixed.value.terminate).toBe(false);

  const { rig: allRig } = await openRig([
    { name: "stop", run: () => Promise.resolve({ text: "bye", terminate: true }) },
  ]);
  const all = await batch(allRig, [call("a", "stop"), call("b", "stop")]);
  expect(all.ok && all.value.terminate).toBe(true);
});

test("a_blocked_call_settles_in_prepare_and_the_rest_still_run", async () => {
  const { h, rig } = await openRig([{ name: "read", blockReason: "denied" }, { name: "ls" }]);
  const result = await batch(rig, [call("a", "read"), call("b", "ls")]);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(h.tools.executed).toEqual(["b"]);
  expect(result.value.outcomes.map((outcome) => outcome.state)).toEqual(["rejected", "executed"]);
});

test("resume_batch_mixes_recorded_rerun_and_run_in_source_order", async () => {
  const { h, rig } = await openRig([
    { name: "read", replay: "safe" },
    { name: "ls" },
    { name: "write" },
  ]);
  const recordedMessage = {
    role: "toolResult" as const,
    toolCallId: "a",
    toolName: "read",
    content: [{ type: "text" as const, text: "from before the cut" }],
    isError: false,
    timestamp: 1,
  };
  const resume: ToolCallResume[] = [
    {
      kind: "recorded",
      toolCallId: "a",
      itemId: rig.ctx.ids.next("itm"),
      message: recordedMessage,
    },
    {
      kind: "rerun",
      toolCallId: "b",
      intent: {
        effectId: rig.ctx.ids.next("efx"),
        toolCallId: "b",
        toolName: "ls",
        itemId: rig.ctx.ids.next("itm"),
        argsHash: "0".repeat(64),
        args: {},
        replay: "safe",
        idempotencyKey: null,
      },
    },
    { kind: "run", toolCall: call("c", "write") },
  ];
  const result = await batch(rig, [call("a", "read"), call("b", "ls"), call("c", "write")], {
    resume,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.outcomes.map((outcome) => outcome.toolCall.id)).toEqual(["a", "b", "c"]);
  // 기록된 결과는 다시 실행하지 않고, 결과 불명 효과는 재실행하고, 나머지는 새로 실행한다
  expect(h.tools.executed).toEqual(["c"]);
  expect(h.tools.reran).toEqual(["b"]);
  // 기록된 호출과 재실행 호출은 이벤트를 다시 내지 않는다
  expect(rig.trace().filter((entry) => entry.startsWith("tool_execution_start"))).toEqual([
    "tool_execution_start:c",
  ]);
});
