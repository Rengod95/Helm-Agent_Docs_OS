import { describe, expect, test } from "bun:test";
import {
  contextThreadGroupsOf,
  folderLabel,
  groupByWorkspace,
} from "../../src/views/thread-groups.ts";
import { summary, thr } from "../state/helpers.ts";

const TRIAL = { profileId: null, target: null, paused: false };

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

describe("contextThreadGroupsOf", () => {
  test("puts test-run threads only in the trials group and ordinary threads only in the threads group, keeping order", () => {
    const first = summary(thr(1), { title: "첫 대화" });
    const trialA = summary(thr(2), { title: "시험 A", testRun: TRIAL });
    const second = summary(thr(3), { title: null });
    const trialB = summary(thr(4), { title: "시험 B", testRun: { ...TRIAL, paused: true } });
    const groups = contextThreadGroupsOf([first, trialA, second, trialB]);
    expect(groups).toEqual({ threads: [first, second], trials: [trialA, trialB] });
  });
  test("a thread with no test-run mark is never a trial, even when it has no title", () => {
    const plain = summary(thr(5), { title: null, status: "closed" });
    expect(contextThreadGroupsOf([plain])).toEqual({ threads: [plain], trials: [] });
  });
  test("is empty in both groups for no threads", () => {
    expect(contextThreadGroupsOf([])).toEqual({ threads: [], trials: [] });
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
