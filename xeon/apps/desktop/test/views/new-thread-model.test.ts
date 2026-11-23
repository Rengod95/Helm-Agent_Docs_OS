import { expect, test } from "bun:test";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import {
  blankThreadIn,
  isBlankThread,
  planNewThread,
  recentWorkspacesOf,
} from "../../src/views/new-thread-model.ts";
import { middleEllipsisOf } from "../../src/views/thread-groups.ts";
import { thr, trn } from "../state/helpers.ts";

function summary(patch: Partial<ThreadSummary>): ThreadSummary {
  return {
    threadId: thr(1),
    title: null,
    status: "idle",
    workspace: "/w/a",
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    headSeq: 1,
    forkedFrom: null,
    resumable: null,
    queuedInputs: 0,
    pendingApprovals: 0,
    ...patch,
  };
}

test("a thread with a turn or a title is not blank", () => {
  expect(isBlankThread(summary({}))).toBe(true);
  expect(isBlankThread(summary({ lastTurnId: trn(1) }))).toBe(false);
  expect(isBlankThread(summary({ title: "x" }))).toBe(false);
  expect(isBlankThread(summary({ status: "closed" }))).toBe(false);
  // Helm이 Drive한 대화: 사용자 말이 슬래시 명령뿐이어도 보낸 것이 있으면 빈 대화가 아니다
  expect(isBlankThread(summary({ preview: "/helm start 탐구" }))).toBe(false);
  expect(isBlankThread(summary({ queuedInputs: 1 }))).toBe(false);
});

test("no selected thread or an unknown folder opens a thread without a folder", () => {
  expect(planNewThread([summary({})], null)).toEqual({ kind: "createNoFolder" });
  expect(planNewThread([summary({ workspace: null, title: "x" })], thr(1))).toEqual({
    kind: "createNoFolder",
  });
  // 폴더 없는 빈 대화가 이미 있으면 그리로 간다
  expect(
    planNewThread(
      [summary({ workspace: null, title: "x" }), summary({ threadId: thr(2), workspace: null })],
      thr(1),
    ),
  ).toEqual({ kind: "open", threadId: thr(2) });
});

test("a caller that needs a folder still gets the folder picker when the folder is unknown", () => {
  expect(planNewThread([summary({})], null, "pick")).toEqual({ kind: "pickFolder" });
});

test("a Helm-driven thread (only a slash command sent) is not reused as blank", () => {
  const helm = summary({ preview: "/helm start 탐구", queuedInputs: 1 });
  expect(planNewThread([helm], thr(1))).toEqual({ kind: "create", workspace: "/w/a" });
  expect(blankThreadIn([helm], "/w/a")).toBeNull();
});

test("the selected folder opens a new thread there", () => {
  const used = summary({ title: "작업", lastTurnId: trn(1) });
  expect(planNewThread([used], thr(1))).toEqual({ kind: "create", workspace: "/w/a" });
});

test("a blank thread in the same folder is reused instead of creating another", () => {
  const used = summary({ title: "작업", lastTurnId: trn(1) });
  const blank = summary({ threadId: thr(2) });
  expect(planNewThread([used, blank], thr(1))).toEqual({ kind: "open", threadId: thr(2) });
  expect(blankThreadIn([used, blank], "/w/b")).toBeNull();
  expect(blankThreadIn([summary({ threadId: thr(3), workspace: null })], null)).toBe(thr(3));
});

test("recent folders are the distinct folders in list order, with their thread counts", () => {
  const threads = [
    summary({ threadId: thr(1), workspace: "/w/a" }),
    summary({ threadId: thr(2), workspace: null }),
    summary({ threadId: thr(3), workspace: "/w/b" }),
    summary({ threadId: thr(4), workspace: "/w/a" }),
    summary({ threadId: thr(5), workspace: "" }),
    summary({ threadId: thr(6), workspace: "/w/c" }),
  ];
  expect(recentWorkspacesOf(threads)).toEqual([
    { path: "/w/a", count: 2 },
    { path: "/w/b", count: 1 },
    { path: "/w/c", count: 1 },
  ]);
  expect(recentWorkspacesOf([summary({ workspace: null })])).toEqual([]);
  expect(recentWorkspacesOf([])).toEqual([]);
});

test("at most five recent folders are offered", () => {
  const threads = ["/w/1", "/w/2", "/w/3", "/w/4", "/w/5", "/w/6"].map((path, index) =>
    summary({ threadId: thr(index + 1), workspace: path }),
  );
  expect(recentWorkspacesOf(threads).map((recent) => recent.path)).toEqual([
    "/w/1",
    "/w/2",
    "/w/3",
    "/w/4",
    "/w/5",
  ]);
});

test("a thread's own default folder (<default>/<thread id>) is not a recent folder (R-07)", () => {
  const threads = [
    summary({ threadId: thr(1), workspace: `/home/u/.fresnel/threads/${thr(1)}` }),
    summary({ threadId: thr(2), workspace: `/home/u/.fresnel/threads/${thr(2)}/` }),
    summary({ threadId: thr(3), workspace: "/w/a" }),
    // 다른 대화의 기본 폴더(대화 id와 다른 이름)도 뺀다
    summary({ threadId: thr(7), workspace: `/home/u/.fresnel/default-project/${thr(8)}` }),
    // 다른 대화의 id와 같은 이름이어도 그 대화의 기본 폴더가 아니면 일반 폴더다
    summary({ threadId: thr(4), workspace: `/w/${thr(9)}` }),
  ];
  expect(recentWorkspacesOf(threads)).toEqual([
    { path: "/w/a", count: 1 },
    { path: `/w/${thr(9)}`, count: 1 },
  ]);
});

test("a new thread started from a no-project thread does not inherit its default folder (AGE-77)", () => {
  const own = `/home/u/.fresnel/default-project/${thr(1)}`;
  const used = summary({ threadId: thr(1), workspace: own, title: "x" });
  expect(planNewThread([used], thr(1))).toEqual({ kind: "createNoFolder" });
  const blank = summary({ threadId: thr(2), workspace: null });
  expect(planNewThread([used, blank], thr(1))).toEqual({ kind: "open", threadId: thr(2) });
});

test("middleEllipsisOf keeps the start and the folder name", () => {
  expect(middleEllipsisOf("/a/b", 40)).toBe("/a/b");
  expect(middleEllipsisOf("/Users/me/Library/Application Support/x/default-project/abc", 20)).toBe(
    "/Users/…-project/abc",
  );
});
