import { describe, expect, test } from "bun:test";
import type { ReviewText, ReviewTextFailure, ReviewTextReader } from "@fresnel/cap-artifacts";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WireError, type ReviewGetResult, type WireRequestContext } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { M4PortDeps } from "../../src/assembly/m4/deps.ts";
import { createDialogAreaHolder } from "../../src/assembly/m4/dialog-area-bridge.ts";
import { createDialogAreaPort, reviewGetResultOf } from "../../src/assembly/m4/dialog-area-port.ts";
import { createDialogAreaHandlers } from "../../src/handlers/m4/dialog-area.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { partial } from "../fixtures/unsafe.ts";

// review.get(W-02)의 포트 자리(`assembly/m4/dialog-area-port.ts`). 가짜 읽기 면으로 대화 찾기 순서, 실패의 옮김, 와이어 상한과 오류 코드를 본다.

const ids = fixedIdFactory(31);
const T1: ThreadId = ids.next("thr");
const T2: ThreadId = ids.next("thr");
const T3: ThreadId = ids.next("thr");
const REVIEW_ID = "rvw_port_1";
const SIGNAL = new AbortController().signal;

const REVIEW: ReviewText = {
  reviewId: REVIEW_ID,
  files: [
    {
      path: "src/a.ts",
      binary: false,
      hunks: [
        {
          hunkId: "f0h0",
          header: "@@ -1,2 +1,2 @@",
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: "context", text: "keep" },
            { kind: "del", text: "old" },
            { kind: "add", text: "new" },
          ],
        },
      ],
    },
    { path: "logo.png", binary: true, hunks: [] },
  ],
};

/** `REVIEW`를 와이어 값으로 옮긴 결과 */
const WIRE_REVIEW: ReviewGetResult = {
  reviewId: REVIEW_ID,
  files: [
    {
      path: "src/a.ts",
      hunks: [
        {
          hunkId: "f0h0",
          header: "@@ -1,2 +1,2 @@",
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: "context", text: "keep" },
            { kind: "del", text: "old" },
            { kind: "add", text: "new" },
          ],
        },
      ],
    },
    { path: "logo.png", hunks: [] },
  ],
};

type Answer = Result<ReviewText | undefined, ReviewTextFailure>;

/** 대화별 읽기 결과. 빠진 대화는 리뷰가 없다고 답한다 */
function answersOf(
  entries: readonly (readonly [ThreadId, Answer])[],
): ReadonlyMap<ThreadId, Answer> {
  return new Map(entries);
}

interface Script {
  /** 승인 요청으로 안 대화 */
  readonly known?: ThreadId;
  /** 대기 승인이 있는 열린 대화, 최근 갱신 순 */
  readonly pending?: readonly ThreadId[];
  /** 대화마다 돌려줄 읽기 결과. 없으면 그 대화에 리뷰가 없다 */
  readonly answers?: ReadonlyMap<ThreadId, Answer>;
}

interface FakeReader {
  readonly reader: ReviewTextReader;
  /** `read`를 부른 대화, 부른 순서대로 */
  readonly reads: ThreadId[];
  /** `pendingThreads`를 부른 횟수 */
  readonly pending: { count: number };
}

function fakeReader(script: Script): FakeReader {
  const reads: ThreadId[] = [];
  const pending = { count: 0 };
  return {
    reads,
    pending,
    reader: {
      requestedThreadOf: () => script.known,
      pendingThreads() {
        pending.count += 1;
        return script.pending ?? [];
      },
      read(threadId) {
        reads.push(threadId);
        return script.answers?.get(threadId) ?? ok(undefined);
      },
    },
  };
}

/** 확장이 올라왔을 때(reader 있음)와 아닐 때(없음)의 포트 */
function portWith(reader: ReviewTextReader | undefined) {
  const holder = createDialogAreaHolder();
  holder.reviews = reader;
  return createDialogAreaPort(partial<M4PortDeps>({ dialogArea: holder }));
}

function lineOf(index: number) {
  return { kind: "add" as const, text: `line ${String(index)}` };
}

describe("review.get port: lookup order", () => {
  test("the requested thread is read first, and no pending thread is listed when it has the review", async () => {
    const fake = fakeReader({ known: T1, answers: answersOf([[T1, ok(REVIEW)]]) });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(ok(WIRE_REVIEW));
    expect(fake.reads).toEqual([T1]);
    expect(fake.pending.count).toBe(0);
  });

  test("when the requested thread lacks the review, the pending threads are read in order and the first match wins", async () => {
    const fake = fakeReader({
      known: T1,
      pending: [T2, T3],
      answers: answersOf([
        [T1, ok(undefined)],
        [T2, ok(undefined)],
        [T3, ok(REVIEW)],
      ]),
    });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(ok(WIRE_REVIEW));
    expect(fake.reads).toEqual([T1, T2, T3]);
  });

  test("the requested thread is not read a second time when it also appears among the pending threads", async () => {
    const fake = fakeReader({
      known: T1,
      pending: [T1, T2],
      answers: answersOf([
        [T1, ok(undefined)],
        [T2, ok(REVIEW)],
      ]),
    });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(ok(WIRE_REVIEW));
    expect(fake.reads).toEqual([T1, T2]);
  });

  test("with no requested thread, only the pending threads are searched", async () => {
    const fake = fakeReader({
      pending: [T2],
      answers: answersOf([[T2, ok(REVIEW)]]),
    });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(ok(WIRE_REVIEW));
    expect(fake.reads).toEqual([T2]);
  });

  test("a review found in no thread is unknown with the path reviewId", async () => {
    const fake = fakeReader({ known: T1, pending: [T2] });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(
      err({ kind: "unknown", path: "reviewId", id: REVIEW_ID }),
    );
    expect(fake.reads).toEqual([T1, T2]);
  });

  test("without the artifacts extension the port is unavailable", async () => {
    const port = portWith(undefined);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(err({ kind: "unavailable" }));
  });
});

describe("review.get port: failures", () => {
  test("a read failure stops the search and becomes a store failure with the failure kind", async () => {
    const fake = fakeReader({
      pending: [T1, T2],
      answers: answersOf([
        [T1, err({ kind: "read_failed", failure: { kind: "busy" } })],
        [T2, ok(REVIEW)],
      ]),
    });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(
      err({ kind: "store_failed", message: "busy" }),
    );
    expect(fake.reads).toEqual([T1]);
  });

  test("a stored blob that cannot be read becomes a store failure with the blob error kind", async () => {
    const fake = fakeReader({
      known: T1,
      answers: answersOf([
        [T1, err({ kind: "blob_failed", error: { kind: "blob_missing", sha256: "abc" } })],
      ]),
    });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(
      err({ kind: "store_failed", message: "blob_missing" }),
    );
  });

  test("a damaged diff becomes a store failure that names the reason", async () => {
    const fake = fakeReader({
      known: T1,
      answers: answersOf([[T1, err({ kind: "diff_damaged", reason: "mismatch" })]]),
    });
    const port = portWith(fake.reader);

    expect(await port.reviewGet(REVIEW_ID, SIGNAL)).toEqual(
      err({ kind: "store_failed", message: "diff_mismatch" }),
    );
  });
});

describe("review.get wire mapping", () => {
  test("the files and hunks keep their order and the stored ids, starts and header", () => {
    expect(reviewGetResultOf(REVIEW)).toEqual(WIRE_REVIEW);
  });

  test("files past 500 are dropped from the back: 501 files come back as the first 500", () => {
    const wide = reviewGetResultOf({
      reviewId: REVIEW_ID,
      files: Array.from({ length: 501 }, (_, index) => ({
        path: `f${String(index)}.txt`,
        binary: false,
        hunks: [],
      })),
    });

    expect(wide.files).toHaveLength(500);
    expect(wide.files[0]?.path).toBe("f0.txt");
    expect(wide.files[499]?.path).toBe("f499.txt");
  });

  test("hunks past 500 in one file are dropped from the back: 501 hunks come back as the first 500", () => {
    const wide = reviewGetResultOf({
      reviewId: REVIEW_ID,
      files: [
        {
          path: "many.txt",
          binary: false,
          hunks: Array.from({ length: 501 }, (_, index) => ({
            hunkId: `f0h${String(index)}`,
            header: "@@ -1 +1 @@",
            oldStart: 1,
            newStart: 1,
            lines: [],
          })),
        },
      ],
    });

    expect(wide.files[0]?.hunks).toHaveLength(500);
    expect(wide.files[0]?.hunks[0]?.hunkId).toBe("f0h0");
    expect(wide.files[0]?.hunks[499]?.hunkId).toBe("f0h499");
  });

  test("lines past 5000 in one hunk are dropped from the back: 5001 lines come back as the first 5000", () => {
    const wide = reviewGetResultOf({
      reviewId: REVIEW_ID,
      files: [
        {
          path: "long.txt",
          binary: false,
          hunks: [
            {
              hunkId: "f0h0",
              header: "@@ -1 +1 @@",
              oldStart: 1,
              newStart: 1,
              lines: Array.from({ length: 5001 }, (_, index) => lineOf(index)),
            },
          ],
        },
      ],
    });

    expect(wide.files[0]?.hunks[0]?.lines).toHaveLength(5000);
    expect(wide.files[0]?.hunks[0]?.lines[0]).toEqual({ kind: "add", text: "line 0" });
    expect(wide.files[0]?.hunks[0]?.lines[4999]).toEqual({ kind: "add", text: "line 4999" });
  });

  test("text past 20000 UTF-16 units is cut, a header past 512 and a path past 4096 are cut too", () => {
    const wide = reviewGetResultOf({
      reviewId: REVIEW_ID,
      files: [
        {
          path: "p".repeat(4097),
          binary: false,
          hunks: [
            {
              hunkId: "f0h0",
              header: "h".repeat(600),
              oldStart: 1,
              newStart: 1,
              lines: [{ kind: "context", text: "a".repeat(20001) }],
            },
          ],
        },
      ],
    });

    expect(wide.files[0]?.path).toBe("p".repeat(4096));
    expect(wide.files[0]?.hunks[0]?.header).toBe("h".repeat(512));
    expect(wide.files[0]?.hunks[0]?.lines[0]).toEqual({ kind: "context", text: "a".repeat(20000) });
  });

  test("a cut never leaves half of a surrogate pair", () => {
    const wide = reviewGetResultOf({
      reviewId: REVIEW_ID,
      files: [
        {
          path: "emoji.txt",
          binary: false,
          hunks: [
            {
              hunkId: "f0h0",
              header: "@@ -1 +1 @@",
              oldStart: 1,
              newStart: 1,
              // 20000번째 자리에 걸친 😀(대리 쌍 두 단위)
              lines: [{ kind: "add", text: `${"a".repeat(19999)}😀` }],
            },
          ],
        },
      ],
    });

    expect(wide.files[0]?.hunks[0]?.lines[0]?.text).toBe("a".repeat(19999));
  });
});

describe("review.get handler", () => {
  test("an unavailable port is method not found, and an unknown review is invalid params on reviewId", async () => {
    const context = partial<WireRequestContext>({ signal: SIGNAL });
    const absent = createDialogAreaHandlers(portWith(undefined));
    const unavailable = await rejectionOf(absent["review.get"]({ reviewId: REVIEW_ID }, context));
    expect(unavailable).toBeInstanceOf(WireError);
    if (unavailable instanceof WireError) {
      expect(unavailable.data.kind).toBe("jsonrpc.methodNotFound");
    }

    const empty = createDialogAreaHandlers(portWith(fakeReader({}).reader));
    const unknown = await rejectionOf(empty["review.get"]({ reviewId: REVIEW_ID }, context));
    expect(unknown).toBeInstanceOf(WireError);
    if (unknown instanceof WireError) {
      expect(unknown.data.kind).toBe("jsonrpc.invalidParams");
      expect(unknown.data.details).toEqual({
        issues: [{ path: "reviewId", message: "unknown review" }],
      });
    }
  });
});
