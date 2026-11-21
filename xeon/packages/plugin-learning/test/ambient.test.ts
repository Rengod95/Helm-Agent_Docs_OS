import { expect, test } from "bun:test";
import { renderDiff } from "../src/proposals/diff.ts";
import { fakeKnowledge } from "./support/fake-knowledge.ts";
import { NEW_SKILL, queueApi, startReview, submit } from "./support/flow.ts";
import { foldEvents } from "./support/projection.ts";

// M3-REQ-100·102: 도구 execute와 명령 처리기가 ambient 안에서 돌아 후보와 결정을 이벤트로 남기고 투영이 행을 만든다.

test("propose.after-untrusted-flag: the caller's afterUntrusted reaches the row and the view", async () => {
  const review = await startReview();
  expect(await submit(review, NEW_SKILL, { afterUntrusted: true })).toMatchObject({ ok: true });
  expect(await submit(review, { ...NEW_SKILL, target: "second-skill" })).toMatchObject({
    ok: true,
  });
  const listed = await queueApi(review.rig).list({});
  const flags = listed.ok ? listed.value.map((view) => [view.target, view.afterUntrusted]) : [];
  expect(flags.toSorted((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
    ["release-notes", true],
    ["second-skill", false],
  ]);
});

test("propose.id-comes-from-the-tool-call: the same call id is the same proposal and a new call is a new one", async () => {
  const review = await startReview();
  const first = await submit(review, NEW_SKILL, { toolCallId: "call_a" });
  const other = await submit(
    review,
    { ...NEW_SKILL, target: "other-skill" },
    { toolCallId: "call_b" },
  );
  const again = await submit(
    review,
    { ...NEW_SKILL, target: "other-skill" },
    { toolCallId: "call_c" },
  );
  expect(first.ok && other.ok && first.proposalId !== other.proposalId).toBe(true);
  // 같은 후보를 다른 호출로 다시 내면 대기열의 같은 후보를 돌려준다
  expect(other.ok && again.ok && other.proposalId === again.proposalId).toBe(true);
  expect(first.ok && /^prop_[0-9A-F]{26}$/u.test(first.proposalId)).toBe(true);
});

test("records.decision-records: approve, apply, reject and a blocked candidate write the skill records and the private events", async () => {
  const knowledge = fakeKnowledge();
  const review = await startReview({ knowledge });
  const { rig } = review;
  const first = await submit(review, NEW_SKILL);
  const second = await submit(review, { ...NEW_SKILL, target: "other-skill" });
  const api = queueApi(rig);
  await api.decide({ kind: "approve", proposalId: first.ok ? first.proposalId : "", revision: 1 });
  await api.decide({ kind: "reject", proposalId: second.ok ? second.proposalId : "" });
  knowledge.scanBlocks = ["inject.prompt"];
  await submit(review, { ...NEW_SKILL, target: "third-skill" });
  expect(rig.payloads("grp.learning.skill.proposed")).toHaveLength(2);
  expect(rig.payloads("grp.learning.skill.approved")).toMatchObject([
    { target: "release-notes", revision: 1 },
  ]);
  expect(rig.payloads("grp.learning.skill.applied")).toMatchObject([
    { target: "release-notes", skillName: "release-notes" },
  ]);
  const rejected = rig.payloads("grp.learning.skill.rejected");
  expect(rejected).toHaveLength(2);
  expect(rejected).toContainEqual(
    expect.objectContaining({ target: "other-skill", reason: "user_rejected" }),
  );
  expect(rejected).toContainEqual(
    expect.objectContaining({ target: "third-skill", reason: "scan_failed" }),
  );
  expect(rig.events("grp.learning.proposal.created")).toHaveLength(3);
  expect(rig.events("grp.learning.proposal.decided")).toHaveLength(2);
  expect(rig.events("grp.learning.proposal.applied")).toHaveLength(1);
  // 결정 기록은 `/learning` 명령을 부른 대화에, 후보 기록은 검토 포크 자식 대화에 쓰인다
  expect(
    rig.t.records
      .events(rig.thread)
      .some((event) => event.kind === "grp.learning.proposal.decided"),
  ).toBe(true);
  expect(
    rig.t.records
      .events(review.childThreadId)
      .some((event) => event.kind === "grp.learning.proposal.created"),
  ).toBe(true);
});

test("queue.projection-rebuild-equal: folding the events again gives the rows the decision path returned", async () => {
  const review = await startReview();
  const { rig } = review;
  // 큰 본문이 기록을 거쳐 같은 본문과 같은 diff로 돌아온다
  const body = `# Big\n${"line of the skill body\n".repeat(4000)}`;
  const big = await submit(review, { ...NEW_SKILL, target: "big-skill", body });
  const small = await submit(review, NEW_SKILL);
  const api = queueApi(rig);
  const approved = await api.decide({
    kind: "approve",
    proposalId: small.ok ? small.proposalId : "",
    revision: 1,
  });
  const rows = foldEvents(rig.foldedEvents());
  const bigRow = rows.proposals.get(big.ok ? big.proposalId : "");
  expect(bigRow?.diff).toBe(renderDiff("create", "big-skill", body));
  expect(bigRow?.body).toBe(body);
  const smallRow = rows.proposals.get(small.ok ? small.proposalId : "");
  expect(approved.ok ? approved.proposal.status : "").toBe(smallRow?.status ?? "none");
  expect(approved.ok ? approved.proposal.revision : 0).toBe(smallRow?.revision ?? -1);
  // 읽기 면의 목록은 접은 행과 같다
  const listed = await rig.reader.listProposals({});
  expect(listed.ok ? listed.value.map((row) => row.id).toSorted() : []).toEqual(
    [...rows.proposals.keys()].toSorted(),
  );
});

test("propose.too-large: an oversized body is stored as a rejected candidate without its body", async () => {
  const review = await startReview();
  const result = await submit(review, { ...NEW_SKILL, body: "가".repeat(60_000) });
  expect(result).toMatchObject({ ok: true, status: "rejected" });
  const rows = foldEvents(review.rig.foldedEvents());
  expect([...rows.proposals.values()].map((row) => [row.status, row.body])).toEqual([
    ["rejected", ""],
  ]);
});

test("commands.without-a-conversation: reading works and every write is refused with noConversation", async () => {
  const review = await startReview();
  const { rig } = review;
  await submit(review, NEW_SKILL);
  const listed = await rig.command("queue", null);
  expect(listed).toMatchObject({ kind: "queue", sweep: null });
  const shown = await rig.command("queue approve prop_x --revision 1", null);
  expect(shown).toEqual({ kind: "error", error: { kind: "learning.noConversation" } });
  expect(await rig.command("review", null)).toEqual({
    kind: "error",
    error: { kind: "learning.noConversation" },
  });
});

test("commands.review: a manual review commits the epoch and the in-flight id, and the next one is busy until it settles", async () => {
  const review = await startReview();
  const { rig } = review;
  await rig.settle(review.requestId, "completed");
  expect(rig.state()).toMatchObject({ epoch: 1, inFlightReviewId: null });
  const started = await rig.command("review");
  expect(started).toEqual({
    kind: "review",
    result: { ok: true, requestId: "learning:review:manual:2", duplicate: false },
  });
  expect(rig.state()).toMatchObject({
    epoch: 2,
    lastReviewId: "learning:review:manual:2",
    inFlightReviewId: "learning:review:manual:2",
  });
  expect(await rig.command("review")).toMatchObject({
    kind: "review",
    result: { ok: false, error: { kind: "learning.reviewBusy" } },
  });
  await rig.settle("learning:review:manual:2", "completed");
  expect(rig.state().inFlightReviewId).toBeNull();
  // 자동 검토는 순번을 이어 쓴다
  await rig.turn();
  expect(rig.agents.delegated.at(-1)?.request.requestId).toBe("learning:review:3");
});
