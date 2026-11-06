import { expect, test } from "bun:test";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import {
  blankThreadIn,
  isBlankThread,
  planNewThread,
  recentWorkspacesOf,
} from "../../src/views/new-thread-model.ts";
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
});

test("no selected thread asks for a folder", () => {
  expect(planNewThread([summary({})], null)).toEqual({ kind: "pickFolder" });
  expect(planNewThread([summary({ workspace: null })], thr(1))).toEqual({ kind: "pickFolder" });
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
