import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { JsonValueSchema, type JsonValue } from "@fresnel/contracts/conversation";
import {
  candidateResultOf,
  classifyCall,
  verdictOfOutcome,
  type CandidateVerdict,
} from "../../../src/assembly/backtest/classify.ts";
import type { Verdict } from "@fresnel/contracts/wire";
import type { CandidateOutcome, ReplayPoint } from "@fresnel/ext-host";

// 분류(§4.8 규칙 49)의 표 시험. 후보의 결과와 실제 판정의 짝마다 기대 값을 값으로 비교한다.

const decided = (
  decision: "none" | "block" | "ask" | "replace" | "modify",
  reason: string | null = "why",
): CandidateVerdict => ({
  kind: "decided",
  decision,
  reason,
  ms: 3,
});
const fault = (
  fault: "threw" | "timeout" | "replay_denied" | "process_failed",
): CandidateVerdict => ({
  kind: "fault",
  fault,
  message: "boom",
  ms: 9,
});

function classOf(
  point: ReplayPoint,
  verdict: Verdict,
  candidate: CandidateVerdict,
  options: {
    readonly blockedHook?: string | null;
    readonly approval?: "allow" | "deny" | "answer" | null;
  } = {},
) {
  return classifyCall({
    point,
    verdict,
    blockedHook: options.blockedHook ?? null,
    approval: options.approval ?? null,
    candidate,
  });
}

test("every class is reached by its rule of §4.8 rule 49", () => {
  // 후보가 막았거나 물었다. 실제로는 실행됐다 → newly_caught
  expect(classOf("tool.call.before", "allowed", decided("block"))).toEqual({
    class: "newly_caught",
    skippedBy: null,
  });
  expect(classOf("tool.call.before", "allowed", decided("ask"))).toEqual({
    class: "newly_caught",
    skippedBy: null,
  });
  // 교체도 막음처럼 센다
  expect(classOf("tool.call.before", "allowed", decided("replace"))).toEqual({
    class: "newly_caught",
    skippedBy: null,
  });
  // 사람이 허용했던 호출을 막았다 → 과한 차단
  expect(classOf("tool.call.before", "allowed", decided("block"), { approval: "allow" })).toEqual({
    class: "would_block_allowed_by_human",
    skippedBy: null,
  });
  expect(classOf("tool.call.before", "allowed", decided("ask"), { approval: "allow" })).toEqual({
    class: "would_block_allowed_by_human",
    skippedBy: null,
  });
  // 후보와 실제 훅이 둘 다 막았다 → agrees_block
  expect(
    classOf("tool.call.before", "blocked_hook", decided("block"), {
      blockedHook: "tool.call.before",
    }),
  ).toEqual({
    class: "agrees_block",
    skippedBy: null,
  });
  // 정책이나 사람이 이미 막았다 → already_stopped
  expect(classOf("tool.call.before", "denied_policy", decided("block"))).toEqual({
    class: "already_stopped",
    skippedBy: null,
  });
  expect(
    classOf("tool.call.before", "denied_human", decided("block"), { approval: "deny" }),
  ).toEqual({
    class: "already_stopped",
    skippedBy: null,
  });
  // 후보가 통과시켰다 → passes_same, 막힌 호출이어도 같다
  expect(classOf("tool.call.before", "allowed", decided("none"))).toEqual({
    class: "passes_same",
    skippedBy: null,
  });
  expect(classOf("tool.result", "allowed", decided("modify"))).toEqual({
    class: "passes_same",
    skippedBy: null,
  });
  expect(classOf("tool.call.before", "blocked_hook", decided("none"))).toEqual({
    class: "passes_same",
    skippedBy: null,
  });
  // 후보가 던졌거나 시간을 넘겼다 → candidate_fault
  expect(classOf("tool.call.before", "allowed", fault("threw"))).toEqual({
    class: "candidate_fault",
    skippedBy: null,
  });
  expect(classOf("tool.call.before", "allowed", fault("timeout"))).toEqual({
    class: "candidate_fault",
    skippedBy: null,
  });
  expect(classOf("tool.call.before", "allowed", fault("replay_denied"))).toEqual({
    class: "candidate_fault",
    skippedBy: null,
  });
  expect(classOf("tool.call.before", "allowed", fault("process_failed"))).toEqual({
    class: "candidate_fault",
    skippedBy: null,
  });
});

test("a guard candidate that the earlier tool.call.before hook stopped is already_stopped with that hook as skippedBy", () => {
  expect(
    classOf("guard.tool.before", "blocked_hook", decided("block"), {
      blockedHook: "tool.call.before",
    }),
  ).toEqual({ class: "already_stopped", skippedBy: "tool.call.before" });
  // 통과시키는 후보도 닿지 못했으면 already_stopped다
  expect(
    classOf("guard.tool.before", "blocked_hook", decided("none"), {
      blockedHook: "tool.call.before",
    }),
  ).toEqual({ class: "already_stopped", skippedBy: "tool.call.before" });
  // 정책에서 멈춘 호출은 훅 이름이 없다
  expect(classOf("guard.tool.before", "denied_policy", decided("block"))).toEqual({
    class: "already_stopped",
    skippedBy: null,
  });
  // 닿지 못한 가드의 고장도 already_stopped다(규칙 49의 순서: 닿음 확인이 먼저다)
  expect(classOf("guard.tool.before", "denied_policy", fault("threw"))).toEqual({
    class: "already_stopped",
    skippedBy: null,
  });
});

test("a guard candidate that did reach the call classifies like any other stop", () => {
  expect(classOf("guard.tool.before", "allowed", decided("block"))).toEqual({
    class: "newly_caught",
    skippedBy: null,
  });
  expect(
    classOf("guard.tool.before", "blocked_guard", decided("block"), {
      blockedHook: "guard.tool.before",
    }),
  ).toEqual({
    class: "agrees_block",
    skippedBy: null,
  });
  expect(classOf("guard.tool.before", "blocked_guard_fault", decided("none"))).toEqual({
    class: "passes_same",
    skippedBy: null,
  });
});

test("a tool.call.before candidate sees a later guard or policy stop as the real one it agrees with", () => {
  expect(
    classOf("tool.call.before", "blocked_guard", decided("block"), {
      blockedHook: "guard.tool.before",
    }),
  ).toEqual({
    class: "agrees_block",
    skippedBy: null,
  });
  expect(classOf("tool.call.before", "denied_noninteractive", decided("ask"))).toEqual({
    class: "already_stopped",
    skippedBy: null,
  });
});

test("the candidate's outcome maps to a verdict and the item's candidate.result", () => {
  const point: ReplayPoint = "tool.call.before";
  expect(verdictOfOutcome(point, ret(null))).toEqual({
    kind: "decided",
    decision: "none",
    reason: null,
    ms: 4,
  });
  expect(verdictOfOutcome(point, ret({ block: true, reason: "no" }))).toEqual({
    kind: "decided",
    decision: "block",
    reason: "no",
    ms: 4,
  });
  expect(verdictOfOutcome(point, ret({ ask: true, reason: "ok?" }))).toEqual({
    kind: "decided",
    decision: "ask",
    reason: "ok?",
    ms: 4,
  });
  expect(verdictOfOutcome(point, ret({ replace: { content: [] }, reason: "cached" }))).toEqual({
    kind: "decided",
    decision: "replace",
    reason: "cached",
    ms: 4,
  });
  expect(verdictOfOutcome("tool.result", ret({ content: [] }))).toEqual({
    kind: "decided",
    decision: "modify",
    reason: null,
    ms: 4,
  });
  // 결정 모양이 아닌 값은 후보의 실패다
  expect(verdictOfOutcome(point, ret({ nothing: true })).kind).toBe("fault");
  expect(verdictOfOutcome(point, { kind: "timeout", ms: 5 })).toEqual({
    kind: "fault",
    fault: "timeout",
    message: "the candidate hook timed out",
    ms: 5,
  });
  expect(verdictOfOutcome(point, { kind: "replay_denied", ms: 2 }).kind).toBe("fault");
  expect(candidateResultOf(decided("none"))).toEqual({ result: "pass", reason: null, ms: 3 });
  expect(candidateResultOf(decided("modify"))).toEqual({ result: "modify", reason: null, ms: 3 });
  expect(candidateResultOf(decided("block", "why"))).toEqual({
    result: "block",
    reason: "why",
    ms: 3,
  });
  expect(candidateResultOf(decided("ask"))).toEqual({ result: "ask", reason: "why", ms: 3 });
  expect(candidateResultOf(decided("replace"))).toEqual({
    result: "replace",
    reason: "why",
    ms: 3,
  });
  expect(candidateResultOf(fault("threw"))).toEqual({ result: "failed", reason: "boom", ms: 9 });
  expect(candidateResultOf(fault("timeout"))).toEqual({ result: "timeout", reason: "boom", ms: 9 });
});

/** 시험 값을 JSON 값으로 검사해 받는다(단언 없이) */
function jsonOf(value: unknown): JsonValue {
  const checked = parse(JsonValueSchema, value);
  if (!checked.ok) throw new Error("the fixture must be JSON");
  return checked.value;
}

/** 값이 있는 `returned` 결과 하나(시간은 4 ms) */
const ret = (value: unknown, ms = 4): CandidateOutcome => ({
  kind: "returned",
  value: jsonOf(value),
  ms,
});
