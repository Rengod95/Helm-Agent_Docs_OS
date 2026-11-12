import { describe, expect, test } from "bun:test";
import { checklistOf } from "../../src/views/convo/task-checklist-model.ts";

describe("checklistOf (DP-143)", () => {
  test("first block: created rows, progress as of that call (0/3), not the later state", () => {
    const list = checklistOf(
      [
        { op: "create", ref: "@a", content: "a", status: null },
        { op: "create", ref: "@b", content: "b", status: null },
        { op: "create", ref: "@c", content: "c", status: null },
      ],
      "Created: @a=t1, @b=t2, @c=t3\n[ ] t1 a\n[ ] t2 b\n[ ] t3 c",
    );
    expect(list).toEqual({
      progress: { done: 0, total: 3 },
      rows: [
        { key: "t1", content: "a", status: "pending", changed: true },
        { key: "t2", content: "b", status: "pending", changed: true },
        { key: "t3", content: "c", status: "pending", changed: true },
      ],
      folded: [],
    });
  });

  test("an update block shows the whole list and marks only changed rows", () => {
    const list = checklistOf(
      [
        { op: "update", ref: "t1", content: null, status: "completed" },
        { op: "update", ref: "t2", content: null, status: "in_progress" },
      ],
      "[x] t1 a\n[>] t2 b 실행 중\n[ ] t3 c",
    );
    expect(list.progress).toEqual({ done: 1, total: 3 });
    expect(list.rows.map((r) => [r.key, r.status, r.changed])).toEqual([
      ["t1", "completed", true],
      ["t2", "in_progress", true],
      ["t3", "pending", false],
    ]);
  });

  test("no result yet: only this call's items, no progress", () => {
    expect(checklistOf([{ op: "create", ref: null, content: "a", status: null }], null)).toEqual({
      progress: null,
      rows: [{ key: "0:a", content: "a", status: "pending", changed: true }],
      folded: [],
    });
  });

  test("cancelled rows are not counted; long lists fold unchanged rows", () => {
    const lines = Array.from({ length: 11 }, (_, i) => `[x] t${i + 1} job ${i + 1}`);
    lines.push("[-] t12 dropped");
    lines.push("[>] t13 working");
    const list = checklistOf(
      [{ op: "update", ref: "t2", content: null, status: "completed" }],
      lines.join("\n"),
    );
    expect(list.progress).toEqual({ done: 11, total: 12 });
    expect(list.rows.map((r) => r.key)).toEqual(["t2", "t13"]);
    expect(list.folded.length).toBe(11);
  });
});
