import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Bug, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  ThreadListQuery,
  ThreadLifecycle,
  ThreadPage,
  ThreadSummaryRow,
} from "@fresnel/contracts/records";
import { createReviewTextReader, type ReviewTextReader } from "../src/reviews/text.ts";
import { NEW_FILE, ONE_FILE_THREE_HUNKS } from "./support/fixtures.ts";
import { fixedIds, openReviews, type ReviewsHarness } from "./support/harness.ts";

// 리뷰 본문 읽기(L2.artifacts.spec §4.2.9). 본문은 저장한 diff blob에서 읽고, 대화 찾기는 승인 요청 기록과 대화 목록으로 한다.

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

/** 줄들을 줄바꿈으로 이어 diff 텍스트를 만든다. 마지막 줄에도 줄바꿈이 붙는다 */
function diff(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

const NO_NEWLINE = "\\ No newline at end of file";

/** 결과를 값으로 바꾼다. 실패면 시험이 실패한다 */
function valueOf<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Bug("the read was expected to succeed", { cause: result.error });
  return result.value;
}

function readerOf(h: ReviewsHarness, threads?: Pick<ThreadLifecycle, "list">): ReviewTextReader {
  return createReviewTextReader({
    kernel: h.runtime.kernel,
    threads: threads ?? h.session.threads,
  });
}

function rowOf(threadId: ThreadId, pendingApprovals: number): ThreadSummaryRow {
  return {
    threadId,
    title: null,
    status: "idle",
    workspace: null,
    createdAt: 0,
    updatedAt: 0,
    headSeq: 0,
    forkedFrom: null,
    marker: null,
    queuedInputs: 0,
    pendingApprovals,
    lastTurnId: null,
  };
}

/** 쪽 번호를 커서로 주는 대화 목록 대역. `list`를 부른 횟수를 센다 */
function pagedThreads(pageAt: (index: number) => ThreadPage): {
  readonly list: ThreadLifecycle["list"];
  readonly calls: () => number;
} {
  const queries: ThreadListQuery[] = [];
  return {
    list(query) {
      queries.push(query);
      return pageAt(query.cursor === undefined ? 0 : Number(query.cursor));
    },
    calls: () => queries.length,
  };
}

describe("read", () => {
  test("a patch's hunks come back as lines with their kind, and the text without the diff prefix", async () => {
    const h = await harness();
    const view = await h.api.open(
      { changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } },
      h.opts(),
    );

    expect(valueOf(readerOf(h).read(h.threadId, view.reviewId))).toEqual({
      reviewId: view.reviewId,
      files: [
        {
          path: "src/a.ts",
          binary: false,
          hunks: [
            {
              hunkId: "f0h0",
              header: "@@ -1 +1 @@",
              oldStart: 1,
              newStart: 1,
              lines: [
                { kind: "del", text: "const x = 1;" },
                { kind: "add", text: "const x = 10;" },
              ],
            },
            {
              hunkId: "f0h1",
              header: "@@ -2 +2 @@",
              oldStart: 2,
              newStart: 2,
              lines: [
                { kind: "del", text: "const y = 2;" },
                { kind: "add", text: "const y = 20;" },
              ],
            },
            {
              hunkId: "f0h2",
              header: "@@ -3 +3 @@",
              oldStart: 3,
              newStart: 3,
              lines: [
                { kind: "del", text: "const z = 3;" },
                { kind: "add", text: "const z = 30;" },
              ],
            },
          ],
        },
      ],
    });
  });

  test("context lines keep the context kind, and the no-newline marker is not a line", async () => {
    const h = await harness();
    const view = await h.api.open(
      {
        changes: {
          type: "patch",
          patch: diff(
            "--- a/notes.txt",
            "+++ b/notes.txt",
            "@@ -1,2 +1,2 @@",
            " keep",
            "-old tail",
            NO_NEWLINE,
            "+new tail",
            NO_NEWLINE,
          ),
        },
      },
      h.opts(),
    );

    expect(valueOf(readerOf(h).read(h.threadId, view.reviewId))?.files).toEqual([
      {
        path: "notes.txt",
        binary: false,
        hunks: [
          {
            hunkId: "f0h0",
            header: "@@ -1,2 +1,2 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { kind: "context", text: "keep" },
              { kind: "del", text: "old tail" },
              { kind: "add", text: "new tail" },
            ],
          },
        ],
      },
    ]);
  });

  test("a binary file is listed with no hunks", async () => {
    const h = await harness();
    const view = await h.api.open(
      {
        changes: { type: "patch", patch: diff("Binary files a/logo.png and b/logo.png differ") },
      },
      h.opts(),
    );

    expect(valueOf(readerOf(h).read(h.threadId, view.reviewId))?.files).toEqual([
      { path: "logo.png", binary: true, hunks: [] },
    ]);
  });

  test("a new file's hunk has old start 0 and its added line is the only line", async () => {
    const h = await harness();
    const view = await h.api.open({ changes: { type: "patch", patch: NEW_FILE } }, h.opts());

    expect(valueOf(readerOf(h).read(h.threadId, view.reviewId))?.files).toEqual([
      {
        path: "src/new.ts",
        binary: false,
        hunks: [
          {
            hunkId: "f0h0",
            header: "@@ -0,0 +1 @@",
            oldStart: 0,
            newStart: 1,
            lines: [{ kind: "add", text: "export const n = 1;" }],
          },
        ],
      },
    ]);
  });

  test("a review id that was never opened, or belongs to another thread, reads as undefined", async () => {
    const h = await harness();
    const view = await h.api.open(
      { changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } },
      h.opts(),
    );
    const reader = readerOf(h);

    expect(valueOf(reader.read(h.threadId, "rvw_never_opened"))).toBeUndefined();
    expect(valueOf(reader.read(h.ids.next("thr"), view.reviewId))).toBeUndefined();
  });
});

describe("requestedThreadOf", () => {
  test("knows the thread of a review whose approval this process requested, and nothing else", async () => {
    const h = await harness();
    const asked = await h.api.open(
      { changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } },
      h.opts(),
    );
    const quiet = await h.api.open(
      { changes: { type: "patch", patch: NEW_FILE }, requestApproval: false },
      h.opts(),
    );
    const reader = readerOf(h);

    expect(reader.requestedThreadOf(asked.reviewId)).toBe(h.threadId);
    expect(reader.requestedThreadOf(quiet.reviewId)).toBeUndefined();
    expect(reader.requestedThreadOf("rvw_never_opened")).toBeUndefined();
  });

  test("with no approval request in the store, the thread list has no pending thread", async () => {
    const h = await harness();
    await h.api.open({ changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } }, h.opts());

    expect(readerOf(h).pendingThreads()).toEqual([]);
  });
});

describe("pendingThreads", () => {
  test("lists the threads with pending approvals in list order, following the cursor to the last page", async () => {
    const h = await harness();
    const ids = fixedIds(21);
    const [a, b, c] = [ids.next("thr"), ids.next("thr"), ids.next("thr")];
    const pages: readonly ThreadPage[] = [
      { threads: [rowOf(a, 0), rowOf(b, 2)], nextCursor: "1" },
      { threads: [rowOf(c, 1)], nextCursor: null },
    ];
    const listing = pagedThreads((index) => pages[index] ?? { threads: [], nextCursor: null });

    expect(readerOf(h, listing).pendingThreads()).toEqual([b, c]);
    expect(listing.calls()).toBe(2);
  });

  test("scans at most 1000 thread rows (five pages of 200), so a pending thread past that is not found", async () => {
    const h = await harness();
    const ids = fixedIds(22);
    const listing = pagedThreads((index) => ({
      threads: Array.from({ length: 200 }, () => rowOf(ids.next("thr"), index === 5 ? 1 : 0)),
      nextCursor: String(index + 1),
    }));

    expect(readerOf(h, listing).pendingThreads()).toEqual([]);
    expect(listing.calls()).toBe(5);
  });

  test("returns at most 50 threads, the first ones in list order", async () => {
    const h = await harness();
    const ids = fixedIds(23);
    const threads = Array.from({ length: 60 }, () => ids.next("thr"));
    const listing = pagedThreads(() => ({
      threads: threads.map((threadId) => rowOf(threadId, 1)),
      nextCursor: null,
    }));

    expect(readerOf(h, listing).pendingThreads()).toEqual(threads.slice(0, 50));
  });
});
