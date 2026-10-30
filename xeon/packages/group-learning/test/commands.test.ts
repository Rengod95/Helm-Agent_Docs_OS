import { expect, test } from "bun:test";
import { LEARNING_USAGE, parseLearningCommand } from "../src/commands.ts";
import { fakeKnowledge } from "./support/fake-knowledge.ts";
import { NEW_SKILL, startReview, submit } from "./support/flow.ts";
import { createRig } from "./support/rig.ts";

function ok(args: string) {
  const parsed = parseLearningCommand(args);
  return parsed.ok ? parsed.command : parsed.usage;
}

test("commands.parse: every subcommand of spec 6.2 and the usage for anything else", () => {
  expect(ok("queue")).toEqual({ op: "queue", json: false, status: undefined });
  expect(ok("queue --json --status pending")).toEqual({
    op: "queue",
    json: true,
    status: "pending",
  });
  expect(ok("queue show prop_1")).toEqual({ op: "show", id: "prop_1" });
  expect(ok("queue approve prop_1 --revision 2")).toEqual({
    op: "approve",
    id: "prop_1",
    revision: 2,
    scope: undefined,
  });
  expect(ok("queue approve prop_1 --revision 2 --scope project")).toEqual({
    op: "approve",
    id: "prop_1",
    revision: 2,
    scope: "project",
  });
  expect(ok("queue reject prop_1")).toEqual({ op: "reject", id: "prop_1", note: undefined });
  expect(ok("queue reject prop_1 --note too  vague")).toEqual({
    op: "reject",
    id: "prop_1",
    note: "too vague",
  });
  expect(ok("queue edit prop_1 --revision 1 # New body\nSecond line")).toEqual({
    op: "edit",
    id: "prop_1",
    revision: 1,
    body: "# New body\nSecond line",
  });
  expect(ok("queue revert prop_1")).toEqual({ op: "revert", id: "prop_1" });
  expect(ok("review")).toEqual({ op: "review", cancel: false });
  expect(ok("review --cancel")).toEqual({ op: "review", cancel: true });
  // 승인과 수정은 판이 필수다(F wire proposal.decide)
  for (const bad of [
    "",
    "queue approve prop_1",
    "queue approve prop_1 --revision 0",
    "queue approve prop_1 --revision x",
    "queue edit prop_1 body",
    "queue approve prop_1 --revision 1 --scope team",
    "queue show",
    "queue --status nope",
    "history",
    "review now",
  ]) {
    expect(ok(bad)).toBe(LEARNING_USAGE);
  }
});

test("commands.queue-json-matches-view: /learning queue returns ProposalView rows with source learning", async () => {
  const review = await startReview();
  await submit(review, NEW_SKILL);
  const report = await review.rig.command("queue --json");
  if (report.kind !== "queue") throw new Error(`expected a queue report, got ${report.kind}`);
  expect(report.views).toHaveLength(1);
  expect(report.views[0]).toEqual({
    id: report.views[0]?.id ?? "",
    kind: "skill",
    op: "create",
    target: "release-notes",
    status: "pending",
    destructive: false,
    diff: "+ # Release notes\n+ Write release notes from the merged pull requests.",
    rationale: "The user asked twice for the same release notes format.",
    evidence: [{ eventId: "evt_00000000000000000000000001", threadId: review.rig.thread }],
    conflictsWith: null,
    reason: null,
    revision: 1,
    scope: "user",
    afterUntrusted: false,
    createdAt: report.views[0]?.createdAt ?? 0,
    source: "learning",
  });
});

test("commands.decisions-run-through-the-queue", async () => {
  const review = await startReview();
  const accepted = await submit(review, NEW_SKILL);
  const id = accepted.ok ? accepted.proposalId : "";
  const show = await review.rig.command(`queue show ${id}`);
  expect(show).toMatchObject({ kind: "show", view: { id } });
  const noRevision = await review.rig.command(`queue approve ${id}`);
  expect(noRevision).toEqual({ kind: "usage", text: LEARNING_USAGE });
  const wrong = await review.rig.command(`queue approve ${id} --revision 9`);
  expect(wrong).toMatchObject({
    kind: "decision",
    result: { ok: false, error: { kind: "learning.revisionMismatch", current: 1 } },
  });
  const approved = await review.rig.command(`queue approve ${id} --revision 1 --scope project`);
  expect(approved).toMatchObject({
    kind: "decision",
    result: { ok: true, applied: true, proposal: { scope: "project", status: "applied" } },
  });
  const missing = await review.rig.command("queue show prop_nope");
  expect(missing).toEqual({
    kind: "error",
    error: { kind: "learning.notFound", proposalId: "prop_nope" },
  });
  const reverted = await review.rig.command(`queue revert ${id}`);
  expect(reverted).toMatchObject({
    kind: "decision",
    result: { ok: true, proposal: { status: "reverted" } },
  });
});

test("commands.reject-and-edit", async () => {
  const review = await startReview();
  const first = await submit(review, NEW_SKILL);
  const second = await submit(review, { ...NEW_SKILL, target: "other-skill" });
  const rejected = await review.rig.command(
    `queue reject ${first.ok ? first.proposalId : ""} --note not useful`,
  );
  expect(rejected).toMatchObject({
    kind: "decision",
    result: { ok: true, proposal: { status: "rejected", reason: "user_rejected" } },
  });
  const edited = await review.rig.command(
    `queue edit ${second.ok ? second.proposalId : ""} --revision 1 Shorter body`,
  );
  expect(edited).toMatchObject({
    kind: "decision",
    result: { ok: true, proposal: { revision: 2, diff: "+ Shorter body" } },
  });
});

test("commands.review-starts-a-manual-review-once-and-cancels-it", async () => {
  const rig = await createRig({ knowledge: fakeKnowledge() });
  // 포크 지점을 모르면 시작하지 않는다
  expect(await rig.command("review")).toMatchObject({
    kind: "review",
    result: { ok: false, error: { kind: "learning.noSnapshot" } },
  });
  await rig.turn();
  expect(await rig.command("review")).toEqual({
    kind: "review",
    result: { ok: true, requestId: "learning:review:manual:1", duplicate: false },
  });
  expect(rig.agents.delegated).toHaveLength(1);
  expect(rig.agents.delegated[0]?.request.fork?.at).toBe("item");
  // 진행 중 검토가 있으면 busy
  expect(await rig.command("review")).toMatchObject({
    kind: "review",
    result: {
      ok: false,
      error: { kind: "learning.reviewBusy", requestId: "learning:review:manual:1" },
    },
  });
  expect(await rig.command("review --cancel")).toEqual({ kind: "cancel", cancelled: true });
  expect(rig.agents.cancels).toHaveLength(1);
  // 취소한 뒤에는 다시 시작할 수 있고 순번이 올라간다
  expect(await rig.command("review")).toMatchObject({
    kind: "review",
    result: { ok: true, requestId: "learning:review:manual:2" },
  });
});

test("commands.review-start-takes-the-command-signal: the review delegate gets the signal of the command invocation", async () => {
  const rig = await createRig({ knowledge: fakeKnowledge() });
  await rig.turn();
  const invocation = new AbortController();
  // 명령 호출의 신호(ctx.signal)를 그대로 검토 시작에 넘긴다. 처리기가 따로 만든 신호는 쓰지 않는다
  expect(await rig.command("review", rig.thread, invocation.signal)).toEqual({
    kind: "review",
    result: { ok: true, requestId: "learning:review:manual:1", duplicate: false },
  });
  const started = rig.agents.delegated[0];
  expect(started?.origin.signal).toBe(invocation.signal);
  expect(started?.origin.signal.aborted).toBe(false);
  // 호출이 취소되면 검토 시작이 받은 신호도 취소된다
  invocation.abort();
  expect(started?.origin.signal.aborted).toBe(true);
});
