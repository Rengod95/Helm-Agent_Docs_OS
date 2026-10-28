import { expect, test } from "bun:test";
import { startReview, submit, queueApi } from "./support/flow.ts";

const FEEDBACK = {
  kind: "feedback",
  op: "add",
  target: "user/work-style",
  body: "Ask before running destructive git commands, because the user lost work after a force push.",
  rationale: 'The user said "never do that again" after the force push.',
  evidenceEventIds: ["evt_00000000000000000000000007"],
} as const;

test("feedback.frustration-signal-creates-proposal: a feedback candidate is announced and touches no file until approved", async () => {
  const review = await startReview();
  const { rig } = review;
  const before = rig.knowledge.snapshot();
  expect(await submit(review, FEEDBACK)).toMatchObject({ ok: true, status: "pending" });
  await rig.settle(review.requestId, "completed");
  const announced = rig.payloads("grp.learning.feedback.proposed");
  expect(announced).toHaveLength(1);
  expect(announced[0]).toMatchObject({ target: "user/work-style", reviewId: review.requestId });
  // 레코드에 본문이 없고, 승인 전에 메모리 파일은 그대로다
  expect(JSON.stringify(announced)).not.toContain("force push");
  expect(rig.knowledge.snapshot()).toBe(before);
});

test("feedback.approval-adds-a-memory-user-entry-through-the-write-api", async () => {
  const review = await startReview();
  const { rig } = review;
  const accepted = await submit(review, FEEDBACK);
  const id = accepted.ok ? accepted.proposalId : "";
  const result = await queueApi(rig).decide(
    { kind: "approve", proposalId: id, revision: 1 },
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    ok: true,
    applied: true,
    proposal: { kind: "feedback", status: "applied" },
  });
  expect(rig.knowledge.memory.user).toEqual([FEEDBACK.body]);
  expect(rig.knowledge.writes.map((write) => write.method)).toEqual(["memory.add"]);
  expect(rig.knowledge.writes[0]?.approvalSource).toBe("learning.queue");
});

test("replay.no-capability-calls-in-handlers: the trigger and subscription handlers never call a knowledge capability", async () => {
  const review = await startReview();
  const { rig } = review;
  const baseline = rig.knowledge.calls();
  await rig.turn({ toolSteps: 2 });
  await rig.settle(review.requestId, "completed");
  await rig.turn();
  expect(rig.knowledge.calls()).toBe(baseline);
  // 도구 execute가 능력을 부르는 것은 재실행되는 코드가 아니라 허용된다
  await submit(review, { ...FEEDBACK, target: "user/work-style" });
  expect(rig.knowledge.calls()).toBeGreaterThan(baseline);
});
