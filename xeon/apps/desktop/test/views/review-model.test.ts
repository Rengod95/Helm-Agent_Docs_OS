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
  lineOfRow,
  removeReviewComment,
  reviewAnswerOf,
  reviewKeyContextOf,
  reviewKeyOf,
  reviewReducer,
  reviewResultRowsOf,
  reviewResultViewOf,
  setHunkDecision,
  shownHunkIdsOf,
  submitBlockOf,
  submitOpenOf,
  tallyOf,
  toggleFileDecision,
  toggleHunkDecision,
  type ReviewCandidate,
  type ReviewDraft,
  type ReviewFile,
  type ReviewKeyContext,
  type ReviewKeyEvent,
  type ReviewKeyFile,
  type ReviewState,
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
    expect(one.comments).toEqual([
      { key: "c1", hunkId: "f0h0", line: null, body: "ms 단위 주석 필요" },
    ]);
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
  test("moving the focus closes a comment only when the file changes, and records the focused hunk", () => {
    const onFile = reviewReducer(INITIAL_REVIEW_STATE, {
      type: "focusMoved",
      path: "src/cache.ts",
      hunkId: "f0h0",
    });
    const composing = reviewReducer(onFile, {
      type: "composeOpened",
      hunkId: "f0h0",
      line: null,
    });
    const same = reviewReducer(composing, {
      type: "focusMoved",
      path: "src/cache.ts",
      hunkId: "f0h1",
    });
    expect(same.composing).toEqual({ hunkId: "f0h0", line: null, text: "" });
    expect(same.focusedHunkId).toBe("f0h1");
    const moved = reviewReducer(same, {
      type: "focusMoved",
      path: "docs/cache.md",
      hunkId: "f1h0",
    });
    expect(moved.composing).toBeNull();
    expect(moved.selectedPath).toBe("docs/cache.md");
    expect(moved.focusedHunkId).toBe("f1h0");
    const expanded = reviewReducer(reviewReducer(moved, { type: "fileExpanded", path: "a.ts" }), {
      type: "fileExpanded",
      path: "a.ts",
    });
    expect(expanded.expanded).toEqual(["a.ts"]);
  });

  test("a decision and an opening comment both move the focus to their hunk", () => {
    const decided = reviewReducer(INITIAL_REVIEW_STATE, {
      type: "hunkDecided",
      hunkId: "f0h1",
      decision: "rejected",
    });
    expect(decided.focusedHunkId).toBe("f0h1");
    expect(decided.draft.decisions).toEqual({ f0h1: "rejected" });
    const opened = reviewReducer(decided, {
      type: "composeOpened",
      hunkId: "f0h0",
      line: { side: "new", number: 11 },
    });
    expect(opened.focusedHunkId).toBe("f0h0");
    expect(opened.composing).toEqual({
      hunkId: "f0h0",
      line: { side: "new", number: 11 },
      text: "",
    });
  });

  test("a comment saved from a line composer carries its line into the draft", () => {
    let state = reviewReducer(INITIAL_REVIEW_STATE, {
      type: "composeOpened",
      hunkId: "f0h1",
      line: { side: "old", number: 40 },
    });
    state = reviewReducer(state, { type: "composeChanged", text: "지운 줄 확인" });
    state = reviewReducer(state, {
      type: "commentAdded",
      hunkId: "f0h1",
      line: { side: "old", number: 40 },
      text: "지운 줄 확인",
    });
    expect(state.composing).toBeNull();
    expect(state.draft.comments).toEqual([
      { key: "c1", hunkId: "f0h1", line: { side: "old", number: 40 }, body: "지운 줄 확인" },
    ]);
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

describe("line comments", () => {
  test("the line of a row: a removed line counts the old file, the others the new file", () => {
    const rows = diffRowsOf({
      oldStart: 10,
      newStart: 10,
      lines: [
        { kind: "context", text: "a" },
        { kind: "del", text: "b" },
        { kind: "add", text: "c" },
      ],
    });
    expect(rows.map(lineOfRow)).toEqual([
      { side: "new", number: 10 },
      { side: "old", number: 11 },
      { side: "new", number: 11 },
    ]);
  });

  test("a line comment reaches the answer with its line, and the answer still parses", () => {
    const draft = addReviewComment(EMPTY_REVIEW_DRAFT, "f0h1", "ms 단위 주석 필요", {
      side: "new",
      number: 42,
    });
    const answer = reviewAnswerOf(HUNKS, draft);
    expect(answer.comments).toEqual([
      {
        target: { type: "hunk", hunkId: "f0h1", line: { side: "new", number: 42 } },
        body: "ms 단위 주석 필요",
      },
    ]);
    expect(parse(ReviewAnswerSchema, answer).ok).toBe(true);
  });
});

describe("submit gate for the key", () => {
  const tally = tallyOf(HUNKS, EMPTY_REVIEW_DRAFT);
  test("the key gate is the same rule as the submit button", () => {
    expect(submitOpenOf(HUNKS, EMPTY_REVIEW_DRAFT, { live: true, busy: false })).toBe(false);
    expect(
      submitOpenOf(
        HUNKS,
        { ...EMPTY_REVIEW_DRAFT, approveRemaining: true },
        { live: true, busy: false },
      ),
    ).toBe(true);
    expect(
      submitOpenOf(
        HUNKS,
        { ...EMPTY_REVIEW_DRAFT, approveRemaining: true },
        { live: true, busy: true },
      ),
    ).toBe(false);
    expect(submitBlockOf({ tally, approveRemaining: true, live: true, busy: false })).toBeNull();
  });
});

// 키 판정은 값만 받는다. 보이는 파일 세 개: 두 hunk, 한 hunk, 바뀐 hunk가 없는 이미지.
const KEY_FILES: readonly ReviewKeyFile[] = [
  { path: "a.ts", hunkIds: ["f0h0", "f0h1"], shownHunkIds: ["f0h0", "f0h1"] },
  { path: "b.ts", hunkIds: ["f1h0"], shownHunkIds: ["f1h0"] },
  { path: "img.png", hunkIds: [], shownHunkIds: [] },
];
const KEY_CONTEXT: ReviewKeyContext = {
  files: KEY_FILES,
  selectedPath: "a.ts",
  focusedHunkId: "f0h0",
  composingHunkId: null,
  editable: true,
  submitOpen: true,
};
const ctx = (overrides: Partial<ReviewKeyContext>): ReviewKeyContext => ({
  ...KEY_CONTEXT,
  ...overrides,
});
const ev = (key: string, mods: Partial<Omit<ReviewKeyEvent, "key">> = {}): ReviewKeyEvent => ({
  key,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 0,
  editing: false,
  ...mods,
});

describe("the key mapping: one key, one action, for each state", () => {
  test("j and k move the file, and the moved-to file focuses its first shown hunk", () => {
    expect(reviewKeyOf(ev("j"), KEY_CONTEXT)).toEqual({
      type: "focusMoved",
      path: "b.ts",
      hunkId: "f1h0",
    });
    expect(reviewKeyOf(ev("k"), ctx({ selectedPath: "b.ts", focusedHunkId: "f1h0" }))).toEqual({
      type: "focusMoved",
      path: "a.ts",
      hunkId: "f0h0",
    });
  });

  test("j on the last file and k on the first file do nothing: the cursor stops, it does not wrap", () => {
    expect(reviewKeyOf(ev("j"), ctx({ selectedPath: "img.png", focusedHunkId: null }))).toBeNull();
    expect(reviewKeyOf(ev("k"), KEY_CONTEXT)).toBeNull();
  });

  test("with no selected file, the first file is the current one; a file without hunks focuses nothing", () => {
    expect(reviewKeyOf(ev("j"), ctx({ selectedPath: null, focusedHunkId: null }))).toEqual({
      type: "focusMoved",
      path: "b.ts",
      hunkId: "f1h0",
    });
    expect(reviewKeyOf(ev("j"), ctx({ selectedPath: "b.ts", focusedHunkId: "f1h0" }))).toEqual({
      type: "focusMoved",
      path: "img.png",
      hunkId: null,
    });
  });

  test("n and p walk the shown hunks across files and stop at the ends", () => {
    expect(reviewKeyOf(ev("n"), KEY_CONTEXT)).toEqual({
      type: "focusMoved",
      path: "a.ts",
      hunkId: "f0h1",
    });
    expect(reviewKeyOf(ev("n"), ctx({ focusedHunkId: "f0h1" }))).toEqual({
      type: "focusMoved",
      path: "b.ts",
      hunkId: "f1h0",
    });
    expect(reviewKeyOf(ev("n"), ctx({ selectedPath: "b.ts", focusedHunkId: "f1h0" }))).toBeNull();
    expect(reviewKeyOf(ev("p"), ctx({ selectedPath: "b.ts", focusedHunkId: "f1h0" }))).toEqual({
      type: "focusMoved",
      path: "a.ts",
      hunkId: "f0h1",
    });
    expect(reviewKeyOf(ev("p"), KEY_CONTEXT)).toBeNull();
  });

  test("with no focused hunk, n starts at the first shown hunk and p at the last one", () => {
    expect(reviewKeyOf(ev("n"), ctx({ focusedHunkId: null }))).toEqual({
      type: "focusMoved",
      path: "a.ts",
      hunkId: "f0h0",
    });
    expect(reviewKeyOf(ev("p"), ctx({ focusedHunkId: null }))).toEqual({
      type: "focusMoved",
      path: "b.ts",
      hunkId: "f1h0",
    });
  });

  test("n skips a hunk folded away (it is not shown, so it cannot be decided)", () => {
    const folded = ctx({
      files: [{ path: "a.ts", hunkIds: ["f0h0", "f0h1", "f0h2"], shownHunkIds: ["f0h0", "f0h1"] }],
      selectedPath: "a.ts",
      focusedHunkId: "f0h1",
    });
    expect(reviewKeyOf(ev("n"), folded)).toBeNull();
  });

  test("a and r decide the focused hunk, the same as its buttons", () => {
    expect(reviewKeyOf(ev("a"), KEY_CONTEXT)).toEqual({
      type: "hunkDecided",
      hunkId: "f0h0",
      decision: "approved",
    });
    expect(reviewKeyOf(ev("r"), KEY_CONTEXT)).toEqual({
      type: "hunkDecided",
      hunkId: "f0h0",
      decision: "rejected",
    });
  });

  test("a and r do nothing with no focused hunk, while a send is in flight, or on a hunk not shown", () => {
    expect(reviewKeyOf(ev("a"), ctx({ focusedHunkId: null }))).toBeNull();
    expect(reviewKeyOf(ev("r"), ctx({ editable: false }))).toBeNull();
    expect(reviewKeyOf(ev("a"), ctx({ focusedHunkId: "f0h9" }))).toBeNull();
  });

  test("shift A approves every hunk of the selected file, whatever the case of the letter", () => {
    expect(reviewKeyOf(ev("A", { shiftKey: true }), KEY_CONTEXT)).toEqual({
      type: "fileDecided",
      hunkIds: ["f0h0", "f0h1"],
      decision: "approved",
    });
    expect(reviewKeyOf(ev("a", { shiftKey: true }), KEY_CONTEXT)).toEqual({
      type: "fileDecided",
      hunkIds: ["f0h0", "f0h1"],
      decision: "approved",
    });
    expect(reviewKeyOf(ev("A", { shiftKey: true }), ctx({ selectedPath: "img.png" }))).toBeNull();
    expect(reviewKeyOf(ev("A", { shiftKey: true }), ctx({ editable: false }))).toBeNull();
  });

  test("c opens the comment on the focused hunk, and does not reopen one already open for that hunk", () => {
    expect(reviewKeyOf(ev("c"), KEY_CONTEXT)).toEqual({
      type: "composeOpened",
      hunkId: "f0h0",
      line: null,
    });
    expect(reviewKeyOf(ev("c"), ctx({ composingHunkId: "f0h0" }))).toBeNull();
    expect(reviewKeyOf(ev("c"), ctx({ focusedHunkId: null }))).toBeNull();
  });

  test("Esc cancels a comment being written, and is left to the shell otherwise", () => {
    expect(reviewKeyOf(ev("Escape"), ctx({ composingHunkId: "f0h0" }))).toEqual({
      type: "composeCancelled",
    });
    expect(reviewKeyOf(ev("Esc"), ctx({ composingHunkId: "f0h0" }))).toEqual({
      type: "composeCancelled",
    });
    expect(reviewKeyOf(ev("Escape"), KEY_CONTEXT)).toBeNull();
  });

  test("⌘Enter and Ctrl+Enter submit only when the submit rule allows it", () => {
    expect(reviewKeyOf(ev("Enter", { metaKey: true }), KEY_CONTEXT)).toEqual({ type: "submit" });
    expect(reviewKeyOf(ev("Enter", { ctrlKey: true }), KEY_CONTEXT)).toEqual({ type: "submit" });
    expect(reviewKeyOf(ev("Enter", { metaKey: true }), ctx({ submitOpen: false }))).toBeNull();
    expect(reviewKeyOf(ev("Enter"), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("Enter", { metaKey: true, shiftKey: true }), KEY_CONTEXT)).toBeNull();
  });

  test("while typing in the comment box only ⌘Enter and Esc get through", () => {
    const typing = ctx({ composingHunkId: "f0h0" });
    expect(reviewKeyOf(ev("j", { editing: true }), typing)).toBeNull();
    expect(reviewKeyOf(ev("a", { editing: true }), typing)).toBeNull();
    expect(reviewKeyOf(ev("c", { editing: true }), typing)).toBeNull();
    expect(reviewKeyOf(ev("n", { editing: true }), typing)).toBeNull();
    expect(reviewKeyOf(ev("Enter", { editing: true }), typing)).toBeNull();
    expect(reviewKeyOf(ev("Escape", { editing: true }), typing)).toEqual({
      type: "composeCancelled",
    });
    expect(reviewKeyOf(ev("Enter", { editing: true, metaKey: true }), typing)).toEqual({
      type: "submit",
    });
  });

  test("IME composition ignores every key, Enter and Esc included", () => {
    const typing = ctx({ composingHunkId: "f0h0" });
    expect(reviewKeyOf(ev("Enter", { metaKey: true, isComposing: true }), typing)).toBeNull();
    expect(reviewKeyOf(ev("Escape", { isComposing: true }), typing)).toBeNull();
    expect(reviewKeyOf(ev("j", { isComposing: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("Enter", { metaKey: true, keyCode: 229 }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("a", { keyCode: 229 }), KEY_CONTEXT)).toBeNull();
  });

  test("modifier combinations that are not listed are ignored", () => {
    expect(reviewKeyOf(ev("j", { metaKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("j", { ctrlKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("n", { altKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("J", { shiftKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("N", { shiftKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("R", { shiftKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("C", { shiftKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("a", { metaKey: true }), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("a", { ctrlKey: true }), KEY_CONTEXT)).toBeNull();
    expect(
      reviewKeyOf(ev("Escape", { metaKey: true }), ctx({ composingHunkId: "f0h0" })),
    ).toBeNull();
  });

  test("keys that are not listed do nothing, and a capital letter without shift is the same key", () => {
    expect(reviewKeyOf(ev("x"), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("Tab"), KEY_CONTEXT)).toBeNull();
    expect(reviewKeyOf(ev("J"), KEY_CONTEXT)).toEqual({
      type: "focusMoved",
      path: "b.ts",
      hunkId: "f1h0",
    });
  });
});

const bareHunk = (id: string) => ({
  hunkId: id,
  header: "@@",
  oldStart: 1,
  newStart: 1,
  lines: [],
});

describe("the key context of a screen state", () => {
  const big: ReviewFile = {
    path: "a.ts",
    change: "modified" as const,
    binary: false,
    hunks: Array.from({ length: 32 }, (_, index) => bareHunk(`f0h${String(index)}`)),
  };
  test("the shown hunks follow the fold, and the focus and the composer come from the state", () => {
    const state: ReviewState = {
      ...INITIAL_REVIEW_STATE,
      selectedPath: "a.ts",
      focusedHunkId: "f0h1",
      composing: { hunkId: "f0h1", line: null, text: "" },
    };
    const folded = reviewKeyContextOf([big], state, { editable: true, submitOpen: false });
    expect(folded.files).toEqual([
      {
        path: "a.ts",
        hunkIds: Array.from({ length: 32 }, (_, index) => `f0h${String(index)}`),
        shownHunkIds: Array.from({ length: 30 }, (_, index) => `f0h${String(index)}`),
      },
    ]);
    expect(folded.focusedHunkId).toBe("f0h1");
    expect(folded.composingHunkId).toBe("f0h1");
    const open = reviewKeyContextOf(
      [big],
      { ...state, expanded: ["a.ts"] },
      {
        editable: false,
        submitOpen: false,
      },
    );
    expect(open.files[0]?.shownHunkIds).toHaveLength(32);
    expect(open.editable).toBe(false);
    expect(shownHunkIdsOf(big, [])).toHaveLength(30);
  });
});

describe("the submit result rows", () => {
  test("a result row per hunk, a row with no hunk for an outcome without hunks, and the detail when there is one", () => {
    const rows = reviewResultRowsOf([
      {
        path: "src/cache.ts",
        hunkIds: ["f0h2", "f0h3"],
        result: "reverted",
        method: "workspace_files",
      },
      {
        path: "img/logo.png",
        hunkIds: [],
        result: "skipped",
        method: "none",
        detail: "바이너리 파일이에요",
      },
      {
        path: "docs/cache.md",
        hunkIds: ["f2h0"],
        result: "conflict",
        method: "none",
        detail: "새 줄이 맞지 않아요: 직접 고쳐 주세요",
      },
    ]);
    expect(rows).toEqual([
      {
        path: "src/cache.ts",
        hunkId: "f0h2",
        result: "reverted",
        method: "workspace_files",
        detail: null,
      },
      {
        path: "src/cache.ts",
        hunkId: "f0h3",
        result: "reverted",
        method: "workspace_files",
        detail: null,
      },
      {
        path: "img/logo.png",
        hunkId: null,
        result: "skipped",
        method: "none",
        detail: "바이너리 파일이에요",
      },
      {
        path: "docs/cache.md",
        hunkId: "f2h0",
        result: "conflict",
        method: "none",
        detail: "새 줄이 맞지 않아요: 직접 고쳐 주세요",
      },
    ]);
  });

  test("the table view: no outcome gives no rows; the delivery is the when and the request id, or null", () => {
    expect(reviewResultViewOf(null, null)).toEqual({ rows: [], delivery: null });
    expect(
      reviewResultViewOf(
        [
          {
            path: "src/cache.ts",
            hunkIds: ["f0h2"],
            result: "reverted",
            method: "workspace_files",
          },
        ],
        { requestId: "review:rvw_1:r1", when: "followUp", commentIds: [] },
      ),
    ).toEqual({
      rows: [
        {
          path: "src/cache.ts",
          hunkId: "f0h2",
          result: "reverted",
          method: "workspace_files",
          detail: null,
        },
      ],
      delivery: { when: "followUp", requestId: "review:rvw_1:r1" },
    });
  });
});
