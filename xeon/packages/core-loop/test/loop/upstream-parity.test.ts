import { expect, test } from "bun:test";
import { requestLoop } from "../../src/loop/run-turn.ts";
import { createHarness, recordedCallId } from "../support/harness.ts";
import { createRig } from "../support/loop-rig.ts";
import type { ScriptedResponse } from "../support/fake-models.ts";

// L1.loop.plan §5 upstream_event_order_cases. pi-agent-core 1.3.0 `packages/agent/test/agent-loop.test.ts`의 사례를 옮겨 적었다
// (원본 코드는 실행하지 않는다). 이 루프는 프롬프트 메시지 이벤트(T1이 이미 기록)와 `agent_end`(T6 뒤 tap)를 매퍼에 먹이지 않으므로
// 기대 열에서 그 둘이 빠진다. 나머지 이벤트 순서는 원본과 같다.

const text = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});
const calls = (...ids: readonly string[]): ScriptedResponse => ({
  kind: "message",
  content: ids.map((id) => ({
    type: "toolCall" as const,
    id,
    name: id.startsWith("s") ? "stop" : "go",
    arguments: {},
  })),
  stopReason: "toolUse",
});

const ASSISTANT_STREAM = [
  "message_start:assistant",
  "message_update",
  "message_update",
  "message_update",
  "message_end:assistant",
];

async function rigFor(options: Parameters<typeof createHarness>[0]) {
  const h = await createHarness({ ...options, withoutLoop: true });
  return { h, rig: createRig(h) };
}

test("a_text_only_turn_emits_start_stream_end_and_turn_end", async () => {
  const { rig } = await rigFor({ script: [text("hello")] });
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(true);
  expect(rig.trace()).toEqual(["agent_start", "turn_start", ...ASSISTANT_STREAM, "turn_end"]);
});

test("a_tool_call_turn_runs_the_tool_between_the_response_and_turn_end_then_asks_again", async () => {
  const { h, rig } = await rigFor({
    tools: [{ name: "go" }],
    script: [calls("c1"), text("done")],
  });
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(true);
  const id = recordedCallId(h, "c1");
  expect(h.tools.executed).toEqual([id]);
  expect(rig.trace()).toEqual([
    "agent_start",
    "turn_start",
    ...ASSISTANT_STREAM,
    `tool_execution_start:${id}`,
    `tool_execution_end:${id}`,
    "message_start:toolResult",
    "message_end:toolResult",
    "turn_end",
    "turn_start",
    ...ASSISTANT_STREAM,
    "turn_end",
  ]);
});

test("a_queued_steer_message_is_injected_after_the_tool_batch_before_the_next_request", async () => {
  const { h, rig } = await rigFor({
    tools: [
      {
        name: "go",
        run: async () => {
          await h.tasks.service.inputs.enqueue({
            threadId: h.threadId,
            mode: "steer",
            item: { kind: "user", content: "also this" },
            requestId: "steer-1",
            source: { type: "user", via: "interactive" },
          });
          return { text: "A" };
        },
      },
    ],
    script: [calls("c1"), text("done")],
  });
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(true);
  const trace = rig.trace();
  const secondStart = trace.lastIndexOf("turn_start");
  // turn_start가 먼저, 그다음 배치된 입력의 시작·끝, 그다음 어시스턴트 응답
  expect(trace.slice(secondStart, secondStart + 4)).toEqual([
    "turn_start",
    "message_start:user",
    "message_end:user",
    "message_start:assistant",
  ]);
  expect(h.models.requests[1]?.messages.at(-1)).toMatchObject({
    role: "user",
    content: "also this",
  });
});

test("an_error_response_ends_the_loop_after_turn_end", async () => {
  const { h, rig } = await rigFor({
    tools: [{ name: "go" }],
    script: [{ kind: "error", message: "boom" }],
  });
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(true);
  expect(h.tools.executed).toEqual([]);
  expect(rig.trace()).toEqual([
    "agent_start",
    "turn_start",
    "message_start:assistant",
    "message_end:assistant",
    "turn_end",
  ]);
});

test("the_loop_stops_after_a_batch_when_every_tool_result_terminates", async () => {
  const { h, rig } = await rigFor({
    tools: [{ name: "stop", run: () => Promise.resolve({ text: "bye", terminate: true }) }],
    script: [calls("s1", "s2")],
  });
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(true);
  expect(h.models.requests).toHaveLength(1);
  expect(rig.trace().filter((entry) => entry === "turn_start")).toHaveLength(1);
});

test("the_loop_continues_after_a_mixed_batch_when_not_every_result_terminates", async () => {
  const { h, rig } = await rigFor({
    tools: [
      { name: "stop", run: () => Promise.resolve({ text: "bye", terminate: true }) },
      { name: "go" },
    ],
    script: [calls("s1", "c2"), text("done")],
  });
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(true);
  expect(h.models.requests).toHaveLength(2);
});

test("commit_failure_returns_a_failure_value_and_never_runs_the_tools", async () => {
  const { h, rig } = await rigFor({ tools: [{ name: "go" }], script: [calls("c1")] });
  h.fake.failBusyFor((key) => key.startsWith("resp:"), 99);
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("commit_failed");
  expect(h.tools.executed).toEqual([]);
});

test("a_cancelled_turn_settles_after_the_step_instead_of_asking_again", async () => {
  const { h, rig } = await rigFor({
    tools: [{ name: "go" }],
    script: [calls("c1"), text("never asked")],
  });
  await h.tasks.service.abort(rig.turnScope, { code: "user", message: null });
  const result = await requestLoop(rig.run, []);
  expect(result.ok).toBe(true);
  expect(h.models.requests).toHaveLength(1);
  // 취소된 배치도 호출마다 결과를 남기고 단계를 끝낸다
  expect(h.tools.executed).toEqual([]);
  expect(rig.trace().at(-1)).toBe("turn_end");
});
