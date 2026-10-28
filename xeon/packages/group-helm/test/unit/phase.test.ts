import { expect, test } from "bun:test";
import type { SpawnOutcome, TurnOutcome } from "@xeon/contracts/extensions";
import { assertNever } from "@xeon/contracts";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { TRANSITIONS, transition, type HelmEvent } from "../../src/phase.ts";
import { reactionOf, type HelmReaction } from "../../src/reaction.ts";
import type { HelmFailure } from "../../src/failures.ts";
import { INITIAL_HELM_STATE, type HelmPhase, type HelmState } from "../../src/state.ts";

const ids = fixedIdFactory(0);
const TURN = ids.next("trn");
const THREAD = ids.next("thr");
const ID = "habcdefghijklm";
const PENDING = { inquiryId: ID, topic: "캐시 무효화", source: "command" as const };
const LENSES = [
  { id: "analogy", title: "다른 분야의 유사 문제", status: "pending" as const },
  { id: "prior-art", title: "선행 사례와 문헌", status: "pending" as const },
];

function at(phase: HelmPhase): HelmState {
  if (phase === "idle") return { ...INITIAL_HELM_STATE, pending: PENDING };
  return {
    ...INITIAL_HELM_STATE,
    phase,
    inquiryId: ID,
    topic: "캐시 무효화",
    round: 1,
    lenses: LENSES.map((lens) => ({
      ...lens,
      status: phase === "diverge" ? lens.status : "running",
    })),
    findings: [{ id: "analogy-1", lensId: "analogy", claim: "c", sources: [], confidence: "low" }],
  };
}

const COMPLETED: TurnOutcome = { turnId: TURN, status: "completed" };
const FAILURE: HelmFailure = { kind: "state_too_large" };
const LENS_OK: SpawnOutcome = {
  childThreadId: THREAD,
  status: "completed",
  answer: '{"findings":[]}',
};

/** 이벤트 종류마다 표의 정상 경로를 만드는 이벤트 */
function eventOf(type: HelmEvent["type"]): HelmEvent {
  switch (type) {
    case "requested":
      return { type, pending: PENDING };
    case "leaseGranted":
      return { type, lenses: LENSES };
    case "diverged":
    case "applied":
      return { type, outcome: COMPLETED };
    case "lensesStarted":
    case "stopRequested":
      return { type };
    case "explored":
      return { type, results: [{ lensId: "analogy", outcome: { ok: true, value: LENS_OK } }] };
    case "converged":
      return { type, findings: at("converge").findings, context: [] };
    case "limitReached":
      return { type, limit: "turns" };
    case "failed":
      return { type, failure: FAILURE };
    default:
      return assertNever(type, "eventOf");
  }
}

const PHASES: readonly HelmPhase[] = ["idle", "diverge", "explore", "converge", "apply"];
const EVENT_TYPES: readonly HelmEvent["type"][] = [
  "requested",
  "leaseGranted",
  "diverged",
  "lensesStarted",
  "explored",
  "converged",
  "applied",
  "stopRequested",
  "limitReached",
  "failed",
];

test("transitions.table-covers-all-phase-pairs", () => {
  for (const from of PHASES) {
    for (const on of EVENT_TYPES) {
      const state = at(from);
      const row = TRANSITIONS.find((entry) => entry.from === from && entry.on === on);
      const result = transition(state, eventOf(on));
      if (row === undefined) {
        expect({ from, on, state: result.state, finished: result.finished }).toEqual({
          from,
          on,
          state,
          finished: undefined,
        });
      } else {
        expect({ from, on, to: result.state.phase }).toEqual({ from, on, to: row.to });
      }
    }
  }
  // 표의 같은 (from, on) 쌍은 한 번만 나온다
  const keys = TRANSITIONS.map((entry) => `${entry.from}/${entry.on}`);
  expect(new Set(keys).size).toBe(keys.length);
});

test("transitions.finish-resets-inquiry", () => {
  const result = transition(at("apply"), { type: "applied", outcome: COMPLETED });
  expect(result.state).toEqual({ ...INITIAL_HELM_STATE, appliedTurnId: TURN });
  expect(result.finished).toEqual({
    inquiryId: ID,
    outcome: "applied",
    topic: "캐시 무효화",
    rounds: 1,
    lensCount: 2,
    failedLenses: 0,
    findingCount: 1,
    appliedTurnId: TURN,
  });
  const stopped = transition(at("explore"), { type: "stopRequested" });
  expect(stopped.finished?.outcome).toBe("stopped");
  expect(stopped.state.appliedTurnId).toBeNull();
  const limited = transition(at("diverge"), { type: "limitReached", limit: "spawns" });
  expect(limited.finished).toMatchObject({ outcome: "limit", limit: "spawns" });
});

test("a lease grant moves pending into the inquiry and starts round 1", () => {
  const result = transition(at("idle"), { type: "leaseGranted", lenses: LENSES });
  expect(result.state).toEqual({
    ...INITIAL_HELM_STATE,
    phase: "diverge",
    inquiryId: ID,
    topic: "캐시 무효화",
    round: 1,
    lenses: LENSES,
    pending: null,
  });
  const none = transition(INITIAL_HELM_STATE, { type: "leaseGranted", lenses: LENSES });
  expect(none.state).toBe(INITIAL_HELM_STATE);
  const cleared = transition(at("idle"), { type: "stopRequested" });
  expect(cleared.state.pending).toBeNull();
  expect(cleared.finished).toBeUndefined();
});

test("a failed turn ends the inquiry as stopped or failed", () => {
  const aborted = transition(at("diverge"), {
    type: "diverged",
    outcome: { turnId: TURN, status: "aborted" },
  });
  expect(aborted.finished?.outcome).toBe("stopped");
  const errored = transition(at("apply"), {
    type: "applied",
    outcome: { turnId: TURN, status: "error" },
  });
  expect(errored.finished).toMatchObject({ outcome: "failed", reason: "apply turn error" });
});

test("explored keeps partial results and fails only when no lens is done", () => {
  const state = at("explore");
  const report =
    '```json\n{"findings":[{"claim":"x","sources":[],"confidence":"high","followUp":"do x"}]}\n```';
  const partial = transition(state, {
    type: "explored",
    results: [
      {
        lensId: "analogy",
        outcome: {
          ok: true,
          value: { childThreadId: THREAD, status: "completed", answer: report },
        },
      },
      {
        lensId: "prior-art",
        outcome: { ok: false, error: { kind: "spawn", lensId: "prior-art", status: "error" } },
      },
    ],
  });
  expect(partial.state.phase).toBe("converge");
  expect(partial.state.lenses.map((lens) => lens.status)).toEqual(["done", "failed"]);
  expect(partial.state.findings.map((found) => found.id)).toEqual(["analogy-1", "analogy-1"]);
  const allFailed = transition(state, {
    type: "explored",
    results: [
      {
        lensId: "analogy",
        outcome: { ok: true, value: { childThreadId: THREAD, status: "error" } },
      },
    ],
  });
  expect(allFailed.finished).toMatchObject({ outcome: "failed", failedLenses: 1, lensCount: 2 });
  expect(allFailed.state.phase).toBe("idle");
});

test("converged with no findings finishes as empty", () => {
  const result = transition(at("converge"), { type: "converged", findings: [], context: [] });
  expect(result.finished?.outcome).toBe("empty");
});

test("failures.reaction-covers-all-kinds", () => {
  const failures: readonly HelmFailure[] = [
    { kind: "lease_lost" },
    { kind: "budget", limit: "spawns" },
    { kind: "state_conflict" },
    { kind: "state_too_large" },
    { kind: "storage" },
    { kind: "disabled" },
    { kind: "capability", capability: "web.search", code: "unavailable" },
    { kind: "turn", phase: "apply", status: "aborted" },
    { kind: "turn", phase: "diverge", status: "error" },
    { kind: "spawn", lensId: "analogy", status: "error" },
    { kind: "state_inconsistent", detail: "inquiryId is null" },
  ];
  const expected: HelmReaction[] = [
    { type: "yield" },
    { type: "finish", event: { type: "limitReached", limit: "spawns" } },
    { type: "yield" },
    { type: "finish", event: { type: "failed", failure: { kind: "state_too_large" } } },
    { type: "yield" },
    { type: "yield" },
    { type: "degrade", source: "web" },
    { type: "finish", event: { type: "stopRequested" } },
    {
      type: "finish",
      event: { type: "failed", failure: { kind: "turn", phase: "diverge", status: "error" } },
    },
    { type: "lens_failed", lensId: "analogy" },
    {
      type: "finish",
      event: {
        type: "failed",
        failure: { kind: "state_inconsistent", detail: "inquiryId is null" },
      },
    },
  ];
  for (const phase of PHASES) {
    expect(failures.map((failure) => reactionOf(failure, phase))).toEqual(expected);
  }
  expect(
    reactionOf(
      { kind: "capability", capability: "knowledge.search", code: "timeout" },
      "converge",
      "session",
    ),
  ).toEqual({ type: "degrade", source: "session" });
  expect(
    reactionOf({ kind: "capability", capability: "work.tasks", code: "denied" }, "apply"),
  ).toEqual({ type: "degrade", source: "work" });
});
