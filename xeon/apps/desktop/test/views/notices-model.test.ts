import { describe, expect, test } from "bun:test";
import type { Notice } from "@fresnel/contracts/capabilities";
import {
  createClearedBoundary,
  highestSeqOf,
  mergeNotices,
  NOTICE_KEEP,
  noticeAgeViewOf,
  noticeBodyViewOf,
  noticeKindId,
  noticeResolved,
  noticesAfter,
  noticeTitleViewOf,
  noticeToastVisible,
  threadBySeqOf,
  type NoticeEntry,
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

describe("threadBySeqOf", () => {
  test("maps each notice seq to the thread whose scoped list held it", () => {
    const found = threadBySeqOf([
      { threadId: thr(1), notices: [notice(4), notice(9)] },
      { threadId: thr(2), notices: [notice(7)] },
    ]);
    expect([...found]).toEqual([
      [4, thr(1)],
      [9, thr(1)],
      [7, thr(2)],
    ]);
  });
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

describe("noticeResolved", () => {
  const waiting: Notice = { ...notice(1, "승인이 필요해요: edit"), kind: "approval_waiting" };
  test("an approval notice is resolved once its thread has no pending approval", () => {
    expect(noticeResolved({ notice: waiting, threadId: thr(1) }, new Set())).toBe(true);
    expect(noticeResolved({ notice: waiting, threadId: thr(1) }, new Set([thr(1)]))).toBe(false);
  });
  test("an unknown thread or another kind is never called resolved", () => {
    expect(noticeResolved({ notice: waiting, threadId: null }, new Set())).toBe(false);
    expect(noticeResolved({ notice: notice(2), threadId: thr(1) }, new Set())).toBe(false);
  });
});

const AUTH_JSON =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';

const failedTurn = (body: string | null): Notice => ({
  kind: "error",
  title: "턴이 실패했어요",
  body,
  seq: 1,
  sourceType: "turn.completed",
});

describe("noticeBodyViewOf", () => {
  test("a 401 JSON body gives the conversation's key sentence and button, the JSON stays in details", () => {
    expect(noticeBodyViewOf(failedTurn(AUTH_JSON))).toEqual({
      kind: "failure",
      text: "desktop.turnFailure.auth",
      action: "reregister-key",
      detail: AUTH_JSON,
    });
  });

  test("a plain text body that matches no failure is shown as it is", () => {
    expect(noticeBodyViewOf(failedTurn("뭔지 모를 오류"))).toEqual({
      kind: "plain",
      text: "뭔지 모를 오류",
    });
  });

  test("unknown JSON never shows the raw JSON, it gives the generic failure sentence", () => {
    expect(noticeBodyViewOf(failedTurn('{"foo":1}'))).toEqual({
      kind: "failure",
      text: "desktop.turnFailure.unknown",
      action: null,
      detail: '{"foo":1}',
    });
  });

  test("a host mismatch offers the provider settings and names the host", () => {
    const error =
      "secret_unresolved: secret k could not be leased (denied: host_mismatch, host=proxy.example.com)";
    expect(noticeBodyViewOf(failedTurn(error))).toEqual({
      kind: "failure",
      text: "desktop.turnFailure.hostMismatch",
      params: { host: "proxy.example.com" },
      action: "open-providers",
      detail: error,
    });
  });

  test("a sentence that needs the composer or a resend keeps its text but drops the button", () => {
    expect(
      noticeBodyViewOf(failedTurn('404 {"error":{"type":"not_found_error","message":"model: x"}}')),
    ).toMatchObject({ kind: "failure", text: "desktop.turnFailure.modelNotFound", action: null });
    expect(noticeBodyViewOf(failedTurn("429 rate limit"))).toMatchObject({
      kind: "failure",
      text: "desktop.turnFailure.rateLimited",
      action: null,
    });
  });

  test("a body of another kind stays as it is, and no body is nothing to show", () => {
    expect(
      noticeBodyViewOf({
        kind: "completed",
        title: "작업이 끝났어요",
        body: '{"done":true}',
        seq: 2,
        sourceType: "turn.completed",
      }),
    ).toEqual({ kind: "plain", text: '{"done":true}' });
    expect(
      noticeBodyViewOf({
        kind: "completed",
        title: "x",
        body: null,
        seq: 3,
        sourceType: "turn.completed",
      }),
    ).toBeNull();
  });

  test("a failed turn with no body still says it failed, without details", () => {
    expect(noticeBodyViewOf(failedTurn(null))).toEqual({
      kind: "failure",
      text: "desktop.turnFailure.unknown",
      action: null,
      detail: null,
    });
  });
});

describe("noticeAgeViewOf", () => {
  const NOW = 1_000_000_000_000;
  test("a notice without a delivery time has no age line", () => {
    expect(noticeAgeViewOf(NOW, undefined)).toBeNull();
  });

  test("the age uses the approval card's words: now, minutes, hours, days", () => {
    expect(noticeAgeViewOf(NOW, NOW - 30_000)).toEqual({ id: "desktop.approvals.age.now" });
    expect(noticeAgeViewOf(NOW, NOW - 5 * 60_000)).toEqual({
      id: "desktop.approvals.age.minutes",
      params: { count: 5 },
    });
    expect(noticeAgeViewOf(NOW, NOW - 3 * 3_600_000)).toEqual({
      id: "desktop.approvals.age.hours",
      params: { count: 3 },
    });
    expect(noticeAgeViewOf(NOW, NOW - 2 * 86_400_000)).toEqual({
      id: "desktop.approvals.age.days",
      params: { count: 2 },
    });
  });
});

/** 대화 없는 알림 한 줄(지운 경계 시험용) */
const entry = (seq: number): NoticeEntry => ({ notice: notice(seq), threadId: null });

describe("cleared notices", () => {
  test("the boundary only moves up, and notices at or below it are dropped", () => {
    const boundary = createClearedBoundary();
    expect(boundary.read()).toBe(0);
    boundary.clearThrough(7);
    boundary.clearThrough(3);
    expect(boundary.read()).toBe(7);
    expect(noticesAfter(boundary.read(), [entry(6), entry(7), entry(8)])).toEqual([entry(8)]);
  });

  test("a re-read after clearing brings back only the notices newer than the cleared ones", () => {
    const boundary = createClearedBoundary();
    const shown = mergeNotices([], [entry(1), entry(2), entry(3), entry(4), entry(5)]);
    boundary.clearThrough(highestSeqOf(shown));
    // 화면을 떠났다 돌아와 빈 목록에서 다시 읽는다. 지운 1..5는 돌아오지 않고 6, 7만 보인다
    const reread = mergeNotices(
      [],
      noticesAfter(boundary.read(), [1, 2, 3, 4, 5, 6, 7].map(entry)),
    );
    expect(reread.map((e) => e.notice.seq)).toEqual([7, 6]);
  });

  test("the highest seq of nothing is zero", () => {
    expect(highestSeqOf([])).toBe(0);
  });

  test("a delivered entry keeps its delivery time when a later list read gives the same notice", () => {
    const merged = mergeNotices(
      [{ notice: notice(5), threadId: null, deliveredAt: 1000 }],
      [{ notice: notice(5), threadId: null }],
    );
    expect(merged).toEqual([{ notice: notice(5), threadId: null, deliveredAt: 1000 }]);
  });
});
