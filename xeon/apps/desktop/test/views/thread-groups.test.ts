import { describe, expect, test } from "bun:test";
import {
  folderLabel,
  folderPartsOf,
  groupByWorkspace,
  listedThreadsOf,
  sidebarGroupsOf,
} from "../../src/views/thread-groups.ts";
import { summary, thr } from "../state/helpers.ts";

describe("groupByWorkspace", () => {
  test("keeps first-seen folder order and puts folderless threads last", () => {
    const groups = groupByWorkspace([
      { id: "a", workspace: "/x/b" },
      { id: "b", workspace: null },
      { id: "c", workspace: "/x/a" },
      { id: "d", workspace: "/x/b" },
    ]);
    expect(groups.map((g) => [g.workspace, g.items.map((i) => i.id)])).toEqual([
      ["/x/b", ["a", "d"]],
      ["/x/a", ["c"]],
      [null, ["b"]],
    ]);
  });
  test("is empty for no threads", () => {
    expect(groupByWorkspace([])).toEqual([]);
  });
});

describe("folderLabel", () => {
  test("shows the last two segments of a long path", () => {
    expect(folderLabel("/Users/me/code/fresnel")).toBe("…/code/fresnel");
  });
  test("keeps a short path whole", () => {
    expect(folderLabel("/notes")).toBe("/notes");
    expect(folderLabel("/a/b")).toBe("/a/b");
  });
});

describe("folderPartsOf", () => {
  test("splits the last folder name from its parent path", () => {
    expect(folderPartsOf("/Users/me/webui-home-cyY/work")).toEqual({
      name: "work",
      parent: "/Users/me/webui-home-cyY",
    });
  });
  test("ignores a trailing separator", () => {
    expect(folderPartsOf("/Users/me/proj/")).toEqual({ name: "proj", parent: "/Users/me" });
  });
  test("a folder right under the root has the root as its parent", () => {
    expect(folderPartsOf("/notes")).toEqual({ name: "notes", parent: "/" });
  });
  test("reads Windows separators too", () => {
    expect(folderPartsOf("C:\\work\\app")).toEqual({ name: "app", parent: "C:\\work" });
  });
  test("a path with no separator is all name", () => {
    expect(folderPartsOf("work")).toEqual({ name: "work", parent: "" });
    expect(folderPartsOf("/")).toEqual({ name: "/", parent: "" });
  });
});

describe("sidebarGroupsOf", () => {
  const parent = summary(thr(1), { title: "부모", workspace: "/p/app" });
  const sub = summary(thr(2), {
    title: "explore",
    workspace: null,
    spawnedBy: { threadId: thr(1), kind: "subagent" },
  });
  const review = summary(thr(3), {
    title: "부모",
    workspace: "/p/app",
    spawnedBy: { threadId: thr(1), kind: "internal" },
  });
  const other = summary(thr(4), { title: "다른", workspace: "/p/other" });

  test("hides internal conversations and nests a sub conversation under its parent's folder", () => {
    // 목록은 최근 활동 먼저: 자식과 검토 대화가 부모보다 앞에 온다
    const groups = sidebarGroupsOf([review, sub, other, parent]);
    expect(
      groups.map((g) => [g.workspace, g.items.map((r) => [r.thread.threadId, r.child])]),
    ).toEqual([
      ["/p/other", [[thr(4), false]]],
      [
        "/p/app",
        [
          [thr(1), false],
          [thr(2), true],
        ],
      ],
    ]);
  });

  test("a sub conversation whose parent is not listed stays where its own folder puts it", () => {
    const groups = sidebarGroupsOf([sub]);
    expect(
      groups.map((g) => [g.workspace, g.items.map((r) => [r.thread.threadId, r.child])]),
    ).toEqual([[null, [[thr(2), false]]]]);
  });
});

describe("listedThreadsOf (lcM6e)", () => {
  test("drops test-run threads from the plain list and keeps the order of the rest", () => {
    const plain = summary(thr(1), { title: "보통", workspace: "/p/app" });
    const run = summary(thr(2), {
      title: "테스트 런",
      workspace: "/p/app",
      testRun: { profileId: "review", target: "helm", paused: false },
    });
    const draftRun = summary(thr(3), {
      title: "드래프트 런",
      workspace: null,
      testRun: { profileId: null, target: null, paused: true, kind: "draft", draft: true },
    });
    const later = summary(thr(4), { title: "나중", workspace: null });
    const listed = listedThreadsOf([plain, run, draftRun, later]);
    expect(listed.map((thread) => thread.threadId)).toEqual([thr(1), thr(4)]);
    expect(
      sidebarGroupsOf(listed).map((group) => [
        group.workspace,
        group.items.map((row) => row.thread.title),
      ]),
    ).toEqual([
      ["/p/app", ["보통"]],
      [null, ["나중"]],
    ]);
  });
});
