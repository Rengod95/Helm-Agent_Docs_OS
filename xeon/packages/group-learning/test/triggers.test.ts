import { expect, test } from "bun:test";
import { INITIAL_LEARNING_STATE, type LearningState } from "../src/state.ts";
import {
  advanceCounters,
  afterDelegateFailure,
  applyTurn,
  countsAsUserTurn,
  type TurnTally,
} from "../src/triggers.ts";
import { TURN } from "./support/ids.ts";
import { createRig } from "./support/rig.ts";

const SETTINGS = { userTurns: 10, toolIterations: 10 };

function tally(patch: Partial<TurnTally> = {}): TurnTally {
  return {
    // 순수 함수 시험이라 id 값은 읽히지 않는다. 형식만 맞춘 고정 값이다
    turnId: patch.turnId ?? TURN,
    origin: "user",
    status: "completed",
    hasFinalAnswer: true,
    toolIterations: 0,
    skillWritten: false,
    ...patch,
  };
}

function state(patch: Partial<LearningState> = {}): LearningState {
  return { ...INITIAL_LEARNING_STATE, ...patch };
}

// ── 순수 함수 ──────────────────────────────────────────────────────────

test("triggers.counts-user-turns (pure): the tenth user turn reviews, the ninth does not", () => {
  const ninth = applyTurn(state({ userTurnsSinceReview: 8 }), tally(), SETTINGS, true);
  expect(ninth).toMatchObject({ kind: "skip", why: "below_threshold" });
  expect(ninth.next.userTurnsSinceReview).toBe(9);
  const tenth = applyTurn(state({ userTurnsSinceReview: 9 }), tally(), SETTINGS, true);
  expect(tenth).toEqual({
    kind: "review",
    reasons: ["user_turns"],
    requestId: "learning:review:1",
    next: {
      ...INITIAL_LEARNING_STATE,
      userTurnsSinceReview: 0,
      toolIterationsSinceSkillWrite: 0,
      lastReviewId: "learning:review:1",
      inFlightReviewId: "learning:review:1",
      lastTurnId: TURN,
      epoch: 1,
    },
  });
});

test("triggers.skips-aborted-and-scheduled-turns (pure)", () => {
  const before = state({ userTurnsSinceReview: 9 });
  for (const patch of [
    { status: "aborted" },
    { status: "error" },
    { hasFinalAnswer: false },
    { origin: "scheduled" },
    { origin: "remote" },
    { origin: "delegation" },
    { origin: "drive" },
    { origin: "other" },
  ] as const) {
    const decision = applyTurn(before, tally(patch), SETTINGS, true);
    expect(decision).toMatchObject({ kind: "skip", why: "excluded" });
    // 사용자 turn 수는 올리지 않는다
    expect(decision.next.userTurnsSinceReview).toBe(9);
    expect(countsAsUserTurn(tally(patch))).toBe(false);
  }
  // 제외된 turn도 도구 반복 수는 올린다(spec §4.2 규칙 2)
  const excluded = applyTurn(
    state(),
    tally({ origin: "scheduled", toolIterations: 3 }),
    SETTINGS,
    true,
  );
  expect(excluded.next.toolIterationsSinceSkillWrite).toBe(3);
});

test("triggers.resets-on-skill-write (pure)", () => {
  const decision = applyTurn(
    state({ toolIterationsSinceSkillWrite: 9 }),
    tally({ toolIterations: 4, skillWritten: true }),
    SETTINGS,
    true,
  );
  expect(decision).toMatchObject({ kind: "skip", why: "below_threshold" });
  expect(decision.next.toolIterationsSinceSkillWrite).toBe(0);
  expect(
    advanceCounters(state({ toolIterationsSinceSkillWrite: 5 }), tally({ toolIterations: 2 }))
      .toolIterationsSinceSkillWrite,
  ).toBe(7);
});

test("triggers.zero-threshold-disables-reason (pure)", () => {
  const before = state({ userTurnsSinceReview: 50, toolIterationsSinceSkillWrite: 0 });
  expect(applyTurn(before, tally(), { userTurns: 0, toolIterations: 10 }, true)).toMatchObject({
    kind: "skip",
    why: "below_threshold",
  });
  // 도구 반복 사유만 켜져 있으면 그 사유로 검토한다
  const byTools = applyTurn(
    state({ toolIterationsSinceSkillWrite: 9 }),
    tally({ toolIterations: 1 }),
    { userTurns: 0, toolIterations: 10 },
    true,
  );
  expect(byTools).toMatchObject({ kind: "review", reasons: ["tool_iterations"] });
});

test("triggers.in-flight-blocks-second-review (pure)", () => {
  const busy = state({ userTurnsSinceReview: 20, inFlightReviewId: "learning:review:3", epoch: 3 });
  const decision = applyTurn(busy, tally(), SETTINGS, true);
  expect(decision).toMatchObject({ kind: "skip", why: "in_flight" });
  // 카운터는 계속 센다
  expect(decision.next.userTurnsSinceReview).toBe(21);
  expect(decision.next.inFlightReviewId).toBe("learning:review:3");
});

test("triggers.disabled-leaves-state-unchanged (pure)", () => {
  const before = state({ userTurnsSinceReview: 7 });
  expect(applyTurn(before, tally(), SETTINGS, false)).toEqual({
    kind: "skip",
    why: "disabled",
    next: before,
  });
});

test("fork.delegate-failure-counts (pure): the third failure drops the review and resets both counters", () => {
  const first = afterDelegateFailure(
    state({ epoch: 4 }),
    state({ epoch: 5, userTurnsSinceReview: 0, inFlightReviewId: "learning:review:5" }),
  );
  // 에폭과 진행 중 검토는 위임하기 전 값이다
  expect(first).toMatchObject({ epoch: 4, inFlightReviewId: null, delegateFailures: 1 });
  const third = afterDelegateFailure(
    state({ epoch: 4, delegateFailures: 2 }),
    state({ userTurnsSinceReview: 12, toolIterationsSinceSkillWrite: 8, delegateFailures: 2 }),
  );
  expect(third).toMatchObject({
    epoch: 4,
    userTurnsSinceReview: 0,
    toolIterationsSinceSkillWrite: 0,
    delegateFailures: 0,
  });
});

// ── 핸들러(X 호스트) ───────────────────────────────────────────────────

test("triggers.counts-user-turns: ten user turns start one background review, nine start none", async () => {
  const rig = await createRig();
  for (let n = 1; n <= 9; n += 1) {
    // eslint-disable-next-line no-await-in-loop -- turn은 차례로 정착한다
    await rig.turn();
  }
  expect(rig.agents.delegated).toHaveLength(0);
  expect(rig.state().userTurnsSinceReview).toBe(9);
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(1);
  expect(rig.state()).toMatchObject({
    userTurnsSinceReview: 0,
    epoch: 1,
    lastReviewId: "learning:review:1",
    inFlightReviewId: "learning:review:1",
  });
});

test("triggers.counts-tool-iterations-per-step: three tools in one step are one iteration and a replayed step counts once", async () => {
  const rig = await createRig();
  await rig.turn({ toolSteps: 1, toolsPerStep: 3 });
  expect(rig.state().toolIterationsSinceSkillWrite).toBe(1);
  const fixed = [rig.t.ids.next("stp")];
  await rig.turn({ toolSteps: 1, stepIds: fixed });
  await rig.turn({ toolSteps: 1, stepIds: fixed });
  // 같은 stepId를 다시 세지 않는 것은 한 turn 안의 재발화다: 두 turn의 집계표는 따로라 둘 다 센다
  expect(rig.state().toolIterationsSinceSkillWrite).toBe(3);
});

test("triggers.counts-tool-iterations-per-step: the same stepId fired twice in one turn counts once", async () => {
  const rig = await createRig();
  const stepId = rig.t.ids.next("stp");
  const turnId = rig.t.ids.next("trn");
  const dispatchStep = (key: string) =>
    rig.t.host.dispatch(
      "boundary.step.after",
      {
        stepIndex: 0,
        stepId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "m",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 1,
        },
        toolResults: [
          {
            role: "toolResult",
            toolCallId: "c",
            toolName: "read",
            content: [],
            isError: false,
            timestamp: 1,
          },
        ],
        messageItemId: rig.t.ids.next("itm"),
        toolResultItemIds: [rig.t.ids.next("itm")],
        context: { contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: true },
      },
      {
        threadId: rig.thread,
        dispatchKey: key,
        initial: { entries: [], continue: true },
        finalize: (value) => value,
      },
    );
  await rig.t.host.dispatch(
    "boundary.turn.before",
    { turnId },
    { threadId: rig.thread, dispatchKey: "b" },
  );
  await dispatchStep("s1");
  const second = await dispatchStep("s2");
  // 핸들러 반환값은 undefined라 chain 값이 바뀌지 않는다
  expect(second.value).toEqual({ entries: [], continue: true });
  await rig.t.host.dispatch(
    "boundary.settle.after",
    { turnId, aborted: false, lastItemId: rig.t.ids.next("itm") },
    { threadId: rig.thread, dispatchKey: "c" },
  );
  expect(rig.state().toolIterationsSinceSkillWrite).toBe(1);
});

test("triggers.resets-on-skill-write: a skill_manage or learning_propose result zeroes the tool iterations", async () => {
  const rig = await createRig();
  await rig.turn({ toolSteps: 4 });
  expect(rig.state().toolIterationsSinceSkillWrite).toBe(4);
  await rig.turn({ toolSteps: 2, toolName: "skill_manage" });
  expect(rig.state().toolIterationsSinceSkillWrite).toBe(0);
  await rig.turn({ toolSteps: 3 });
  await rig.turn({ toolSteps: 1, toolName: "learning_propose" });
  expect(rig.state().toolIterationsSinceSkillWrite).toBe(0);
});

test("triggers.skips-aborted-and-scheduled-turns: excluded turns neither count nor review", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 2 } });
  await rig.turn({ origin: "scheduled" });
  await rig.turn({ origin: "delegation" });
  await rig.turn({ origin: "drive" });
  await rig.turn({ status: "aborted" });
  await rig.turn({ status: "error" });
  expect(rig.state().userTurnsSinceReview).toBe(0);
  expect(rig.agents.delegated).toHaveLength(0);
  await rig.turn();
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(1);
});

test("triggers.zero-threshold-disables-reason: a zero user turn threshold never reviews by turns", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 0 } });
  for (let n = 0; n < 12; n += 1) {
    // eslint-disable-next-line no-await-in-loop -- turn은 차례로 정착한다
    await rig.turn();
  }
  expect(rig.agents.delegated).toHaveLength(0);
});

test("triggers.commit-once-per-turn: one settled turn commits the state at most once", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 3 } });
  await rig.turn({ toolSteps: 2 });
  expect(rig.commits()).toBe(1);
  await rig.turn({ toolSteps: 2 });
  expect(rig.commits()).toBe(2);
});

test("triggers.missing-last-item-id-no-review: no fork point means no review and the counters stay", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 2 } });
  await rig.turn({ lastItemId: null });
  await rig.turn({ lastItemId: null });
  expect(rig.agents.delegated).toHaveLength(0);
  expect(rig.state()).toMatchObject({ userTurnsSinceReview: 2, epoch: 0, inFlightReviewId: null });
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(1);
});

test("triggers.fork-has-zero-counters: a delegation turn on the review thread never counts or delegates", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 1 } });
  await rig.turn({ origin: "delegation" });
  await rig.turn({ origin: "delegation" });
  expect(rig.agents.delegated).toHaveLength(0);
  expect(rig.state().userTurnsSinceReview).toBe(0);
});

test("triggers.fail-closed: unreadable settings start no review", async () => {
  const rig = await createRig();
  rig.control.settingsDown = true;
  for (let n = 0; n < 12; n += 1) {
    // eslint-disable-next-line no-await-in-loop -- turn은 차례로 정착한다
    await rig.turn();
  }
  expect(rig.agents.delegated).toHaveLength(0);
  expect(rig.commits()).toBe(0);
});

test("triggers.double-fire-is-counted-once: the same turn settled twice counts once and delegates once", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 2 } });
  await rig.turn();
  const turnId = rig.t.ids.next("trn");
  await rig.turn({ turnId, key: "twice" });
  await rig.turn({ turnId, key: "twice" });
  expect(rig.agents.delegated).toHaveLength(1);
  expect(rig.state()).toMatchObject({ epoch: 1, userTurnsSinceReview: 0 });
  expect(rig.events("grp.learning.fork.started")).toHaveLength(1);
});
