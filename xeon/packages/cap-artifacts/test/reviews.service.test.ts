import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ReviewView } from "@xeon/contracts/capabilities";
import type { DurableEventEnvelope, EventKind } from "@xeon/contracts/records";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import { foldReview } from "../src/reviews/state.ts";
import { codeOf, hunkStates, rejection } from "./support/assert.ts";
import {
  A_AFTER_EDIT,
  NEW_FILE,
  ONE_FILE_THREE_HUNKS,
  REPEAT_EDIT_FIRST,
  REPEAT_EDIT_SECOND,
  TWO_FILES_THREE_HUNKS,
} from "./support/fixtures.ts";
import { fixedIds, fixedLocalIds, openReviews, type ReviewsHarness } from "./support/harness.ts";

// 저장소를 여는 시험은 첫 실행에서 기본 5초를 넘긴 적이 있어 시간 상한을 넓힌다.
setDefaultTimeout(20_000);

let opened: ReviewsHarness | undefined;

async function harness(files?: Readonly<Record<string, string>>): Promise<ReviewsHarness> {
  opened = await openReviews(files);
  return opened;
}

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

/**
 * ONE_FILE_THREE_HUNKS를 한 턴 안에서 연다. 되돌림은 리뷰를 연 턴으로 가드를 부르므로 기본은 턴이 있다.
 * 턴 없이 여는 경우는 시험이 `h.api.open`을 직접 부른다.
 */
function openOne(h: ReviewsHarness, turnId: TurnId = h.ids.next("trn")): Promise<ReviewView> {
  return h.api.open(
    { changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } },
    h.opts(undefined, turnId),
  );
}

describe("open", () => {
  test("a patch with 2 files and 3 hunks opens at round 1 with f0h0.. ids, one commit for the changeset and the opened event, and one approval request", async () => {
    const h = await harness();
    const view = await h.api.open(
      { changes: { type: "patch", patch: TWO_FILES_THREE_HUNKS } },
      h.opts("open-1"),
    );

    expect(view.status).toBe("open");
    expect(view.round).toBe(1);
    expect(view.title).toBe("Review src/a.ts and 1 more");
    expect(
      view.files.map((file) => [file.fileIndex, file.path, file.hunks.map((hunk) => hunk.hunkId)]),
    ).toEqual([
      [0, "src/a.ts", ["f0h0", "f0h1"]],
      [1, "src/b.ts", ["f1h0"]],
    ]);
    expect(hunkStates(view)).toEqual([
      ["f0h0", "pending", "none"],
      ["f0h1", "pending", "none"],
      ["f1h0", "pending", "none"],
    ]);

    // 산출물 등록과 리뷰 열림이 한 커밋이다: 커밋 범위의 종류가 둘뿐이다
    expect(h.commits).toHaveLength(1);
    const kinds = await Promise.all(
      h.commits.map((commit) => h.eventKindsIn(commit.firstSeq, commit.lastSeq)),
    );
    expect(kinds).toEqual([["artifact.registered", "artifact.review_opened"]]);
    const [registered] = await h.events("artifact.registered");
    expect(registered?.payload).toMatchObject({ kind: "changeset", version: 1, title: view.title });

    // 승인 요청은 한 번, kind review, 대상은 파일 요약이다
    expect(h.approvals.requests).toEqual([
      {
        threadId: h.threadId,
        kind: "review",
        blocking: false,
        requestId: expect.any(String),
        subject: {
          reviewId: view.reviewId,
          artifactId: view.artifactId,
          title: "Review src/a.ts and 1 more",
          round: 1,
          files: [
            { path: "src/a.ts", change: "modified", binary: false, hunks: 2 },
            { path: "src/b.ts", change: "modified", binary: false, hunks: 1 },
          ],
        },
      },
    ]);
  });

  test("opening again with the same requestId returns the first review and does not create a second one", async () => {
    const h = await harness();
    const first = await h.api.open(
      { changes: { type: "patch", patch: TWO_FILES_THREE_HUNKS } },
      h.opts("open-1"),
    );
    const again = await h.api.open(
      { changes: { type: "patch", patch: TWO_FILES_THREE_HUNKS } },
      h.opts("open-1"),
    );

    expect(again.reviewId).toBe(first.reviewId);
    expect(await h.events("artifact.review_opened")).toHaveLength(1);
    expect(await h.events("artifact.registered")).toHaveLength(1);
    expect(h.approvals.requests).toHaveLength(1);
  });

  test("no changes, a checkpoint source and a garbage patch are rejected with their codes", async () => {
    const h = await harness();
    const turnId = h.ids.next("trn");

    expect(await codeOf(h.api.open({ changes: { type: "turn", turnId } }, h.opts()))).toBe(
      "no_changes",
    );
    expect(
      await codeOf(
        h.api.open({ changes: { type: "checkpoint", checkpointId: h.ids.next("ckp") } }, h.opts()),
      ),
    ).toBe("source_unsupported");

    const garbage = await rejection(
      h.api.open({ changes: { type: "patch", patch: "this is not a diff\n" } }, h.opts()),
    );
    expect([garbage.data.code, garbage.data.detail]).toEqual([
      "diff_unparsable",
      { source: "patch:0", line: 1 },
    ]);
    expect(await h.events("artifact.review_")).toEqual([]);
  });

  test("a turn source collects only that turn's successful tool results in order, and the guard later runs under that turn", async () => {
    const h = await harness({ "src/a.ts": "const v = 'c';\n" });
    const turn = h.ids.next("trn");
    const other = h.ids.next("trn");
    h.seedToolResult({
      turnId: turn,
      toolCallId: "call-1",
      path: "src/a.ts",
      diff: REPEAT_EDIT_FIRST,
    });
    h.seedToolResult({
      turnId: turn,
      toolCallId: "call-2",
      path: "src/a.ts",
      diff: REPEAT_EDIT_SECOND,
      isError: true,
    });
    h.seedToolResult({
      turnId: turn,
      toolCallId: "call-3",
      path: "src/a.ts",
      diff: REPEAT_EDIT_SECOND,
    });
    h.seedToolResult({ turnId: other, toolCallId: "call-4", path: "src/new.ts", diff: NEW_FILE });

    const view = await h.api.open({ changes: { type: "turn" } }, h.opts(undefined, turn));

    // 오류 결과(call-2)와 다른 턴(call-4)은 빠진다. 같은 파일의 두 편집은 hunk 둘로 이어진다
    expect(view.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(hunkStates(view).map((state) => state[0])).toEqual(["f0h0", "f0h1"]);
    expect(await h.events("artifact.review_opened")).toMatchObject([
      { payload: { basis: { type: "turn", turnId: turn, toolCallIds: [] } } },
    ]);

    await h.api.reject({ reviewId: view.reviewId, hunks: "all" }, h.opts());
    await h.api.submit({ reviewId: view.reviewId }, h.opts());
    expect(h.guard.calls.map((call) => call.turnId)).toEqual([turn, turn]);
    expect(h.files.calls.map((call) => call.oldText)).toEqual([
      "const v = 'c';\n",
      "const v = 'b';\n",
    ]);
  });

  test("a toolCalls source takes only the named calls", async () => {
    const h = await harness();
    const turn = h.ids.next("trn");
    h.seedToolResult({
      turnId: turn,
      toolCallId: "call-1",
      path: "src/a.ts",
      diff: REPEAT_EDIT_FIRST,
    });
    h.seedToolResult({
      turnId: turn,
      toolCallId: "call-2",
      path: "src/a.ts",
      diff: REPEAT_EDIT_SECOND,
    });

    const view = await h.api.open(
      { changes: { type: "toolCalls", toolCallIds: ["call-2"] } },
      h.opts(undefined, turn),
    );

    expect(hunkStates(view)).toEqual([["f0h0", "pending", "none"]]);
    expect(await h.events("artifact.review_opened")).toMatchObject([
      { payload: { basis: { type: "toolCalls", toolCallIds: ["call-2"] } } },
    ]);
  });
});

describe("approve, reject and comment validation", () => {
  test("unknown hunks, lines outside the hunk and closed reviews are rejected with their codes", async () => {
    const h = await harness();
    const view = await openOne(h);
    const reviewId = view.reviewId;

    expect(await codeOf(h.api.approve({ reviewId, hunks: ["f9h9"] }, h.opts()))).toBe(
      "hunk_unknown",
    );
    expect(await codeOf(h.api.reject({ reviewId, hunks: ["f0h0", "f9h9"] }, h.opts()))).toBe(
      "hunk_unknown",
    );
    expect(
      await codeOf(
        h.api.comment({ reviewId, target: { type: "hunk", hunkId: "f9h9" }, body: "x" }, h.opts()),
      ),
    ).toBe("hunk_unknown");
    // f0h0은 새 쪽 1행 하나짜리다: 2행은 밖이다
    expect(
      await codeOf(
        h.api.comment(
          {
            reviewId,
            target: { type: "hunk", hunkId: "f0h0", line: { side: "new", number: 2 } },
            body: "x",
          },
          h.opts(),
        ),
      ),
    ).toBe("line_out_of_range");
    // 옛 쪽 1행은 안이다
    const inRange = await h.api.comment(
      {
        reviewId,
        target: { type: "hunk", hunkId: "f0h0", line: { side: "old", number: 1 } },
        body: "ok",
      },
      h.opts(),
    );
    expect(inRange.round).toBe(1);

    await h.api.close({ reviewId, reason: "done" }, h.opts());
    expect(await codeOf(h.api.approve({ reviewId, hunks: "all" }, h.opts()))).toBe("review_closed");
    expect(await codeOf(h.api.reject({ reviewId, hunks: "all" }, h.opts()))).toBe("review_closed");
    expect(
      await codeOf(h.api.comment({ reviewId, target: { type: "review" }, body: "x" }, h.opts())),
    ).toBe("review_closed");
  });

  test("a hunk that was reverted cannot be approved again", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);
    const reviewId = view.reviewId;
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());
    const submitted = await h.api.submit({ reviewId }, h.opts());
    expect(hunkStates(submitted.review)).toEqual([
      ["f0h0", "approved", "none"],
      ["f0h1", "rejected", "reverted"],
      ["f0h2", "approved", "none"],
    ]);

    expect(await codeOf(h.api.approve({ reviewId, hunks: ["f0h1"] }, h.opts()))).toBe(
      "invalid_input",
    );
    expect(hunkStates(await h.api.get({ reviewId }, h.opts()))[1]).toEqual([
      "f0h1",
      "rejected",
      "reverted",
    ]);
  });
});

describe("submit", () => {
  test("pending hunks without approveRemaining are refused and nothing is written", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);
    await h.api.approve({ reviewId: view.reviewId, hunks: ["f0h0"] }, h.opts());

    expect(await codeOf(h.api.submit({ reviewId: view.reviewId }, h.opts()))).toBe(
      "decisions_pending",
    );
    expect(h.files.calls).toEqual([]);
    expect(h.queue.attempts).toEqual([]);
    expect(await h.events("artifact.review_submitted")).toEqual([]);
  });

  test("with approveRemaining and everything approved there is no post, delivery is null and the review is submitted", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);

    const out = await h.api.submit({ reviewId: view.reviewId, approveRemaining: true }, h.opts());

    expect(out.review.status).toBe("submitted");
    expect(out.review.round).toBe(1);
    expect(hunkStates(out.review).map((state) => state.slice(1))).toEqual([
      ["approved", "none"],
      ["approved", "none"],
      ["approved", "none"],
    ]);
    expect(out.applied).toEqual([]);
    expect(out.delivery).toBeNull();
    expect(h.queue.attempts).toEqual([]);
    expect(h.files.calls).toEqual([]);
  });

  test("rejecting one of three hunks in one file reverts only that hunk, posts one delivery and records only that hunk", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);
    const reviewId = view.reviewId;
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());

    const out = await h.api.submit({ reviewId }, h.opts());

    // 되돌림: 거절한 hunk의 새 쪽 글을 옛 쪽 글로 바꾼다
    expect(h.files.calls).toEqual([
      {
        path: "src/a.ts",
        oldText: "const y = 20;\n",
        newText: "const y = 2;\n",
        requestId: `${reviewId}:f0h1`,
      },
    ]);
    expect(h.files.contents.get("src/a.ts")).toBe("const x = 10;\nconst y = 2;\nconst z = 30;\n");
    expect(out.applied).toEqual([
      { path: "src/a.ts", hunkIds: ["f0h1"], result: "reverted", method: "workspace_files" },
    ]);
    expect(hunkStates(out.review)).toEqual([
      ["f0h0", "approved", "none"],
      ["f0h1", "rejected", "reverted"],
      ["f0h2", "approved", "none"],
    ]);
    expect((await h.events("artifact.review_applied")).map((event) => event.payload)).toEqual([
      {
        reviewId,
        round: 1,
        outcomes: [
          { path: "src/a.ts", hunkIds: ["f0h1"], result: "reverted", method: "workspace_files" },
        ],
      },
    ]);

    // 전달: 글은 정확히 이 문안이고 큐에는 한 번 들어간다
    const requestId = `review:${reviewId}:r1`;
    expect(h.queue.posts).toEqual([
      {
        requestId,
        when: "followUp",
        item: {
          kind: "user",
          content: `[review ${reviewId} round 1]\n거절하고 되돌림: src/a.ts f0h1\n승인: 나머지 2개 hunk`,
        },
      },
    ]);
    expect(out.delivery).toEqual({ requestId, when: "followUp", duplicate: false });
  });

  test("submitting again does not post again and keeps the review submitted at the same round", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);
    const reviewId = view.reviewId;
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());
    await h.api.submit({ reviewId }, h.opts());

    const again = await h.api.submit({ reviewId }, h.opts());

    expect(again.review.status).toBe("submitted");
    expect(again.review.round).toBe(1);
    expect(h.queue.attempts).toEqual([`review:${reviewId}:r1`]);
    expect(h.files.calls).toHaveLength(1);
  });

  test("a queue that already holds the round's request reports duplicate and is not posted to again", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);
    const reviewId = view.reviewId;
    const requestId = `review:${reviewId}:r1`;
    h.queue.alreadyQueued(requestId);
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());

    const out = await h.api.submit({ reviewId }, h.opts());

    expect(out.delivery).toEqual({ requestId, when: "followUp", duplicate: true });
    expect(h.queue.attempts).toEqual([requestId]);
    expect(h.queue.posts).toEqual([]);
    expect(out.review.status).toBe("submitted");
  });

  test("a comment on a hunk decided in an earlier round is delivered in the next round", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);
    const reviewId = view.reviewId;
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());
    await h.api.submit({ reviewId }, h.opts());

    await h.api.comment(
      { reviewId, target: { type: "hunk", hunkId: "f0h0" }, body: "why?" },
      h.opts(),
    );
    const out = await h.api.submit({ reviewId }, h.opts());

    expect(out.review.round).toBe(2);
    expect(out.delivery).toEqual({
      requestId: `review:${reviewId}:r2`,
      when: "followUp",
      duplicate: false,
    });
    expect(h.queue.posts.map((post) => post.item)).toEqual([
      {
        kind: "user",
        content: `[review ${reviewId} round 1]\n거절하고 되돌림: src/a.ts f0h1\n승인: 나머지 2개 hunk`,
      },
      {
        kind: "user",
        content: `[review ${reviewId} round 2]\n\n코멘트:\n- src/a.ts f0h0: why?`,
      },
    ]);
  });
});

describe("conflicts and skipped hunks", () => {
  test("a failed workspace edit is a conflict on that hunk and the review still submits", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await openOne(h);
    const reviewId = view.reviewId;
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());
    // 바뀐 줄이 사라졌다: 되돌릴 글이 파일에 없다
    h.files.contents.set("src/a.ts", "const x = 10;\nconst y = 99;\nconst z = 30;\n");

    const out = await h.api.submit({ reviewId }, h.opts());

    expect(out.applied).toEqual([
      {
        path: "src/a.ts",
        hunkIds: ["f0h1"],
        result: "conflict",
        method: "workspace_files",
        detail: "edit_not_found: oldText is not in the file",
      },
    ]);
    expect(hunkStates(out.review)[1]).toEqual(["f0h1", "rejected", "conflict"]);
    expect(h.files.contents.get("src/a.ts")).toBe("const x = 10;\nconst y = 99;\nconst z = 30;\n");
    expect(h.queue.posts.map((post) => post.item)).toEqual([
      {
        kind: "user",
        content: `[review ${reviewId} round 1]\n되돌리지 못함(충돌): src/a.ts f0h1\n승인: 나머지 2개 hunk`,
      },
    ]);
  });

  test("a guard that blocks the write makes the hunk a conflict and the file is not written", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const turn = h.ids.next("trn");
    const view = await openOne(h, turn);
    const reviewId = view.reviewId;
    h.guard.block("policy says no");
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());

    const out = await h.api.submit({ reviewId }, h.opts());

    expect(h.guard.calls).toEqual([
      {
        threadId: h.threadId,
        turnId: turn,
        content: "src/a.ts\nconst y = 2;\n",
        requestId: `${reviewId}:f0h1`,
      },
    ]);
    expect(h.files.calls).toEqual([]);
    expect(out.applied).toEqual([
      {
        path: "src/a.ts",
        hunkIds: ["f0h1"],
        result: "conflict",
        method: "workspace_files",
        detail: "Blocked by a guard: policy says no",
      },
    ]);
    expect(h.files.contents.get("src/a.ts")).toBe(A_AFTER_EDIT);
  });

  test("a review opened outside any turn cannot run the guard, so every rejected hunk is a conflict with no write", async () => {
    const h = await harness({ "src/a.ts": A_AFTER_EDIT });
    const view = await h.api.open(
      { changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } },
      h.opts(),
    );
    const reviewId = view.reviewId;
    await h.api.reject({ reviewId, hunks: ["f0h1"] }, h.opts());
    await h.api.approve({ reviewId, hunks: ["f0h0", "f0h2"] }, h.opts());

    const out = await h.api.submit({ reviewId }, h.opts());

    expect(out.applied).toEqual([
      {
        path: "src/a.ts",
        hunkIds: ["f0h1"],
        result: "conflict",
        method: "workspace_files",
        detail: "The review has no turn to run the output guard against.",
      },
    ]);
    expect(h.guard.calls).toEqual([]);
    expect(h.files.calls).toEqual([]);
  });

  test("a rejected hunk that creates a new file is skipped, not reverted", async () => {
    const h = await harness();
    const turn = h.ids.next("trn");
    const view = await h.api.open(
      { changes: { type: "patch", patch: NEW_FILE } },
      h.opts(undefined, turn),
    );
    const reviewId = view.reviewId;
    await h.api.reject({ reviewId, hunks: "all" }, h.opts());

    const out = await h.api.submit({ reviewId }, h.opts());

    expect(out.applied).toEqual([
      {
        path: "src/new.ts",
        hunkIds: ["f0h0"],
        result: "skipped",
        method: "none",
        detail: "The creation of a new file cannot be reverted here. Delete the file to undo it.",
      },
    ]);
    expect(hunkStates(out.review)).toEqual([["f0h0", "rejected", "none"]]);
    expect(h.files.calls).toEqual([]);
    expect(h.queue.posts.map((post) => post.item)).toEqual([
      {
        kind: "user",
        content: `[review ${reviewId} round 1]\n거절했으나 되돌리지 않음: src/new.ts f0h0`,
      },
    ]);
  });

  test("two edits to the same line in one turn are reverted newest first, so the file returns to the original text", async () => {
    const h = await harness({ "src/a.ts": "const v = 'c';\n" });
    const turn = h.ids.next("trn");
    h.seedToolResult({
      turnId: turn,
      toolCallId: "call-1",
      path: "src/a.ts",
      diff: REPEAT_EDIT_FIRST,
    });
    h.seedToolResult({
      turnId: turn,
      toolCallId: "call-2",
      path: "src/a.ts",
      diff: REPEAT_EDIT_SECOND,
    });
    const view = await h.api.open(
      { changes: { type: "toolCalls", toolCallIds: ["call-1", "call-2"] } },
      h.opts(undefined, turn),
    );
    const reviewId = view.reviewId;
    await h.api.reject({ reviewId, hunks: "all" }, h.opts());

    const out = await h.api.submit({ reviewId }, h.opts());

    expect(h.files.calls.map((call) => [call.oldText, call.newText])).toEqual([
      ["const v = 'c';\n", "const v = 'b';\n"],
      ["const v = 'b';\n", "const v = 'a';\n"],
    ]);
    expect(h.files.contents.get("src/a.ts")).toBe("const v = 'a';\n");
    expect(out.applied).toEqual([
      {
        path: "src/a.ts",
        hunkIds: ["f0h1", "f0h0"],
        result: "reverted",
        method: "workspace_files",
      },
    ]);
  });
});

const sha = (char: string): string => char.repeat(64);

describe("foldReview over a hand-built event list", () => {
  const ids = fixedIds(7);
  const localIds = fixedLocalIds(7);
  const threadId: ThreadId = ids.next("thr");
  const reviewId = localIds.next("rvw");
  const artifactId = localIds.next("art");
  const commentId = localIds.next("cmt");

  function event(seq: number, kind: EventKind, payload: unknown): DurableEventEnvelope {
    return {
      id: ids.next("evt"),
      kind,
      version: 1,
      threadId,
      turnId: null,
      stepId: null,
      recordedAt: seq,
      causationId: null,
      correlationId: null,
      payload,
      durable: true,
      seq,
      parentId: null,
    };
  }

  const hunk = (hunkId: string, line: number) => ({
    hunkId,
    header: `@@ -${line} +${line} @@`,
    oldStart: line,
    oldLines: 1,
    newStart: line,
    newLines: 1,
    patchSha256: sha("b"),
  });

  const events: DurableEventEnvelope[] = [
    event(1, "artifact.review_opened", {
      reviewId,
      artifactId,
      title: "Review src/a.ts",
      basis: { type: "patch" },
      diff: { type: "blob", sha256: sha("a"), size: 10, mediaType: "text/x-diff" },
      files: [
        {
          fileIndex: 0,
          path: "src/a.ts",
          oldPath: "src/a.ts",
          change: "modified",
          binary: false,
          hunks: [hunk("f0h0", 1), hunk("f0h1", 2), hunk("f0h2", 3)],
        },
      ],
      deliverAs: "followUp",
      approvalId: null,
    }),
    event(2, "artifact.review_decided", {
      reviewId,
      round: 1,
      decisions: [
        { hunkId: "f0h0", decision: "approved" },
        { hunkId: "f0h1", decision: "rejected" },
      ],
      by: "user",
    }),
    event(3, "artifact.review_commented", {
      reviewId,
      round: 1,
      commentId,
      target: { type: "hunk", hunkId: "f0h1" },
      body: "why",
      by: "user",
    }),
    event(4, "artifact.review_applied", {
      reviewId,
      round: 1,
      outcomes: [
        { path: "src/a.ts", hunkIds: ["f0h1"], result: "reverted", method: "workspace_files" },
      ],
    }),
    event(5, "artifact.review_submitted", {
      reviewId,
      round: 1,
      delivery: { requestId: `review:${reviewId}:r1`, when: "followUp", commentIds: [commentId] },
    }),
    event(6, "artifact.review_decided", {
      reviewId,
      round: 2,
      decisions: [{ hunkId: "f0h2", decision: "approved" }],
      by: "user",
    }),
  ];

  test("open to submitted to open at round 2, with the comment marked delivered at submit", () => {
    const states = events.map((_, index) => foldReview(reviewId, events.slice(0, index + 1)));

    expect(states.map((state) => [state?.status, state?.round])).toEqual([
      ["open", 1],
      ["open", 1],
      ["open", 1],
      ["open", 1],
      ["submitted", 1],
      ["open", 2],
    ]);
    expect(states.map((state) => state?.comments.map((comment) => comment.deliveredRound))).toEqual(
      [[], [], [null], [null], [1], [1]],
    );
    const last = states[5];
    expect(
      last?.files.flatMap((file) =>
        file.hunks.map((item) => [item.hunkId, item.decision, item.applied, item.decidedRound]),
      ),
    ).toEqual([
      ["f0h0", "approved", "none", 1],
      ["f0h1", "rejected", "reverted", 1],
      ["f0h2", "approved", "none", 2],
    ]);
  });

  test("closed is terminal: a decision that arrives after close does not reopen the review", () => {
    const closed = [
      ...events.slice(0, 1),
      event(2, "artifact.review_closed", { reviewId, reason: "done" }),
      event(3, "artifact.review_decided", {
        reviewId,
        round: 1,
        decisions: [{ hunkId: "f0h0", decision: "approved" }],
        by: "user",
      }),
    ];

    expect(foldReview(reviewId, closed)?.status).toBe("closed");
  });
});
