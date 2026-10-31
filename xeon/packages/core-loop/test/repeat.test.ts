import { expect, test } from "bun:test";
import type {
  AgentToolCall,
  AgentToolResult,
  ToolResultMessage,
  TurnNotice,
} from "@xeon/contracts/conversation";
import type { ToolCallOutcome } from "@xeon/contracts/services";
import { createRepeatDetector, type RepeatSettings } from "../src/repeat.ts";

// L1.loop.spec §4.10 반복 감지 값 시험. 도구 호출과 결과는 합성 ToolCallOutcome 값이다.

const DEFAULTS: RepeatSettings = { enabled: true, actionObservation: 4, actionError: 3 };

/** 호출 하나와 그 결과 하나로 된 ToolCallOutcome. 실패면 거부된 호출처럼 `rejected`로 닫힌다 */
function outcome(
  name: string,
  args: Record<string, string>,
  text: string,
  isError: boolean = false,
  id: string = "c1",
): ToolCallOutcome {
  const toolCall: AgentToolCall = { type: "toolCall", id, name, arguments: args };
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError,
    timestamp: 0,
  };
  const result: AgentToolResult = { content: [{ type: "text", text }], details: {}, isError };
  return {
    toolCall,
    state: isError ? "rejected" : "executed",
    result,
    isError,
    message,
    itemId: null,
  };
}

const READ_A = { path: "a.txt" };
const READ_B = { path: "b.txt" };

/** 같은 단계를 차례로 넘기고 단계마다 나온 알림(없으면 null)을 모은다 */
function observeAll(
  settings: RepeatSettings,
  steps: readonly (readonly ToolCallOutcome[])[],
): (TurnNotice | null)[] {
  const detector = createRepeatDetector(settings);
  return steps.map((step) => detector.observe(step));
}

const observationNotice = (count: number): TurnNotice => ({
  code: "repeat_detected",
  detail: { kind: "action_observation", count },
});
const errorNotice = (count: number): TurnNotice => ({
  code: "repeat_detected",
  detail: { kind: "action_error", count },
});

test("the same action and observation four times notify once, on the fourth step", () => {
  const steps = Array.from({ length: 4 }, () => [outcome("read", READ_A, "ok")]);
  expect(observeAll(DEFAULTS, steps)).toEqual([null, null, null, observationNotice(4)]);
});

test("the same failing action three times notifies action_error on the third step", () => {
  const steps = Array.from({ length: 3 }, () => [outcome("read", READ_A, "no such file", true)]);
  expect(observeAll(DEFAULTS, steps)).toEqual([null, null, errorNotice(3)]);
});

test("a streak notifies once: the fifth and later repeats stay silent", () => {
  const observed = Array.from({ length: 8 }, () => [outcome("read", READ_A, "ok")]);
  expect(observeAll(DEFAULTS, observed)).toEqual([
    null,
    null,
    null,
    observationNotice(4),
    null,
    null,
    null,
    null,
  ]);
  const failed = Array.from({ length: 6 }, () => [outcome("read", READ_A, "no", true)]);
  expect(observeAll(DEFAULTS, failed)).toEqual([null, null, errorNotice(3), null, null, null]);
});

test("different arguments start a new streak", () => {
  const steps = [
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_B, "ok")],
    [outcome("read", READ_B, "ok")],
    [outcome("read", READ_B, "ok")],
    [outcome("read", READ_B, "ok")],
  ];
  expect(observeAll(DEFAULTS, steps)).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
    observationNotice(4),
  ]);
});

test("a different result starts a new streak, and so does a changed error flag", () => {
  const changedText = [
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "other")],
    [outcome("read", READ_A, "other")],
    [outcome("read", READ_A, "other")],
    [outcome("read", READ_A, "other")],
  ];
  expect(observeAll(DEFAULTS, changedText)).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
    observationNotice(4),
  ]);
  // 같은 글자라도 오류 표시가 다르면 다른 관찰이다
  const changedFlag = [
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok", true)],
  ];
  expect(observeAll(DEFAULTS, changedFlag)).toEqual([null, null, null, null]);
});

test("a step with no tool calls ends the streak", () => {
  const steps = [
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
  ];
  // 빈 단계가 연속을 끊지 않았다면 인덱스 4에서 이미 4회가 된다. 끊었으므로 인덱스 7에서 새로 4회가 된다
  expect(observeAll(DEFAULTS, steps)).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    observationNotice(4),
  ]);
});

test("argument key order does not change the action", () => {
  const ordered = outcome("grep", { pattern: "needle", path: "src" }, "hit");
  const reversed = outcome("grep", { path: "src", pattern: "needle" }, "hit");
  expect(observeAll(DEFAULTS, [[ordered], [reversed], [ordered], [reversed]])).toEqual([
    null,
    null,
    null,
    observationNotice(4),
  ]);
});

test("enabled false never notifies", () => {
  const off: RepeatSettings = { ...DEFAULTS, enabled: false };
  const okSteps = Array.from({ length: 10 }, () => [outcome("read", READ_A, "ok")]);
  const failSteps = Array.from({ length: 10 }, () => [outcome("read", READ_A, "no", true)]);
  expect(observeAll(off, okSteps).every((notice) => notice === null)).toBe(true);
  expect(observeAll(off, failSteps).every((notice) => notice === null)).toBe(true);
});

test("custom thresholds of two notify on the second repeat of each kind", () => {
  const two: RepeatSettings = { enabled: true, actionObservation: 2, actionError: 2 };
  const steps = [
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "ok")],
    [outcome("read", READ_A, "no", true)],
    [outcome("read", READ_A, "no", true)],
    [outcome("read", READ_A, "no", true)],
  ];
  expect(observeAll(two, steps)).toEqual([
    null,
    observationNotice(2),
    null,
    null,
    errorNotice(2),
    null,
  ]);
});

test("two calls in one step form one pair", () => {
  const step = [
    outcome("read", READ_A, "A-out", false, "c1"),
    outcome("read", READ_B, "B-out", false, "c2"),
  ];
  expect(observeAll(DEFAULTS, [step, step, step, step])).toEqual([
    null,
    null,
    null,
    observationNotice(4),
  ]);
});

test("the whole step is the pair: a shorter or reordered step breaks the streak", () => {
  const x = outcome("read", READ_A, "X-out", false, "c1");
  const y = outcome("read", READ_B, "Y-out", false, "c2");
  // 같은 두 호출이라도 순서가 바뀌면 다른 쌍이다
  expect(
    observeAll(DEFAULTS, [
      [x, y],
      [y, x],
      [x, y],
      [y, x],
    ]),
  ).toEqual([null, null, null, null]);
  // 한 호출만 남은 단계는 두 호출 쌍과 다르다
  expect(observeAll(DEFAULTS, [[x, y], [x, y], [x, y], [x]])).toEqual([null, null, null, null]);
});

test("action_error needs every call in the step to fail; a mixed step is an observation pair", () => {
  const okCall = outcome("read", READ_A, "ok", false, "c1");
  const failCall = outcome("read", READ_B, "no", true, "c2");
  const mixed = [okCall, failCall];
  expect(observeAll(DEFAULTS, [mixed, mixed, mixed])).toEqual([null, null, null]);
  expect(observeAll(DEFAULTS, [mixed, mixed, mixed, mixed])).toEqual([
    null,
    null,
    null,
    { code: "repeat_detected", detail: { kind: "action_observation", count: 4 } },
  ]);
  const allFailing = [failCall, outcome("read", READ_A, "no", true, "c3")];
  expect(observeAll(DEFAULTS, [allFailing, allFailing, allFailing])).toEqual([
    null,
    null,
    errorNotice(3),
  ]);
});
