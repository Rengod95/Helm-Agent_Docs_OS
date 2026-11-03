import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { EventIdSchema } from "@fresnel/contracts/conversation";
import { ApprovalRequestedPayloadSchema, ReviewAnswerSchema } from "@fresnel/contracts/records";
import {
  APPROVE_ALL_ANSWER,
  EMPTY_REVIEW_DRAFT,
  INITIAL_REVIEW_STATE,
  currentReviewOf,
  diffRowsOf,
  foldedHunksOf,
  addReviewComment,
  hunkDecisionOf,
  removeReviewComment,
  reviewAnswerOf,
  reviewReducer,
  setHunkDecision,
  submitBlockOf,
  tallyOf,
  toggleFileDecision,
  toggleHunkDecision,
  type ReviewCandidate,
  type ReviewDraft,
} from "../../src/views/review-model.ts";
import { thr } from "../state/helpers.ts";

// 변경 검토 화면의 순수 값(V-06)을 값으로 비교한다. 답의 모양은 ReviewAnswerSchema로도 검사한다.

const evt = (n: number) => {
  const parsed = parse(EventIdSchema, `evt_${String(n).padStart(26, "0")}`);
  if (!parsed.ok) throw new Error("test event id must parse");
  return parsed.value;
};

const candidate = (approval: number, reviewId: string, round: number): ReviewCandidate => {
  const request = parse(ApprovalRequestedPayloadSchema, {
    origin: { threadId: thr(1), turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: `review-${approval}`,
    title: "Review",
    body: {
      kind: "review",
      review: {
        reviewId,
        artifactId: "art_01ABCDEFGHJKMNPQRSTVWXYZ00",
        title: "Cache",
        round,
        files: [],
      },
    },
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 0,
  });
  if (!request.ok) throw new Error("the test review approval must be valid");
  return { approvalId: evt(approval), request: request.value };
};

const HUNKS = ["f0h0", "f0h1", "f1h0"] as const;

describe("hunk decisions", () => {
  test("a hunk is pending until chosen, and choosing pending clears the decision", () => {
    const draft = setHunkDecision(EMPTY_REVIEW_DRAFT, "f0h0", "approved");
    expect(hunkDecisionOf(EMPTY_REVIEW_DRAFT, "f0h0")).toBe("pending");
    expect(hunkDecisionOf(draft, "f0h0")).toBe("approved");
    expect(hunkDecisionOf(setHunkDecision(draft, "f0h0", "pending"), "f0h0")).toBe("pending");
    expect(setHunkDecision(draft, "f0h0", "pending").decisions).toEqual({});
  });

  test("the button toggles: the same decision again goes back to pending, another one replaces it", () => {
    const approved = toggleHunkDecision(EMPTY_REVIEW_DRAFT, "f0h1", "approved");
    expect(hunkDecisionOf(approved, "f0h1")).toBe("approved");
    expect(hunkDecisionOf(toggleHunkDecision(approved, "f0h1", "approved"), "f0h1")).toBe(
      "pending",
    );
    expect(hunkDecisionOf(toggleHunkDecision(approved, "f0h1", "rejected"), "f0h1")).toBe(
      "rejected",
    );
  });

  test("a file decision sets every hunk of the file, and a second press on an all-same file clears it", () => {
    const first = toggleFileDecision(EMPTY_REVIEW_DRAFT, ["f0h0", "f0h1"], "rejected");
    expect(first.decisions).toEqual({ f0h0: "rejected", f0h1: "rejected" });
    const mixed = toggleHunkDecision(first, "f0h1", "approved");
    const again = toggleFileDecision(mixed, ["f0h0", "f0h1"], "rejected");
    expect(again.decisions).toEqual({ f0h0: "rejected", f0h1: "rejected" });
    expect(toggleFileDecision(again, ["f0h0", "f0h1"], "rejected").decisions).toEqual({});
  });
});

describe("review comments", () => {
  test("a comment is trimmed, keyed in order, and an empty one is not added", () => {
    const one = addReviewComment(EMPTY_REVIEW_DRAFT, "f0h0", "  ms 단위 주석 필요  ");
    expect(one.comments).toEqual([{ key: "c1", hunkId: "f0h0", body: "ms 단위 주석 필요" }]);
    expect(one.nextKey).toBe(2);
    expect(addReviewComment(one, "f0h1", "   ")).toBe(one);
  });

  test("keys stay unique after a removal, because the counter only grows", () => {
    const two = addReviewComment(
      addReviewComment(EMPTY_REVIEW_DRAFT, "f0h0", "first"),
      "f0h1",
      "second",
    );
    const removed = removeReviewComment(two, "c1");
    const next = addReviewComment(removed, "f0h0", "third");
    expect(next.comments.map((comment) => comment.key)).toEqual(["c2", "c3"]);
  });
});

describe("tally and the submit gate", () => {
  test("the tally counts approved, rejected, pending and total", () => {
    const draft = toggleHunkDecision(
      toggleHunkDecision(EMPTY_REVIEW_DRAFT, "f0h0", "approved"),
      "f1h0",
      "rejected",
    );
    expect(tallyOf(HUNKS, draft)).toEqual({ approved: 1, rejected: 1, pending: 1, total: 3 });
    expect(tallyOf([], draft)).toEqual({ approved: 0, rejected: 0, pending: 0, total: 0 });
  });

  test("submit is blocked by offline first, then busy, then pending hunks unless approve-remaining is on", () => {
    const tally = tallyOf(HUNKS, EMPTY_REVIEW_DRAFT);
    expect(submitBlockOf({ tally, approveRemaining: false, live: false, busy: true })).toBe(
      "offline",
    );
    expect(submitBlockOf({ tally, approveRemaining: false, live: true, busy: true })).toBe("busy");
    expect(submitBlockOf({ tally, approveRemaining: false, live: true, busy: false })).toBe(
      "pending",
    );
    expect(submitBlockOf({ tally, approveRemaining: true, live: true, busy: false })).toBeNull();
    const empty = tallyOf([], EMPTY_REVIEW_DRAFT);
    expect(
      submitBlockOf({ tally: empty, approveRemaining: false, live: true, busy: false }),
    ).toBeNull();
  });
});

describe("the ReviewAnswer", () => {
  test("mixed decisions and comments build the exact answer, pending hunks left out, in review order", () => {
    const draft: ReviewDraft = addReviewComment(
      addReviewComment(
        toggleHunkDecision(
          toggleHunkDecision(EMPTY_REVIEW_DRAFT, "f1h0", "rejected"),
          "f0h0",
          "approved",
        ),
        "f0h1",
        "ms 단위 주석 필요",
      ),
      "f1h0",
      "log를 debug로 바꾸지 마세요",
    );
    const answer = reviewAnswerOf(HUNKS, draft);
    expect(answer).toEqual({
      decisions: [
        { hunkId: "f0h0", decision: "approved" },
        { hunkId: "f1h0", decision: "rejected" },
      ],
      comments: [
        { target: { type: "hunk", hunkId: "f0h1" }, body: "ms 단위 주석 필요" },
        { target: { type: "hunk", hunkId: "f1h0" }, body: "log를 debug로 바꾸지 마세요" },
      ],
      submit: true,
      approveRemaining: false,
    });
    expect(parse(ReviewAnswerSchema, answer).ok).toBe(true);
  });

  test("comments on a hunk that is not in this review are left out", () => {
    const draft = addReviewComment(EMPTY_REVIEW_DRAFT, "f9h9", "gone");
    expect(reviewAnswerOf(HUNKS, draft).comments).toEqual([]);
  });

  test("approve-remaining travels in the answer, and approve-all is the fixed answer", () => {
    const draft = { ...EMPTY_REVIEW_DRAFT, approveRemaining: true };
    expect(reviewAnswerOf([], draft)).toEqual({
      decisions: [],
      comments: [],
      submit: true,
      approveRemaining: true,
    });
    expect(APPROVE_ALL_ANSWER).toEqual({
      decisions: [],
      comments: [],
      submit: true,
      approveRemaining: true,
    });
    expect(parse(ReviewAnswerSchema, APPROVE_ALL_ANSWER).ok).toBe(true);
  });
});

describe("folding and diff rows", () => {
  test("a file with more than 30 hunks shows 30 until it is expanded", () => {
    const hunks = Array.from({ length: 32 }, (_, index) => index);
    expect(foldedHunksOf(hunks, false)).toEqual({ shown: hunks.slice(0, 30), hidden: 2 });
    expect(foldedHunksOf(hunks, true)).toEqual({ shown: hunks, hidden: 0 });
    expect(foldedHunksOf([1, 2], false)).toEqual({ shown: [1, 2], hidden: 0 });
  });

  test("removed lines count the old file, added and context lines count the new file", () => {
    const rows = diffRowsOf({
      oldStart: 10,
      newStart: 10,
      lines: [
        { kind: "context", text: "a" },
        { kind: "del", text: "b" },
        { kind: "add", text: "c" },
        { kind: "add", text: "d" },
        { kind: "context", text: "e" },
      ],
    });
    expect(rows).toEqual([
      { kind: "context", number: 10, text: "a" },
      { kind: "remove", number: 11, text: "b" },
      { kind: "add", number: 11, text: "c" },
      { kind: "add", number: 12, text: "d" },
      { kind: "context", number: 13, text: "e" },
    ]);
  });
});

describe("the round the screen follows", () => {
  const REVIEW_ID = "rvw_01ABCDEFGHJKMNPQRSTVWXYZ00";
  const OTHER_ID = "rvw_01ABCDEFGHJKMNPQRSTVWXYZ01";
  test("the approval the screen opened is shown while it is pending", () => {
    const pending = [candidate(1, REVIEW_ID, 1), candidate(2, REVIEW_ID, 2)];
    const shown = currentReviewOf({ approvalId: evt(1), reviewId: REVIEW_ID }, pending);
    expect(shown?.approvalId).toBe(evt(1));
    expect(shown?.review.round).toBe(1);
  });

  test("once it is resolved, the next round of the same review is followed, and nothing else is", () => {
    const pending = [
      candidate(3, OTHER_ID, 5),
      candidate(4, REVIEW_ID, 2),
      candidate(5, REVIEW_ID, 3),
    ];
    const shown = currentReviewOf({ approvalId: evt(1), reviewId: REVIEW_ID }, pending);
    expect(shown?.approvalId).toBe(evt(5));
    expect(shown?.review.round).toBe(3);
  });

  test("with no pending approval of the review, the target is gone (already handled)", () => {
    expect(currentReviewOf({ approvalId: evt(1), reviewId: REVIEW_ID }, [])).toBeNull();
    expect(
      currentReviewOf({ approvalId: evt(1), reviewId: REVIEW_ID }, [candidate(3, OTHER_ID, 1)]),
    ).toBeNull();
  });
});

describe("the review reducer", () => {
  test("selecting a file closes a comment being written, and expanding a file is recorded once", () => {
    const composing = reviewReducer(INITIAL_REVIEW_STATE, {
      type: "composeOpened",
      hunkId: "f0h0",
    });
    const selected = reviewReducer(composing, { type: "fileSelected", path: "src/cache.ts" });
    expect(selected.composing).toBeNull();
    expect(selected.selectedPath).toBe("src/cache.ts");
    const expanded = reviewReducer(
      reviewReducer(selected, { type: "fileExpanded", path: "a.ts" }),
      {
        type: "fileExpanded",
        path: "a.ts",
      },
    );
    expect(expanded.expanded).toEqual(["a.ts"]);
  });

  test("a comment is saved and closes the composer; an empty one keeps it open", () => {
    let state = reviewReducer(INITIAL_REVIEW_STATE, { type: "composeOpened", hunkId: "f0h1" });
    state = reviewReducer(state, { type: "composeChanged", text: "   " });
    const kept = reviewReducer(state, { type: "commentAdded", hunkId: "f0h1", text: "   " });
    expect(kept.composing).toEqual({ hunkId: "f0h1", text: "   " });
    expect(kept.draft.comments).toEqual([]);
    const saved = reviewReducer(state, { type: "commentAdded", hunkId: "f0h1", text: "주석 필요" });
    expect(saved.composing).toBeNull();
    expect(saved.draft.comments).toEqual([{ key: "c1", hunkId: "f0h1", body: "주석 필요" }]);
    expect(reviewReducer(saved, { type: "commentRemoved", key: "c1" }).draft.comments).toEqual([]);
  });

  test("hunk, file and approve-remaining actions update the draft", () => {
    let state = reviewReducer(INITIAL_REVIEW_STATE, {
      type: "fileDecided",
      hunkIds: ["f0h0", "f0h1"],
      decision: "approved",
    });
    state = reviewReducer(state, { type: "hunkDecided", hunkId: "f0h1", decision: "rejected" });
    state = reviewReducer(state, { type: "approveRemainingChanged", on: true });
    expect(state.draft).toEqual({
      decisions: { f0h0: "approved", f0h1: "rejected" },
      comments: [],
      approveRemaining: true,
      nextKey: 1,
    });
  });
});
