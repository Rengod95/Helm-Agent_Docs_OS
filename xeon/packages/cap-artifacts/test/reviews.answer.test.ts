import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { ApprovalId, TurnId } from "@xeon/contracts/conversation";
import { createAnswerHandler } from "../src/reviews/answer.ts";
import { hunkStates } from "./support/assert.ts";
import { A_AFTER_EDIT, ONE_FILE_THREE_HUNKS } from "./support/fixtures.ts";
import { openReviews, type ReviewsHarness } from "./support/harness.ts";

// 저장소를 여는 시험은 첫 실행에서 기본 5초를 넘긴 적이 있어 시간 상한을 넓힌다.
setDefaultTimeout(20_000);

// 검토 승인(kind review)의 답이 리뷰에 반영되는 경로(answer.ts 머리 주석의 의미 규칙).

let opened: ReviewsHarness | undefined;

async function harness(files?: Readonly<Record<string, string>>): Promise<ReviewsHarness> {
  opened = await openReviews(files);
  return opened;
}

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

/** ONE_FILE_THREE_HUNKS를 턴 안에서 열고, 열면서 낸 검토 승인 요청 하나의 approvalId를 돌려준다 */
async function openForAnswer(
  h: ReviewsHarness,
): Promise<{ reviewId: string; approvalId: ApprovalId }> {
  const turn: TurnId = h.ids.next("trn");
  const view = await h.api.open(
    { changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } },
    h.opts(undefined, turn),
  );
  const [first] = h.approvals.snapshots;
  if (first === undefined) throw new Bug("the test expected a review approval request");
  return { reviewId: view.reviewId, approvalId: first.approvalId };
}

const hunkDecision = (hunkId: string, decision: "approved" | "rejected" | "pending") => ({
  hunkId,
  decision,
});

const approveAll = {
  decisions: [
    hunkDecision("f0h0", "approved"),
    hunkDecision("f0h1", "approved"),
    hunkDecision("f0h2", "approved"),
  ],
  comments: [],
  submit: true,
};

const rejectAll = {
  decisions: [
    hunkDecision("f0h0", "rejected"),
    hunkDecision("f0h1", "rejected"),
    hunkDecision("f0h2", "rejected"),
  ],
  comments: [],
  submit: true,
};

describe("answer to the review approval", () => {
  test("all approved and submit: the review is submitted at round 1 with nothing reverted and nothing posted", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { reviewId, approvalId } = await openForAnswer(h);

    await answers.onApprovalResolved(h.resolvedEvent(approvalId, "answer", approveAll));

    const view = await h.api.get({ reviewId }, h.opts());
    expect([view.status, view.round]).toEqual(["submitted", 1]);
    expect(hunkStates(view).map((state) => state.slice(1))).toEqual([
      ["approved", "none"],
      ["approved", "none"],
      ["approved", "none"],
    ]);
    expect(h.files.calls).toEqual([]);
    expect(h.queue.attempts).toEqual([]);
    expect(await h.events("artifact.review_applied")).toEqual([]);
    expect((await h.events("artifact.review_submitted")).map((event) => event.payload)).toEqual([
      { reviewId, round: 1, delivery: null },
    ]);
  });

  test("all rejected and submit: every hunk is reverted newest first and the delivery lists them", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { reviewId, approvalId } = await openForAnswer(h);

    await answers.onApprovalResolved(h.resolvedEvent(approvalId, "answer", rejectAll));

    expect(h.files.calls.map((call) => [call.oldText, call.newText])).toEqual([
      ["const z = 30;\n", "const z = 3;\n"],
      ["const y = 20;\n", "const y = 2;\n"],
      ["const x = 10;\n", "const x = 1;\n"],
    ]);
    expect(h.files.contents.get("src/a.ts")).toBe("const x = 1;\nconst y = 2;\nconst z = 3;\n");
    const view = await h.api.get({ reviewId }, h.opts());
    expect([view.status, view.round]).toEqual(["submitted", 1]);
    expect(hunkStates(view).map((state) => state.slice(1))).toEqual([
      ["rejected", "reverted"],
      ["rejected", "reverted"],
      ["rejected", "reverted"],
    ]);
    expect(h.queue.posts.map((post) => post.item)).toEqual([
      {
        kind: "user",
        content: `[review ${reviewId} round 1]\n거절하고 되돌림: src/a.ts f0h0, f0h1, f0h2`,
      },
    ]);
  });

  test("submit false with a review-level comment: decision and comment are recorded, the review stays open and a new approval is asked", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { reviewId, approvalId } = await openForAnswer(h);

    await answers.onApprovalResolved(
      h.resolvedEvent(approvalId, "answer", {
        // 모든 hunk를 정해 둔다: 제출이 막히지 않으니 submit을 잘못 따르면 되돌림과 전달이 드러난다
        decisions: [
          hunkDecision("f0h0", "approved"),
          hunkDecision("f0h1", "rejected"),
          hunkDecision("f0h2", "approved"),
        ],
        comments: [{ target: { type: "review" }, body: "check the tests" }],
        submit: false,
      }),
    );

    expect((await h.events("artifact.review_decided")).map((event) => event.payload)).toEqual([
      {
        reviewId,
        round: 1,
        decisions: [
          { hunkId: "f0h0", decision: "approved" },
          { hunkId: "f0h1", decision: "rejected" },
          { hunkId: "f0h2", decision: "approved" },
        ],
        by: "user",
      },
    ]);
    expect((await h.events("artifact.review_commented")).map((event) => event.payload)).toEqual([
      {
        reviewId,
        round: 1,
        commentId: expect.any(String),
        target: { type: "review" },
        body: "check the tests",
        by: "user",
      },
    ]);
    const view = await h.api.get({ reviewId }, h.opts());
    expect([view.status, view.round]).toEqual(["open", 1]);
    // 해결된 승인을 대신해 같은 라운드의 새 승인 요청이 하나 더 나간다
    expect(h.approvals.requests.map((request) => request.kind)).toEqual(["review", "review"]);
    expect(new Set(h.approvals.requests.map((request) => request.requestId)).size).toBe(2);
    expect(await h.events("artifact.review_submitted")).toEqual([]);
    expect(h.files.calls).toEqual([]);
    expect(h.queue.attempts).toEqual([]);
  });

  test("submit true while hunks are pending and approveRemaining is not set: nothing is submitted and a new approval is asked", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { reviewId, approvalId } = await openForAnswer(h);

    await answers.onApprovalResolved(
      h.resolvedEvent(approvalId, "answer", {
        decisions: [hunkDecision("f0h0", "approved")],
        comments: [],
        submit: true,
      }),
    );

    const view = await h.api.get({ reviewId }, h.opts());
    expect([view.status, view.round]).toEqual(["open", 1]);
    expect(hunkStates(view)).toEqual([
      ["f0h0", "approved", "none"],
      ["f0h1", "pending", "none"],
      ["f0h2", "pending", "none"],
    ]);
    expect(h.approvals.requests).toHaveLength(2);
    expect(await h.events("artifact.review_submitted")).toEqual([]);
    expect(h.files.calls).toEqual([]);
    expect(h.queue.attempts).toEqual([]);
  });

  test("deny with feedback rejects every revertible hunk, reverts them and delivers the feedback as a review-level comment", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { reviewId, approvalId } = await openForAnswer(h);

    await answers.onApprovalResolved(
      h.resolvedEvent(approvalId, "deny", { feedback: "too risky" }),
    );

    const view = await h.api.get({ reviewId }, h.opts());
    expect([view.status, view.round]).toEqual(["submitted", 1]);
    expect(hunkStates(view).map((state) => state.slice(1))).toEqual([
      ["rejected", "reverted"],
      ["rejected", "reverted"],
      ["rejected", "reverted"],
    ]);
    expect(h.files.calls).toHaveLength(3);
    expect((await h.events("artifact.review_commented")).map((event) => event.payload)).toEqual([
      {
        reviewId,
        round: 1,
        commentId: expect.any(String),
        target: { type: "review" },
        body: "too risky",
        by: "user",
      },
    ]);
    expect(h.queue.posts.map((post) => post.item)).toEqual([
      {
        kind: "user",
        content: `[review ${reviewId} round 1]\n거절하고 되돌림: src/a.ts f0h0, f0h1, f0h2\n\n코멘트:\n- 리뷰 전체: too risky`,
      },
    ]);
  });

  test.each(["noninteractive", "cancelled", "superseded", "expired"] as const)(
    "a %s resolution does not touch the review and asks nothing new",
    async (resolvedBy) => {
      const h = await harness({ "src/a.ts": A_AFTER_EDIT });
      const answers = createAnswerHandler(h.runtime, undefined);
      const { reviewId, approvalId } = await openForAnswer(h);
      const before = await h.events();

      await answers.onApprovalResolved(
        h.resolvedEvent(approvalId, "answer", rejectAll, resolvedBy),
      );

      expect(await h.events()).toEqual(before);
      const view = await h.api.get({ reviewId }, h.opts());
      expect([view.status, view.round]).toEqual(["open", 1]);
      expect(hunkStates(view).map((state) => state.slice(1))).toEqual([
        ["pending", "none"],
        ["pending", "none"],
        ["pending", "none"],
      ]);
      expect(h.files.calls).toEqual([]);
      expect(h.approvals.requests).toHaveLength(1);
    },
  );

  test("hunk ids that do not exist are dropped with a warning and the rest of the answer applies", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { reviewId, approvalId } = await openForAnswer(h);

    await answers.onApprovalResolved(
      h.resolvedEvent(approvalId, "answer", {
        decisions: [hunkDecision("f0h0", "approved"), hunkDecision("f7h7", "rejected")],
        comments: [
          { target: { type: "hunk", hunkId: "f9h9" }, body: "stale" },
          { target: { type: "review" }, body: "ok" },
        ],
        submit: false,
      }),
    );

    expect((await h.events("artifact.review_decided")).map((event) => event.payload)).toEqual([
      {
        reviewId,
        round: 1,
        decisions: [{ hunkId: "f0h0", decision: "approved" }],
        by: "user",
      },
    ]);
    expect((await h.events("artifact.review_commented")).map((event) => event.payload)).toEqual([
      expect.objectContaining({ target: { type: "review" }, body: "ok" }),
    ]);
    expect(h.logs.filter((line) => line.event === "artifacts.review_answer_dropped")).toEqual([
      {
        level: "warn",
        event: "artifacts.review_answer_dropped",
        fields: { reviewId, decisions: 1, comments: 1 },
      },
    ]);
  });

  test("running the same resolved event twice does not post or revert twice", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { approvalId } = await openForAnswer(h);
    const event = h.resolvedEvent(approvalId, "answer", rejectAll);

    await answers.onApprovalResolved(event);
    const afterFirst = await h.events();
    await answers.onApprovalResolved(event);

    expect(await h.events()).toEqual(afterFirst);
    expect(h.files.calls).toHaveLength(3);
    expect(h.queue.attempts).toHaveLength(1);
    expect(h.queue.posts).toHaveLength(1);
  });

  test("running the same submit:false event twice asks for the next decision once", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const answers = createAnswerHandler(h.runtime, undefined);
    const { reviewId, approvalId } = await openForAnswer(h);
    const event = h.resolvedEvent(approvalId, "answer", {
      decisions: [hunkDecision("f0h0", "approved")],
      comments: [],
      submit: false,
    });

    await answers.onApprovalResolved(event);
    await answers.onApprovalResolved(event);

    expect((await h.events("artifact.review_decided")).length).toBe(1);
    expect(h.approvals.requests).toHaveLength(2);
    const view = await h.api.get({ reviewId }, h.opts());
    expect([view.status, view.round]).toEqual(["open", 1]);
  });
});
