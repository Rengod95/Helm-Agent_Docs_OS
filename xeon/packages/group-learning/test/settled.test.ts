import { expect, test } from "bun:test";
import type { AgentSettledEventPayload } from "@xeon/contracts/records";
import { fakeAgents } from "@xeon/group-kit/testing";
import { createTestHost } from "@xeon/ext-host/testing";
import { NEW_SKILL, startReview, submit } from "./support/flow.ts";
import { rigOn } from "./support/rig.ts";

test("settled.finish-records-once: the same agent.settled twice writes one fork.finished, one review.finished and clears the in-flight id", async () => {
  const review = await startReview();
  const { rig, requestId } = review;
  expect(rig.state().inFlightReviewId).toBe(requestId);
  await submit(review, NEW_SKILL);
  await rig.settle(requestId, "completed");
  await rig.settle(requestId, "completed");
  expect(rig.events("grp.learning.fork.finished")).toHaveLength(1);
  expect(rig.events("grp.learning.review.finished")).toHaveLength(1);
  expect(rig.state()).toMatchObject({ inFlightReviewId: null, settledReviewId: requestId });
  // 비공개 기록의 내용: 결과와 이 검토가 만든 후보 id
  const finished = rig.payloads("grp.learning.fork.finished")[0];
  const rows = await rig.reader.listProposals({});
  expect(finished).toMatchObject({
    requestId,
    outcome: "completed",
    proposalIds: rows.ok ? rows.value.map((row) => row.id) : [],
  });
  // 공개 레코드: 후보 알림과 검토 종료. 본문은 싣지 않는다
  expect(rig.events("grp.learning.skill.proposed")).toHaveLength(1);
  expect(JSON.stringify(rig.payloads("grp.learning.skill.proposed")[0])).not.toContain(
    "Write release notes",
  );
  expect(rig.payloads("grp.learning.review.finished")[0]).toMatchObject({
    reviewId: requestId,
    outcome: "completed",
    proposalCount: 1,
  });
  // 저장소의 검토 행도 닫혔다
  const row = await rig.reader.getReview(rig.thread, requestId);
  expect(row.ok ? row.value : undefined).toMatchObject({
    outcome: "completed",
    childThreadId: review.childThreadId,
  });
});

test("settled.outcome-follows-status-and-limit-hit", async () => {
  const review = await startReview();
  await review.rig.settle(review.requestId, "completed", { limitHit: "tokens" });
  expect(review.rig.payloads("grp.learning.fork.finished")[0]).toMatchObject({ outcome: "budget" });
  const failed = await startReview();
  await failed.rig.settle(failed.requestId, "error");
  expect(failed.rig.payloads("grp.learning.review.finished")[0]).toMatchObject({
    outcome: "error",
    proposalCount: 0,
  });
});

test("settled.usage-is-recorded-in-the-review-row", async () => {
  const review = await startReview();
  const usage = {
    input: 1200,
    output: 340,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1540,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  await review.rig.settle(review.requestId, "completed", { usage });
  const row = await review.rig.reader.getReview(review.rig.thread, review.requestId);
  expect(row.ok ? row.value : undefined).toMatchObject({ inputTokens: 1200, outputTokens: 340 });
  expect(review.rig.payloads("grp.learning.review.finished")[0]).toMatchObject({
    inputTokens: 1200,
    outputTokens: 340,
  });
});

test("settled.ignores-foreign-request-ids: another group's delegation and another owner scope leave no trace", async () => {
  const review = await startReview();
  const { rig } = review;
  const base = rig.agents.settle(rig.thread, review.requestId, "completed");
  if (base === undefined) throw new Error("no child");
  const foreign: AgentSettledEventPayload = { ...base, requestId: "helm:explore:1" };
  await rig.t.host.dispatch("lifecycle.agent.settled", foreign, {
    threadId: rig.thread,
    dispatchKey: "foreign-1",
  });
  const otherOwner: AgentSettledEventPayload = {
    ...base,
    owner: { kind: "scope", scopeId: "someone-else" },
  };
  await rig.t.host.dispatch("lifecycle.agent.settled", otherOwner, {
    threadId: rig.thread,
    dispatchKey: "foreign-2",
  });
  await rig.t.settled();
  expect(rig.events("grp.learning.fork.finished")).toEqual([]);
  expect(rig.state().inFlightReviewId).toBe(review.requestId);
});

test("triggers.in-flight-blocks-second-review: no second delegation while one is in flight, one after it settles", async () => {
  const review = await startReview();
  const { rig } = review;
  await rig.turn();
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(1);
  // 카운터는 계속 센다
  expect(rig.state().userTurnsSinceReview).toBe(2);
  await rig.settle(review.requestId, "completed");
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(2);
  expect(rig.agents.delegated[1]?.request.requestId).toBe("learning:review:2");
});

test("triggers.settle-before-commit-clears-inflight: a child that settles before the start commit does not leave the in-flight id set", async () => {
  const t = await createTestHost();
  const base = fakeAgents({ ids: t.ids });
  const hook: { settle?: (id: string) => Promise<unknown> } = {};
  // 자식이 위임 접수 직후 곧바로 정착한다(즉시 오류): 구독 핸들러가 §4.3의 4번 커밋보다 먼저 돈다
  const agents = {
    ...base,
    async delegate(
      request: Parameters<typeof base.delegate>[0],
      origin: Parameters<typeof base.delegate>[1],
    ) {
      const result = await base.delegate(request, origin);
      await hook.settle?.(request.requestId);
      return result;
    },
  };
  const rig = await rigOn(t, { agents, settings: { "l3.learning.trigger.userTurns": 1 } });
  hook.settle = (id) => rig.settle(id, "error");
  await rig.turn();
  expect(agents.delegated).toHaveLength(1);
  expect(rig.state()).toMatchObject({
    epoch: 1,
    settledReviewId: "learning:review:1",
    inFlightReviewId: null,
  });
  // 다음 임계 도달 때 검토가 시작된다
  await rig.turn();
  expect(agents.delegated).toHaveLength(2);
});
