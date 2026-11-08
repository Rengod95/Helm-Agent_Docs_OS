import { describe, expect, test } from "bun:test";
import { folderLabel, groupByWorkspace, sidebarGroupsOf } from "../../src/views/thread-groups.ts";
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
