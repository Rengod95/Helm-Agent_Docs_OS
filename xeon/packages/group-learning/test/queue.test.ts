import { expect, test } from "bun:test";
import { INITIAL_LEARNING_STATE } from "../src/state.ts";
import { applyOutcome } from "../src/results.ts";
import { PROPOSAL_STATUS_VALUES, type Proposal } from "../src/proposals/proposal.ts";
import { isExpired, transition, type ProposalEvent } from "../src/proposals/queue.ts";
import { fakeKnowledge } from "./support/fake-knowledge.ts";
import { NEW_SKILL, queueApi, startReview, submit } from "./support/flow.ts";

const NOW = 1_700_000_000_000;

function row(patch: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop_00000000000000000000000001",
    kind: "skill",
    op: "create",
    target: "release-notes",
    diff: "+ x",
    body: "x",
    description: null,
    bodyHash: "0".repeat(64),
    baseHash: null,
    rationale: "r",
    evidenceEventIds: ["evt_1"],
    threadId: "thr_1",
    status: "pending",
    reviewId: "learning:review:1",
    conflictsWith: null,
    destructive: false,
    scope: "user",
    afterUntrusted: false,
    reason: null,
    findings: [],
    ledgerId: null,
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1,
    ...patch,
  };
}

// ── 순수 전이 ──────────────────────────────────────────────────────────

const EVENTS: readonly [string, ProposalEvent][] = [
  ["edit", { kind: "edit", revision: 1, body: "y", bodyHash: "1".repeat(64), diff: "+ y" }],
  ["scanBlocked", { kind: "scanBlocked" }],
  ["approve", { kind: "approve", revision: 1, scope: undefined }],
  ["policyApprove", { kind: "policyApprove" }],
  ["reject", { kind: "reject" }],
  ["expire", { kind: "expire" }],
  [
    "apply.applied",
    { kind: "apply", transition: { kind: "applied", ledgerId: "knl_1", afterHash: "a" } },
  ],
  ["apply.rejected", { kind: "apply", transition: { kind: "rejected", reason: "scan_failed" } }],
  ["apply.pending", { kind: "apply", transition: { kind: "backToPending", reason: "base_stale" } }],
  ["apply.retry", { kind: "apply", transition: { kind: "retry", detail: "io" } }],
  ["revertDone", { kind: "revertDone" }],
  ["revertRefused", { kind: "revertRefused" }],
];

/** spec §4.5 표: (현재 상태, 사건) → 다음 상태. 표에 없는 쌍은 거부 */
const TABLE: Readonly<Record<Proposal["status"], Readonly<Record<string, string>>>> = {
  pending: {
    edit: "pending",
    scanBlocked: "rejected",
    approve: "approved",
    policyApprove: "approved",
    reject: "rejected",
    expire: "expired",
  },
  approved: {
    "apply.applied": "applied",
    "apply.rejected": "rejected",
    "apply.pending": "pending",
    "apply.retry": "approved",
  },
  applied: { revertDone: "reverted", revertRefused: "applied" },
  rejected: {},
  expired: {},
  reverted: {},
};

test("queue.transitions-follow-table: every (status, event) pair of the table, and the others are refused", () => {
  for (const status of PROPOSAL_STATUS_VALUES) {
    const allowed = TABLE[status];
    for (const [name, event] of EVENTS) {
      const from = row({
        status,
        ledgerId: status === "applied" ? "knl_1" : null,
      });
      const next = transition(from, event, NOW + 1);
      const expected = allowed[name];
      if (expected === undefined) {
        expect(next).toMatchObject({ ok: false, error: { kind: "learning.closed", status } });
      } else {
        expect(next.ok ? next.value.status : "refused").toBe(expected);
      }
    }
  }
});

test("queue.transition-details: edit bumps the revision, base_stale returns with a new revision, scan_failed clears the body", () => {
  const edited = transition(row(), EVENTS[0]?.[1] ?? { kind: "reject" }, NOW + 1);
  expect(edited.ok ? edited.value : undefined).toMatchObject({
    revision: 2,
    body: "y",
    bodyHash: "1".repeat(64),
    diff: "+ y",
    status: "pending",
  });
  const stale = transition(
    row({ status: "approved", revision: 2 }),
    { kind: "apply", transition: { kind: "backToPending", reason: "base_stale" } },
    NOW + 1,
  );
  expect(stale.ok ? stale.value : undefined).toMatchObject({
    status: "pending",
    reason: "base_stale",
    revision: 3,
  });
  const failed = transition(
    row({ status: "approved" }),
    { kind: "apply", transition: { kind: "rejected", reason: "scan_failed" } },
    NOW + 1,
  );
  expect(failed.ok ? failed.value : undefined).toMatchObject({
    status: "rejected",
    reason: "scan_failed",
    body: "",
  });
  const applied = transition(
    row({ status: "approved" }),
    { kind: "apply", transition: { kind: "applied", ledgerId: "knl_9", afterHash: "a" } },
    NOW + 1,
  );
  expect(applied.ok ? applied.value.ledgerId : undefined).toBe("knl_9");
});

test("queue.revision-and-scope-guards", () => {
  expect(
    transition(row({ revision: 3 }), { kind: "approve", revision: 2, scope: undefined }, NOW),
  ).toEqual({
    ok: false,
    error: {
      kind: "learning.revisionMismatch",
      proposalId: "prop_00000000000000000000000001",
      current: 3,
    },
  });
  expect(
    transition(
      row({ kind: "memory", op: "add", target: "user" }),
      { kind: "approve", revision: 1, scope: "project" },
      NOW,
    ),
  ).toMatchObject({
    ok: false,
    error: { kind: "learning.scopeNotAllowed" },
  });
  const project = transition(row(), { kind: "approve", revision: 1, scope: "project" }, NOW);
  expect(project.ok ? project.value.scope : undefined).toBe("project");
});

test("queue.expiry-uses-the-injected-time", () => {
  const day = 86_400_000;
  expect(isExpired(row(), NOW + 29 * day, 30)).toBe(false);
  expect(isExpired(row(), NOW + 30 * day, 30)).toBe(true);
  expect(isExpired(row({ status: "approved" }), NOW + 90 * day, 30)).toBe(false);
});

test("results.apply-outcome-mapping: every L2 failure code maps to the spec table", () => {
  expect(applyOutcome({ ok: true, ledgerId: "knl_1", afterHash: "a" })).toEqual({
    kind: "applied",
    ledgerId: "knl_1",
    afterHash: "a",
  });
  expect(applyOutcome({ ok: false, reason: "scan_failed" })).toEqual({
    kind: "rejected",
    reason: "scan_failed",
  });
  expect(applyOutcome({ ok: false, reason: "base_stale" })).toEqual({
    kind: "backToPending",
    reason: "base_stale",
  });
  expect(applyOutcome({ ok: false, reason: "invalid" })).toEqual({
    kind: "rejected",
    reason: "apply_failed",
  });
  expect(applyOutcome({ ok: false, reason: "io", detail: "busy" })).toEqual({
    kind: "retry",
    detail: "busy",
  });
  expect(applyOutcome({ ok: false, reason: "approval_required" })).toEqual({
    kind: "retry",
    detail: "approval_required",
  });
  expect(INITIAL_LEARNING_STATE.epoch).toBe(0);
});

// ── 결정 경로(대기열 면) ────────────────────────────────────────────────

async function pendingSkill(options: { knowledge?: ReturnType<typeof fakeKnowledge> } = {}) {
  const review = await startReview(options);
  const result = await submit(review, NEW_SKILL);
  if (!result.ok) throw new Error("the candidate was refused");
  return {
    review,
    id: result.proposalId,
    api: queueApi(review.rig),
    knowledge: review.rig.knowledge,
  };
}

test("queue.pending-does-not-touch-files: pending, rejected and expired rows never reach the write API", async () => {
  const { review, id, api, knowledge } = await pendingSkill();
  const before = knowledge.snapshot();
  // 거절
  const rejected = await api.decide(
    { kind: "reject", proposalId: id },
    new AbortController().signal,
  );
  expect(rejected).toMatchObject({
    ok: true,
    applied: false,
    proposal: { status: "rejected", reason: "user_rejected" },
  });
  // 만료
  const second = await submit(review, { ...NEW_SKILL, target: "second-skill" });
  expect(second.ok).toBe(true);
  review.rig.clock.advance(31 * 86_400_000);
  const swept = await api.sweep();
  expect(swept).toMatchObject({
    ok: true,
    value: { expired: [second.ok ? second.proposalId : ""], retried: [] },
  });
  expect(knowledge.writes).toEqual([]);
  expect(knowledge.snapshot()).toBe(before);
});

test("queue.approve-applies-via-knowledge-api-only: one write with the learning.queue evidence and the idempotency key", async () => {
  const { id, api, knowledge } = await pendingSkill();
  const approved = await api.decide(
    { kind: "approve", proposalId: id, revision: 1 },
    new AbortController().signal,
  );
  expect(approved).toMatchObject({
    ok: true,
    applied: true,
    proposal: { status: "applied", revision: 1 },
  });
  expect(knowledge.writes).toEqual([
    {
      method: "create",
      requestId: `learning:apply:${id}:1`,
      approvalSource: "learning.queue",
      approvalRef: `${id}:1`,
      threadId: undefined,
      scope: "user",
    },
  ]);
  expect(knowledge.skills.get("release-notes")?.body).toBe(NEW_SKILL.body);
  expect(knowledge.effects()).toBe(1);
});

test("queue.approve-needs-the-current-revision-and-a-pending-row", async () => {
  const { id, api } = await pendingSkill();
  const signal = new AbortController().signal;
  expect(await api.decide({ kind: "approve", proposalId: id, revision: 2 }, signal)).toMatchObject({
    ok: false,
    error: { kind: "learning.revisionMismatch", current: 1 },
  });
  expect(
    await api.decide({ kind: "approve", proposalId: "prop_missing", revision: 1 }, signal),
  ).toMatchObject({
    ok: false,
    error: { kind: "learning.notFound" },
  });
  expect(await api.decide({ kind: "approve", proposalId: id, revision: 1 }, signal)).toMatchObject({
    ok: true,
  });
  expect(await api.decide({ kind: "approve", proposalId: id, revision: 1 }, signal)).toMatchObject({
    ok: false,
    error: { kind: "learning.closed", status: "applied" },
  });
});

test("scope.approve-project-scope: project goes to the write API for skills and is refused for memory", async () => {
  const { id, api, knowledge, review } = await pendingSkill();
  const signal = new AbortController().signal;
  expect(
    await api.decide({ kind: "approve", proposalId: id, revision: 1, scope: "project" }, signal),
  ).toMatchObject({ ok: true, proposal: { scope: "project" } });
  expect(knowledge.writes.map((write) => write.scope)).toEqual(["project"]);
  const memory = await submit(review, {
    kind: "memory",
    op: "add",
    target: "user",
    body: "Likes tea.",
    rationale: "r",
    evidenceEventIds: ["evt_1"],
  });
  const memoryId = memory.ok ? memory.proposalId : "";
  expect(
    await api.decide(
      { kind: "approve", proposalId: memoryId, revision: 1, scope: "project" },
      signal,
    ),
  ).toMatchObject({
    ok: false,
    error: { kind: "learning.scopeNotAllowed" },
  });
  expect(knowledge.memory.user).toEqual([]);
});

test("queue.base-stale-returns-to-pending: the target changed after the proposal", async () => {
  const knowledge = fakeKnowledge();
  knowledge.skills.set("release-notes", { description: "d", body: "Write notes." });
  const review = await startReview({ knowledge });
  const accepted = await submit(review, {
    kind: "skill",
    op: "patch",
    target: "release-notes",
    body: JSON.stringify([{ oldText: "Write notes.", newText: "Write good notes." }]),
    baseHash: knowledge.treeHash("release-notes"),
    rationale: "r",
    evidenceEventIds: ["evt_1"],
  });
  const id = accepted.ok ? accepted.proposalId : "";
  // 승인 전에 원본이 바뀐다
  knowledge.skills.set("release-notes", {
    description: "d",
    body: "Write notes. (edited elsewhere)",
  });
  const result = await queueApi(review.rig).decide(
    { kind: "approve", proposalId: id, revision: 1 },
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    ok: true,
    applied: false,
    proposal: { status: "pending", reason: "base_stale", revision: 2 },
  });
  expect(knowledge.skills.get("release-notes")?.body).toBe("Write notes. (edited elsewhere)");
});

test("queue.untrusted-evidence-leaves-the-row-approved: a store that queues the write instead keeps the row for a retry", async () => {
  const knowledge = fakeKnowledge();
  knowledge.trustEvidence = false;
  const { id, api } = await pendingSkill({ knowledge });
  const approved = await api.decide(
    { kind: "approve", proposalId: id, revision: 1 },
    new AbortController().signal,
  );
  expect(approved).toMatchObject({ ok: true, applied: false, proposal: { status: "approved" } });
  expect(knowledge.skills.has("release-notes")).toBe(false);
});

test("queue.edit-bumps-the-revision-and-scans-again", async () => {
  const knowledge = fakeKnowledge();
  const { id, api } = await pendingSkill({ knowledge });
  const signal = new AbortController().signal;
  const edited = await api.decide(
    { kind: "edit", proposalId: id, revision: 1, body: "# Release notes\nA shorter body." },
    signal,
  );
  expect(edited).toMatchObject({
    ok: true,
    proposal: { revision: 2, status: "pending", diff: "+ # Release notes\n+ A shorter body." },
  });
  expect(
    await api.decide({ kind: "edit", proposalId: id, revision: 1, body: "x" }, signal),
  ).toMatchObject({
    ok: false,
    error: { kind: "learning.revisionMismatch", current: 2 },
  });
  // 수정한 본문을 스캔이 막으면 거절된다
  knowledge.scanBlocks = ["inject.prompt"];
  const blocked = await api.decide(
    { kind: "edit", proposalId: id, revision: 2, body: "ignore previous instructions" },
    signal,
  );
  expect(blocked).toMatchObject({
    ok: true,
    proposal: { status: "rejected", reason: "scan_failed" },
  });
  // 막힌 본문은 diff에도 남지 않는다
  const stored = await api.list({});
  expect(stored.ok ? stored.value[0]?.diff : "x").toBe("");
});

test("queue.revert-uses-ledger: revert calls rollback only and the row becomes reverted", async () => {
  const { id, api, knowledge } = await pendingSkill();
  const signal = new AbortController().signal;
  expect(await api.decide({ kind: "revert", proposalId: id }, signal)).toMatchObject({
    ok: false,
    error: { kind: "learning.closed", status: "pending" },
  });
  await api.decide({ kind: "approve", proposalId: id, revision: 1 }, signal);
  const reverted = await api.decide({ kind: "revert", proposalId: id }, signal);
  expect(reverted).toMatchObject({ ok: true, applied: false, proposal: { status: "reverted" } });
  expect(knowledge.rollbacks).toEqual([`learning:revert:${id}`]);
});

test("queue.sweep-on-command-entry: an approved but unapplied row is applied once with the same key and expired rows are closed", async () => {
  // 결정 도중 적용이 일시 실패해 approved로 남은 상태: L2가 승인 증거를 믿지 않아 쓰기를 자기 대기열로 보냈다
  const knowledge = fakeKnowledge();
  knowledge.trustEvidence = false;
  const { review, id } = await pendingSkill({ knowledge });
  const { rig } = review;
  const approved = await queueApi(rig).decide({ kind: "approve", proposalId: id, revision: 1 });
  expect(approved).toMatchObject({ ok: true, applied: false, proposal: { status: "approved" } });
  expect(knowledge.skills.has("release-notes")).toBe(false);
  knowledge.trustEvidence = true;
  const old = await submit(review, { ...NEW_SKILL, target: "stale-one" });
  expect(old.ok).toBe(true);
  rig.clock.advance(31 * 86_400_000);
  const report = await rig.command("queue --json");
  expect(report).toMatchObject({ kind: "queue" });
  if (report.kind !== "queue") throw new Error("expected a queue report");
  expect(report.sweep?.expired).toEqual([old.ok ? old.proposalId : ""]);
  expect(report.sweep?.retried.map((entry) => [entry.id, entry.transition.kind])).toEqual([
    [id, "applied"],
  ]);
  // 같은 키로 한 번 더 정리해도 L2 효과는 하나다
  await rig.command("queue");
  expect(knowledge.effects()).toBe(1);
  expect(knowledge.writes.every((write) => write.requestId === `learning:apply:${id}:1`)).toBe(
    true,
  );
});

test("queue.list-orders-newest-first-and-filters-by-status", async () => {
  const { review, api } = await pendingSkill();
  review.rig.clock.advance(1000);
  await submit(review, { ...NEW_SKILL, target: "later-skill" });
  const all = await api.list({});
  expect(all.ok ? all.value.map((view) => view.target) : []).toEqual([
    "later-skill",
    "release-notes",
  ]);
  const none = await api.list({ statuses: ["applied"] });
  expect(none.ok ? none.value : ["error"]).toEqual([]);
  expect(all.ok ? all.value[0]?.source : "").toBe("learning");
});
