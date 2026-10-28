import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { ApprovalResolvedPayloadSchema } from "@xeon/contracts/records";
import type { ApprovalBody, ApprovalRequestInput } from "@xeon/contracts/services";
import { createHarness, expectOk, until, type Harness } from "./support/harness.ts";

// M3-REQ-74(M3-09, ADR-0018): 승인 kind review를 요청·대기·응답·기록까지 받는다.

const REVIEW: ApprovalBody = {
  kind: "review",
  review: {
    reviewId: "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    title: "refactor",
    round: 1,
    files: [{ path: "a.ts", change: "modified", binary: false, hunks: 2 }],
  },
};

const ANSWER = {
  decisions: [
    { hunkId: "f0h0", decision: "approved" },
    { hunkId: "f0h1", decision: "rejected" },
  ],
  comments: [{ target: { type: "file", path: "a.ts" }, body: "rename this" }],
  submit: true,
};

function input(
  h: Harness,
  body: ApprovalBody = REVIEW,
  key: string = "rvw-1",
): ApprovalRequestInput {
  return {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: key,
    title: "Review the changes",
    body,
    remember: ["once"],
  };
}

test("a review approval round trip: request, wait, answer, and the resolution keeps the answer", async () => {
  const h = await createHarness();
  const opened = expectOk(await h.runtime.approvals.open(input(h)));
  const approvalId = opened.request.approvalId;
  const waiting = h.runtime.approvals.wait(approvalId, new AbortController().signal);
  expect(h.runtime.approvals.pending(h.thread).map((request) => request.body)).toEqual([REVIEW]);

  const applied = await h.runtime.approvals.respond(approvalId, {
    decision: "answer",
    answer: ANSWER,
  });
  expect(applied).toEqual({ applied: true });
  const waited = await waiting;
  expect(waited.ok && waited.value).toEqual({
    approvalId,
    decision: "answer",
    answer: ANSWER,
    remember: "once",
    requestedRemember: null,
    resolvedBy: "user",
  });
  const event = h.session.events.find((candidate) => candidate.kind === "approval.resolved");
  const stored = parse(ApprovalResolvedPayloadSchema, event?.payload);
  expect(stored.ok && stored.value.answer).toEqual(ANSWER);
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
});

test("a blocking review request resolves through request() when the answer arrives", async () => {
  const h = await createHarness();
  const waiting = h.runtime.approvals.request(input(h), new AbortController().signal);
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "deny",
    answer: { feedback: "not now" },
  });
  const resolution = expectOk(await waiting);
  expect(resolution).toMatchObject({
    decision: "deny",
    answer: { feedback: "not now" },
    resolvedBy: "user",
  });
});

test("a review answer must be a ReviewAnswer: allow, a malformed answer and thread memory are not applied", async () => {
  const h = await createHarness();
  const opened = expectOk(await h.runtime.approvals.open(input(h)));
  const id = opened.request.approvalId;
  expect(await h.runtime.approvals.respond(id, { decision: "allow" })).toMatchObject({
    applied: false,
    reason: "answer_invalid",
  });
  const missingSubmit = await h.runtime.approvals.respond(id, {
    decision: "answer",
    answer: { decisions: [], comments: [] },
  });
  expect(missingSubmit).toMatchObject({ applied: false, reason: "answer_invalid" });
  expect(
    await h.runtime.approvals.respond(id, {
      decision: "answer",
      answer: ANSWER,
      remember: "thread",
    }),
  ).toMatchObject({ applied: false, reason: "answer_invalid" });
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  expect(await h.runtime.approvals.respond(id, { decision: "answer", answer: ANSWER })).toEqual({
    applied: true,
  });
});

test("a review request is validated before it is written: round 0 and repeated paths are rejected", async () => {
  const h = await createHarness();
  const bad = [
    { ...REVIEW, review: { ...REVIEW.review, round: 0 } },
    {
      ...REVIEW,
      review: {
        ...REVIEW.review,
        files: [
          { path: "a.ts", change: "added", binary: false, hunks: 1 },
          { path: "a.ts", change: "deleted", binary: false, hunks: 1 },
        ],
      },
    },
  ] as const;
  const outs = await Promise.all(
    bad.map((body, index) => h.runtime.approvals.open(input(h, body, `bad-${index}`))),
  );
  for (const out of outs) {
    expect(out.ok ? null : out.error).toMatchObject({
      kind: "rejected",
      code: "approvals.request_invalid",
    });
  }
  expect(h.session.events).toEqual([]);
  const memory = await h.runtime.approvals.open({ ...input(h), remember: ["once", "thread"] });
  expect(memory.ok).toBe(false);
});

test("restore brings back an unresolved review request with its body", async () => {
  const h = await createHarness();
  expectOk(await h.runtime.approvals.open(input(h)));
  const restored = expectOk(await h.runtime.approvals.restore(h.thread));
  expect(restored.map((request) => request.body)).toEqual([REVIEW]);
});
