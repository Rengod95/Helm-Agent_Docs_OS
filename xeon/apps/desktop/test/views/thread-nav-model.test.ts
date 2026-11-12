import { describe, expect, test } from "bun:test";
import type { ThreadOrigin } from "@fresnel/contracts/wire";
import {
  relativeTimeOf,
  rowBadgeOf,
  rowLabelOf,
  rowOpensChat,
  threadMatches,
} from "../../src/views/thread-nav-model.ts";
import { evt, summary, thr, trn } from "../state/helpers.ts";

const RESUMABLE = {
  turnId: trn(1),
  runningSince: "2026-11-07T00:00:00.000Z",
  resumeAttempts: 0,
};
const FROM_SCHEDULE: ThreadOrigin = { kind: "schedule", scheduleId: "sch_aa1" };

describe("rowBadgeOf", () => {
  test("a thread a schedule started shows the schedule badge", () => {
    const thread = summary(thr(1), { origin: FROM_SCHEDULE });
    expect(rowBadgeOf(thread, 0, false)).toBe("schedule");
  });
  test("a user thread gets no badge and a remote thread gets the remote badge", () => {
    expect(rowBadgeOf(summary(thr(2), { origin: { kind: "user" } }), 0, false)).toBeNull();
    expect(rowBadgeOf(summary(thr(3), { origin: { kind: "remote" } }), 0, false)).toBe("remote");
    expect(rowBadgeOf(summary(thr(3), { origin: { kind: "remote" } }), 1, false)).toBe("approvals");
  });
  test("a thread with no origin mark shows no badge unless it is a child", () => {
    expect(rowBadgeOf(summary(thr(4)), 0, false)).toBeNull();
    expect(rowBadgeOf(summary(thr(4)), 0, true)).toBe("sub");
    // 보내지 못한 대화 표시는 하위 표식보다 먼저, 승인 수보다 뒤다
    expect(rowBadgeOf(summary(thr(4)), 0, true, true)).toBe("unsent");
    expect(rowBadgeOf(summary(thr(4)), 2, false, true)).toBe("approvals");
  });
  test("resumable and pending approvals win over the schedule badge", () => {
    const resumable = summary(thr(5), { origin: FROM_SCHEDULE, resumable: RESUMABLE });
    expect(rowBadgeOf(resumable, 0, false)).toBe("resumable");
    // 승인을 기다리는 턴은 이어서 실행 후보가 아니라서 승인 수가 이긴다
    // 답이 필요한 승인이 이어서 실행보다 앞이다(DP-104)
    expect(rowBadgeOf(resumable, 2, false)).toBe("approvals");
    expect(rowBadgeOf(summary(thr(6), { origin: FROM_SCHEDULE }), 2, false)).toBe("approvals");
  });
  test("the schedule badge comes before the closed badge", () => {
    const closed = summary(thr(7), { origin: FROM_SCHEDULE, status: "closed" });
    expect(rowBadgeOf(closed, 0, false)).toBe("schedule");
    expect(rowBadgeOf(summary(thr(8), { status: "closed" }), 0, false)).toBe("closed");
  });
  test("a schedule child shows the schedule badge, not the sub badge", () => {
    const child = summary(thr(9), {
      origin: FROM_SCHEDULE,
      spawnedBy: { threadId: thr(1), kind: "subagent" },
    });
    expect(rowBadgeOf(child, 0, true)).toBe("schedule");
  });
  test("a forked thread shows the fork badge only when no other badge applies", () => {
    const forked = summary(thr(10), { forkedFrom: { threadId: thr(1), eventId: evt(1) } });
    expect(rowBadgeOf(forked, 0, false)).toBe("forked");
    expect(rowBadgeOf(forked, 0, true)).toBe("sub");
    expect(rowBadgeOf(forked, 1, false)).toBe("approvals");
    expect(
      rowBadgeOf(
        summary(thr(11), { forkedFrom: { threadId: thr(1), eventId: evt(1) }, status: "closed" }),
        0,
        false,
      ),
    ).toBe("closed");
  });
});

describe("rowOpensChat", () => {
  test("goes to the chat from settings in either area", () => {
    expect(rowOpensChat({ screen: "settings", area: "chat", chatPlaceScreen: "chat" })).toBe(true);
    expect(rowOpensChat({ screen: "settings", area: "workbench", chatPlaceScreen: "chat" })).toBe(
      true,
    );
  });
  test("goes to the chat from a full page of the chat area", () => {
    for (const place of ["inbox", "schedules", "proposals", "connection", "first-run"]) {
      expect(rowOpensChat({ screen: "chat", area: "chat", chatPlaceScreen: place })).toBe(true);
    }
  });
  test("stays put when already in the chat or in the workbench area", () => {
    expect(rowOpensChat({ screen: "chat", area: "chat", chatPlaceScreen: "chat" })).toBe(false);
    expect(rowOpensChat({ screen: "chat", area: "workbench", chatPlaceScreen: "inbox" })).toBe(
      false,
    );
  });
});

describe("threadMatches", () => {
  test("an empty query matches everything, otherwise the title must contain it, case-insensitive", () => {
    expect(threadMatches({ title: "Calc 함수" }, "  ")).toBe(true);
    expect(threadMatches({ title: "Calc 함수" }, "calc")).toBe(true);
    expect(threadMatches({ title: "Calc 함수" }, "함수")).toBe(true);
    expect(threadMatches({ title: "Calc 함수" }, "sub")).toBe(false);
  });
  test("an untitled thread does not match a query", () => {
    expect(threadMatches({ title: null }, "")).toBe(true);
    expect(threadMatches({ title: null }, "a")).toBe(false);
  });
});

describe("relativeTimeOf", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");
  test("under a minute is now, then minutes, hours and days", () => {
    expect(relativeTimeOf("2026-11-12T11:59:30.000Z", now)).toEqual({ unit: "now" });
    expect(relativeTimeOf("2026-11-12T11:57:00.000Z", now)).toEqual({ unit: "minutes", count: 3 });
    expect(relativeTimeOf("2026-11-12T09:00:00.000Z", now)).toEqual({ unit: "hours", count: 3 });
    expect(relativeTimeOf("2026-11-10T12:00:00.000Z", now)).toEqual({ unit: "days", count: 2 });
  });
  test("a week or more is a month and day, and an unreadable time is now", () => {
    const old = relativeTimeOf("2026-10-01T12:00:00.000Z", now);
    expect(old.unit).toBe("date");
    expect(relativeTimeOf("nope", now)).toEqual({ unit: "now" });
  });
});

describe("rowLabelOf", () => {
  test("a titled thread shows its title, not dimmed, even when it also has a preview", () => {
    const thread = summary(thr(1), { title: "정한 제목", preview: "첫 입력" });
    expect(rowLabelOf(thread)).toEqual({ text: "정한 제목", dim: false });
  });
  test("an untitled thread with a preview shows the preview dimmed in the title's place", () => {
    const thread = summary(thr(2), { preview: "처음 보낸 말을 여기서 봐요" });
    expect(rowLabelOf(thread)).toEqual({ text: "처음 보낸 말을 여기서 봐요", dim: true });
  });
  test("an untitled thread without a preview has no text, so the caller shows the untitled label", () => {
    expect(rowLabelOf(summary(thr(3)))).toEqual({ text: null, dim: true });
  });
  test("a preview is never used as the title for filtering", () => {
    expect(threadMatches(summary(thr(4), { preview: "찾는 말" }), "찾는 말")).toBe(false);
  });
});
