import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  THREADLESS_NOTICE_SEQ_BASE,
  type Notice,
  type NoticeKind,
} from "@fresnel/contracts/capabilities";
import { Bug } from "@fresnel/contracts";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadOrigin } from "@fresnel/contracts/wire";
import {
  coalesceStep,
  notifyTargetOf,
  osNoticeOf,
  permissionViewOf,
  type NotifyCategory,
  type NotifyPrefs,
  type OsNoticeInput,
  type OsNoticePlan,
} from "../../src/views/os-notify-model.ts";

// OS 알림 순수 모델(B-10). 분류, 창 앞과 뒤, 꺼짐, 제목과 본문, 3초 모으기, 권한 보기, 누르기 규칙을 값으로 본다.
// 제목과 본문의 글은 화면 언어에 따라 달라지므로 기대값은 같은 카탈로그 문장으로 만든다.

function thread(raw: string): ThreadId {
  if (!isId("thr", raw)) throw new Bug(`test fixture thread id is malformed: ${raw}`);
  return raw;
}

const T1 = thread("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const T2 = thread("thr_01BX5ZZKBKACTAV9WEVGEMMVRZ");
const ON: NotifyPrefs = { turnDone: true, approval: true, scheduleFailed: true };
const SCHEDULE: ThreadOrigin = { kind: "schedule", scheduleId: "daily" };

function notice(kind: NoticeKind, body: string | null = null): Notice {
  return {
    kind,
    title: "원래 제목",
    body,
    seq: 7,
    sourceType: "dialog.notified",
    createdAt: 1000,
  };
}

function inputOf(over: Partial<OsNoticeInput> = {}): OsNoticeInput {
  return {
    notice: notice("completed"),
    threadId: T1,
    threadOrigin: null,
    threadTitle: "빌드 실패 분석",
    windowFocused: false,
    prefs: ON,
    ...over,
  };
}

function planOf(over: Partial<OsNoticeInput> = {}): OsNoticePlan | null {
  return osNoticeOf(inputOf(over));
}

describe("osNoticeOf classification", () => {
  test("completed and background_completed go to the turn-done category", () => {
    expect(planOf({ notice: notice("completed") })?.category).toBe("turnDone");
    expect(planOf({ notice: notice("background_completed") })?.category).toBe("turnDone");
  });

  test("approval and question waiting go to the approval category", () => {
    expect(planOf({ notice: notice("approval_waiting") })?.category).toBe("approval");
    expect(planOf({ notice: notice("question_waiting") })?.category).toBe("approval");
  });

  test("an error goes to schedule-failed only for a schedule conversation", () => {
    expect(planOf({ notice: notice("error"), threadOrigin: SCHEDULE })?.category).toBe(
      "scheduleFailed",
    );
    expect(planOf({ notice: notice("error"), threadOrigin: { kind: "user" } })).toBeNull();
    expect(planOf({ notice: notice("error"), threadOrigin: { kind: "remote" } })).toBeNull();
    expect(planOf({ notice: notice("error"), threadOrigin: null })).toBeNull();
  });
});

describe("osNoticeOf window, switches, and text", () => {
  test("nothing is sent while the window is in front", () => {
    for (const kind of ["completed", "approval_waiting", "question_waiting"] as const) {
      expect(planOf({ notice: notice(kind), windowFocused: true })).toBeNull();
    }
    expect(
      planOf({ notice: notice("error"), threadOrigin: SCHEDULE, windowFocused: true }),
    ).toBeNull();
  });

  test("a switched-off category is not sent and the other categories still are", () => {
    const off: NotifyPrefs = { ...ON, approval: false };
    expect(planOf({ notice: notice("approval_waiting"), prefs: off })).toBeNull();
    expect(planOf({ notice: notice("completed"), prefs: off })?.category).toBe("turnDone");
    expect(
      planOf({
        notice: notice("error"),
        threadOrigin: SCHEDULE,
        prefs: { ...ON, scheduleFailed: false },
      }),
    ).toBeNull();
  });

  test("the title is 'what · thread title' and the body is one fixed line per kind", () => {
    expect(planOf({ notice: notice("approval_waiting") })).toEqual({
      category: "approval",
      title: t("desktop.osNotice.title", {
        what: t("desktop.osNotice.what.approval"),
        thread: "빌드 실패 분석",
      }),
      body: t("desktop.osNotice.body.approval"),
      threadId: T1,
    });
    expect(planOf({ notice: notice("completed") })).toEqual({
      category: "turnDone",
      title: t("desktop.osNotice.title", {
        what: t("desktop.osNotice.what.done"),
        thread: "빌드 실패 분석",
      }),
      body: t("desktop.osNotice.body.done"),
      threadId: T1,
    });
  });

  test("the notice's own title and body never reach the OS text", () => {
    const secret = "rm -rf / --token=SECRET-VALUE-9";
    const plan = planOf({ notice: notice("approval_waiting", secret) });
    expect(plan).not.toBeNull();
    expect(plan?.title).not.toContain("SECRET-VALUE");
    expect(plan?.body).not.toContain("SECRET-VALUE");
    expect(plan?.body).not.toContain("rm -rf");
    expect(plan?.title).not.toContain("원래 제목");
  });

  test("a missing or blank thread title is the untitled word", () => {
    const untitled = t("desktop.threads.untitled");
    expect(planOf({ threadTitle: null })?.title).toBe(
      t("desktop.osNotice.title", { what: t("desktop.osNotice.what.done"), thread: untitled }),
    );
    expect(planOf({ threadTitle: "   " })?.title).toBe(
      t("desktop.osNotice.title", { what: t("desktop.osNotice.what.done"), thread: untitled }),
    );
  });

  test("a notice without a conversation is sent with no thread id", () => {
    expect(planOf({ threadId: null, threadTitle: null })?.threadId).toBeNull();
  });
});

describe("osNoticeOf for a scheduled run that failed before its conversation opened", () => {
  // 대화 없는 예약 실패: 알림의 종류는 오류, 출처는 예약 실행 종료, seq는 대화 없는 알림의 범위다
  const THREADLESS: Notice = {
    kind: "error",
    title: "예약 작업이 실패했어요",
    body: "start_failed",
    seq: THREADLESS_NOTICE_SEQ_BASE + 7,
    sourceType: "schedule.run_finished",
    createdAt: 1000,
  };
  const threadless = (over: Partial<OsNoticeInput> = {}): OsNoticePlan | null =>
    osNoticeOf({
      notice: THREADLESS,
      threadId: null,
      threadOrigin: null,
      threadTitle: null,
      windowFocused: false,
      prefs: ON,
      ...over,
    });

  test("it is sent in the scheduled-failure category with no thread", () => {
    expect(threadless()).toEqual({
      category: "scheduleFailed",
      title: t("desktop.osNotice.what.scheduleFailed"),
      body: t("desktop.schedules.runs.reason.startFailed"),
      threadId: null,
    });
  });

  test("the body is the reason sentence and never the raw reason code", () => {
    const plan = threadless();
    expect(plan?.body).toBe(t("desktop.schedules.runs.reason.startFailed"));
    expect(plan?.body).not.toContain("start_failed");
    // 대화가 없으니 "대화에서 볼 수 있어요"라고 하지 않는다
    expect(plan?.body).not.toBe(t("desktop.osNotice.body.scheduleFailed"));
  });

  test("the switch for scheduled failures still turns it off", () => {
    expect(threadless({ prefs: { ...ON, scheduleFailed: false } })).toBeNull();
  });

  test("it is not sent while the window is in front", () => {
    expect(threadless({ windowFocused: true })).toBeNull();
  });

  test("an error from another source with no conversation is still not sent", () => {
    expect(threadless({ notice: { ...THREADLESS, sourceType: "turn.completed" } })).toBeNull();
  });
});

function planWith(category: NotifyCategory, threadId: ThreadId): OsNoticePlan {
  return { category, title: "제목", body: "본문", threadId };
}

describe("coalesceStep", () => {
  test("the same category and thread within three seconds is sent once", () => {
    const first = coalesceStep(new Map(), planWith("approval", T1), 0);
    expect(first.send).toBe(true);
    const within = coalesceStep(first.sent, planWith("approval", T1), 2999);
    expect(within.send).toBe(false);
    const after = coalesceStep(within.sent, planWith("approval", T1), 3000);
    expect(after.send).toBe(true);
  });

  test("another category or another thread is not merged", () => {
    const first = coalesceStep(new Map(), planWith("approval", T1), 0);
    expect(coalesceStep(first.sent, planWith("turnDone", T1), 1).send).toBe(true);
    expect(coalesceStep(first.sent, planWith("approval", T2), 1).send).toBe(true);
  });

  test("records older than the window are dropped from the map", () => {
    const one = coalesceStep(new Map(), planWith("approval", T1), 0);
    const two = coalesceStep(one.sent, planWith("turnDone", T2), 0);
    expect(two.sent.size).toBe(2);
    const later = coalesceStep(two.sent, planWith("approval", T1), 3000);
    expect(later.send).toBe(true);
    expect([...later.sent.keys()]).toEqual(["approval:" + T1]);
  });
});

describe("permissionViewOf", () => {
  test("granted is ok, and a failed last delivery turns it into failed", () => {
    expect(permissionViewOf("granted", false)).toEqual({
      kind: "ok",
      text: "desktop.notifySettings.state.ok",
    });
    expect(permissionViewOf("granted", true)).toEqual({
      kind: "failed",
      text: "desktop.notifySettings.state.failed",
    });
  });

  test("denied wins over a failed delivery", () => {
    expect(permissionViewOf("denied", false)).toEqual({
      kind: "denied",
      text: "desktop.notifySettings.state.denied",
    });
    expect(permissionViewOf("denied", true).kind).toBe("denied");
  });

  test("prompt and unknown show their own words unless a delivery failed", () => {
    expect(permissionViewOf("prompt", false)).toEqual({
      kind: "prompt",
      text: "desktop.notifySettings.state.prompt",
    });
    expect(permissionViewOf("unknown", false)).toEqual({
      kind: "unknown",
      text: "desktop.notifySettings.state.unknown",
    });
    expect(permissionViewOf("prompt", true).kind).toBe("failed");
    expect(permissionViewOf("unknown", true).kind).toBe("failed");
  });
});

describe("notifyTargetOf", () => {
  test("a non-empty thread id in the thread format is the target", () => {
    expect(notifyTargetOf(T1)).toBe(T1);
  });

  test("anything else is no target", () => {
    expect(notifyTargetOf(null)).toBeNull();
    expect(notifyTargetOf(undefined)).toBeNull();
    expect(notifyTargetOf("")).toBeNull();
    expect(notifyTargetOf(42)).toBeNull();
    expect(notifyTargetOf("not-a-thread")).toBeNull();
    expect(notifyTargetOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV\n")).toBeNull();
  });
});
