import { expect, test } from "bun:test";
import { NEW_SKILL, startReview, submit } from "./support/flow.ts";

test("dispose.cancels-in-flight-review: turning the group off cancels its child at once", async () => {
  const review = await startReview();
  const { rig } = review;
  expect(rig.agents.cancels).toEqual([]);
  await rig.disable();
  expect(rig.agents.cancels).toEqual([
    { target: { ownerScopeId: "learning" }, reason: "group_disabled" },
  ]);
  expect(rig.agents.delegated).toHaveLength(1);
  // 대기열 면은 그룹이 꺼진 동안 없다(호스트가 unavailable로 본다)
  expect(rig.bridge.api()).toBeUndefined();
});

test("dispose.clears-inflight-id-after-cancel: a turn long after the group came back clears a stale in-flight id", async () => {
  const review = await startReview();
  const { rig } = review;
  expect(rig.state().inFlightReviewId).toBe(review.requestId);
  await rig.disable();
  await rig.enable();
  expect(rig.bridge.api()).toBeDefined();
  // onDispose에는 ambient가 없어 상태를 커밋하지 못한다. 그룹이 꺼진 동안 구독은 돌지 않았으므로 표지가 남는다
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(1);
  // 검토가 너무 오래 닫히지 않으면 끝난 검토로 본다
  rig.clock.advance(3 * 60 * 60 * 1000);
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(2);
  expect(rig.agents.delegated[1]?.request.requestId).toBe("learning:review:2");
  expect(rig.state()).toMatchObject({
    epoch: 2,
    inFlightReviewId: "learning:review:2",
    settledReviewId: review.requestId,
  });
});

test("dispose.command-entry-closes-a-cancelled-review: /learning asks the delegation service and clears the id at once", async () => {
  const review = await startReview();
  const { rig } = review;
  await rig.disable();
  await rig.enable();
  const report = await rig.command("queue");
  expect(report.kind).toBe("queue");
  expect(rig.state()).toMatchObject({ inFlightReviewId: null, settledReviewId: review.requestId });
  // 취소된 검토가 aborted로 닫혔다
  expect(rig.payloads("grp.learning.fork.finished")[0]).toMatchObject({ outcome: "aborted" });
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(2);
});

test("dispose.pending-candidates-survive: candidates submitted before the cancel stay pending in the queue", async () => {
  const review = await startReview();
  await submit(review, NEW_SKILL);
  await review.rig.disable();
  await review.rig.enable();
  const listed = await review.rig.bridge.api()?.list({});
  expect(listed?.ok ? listed.value.map((view) => view.status) : []).toEqual(["pending"]);
});
