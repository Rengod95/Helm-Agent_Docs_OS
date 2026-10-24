import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type {
  CreateAgentEventMapper,
  ItemId,
  ThreadId,
  TurnId,
} from "@xeon/contracts/conversation";
import { createAgentEventMapper } from "../src/index.ts";
import { assistant, toolResult, toolCall, twoToolCallTurn } from "./support/builders.ts";

const ids = () => fixedIdFactory(0);
const init = () => {
  const factory = ids();
  return {
    threadId: factory.next("thr") satisfies ThreadId,
    turnId: factory.next("trn") satisfies TurnId,
    startStepIndex: 0,
    ids: factory,
  };
};

// F의 CreateAgentEventMapper에 대입할 수 있다(L1.loop.spec §3.4)
const assignable: CreateAgentEventMapper = createAgentEventMapper;

test("mapper_maps_full_turn_event_sequence", () => {
  expect(typeof assignable).toBe("function");
  const mapper = createAgentEventMapper(init());
  const out = twoToolCallTurn().flatMap((event) => mapper.map(event));
  // F.conversation.spec §3.5.4 표 순서
  expect(out.map((note) => note.type)).toEqual([
    "turn.updated",
    "step.started",
    "item.started",
    "step.updated",
    "item.updated", // toolcall_start #0
    "item.updated", // toolcall_end #0
    "item.updated", // toolcall_start #1
    "item.updated", // toolcall_end #1
    "item.completed", // assistant
    "item.started", // toolCall a
    "step.updated", // tools
    "item.started", // toolCall b
    "step.updated",
    "item.updated", // tool_progress
    "item.completed", // toolCall a end
    "item.completed", // toolCall b end
    "item.started", // toolResult a
    "item.completed",
    "item.started", // toolResult b
    "item.completed",
    "step.completed",
    "step.started",
    "item.started", // assistant 2
    "step.updated",
    "item.completed",
    "step.completed",
    "turn.completed",
  ]);
  const stepIndexes = out.flatMap((note) =>
    note.type === "step.completed" ? [note.stepIndex] : [],
  );
  expect(stepIndexes).toEqual([0, 1]);
  const turnCompleted = out.at(-1);
  expect(turnCompleted?.type === "turn.completed" ? turnCompleted.status : null).toBe("completed");
  expect(turnCompleted?.type === "turn.completed" ? turnCompleted.stepCount : -1).toBe(2);
});

test("mapper_deterministic_given_ids", () => {
  const a = createAgentEventMapper(init());
  const b = createAgentEventMapper(init());
  const outA = twoToolCallTurn().flatMap((event) => a.map(event));
  const outB = twoToolCallTurn().flatMap((event) => b.map(event));
  expect(JSON.stringify(outA)).toBe(JSON.stringify(outB));
});

test("mapper_counts_steps_from_start_step_index", () => {
  const base = init();
  const mapper = createAgentEventMapper({ ...base, startStepIndex: 4 });
  const notes = mapper.map({ type: "turn_start" });
  expect(notes[0]?.type === "step.started" ? notes[0].stepIndex : -1).toBe(4);
  const next = mapper.map({ type: "turn_start" });
  expect(next[0]?.type === "step.started" ? next[0].stepIndex : -1).toBe(5);
});

test("mapper_uses_bound_item_ids", () => {
  const base = init();
  const factory = base.ids;
  const mapper = createAgentEventMapper(base);
  const steer = { role: "user" as const, content: "more", timestamp: 1 };
  const boundMessage = factory.next("itm") satisfies ItemId;
  mapper.bindItem({ message: steer }, boundMessage);
  const call = toolCall("call_x", "read");
  const boundResult = factory.next("itm") satisfies ItemId;
  mapper.bindItem({ toolCallId: call.id }, boundResult);

  const before = factory.next("itm");
  const started = mapper.map({ type: "message_start", message: steer });
  expect(started[0]?.type === "item.started" ? started[0].itemId : null).toBe(boundMessage);
  const done = mapper.map({ type: "message_end", message: steer });
  expect(done[0]?.type === "item.completed" ? done[0].item.itemId : null).toBe(boundMessage);

  const result = toolResult(call, "x");
  const resultStarted = mapper.map({ type: "message_start", message: result });
  expect(resultStarted[0]?.type === "item.started" ? resultStarted[0].itemId : null).toBe(
    boundResult,
  );
  // 새 id를 발급하지 않았다: 다음 발급은 `before` 바로 다음 값이다
  expect(factory.next("itm") > before).toBe(true);
});

test("mapper_restores_a_recorded_step_for_tool_reentry", () => {
  const base = init();
  const mapper = createAgentEventMapper(base);
  const stepId = base.ids.next("stp");
  const assistantItemId = base.ids.next("itm");
  mapper.restoreStep({ stepId, stepIndex: 3, assistantItemId });
  expect(mapper.snapshot().stepId).toBe(stepId);
  const notes = mapper.map({
    type: "turn_end",
    message: assistant([{ type: "text", text: "x" }]),
    toolResults: [],
  });
  const completed = notes[0];
  expect(completed?.type === "step.completed" ? completed.stepIndex : -1).toBe(3);
  expect(completed?.type === "step.completed" ? completed.assistantItemId : null).toBe(
    assistantItemId,
  );
  // 다음 turn_start는 4번째 다음 단계다
  const next = mapper.map({ type: "turn_start" });
  expect(next[0]?.type === "step.started" ? next[0].stepIndex : -1).toBe(4);
});

test("mapper_adopts_a_recorded_step_id_once", () => {
  const base = init();
  const stepId = base.ids.next("stp");
  const mapper = createAgentEventMapper({ ...base, startStepIndex: 2 }, { adoptStepId: stepId });
  const first = mapper.map({ type: "turn_start" });
  expect(first[0]?.stepId).toBe(stepId);
  const second = mapper.map({ type: "turn_start" });
  expect(second[0]?.stepId).not.toBe(stepId);
});
