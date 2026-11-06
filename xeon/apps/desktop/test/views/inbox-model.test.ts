import { describe, expect, test } from "bun:test";
import {
  arrangeInboxApprovals,
  inboxRowsOf,
  inboxThreadIdsOf,
  inboxThreadOf,
  type InboxRow,
} from "../../src/views/inbox-model.ts";
import { evt, thr } from "../state/helpers.ts";

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

  test("a chosen thread with no waiting approvals shows every approval", () => {
    expect(arrangeInboxApprovals(rows, { thread: thr(9), sort: "oldest" })).toEqual([
      evt(2),
      evt(3),
      evt(1),
    ]);
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
