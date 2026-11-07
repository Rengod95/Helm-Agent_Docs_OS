import { describe, expect, test } from "bun:test";
import type { ThreadOrigin } from "@fresnel/contracts/wire";
import { rowBadgeOf, rowOpensChat } from "../../src/views/thread-nav-model.ts";
import { summary, thr, trn } from "../state/helpers.ts";

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
  test("a user or remote thread gets no schedule badge", () => {
    expect(rowBadgeOf(summary(thr(2), { origin: { kind: "user" } }), 0, false)).toBeNull();
    expect(rowBadgeOf(summary(thr(3), { origin: { kind: "remote" } }), 0, false)).toBeNull();
  });
  test("a thread with no origin mark shows no badge unless it is a child", () => {
    expect(rowBadgeOf(summary(thr(4)), 0, false)).toBeNull();
    expect(rowBadgeOf(summary(thr(4)), 0, true)).toBe("sub");
  });
  test("resumable and pending approvals win over the schedule badge", () => {
    const resumable = summary(thr(5), { origin: FROM_SCHEDULE, resumable: RESUMABLE });
    expect(rowBadgeOf(resumable, 0, false)).toBe("resumable");
    // 승인을 기다리는 턴은 이어서 실행 후보가 아니라서 승인 수가 이긴다
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
