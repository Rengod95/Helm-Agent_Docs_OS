import { expect, test } from "bun:test";
import { fakeAgents } from "@xeon/group-kit/testing";
import { createTestHost } from "@xeon/ext-host/testing";
import {
  buildReviewSpec,
  manualReviewId,
  reviewFinishOutcome,
  reviewRequestId,
  reviewStartOutcome,
  reviewTokenBudget,
} from "../src/review/fork.ts";
import { REVIEW_ALLOWED_TOOLS } from "../src/review/policy.ts";
import type { LearningSettings } from "../src/settings.ts";
import { INITIAL_LEARNING_STATE } from "../src/state.ts";
import { ITEM, THREAD } from "./support/ids.ts";
import { createRig, rigOn } from "./support/rig.ts";

const SETTINGS: LearningSettings = {
  userTurns: 10,
  toolIterations: 10,
  maxIterations: 16,
  tokenBudget: null,
  model: null,
  approvalRequired: true,
  scanEnabled: true,
  expiryDays: 30,
};

test("fork.token-budget-defaults: 75% of the window up to 600k, 120k when unknown, the setting wins", () => {
  expect(reviewTokenBudget(200_000, null)).toBe(150_000);
  expect(reviewTokenBudget(1_000_000, null)).toBe(600_000);
  expect(reviewTokenBudget(null, null)).toBe(120_000);
  expect(reviewTokenBudget(200_000, 50_000)).toBe(50_000);
});

test("fork.uses-item-fork-point: item fork, no report, read-only tool policy and the review limits", () => {
  const spec = buildReviewSpec({
    parent: { threadId: THREAD, upToItemId: ITEM },
    requestId: reviewRequestId(7),
    reasons: ["user_turns", "tool_iterations"],
    settings: { ...SETTINGS, model: "review" },
    contextWindow: 200_000,
  });
  expect(spec.fork).toEqual({ at: "item", itemId: ITEM });
  expect("report" in spec).toBe(false);
  expect(spec.agent).toBe("learning-review");
  expect(spec.requestId).toBe("learning:review:7");
  expect(spec.model).toBe("review");
  expect(spec.limits).toEqual({ maxSteps: 16, maxInputTokens: 150_000 });
  expect(spec.toolPolicy?.allow).toEqual([...REVIEW_ALLOWED_TOOLS]);
  expect(spec.toolPolicy?.keepParentList).toBe(true);
  expect(spec.toolPolicy?.denyHint).toContain("learning_propose");
  // 쓰기, 편집, 셸, 위임 도구는 허용 목록에 없다
  for (const denied of [
    "write",
    "edit",
    "bash",
    "agent",
    "skill_manage",
    "memory_manage",
    "ask_user",
  ]) {
    expect(spec.toolPolicy?.allow).not.toContain(denied);
  }
  // 모델이 null이면 정의의 모델을 쓴다
  expect(
    "model" in
      buildReviewSpec({
        parent: { threadId: THREAD, upToItemId: ITEM },
        requestId: "learning:review:1",
        reasons: ["manual"],
        settings: SETTINGS,
        contextWindow: null,
      }),
  ).toBe(false);
});

test("fork.request-ids: the key stays inside the 48 character limit group-kit allows", () => {
  expect(reviewRequestId(1)).toBe("learning:review:1");
  expect(manualReviewId(3)).toBe("learning:review:manual:3");
  expect(reviewRequestId(999_999_999).length).toBeLessThanOrEqual(48);
});

function receipt(status: "accepted" | "duplicate") {
  return {
    ok: true as const,
    receipt: { requestId: "learning:review:1", childThreadId: THREAD, status },
  };
}

test("fork.start-outcome: accepted, duplicate and a failed delegation", () => {
  expect(reviewStartOutcome(receipt("accepted"))).toEqual({
    kind: "started",
    childThreadId: THREAD,
  });
  expect(reviewStartOutcome(receipt("duplicate"))).toEqual({
    kind: "already",
    childThreadId: THREAD,
  });
  expect(reviewStartOutcome({ ok: false, error: { kind: "group.delegateUnavailable" } })).toEqual({
    kind: "retryLater",
    error: { kind: "group.delegateUnavailable" },
  });
});

test("settled.finish-outcome: the outcome follows the status and a limit hit wins", () => {
  const state = { ...INITIAL_LEARNING_STATE, inFlightReviewId: "learning:review:2" };
  const base = { requestId: "learning:review:2", childThreadId: THREAD, usage: null };
  expect(reviewFinishOutcome(state, { ...base, status: "completed" })).toMatchObject({
    kind: "finished",
    outcome: "completed",
  });
  expect(reviewFinishOutcome(state, { ...base, status: "aborted" })).toMatchObject({
    outcome: "aborted",
  });
  expect(reviewFinishOutcome(state, { ...base, status: "error" })).toMatchObject({
    outcome: "error",
  });
  expect(
    reviewFinishOutcome(state, { ...base, status: "completed", limitHit: "steps" }),
  ).toMatchObject({ outcome: "budget" });
  const finished = reviewFinishOutcome(state, { ...base, status: "completed" });
  expect(finished.kind === "finished" ? finished.next : undefined).toEqual({
    ...state,
    settledReviewId: "learning:review:2",
    inFlightReviewId: null,
  });
  // 다른 검토의 종료는 진행 중 표지를 건드리지 않는다
  const other = reviewFinishOutcome(state, {
    ...base,
    requestId: "learning:review:manual:1",
    status: "completed",
  });
  expect(other.kind === "finished" ? other.next.inFlightReviewId : "x").toBe("learning:review:2");
  expect(
    reviewFinishOutcome(state, { ...base, requestId: "helm:explore:1", status: "completed" }),
  ).toEqual({ kind: "ignore" });
});

test("fork.requestid-dedup-after-restart: a crash between the delegation and the commit still leaves one child", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 1 } });
  // 위임은 나가고 그 뒤의 첫 커밋이 실패한다: 프로세스가 위임과 커밋 사이에서 끝난 것과 같다
  rig.t.records.failNext("busy");
  await rig.turn({ key: "crash" });
  expect(rig.agents.delegated).toHaveLength(1);
  expect(rig.commits()).toBe(0);
  const restarted = await rig.t.restart();
  const again = await rigOn(
    restarted,
    {
      agents: rig.agents,
      knowledge: rig.knowledge,
      settings: { "l3.learning.trigger.userTurns": 1 },
    },
    rig.thread,
  );
  await again.turn({ key: "crash" });
  // 같은 requestId: 두 번째 위임은 duplicate이고 자식 대화는 하나다
  expect(rig.agents.delegated).toHaveLength(1);
  expect(again.state()).toMatchObject({
    epoch: 1,
    lastReviewId: "learning:review:1",
    inFlightReviewId: "learning:review:1",
  });
  const duplicate = await rig.agents.delegate(
    rig.agents.delegated[0]?.request ?? fail("no delegation"),
    rig.agents.delegated[0]?.origin ?? fail("no origin"),
  );
  expect(duplicate).toMatchObject({ ok: true, receipt: { status: "duplicate" } });
});

test("fork.delegate-failure-counts: three failed delegations in a row drop the review and reset the counters", async () => {
  const t = await createTestHost();
  const agents = fakeAgents({ ids: t.ids, unavailable: true });
  const rig = await rigOn(t, { agents, settings: { "l3.learning.trigger.userTurns": 1 } });
  await rig.turn();
  expect(rig.state()).toMatchObject({
    delegateFailures: 1,
    epoch: 0,
    inFlightReviewId: null,
    userTurnsSinceReview: 1,
  });
  await rig.turn();
  expect(rig.state()).toMatchObject({ delegateFailures: 2, userTurnsSinceReview: 2 });
  await rig.turn();
  expect(rig.state()).toMatchObject({ delegateFailures: 0, userTurnsSinceReview: 0, epoch: 0 });
  expect(agents.delegated).toHaveLength(0);
});

function fail(message: string): never {
  throw new Error(message);
}
