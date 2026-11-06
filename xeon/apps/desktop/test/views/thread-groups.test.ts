import { describe, expect, test } from "bun:test";
import { folderLabel, groupByWorkspace } from "../../src/views/thread-groups.ts";

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
