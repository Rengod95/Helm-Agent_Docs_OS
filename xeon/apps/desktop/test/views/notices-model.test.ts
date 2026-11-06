import { describe, expect, test } from "bun:test";
import type { Notice } from "@fresnel/contracts/capabilities";
import {
  mergeNotices,
  NOTICE_KEEP,
  noticeKindId,
  noticeTitleViewOf,
  noticeToastVisible,
} from "../../src/views/notices-model.ts";
import { checkTitle, deleteFailureId } from "../../src/views/thread-row-menu.tsx";
import { thr } from "../state/helpers.ts";

const notice = (seq: number, title = `n${seq}`): Notice => ({
  kind: "completed",
  title,
  body: null,
  seq,
  sourceType: "turn.completed",
});

describe("mergeNotices", () => {
  test("puts the newest first and keeps one entry per seq", () => {
    const merged = mergeNotices(
      [{ notice: notice(1), threadId: null }],
      [
        { notice: notice(3), threadId: thr(1) },
        { notice: notice(2), threadId: null },
        { notice: notice(2), threadId: null },
      ],
    );
    expect(merged.map((e) => e.notice.seq)).toEqual([3, 2, 1]);
  });

  test("a delivered entry fills in the thread of one the list gave without it", () => {
    const merged = mergeNotices(
      [{ notice: notice(5), threadId: null }],
      [{ notice: notice(5), threadId: thr(2) }],
    );
    expect(merged).toEqual([{ notice: notice(5), threadId: thr(2) }]);
  });

  test("an entry that already knows its thread is kept", () => {
    const merged = mergeNotices(
      [{ notice: notice(5), threadId: thr(2) }],
      [{ notice: notice(5), threadId: null }],
    );
    expect(merged).toEqual([{ notice: notice(5), threadId: thr(2) }]);
  });

  test("drops the oldest past the cap", () => {
    const many = Array.from({ length: NOTICE_KEEP + 5 }, (_, i) => ({
      notice: notice(i + 1),
      threadId: null,
    }));
    const merged = mergeNotices([], many);
    expect(merged.length).toBe(NOTICE_KEEP);
    expect(merged[0]?.notice.seq).toBe(NOTICE_KEEP + 5);
    expect(merged.at(-1)?.notice.seq).toBe(6);
  });

  test("each kind has its own text id", () => {
    expect(noticeKindId("error")).toBe("desktop.notices.kind.error");
    expect(noticeKindId("approval_waiting")).toBe("desktop.notices.kind.approvalWaiting");
  });
});

describe("thread row menu rules", () => {
  test("a title is trimmed and must be 1 to 200 characters", () => {
    expect(checkTitle("  새 이름  ")).toBe("새 이름");
    expect(checkTitle("   ")).toBeNull();
    expect(checkTitle("a".repeat(200))).toBe("a".repeat(200));
    expect(checkTitle("a".repeat(201))).toBeNull();
  });

  test("delete failures name forks, offline, or give the general text", () => {
    expect(deleteFailureId({ kind: "rejected", code: 3004 })).toBe(
      "desktop.threads.menu.delete.hasForks",
    );
    expect(deleteFailureId({ kind: "offline" })).toBe("desktop.threads.menu.failed.offline");
    expect(deleteFailureId({ kind: "failed" })).toBe("desktop.threads.menu.delete.failed");
  });
});

const of = (kind: Notice["kind"], sourceType: string, title: string): Notice => ({
  kind,
  title,
  body: null,
  seq: 1,
  sourceType,
});

describe("noticeTitleViewOf", () => {
  test("a notice kind and its source event pick the polite catalog title", () => {
    expect(noticeTitleViewOf(of("completed", "turn.completed", "x"))).toEqual({
      id: "desktop.notices.title.completed",
    });
    expect(noticeTitleViewOf(of("question_waiting", "approval.requested", "x"))).toEqual({
      id: "desktop.notices.title.question",
    });
    expect(noticeTitleViewOf(of("background_completed", "schedule.run_finished", "x"))).toEqual({
      id: "desktop.notices.title.scheduleCompleted",
    });
    expect(noticeTitleViewOf(of("background_completed", "agent.settled", "x"))).toEqual({
      id: "desktop.notices.title.backgroundCompleted",
    });
    expect(noticeTitleViewOf(of("error", "agent.settled", "x"))).toEqual({
      id: "desktop.notices.title.backgroundFailed",
    });
  });

  test("an approval notice carries its tool name after the colon, and plan has its own title", () => {
    expect(noticeTitleViewOf(of("approval_waiting", "approval.requested", "a: edit"))).toEqual({
      id: "desktop.notices.title.approvalTool",
      params: { tool: "edit" },
    });
    expect(noticeTitleViewOf(of("approval_waiting", "approval.requested", "a: plan"))).toEqual({
      id: "desktop.notices.title.approvalPlan",
    });
    expect(noticeTitleViewOf(of("approval_waiting", "approval.requested", "no colon"))).toBeNull();
  });

  test("an approval notice is not toasted because the live announcer already reads it", () => {
    expect(noticeToastVisible(of("approval_waiting", "approval.requested", "a: edit"))).toBe(false);
    expect(noticeToastVisible(of("completed", "turn.completed", "done"))).toBe(true);
    expect(noticeToastVisible(of("question_waiting", "approval.requested", "q"))).toBe(true);
  });

  test("an error from a source the app does not know keeps its own title", () => {
    expect(noticeTitleViewOf(of("error", "dialog.notified", "x"))).toBeNull();
  });
});
