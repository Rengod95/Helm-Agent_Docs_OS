import { describe, expect, test } from "bun:test";
import { THREADLESS_NOTICE_SEQ_BASE, type Notice } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  arrangeInboxApprovals,
  arrangeInboxNotices,
  inboxAllThreadIdsOf,
  inboxRowsOf,
  inboxThreadIdsOf,
  inboxThreadOf,
  type InboxRow,
} from "../../src/views/inbox-model.ts";
import type { NoticeEntry } from "../../src/views/notices-model.ts";
import { evt, thr } from "../state/helpers.ts";

/** 알림 한 건과 그 대화. 종류와 문장은 거르기와 정렬에 쓰이지 않는다. 시각은 기본으로 seq에 맞춘다 */
const entryOf = (seq: number, threadId: ThreadId | null, createdAt = seq * 1000): NoticeEntry => {
  const notice: Notice = {
    kind: "completed",
    title: `n${seq}`,
    body: null,
    seq,
    sourceType: "turn.completed",
    createdAt,
  };
  return { notice, threadId };
};

// 받은 요청의 대화 셀렉트와 정렬 셀렉트가 승인 목록을 거르고 고르는 순서. 대기열 순서는 승인 id 1, 2, 3이다.
const ONE = thr(1);
const TWO = thr(2);

const rows: readonly InboxRow[] = [
  { id: evt(1), threadId: ONE, requestedAt: 300 },
  { id: evt(2), threadId: TWO, requestedAt: 100 },
  { id: evt(3), threadId: ONE, requestedAt: 200 },
];

describe("inbox rows", () => {
  test("reads each approval's thread and request time in queue order and skips unknown ids", () => {
    const byId = {
      [evt(1)]: { threadId: ONE, request: { requestedAt: 300 } },
      [evt(3)]: { threadId: ONE, request: { requestedAt: 200 } },
    };
    expect(inboxRowsOf([evt(1), evt(2), evt(3)], byId)).toEqual([
      { id: evt(1), threadId: ONE, requestedAt: 300 },
      { id: evt(3), threadId: ONE, requestedAt: 200 },
    ]);
  });

  test("the thread choices are the threads with waiting approvals, in the order they first appear", () => {
    expect(inboxThreadIdsOf(rows)).toEqual([ONE, TWO]);
    const reordered: readonly InboxRow[] = [
      { id: evt(2), threadId: TWO, requestedAt: 100 },
      { id: evt(1), threadId: ONE, requestedAt: 300 },
      { id: evt(3), threadId: TWO, requestedAt: 200 },
    ];
    expect(inboxThreadIdsOf(reordered)).toEqual([TWO, ONE]);
  });
});

describe("inbox thread choice", () => {
  test("keeps a thread that still has waiting approvals and falls back to all for one that does not", () => {
    expect(inboxThreadOf("all", [ONE, TWO])).toBe("all");
    expect(inboxThreadOf(TWO, [ONE, TWO])).toBe(TWO);
    expect(inboxThreadOf(thr(9), [ONE, TWO])).toBe("all");
  });
});

describe("arrangeInboxApprovals", () => {
  test("the default order is oldest request first", () => {
    expect(arrangeInboxApprovals(rows, { thread: "all", sort: "oldest" })).toEqual([
      evt(2),
      evt(3),
      evt(1),
    ]);
  });

  test("newest first reverses the request time order", () => {
    expect(arrangeInboxApprovals(rows, { thread: "all", sort: "newest" })).toEqual([
      evt(1),
      evt(3),
      evt(2),
    ]);
  });

  test("a chosen thread keeps only its approvals, in the chosen order", () => {
    expect(arrangeInboxApprovals(rows, { thread: ONE, sort: "oldest" })).toEqual([evt(3), evt(1)]);
    expect(arrangeInboxApprovals(rows, { thread: ONE, sort: "newest" })).toEqual([evt(1), evt(3)]);
    expect(arrangeInboxApprovals(rows, { thread: TWO, sort: "oldest" })).toEqual([evt(2)]);
  });

  test("a chosen thread with no waiting approvals shows none (the screen maps it to all first)", () => {
    expect(arrangeInboxApprovals(rows, { thread: thr(9), sort: "oldest" })).toEqual([]);
    expect(inboxThreadOf(thr(9), inboxThreadIdsOf(rows))).toBe("all");
  });

  test("approvals with the same request time keep their queue order in both directions", () => {
    const same: readonly InboxRow[] = [
      { id: evt(1), threadId: ONE, requestedAt: 100 },
      { id: evt(2), threadId: ONE, requestedAt: 100 },
    ];
    expect(arrangeInboxApprovals(same, { thread: "all", sort: "oldest" })).toEqual([
      evt(1),
      evt(2),
    ]);
    expect(arrangeInboxApprovals(same, { thread: "all", sort: "newest" })).toEqual([
      evt(1),
      evt(2),
    ]);
  });
});

describe("thread choices of the inbox", () => {
  test("approval threads come first in queue order, then threads that only have notices", () => {
    const entries = [entryOf(9, thr(3)), entryOf(8, null), entryOf(7, TWO), entryOf(6, thr(4))];
    expect(inboxAllThreadIdsOf(rows, entries)).toEqual([ONE, TWO, thr(3), thr(4)]);
  });

  test("with no notices the choices are the approval threads alone", () => {
    expect(inboxAllThreadIdsOf(rows, [])).toEqual([ONE, TWO]);
  });
});

/** 알림 목록의 seq만 뽑는다(순서 시험용) */
const seqsOf = (list: readonly NoticeEntry[]): readonly number[] =>
  list.map((entry) => entry.notice.seq);

describe("arrangeInboxNotices", () => {
  // 알림 seq 1..4: 1과 4는 ONE, 2는 대화를 모름, 3은 TWO
  const entries = [entryOf(1, ONE), entryOf(2, null), entryOf(3, TWO), entryOf(4, ONE)];

  test("the default order is oldest seq first, and newest reverses it", () => {
    expect(seqsOf(arrangeInboxNotices(entries, { thread: "all", sort: "oldest" }))).toEqual([
      1, 2, 3, 4,
    ]);
    expect(seqsOf(arrangeInboxNotices(entries, { thread: "all", sort: "newest" }))).toEqual([
      4, 3, 2, 1,
    ]);
  });

  test("all shows the notices without a known thread too", () => {
    expect(arrangeInboxNotices(entries, { thread: "all", sort: "oldest" })).toHaveLength(4);
  });

  test("a chosen thread keeps only its notices, and a notice with no known thread is left out", () => {
    expect(seqsOf(arrangeInboxNotices(entries, { thread: ONE, sort: "oldest" }))).toEqual([1, 4]);
    expect(seqsOf(arrangeInboxNotices(entries, { thread: ONE, sort: "newest" }))).toEqual([4, 1]);
    expect(seqsOf(arrangeInboxNotices(entries, { thread: TWO, sort: "oldest" }))).toEqual([3]);
  });

  test("a chosen thread with no notices shows none", () => {
    expect(arrangeInboxNotices(entries, { thread: thr(9), sort: "oldest" })).toEqual([]);
  });

  test("the notice's creation time decides the order, and the seq breaks a tie", () => {
    const timed = [entryOf(5, ONE, 100), entryOf(3, TWO, 200), entryOf(7, ONE, 200)];
    // 오래된 것 먼저: 시각이 작은 5, 같은 시각이면 seq가 작은 3, 그다음 7
    expect(seqsOf(arrangeInboxNotices(timed, { thread: "all", sort: "oldest" }))).toEqual([
      5, 3, 7,
    ]);
    expect(seqsOf(arrangeInboxNotices(timed, { thread: "all", sort: "newest" }))).toEqual([
      7, 3, 5,
    ]);
  });

  test("a thread-less scheduled failure is shown under all, placed by its time and not by its huge seq", () => {
    const threadless = entryOf(THREADLESS_NOTICE_SEQ_BASE + 4, null, 150);
    const timed = [entryOf(1, ONE, 100), threadless, entryOf(2, TWO, 300)];
    expect(seqsOf(arrangeInboxNotices(timed, { thread: "all", sort: "newest" }))).toEqual([
      2,
      THREADLESS_NOTICE_SEQ_BASE + 4,
      1,
    ]);
    expect(seqsOf(arrangeInboxNotices(timed, { thread: "all", sort: "oldest" }))).toEqual([
      1,
      THREADLESS_NOTICE_SEQ_BASE + 4,
      2,
    ]);
  });

  test("a thread-less scheduled failure is hidden when a conversation is chosen", () => {
    const timed = [entryOf(1, ONE, 100), entryOf(THREADLESS_NOTICE_SEQ_BASE + 4, null, 150)];
    expect(seqsOf(arrangeInboxNotices(timed, { thread: ONE, sort: "newest" }))).toEqual([1]);
    expect(seqsOf(arrangeInboxNotices(timed, { thread: TWO, sort: "oldest" }))).toEqual([]);
  });
});
