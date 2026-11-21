import { describe, expect, test } from "bun:test";
import {
  indentOf,
  lineDiffOf,
  linesOf,
  MAX_HANG,
  wholeFileRows,
} from "../../../src/views/craft/review/review-diff.ts";

// 갱신 항목의 전·후 줄 차이(review-diff.ts). 덩이, 접은 같은 줄 수, 줄 번호(지운 줄은 지난 판, 나머지는 새 판)를 값으로 본다.

const numbered = (count: number, prefix = "line"): string =>
  Array.from({ length: count }, (_, i) => `${prefix} ${String(i + 1)}`).join("\n") + "\n";

describe("line diff of two versions", () => {
  test("the same text has no hunks", () => {
    expect(lineDiffOf("a\nb\n", "a\nb\n")).toEqual({
      hunks: [],
      trailing: 2,
      added: 0,
      removed: 0,
    });
  });

  test("one changed line keeps three lines of context on each side and folds the rest", () => {
    const before = numbered(20);
    const after = before.replace("line 10\n", "line ten\n");
    const diff = lineDiffOf(before, after);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.trailing).toBe(7);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.skipped).toBe(6);
    expect(diff.hunks[0]?.rows.map((row) => [row.kind, row.number, row.text])).toEqual([
      ["context", 7, "line 7"],
      ["context", 8, "line 8"],
      ["context", 9, "line 9"],
      ["remove", 10, "line 10"],
      ["add", 10, "line ten"],
      ["context", 11, "line 11"],
      ["context", 12, "line 12"],
      ["context", 13, "line 13"],
    ]);
  });

  test("far-apart changes make two hunks; an added line shifts the new numbers", () => {
    const before = numbered(30);
    const after = before.replace("line 2\n", "line 2\nnew a\n").replace("line 28\n", "");
    const diff = lineDiffOf(before, after);
    expect(diff.hunks.map((hunk) => hunk.skipped)).toEqual([0, 19]);
    expect(diff.hunks[0]?.rows.find((row) => row.kind === "add")).toEqual({
      kind: "add",
      text: "new a",
      number: 3,
    });
    expect(diff.hunks[1]?.rows.find((row) => row.kind === "remove")).toEqual({
      kind: "remove",
      text: "line 28",
      number: 28,
    });
    expect([diff.added, diff.removed, diff.trailing]).toEqual([1, 1, 0]);
  });

  test("a file rewritten beyond the edit limit falls back to remove-all then add-all", () => {
    const before = numbered(700, "old");
    const after = numbered(700, "new");
    const diff = lineDiffOf(before, after);
    expect([diff.added, diff.removed, diff.hunks.length]).toEqual([700, 700, 1]);
    expect(diff.hunks[0]?.rows[0]).toEqual({ kind: "remove", text: "old 1", number: 1 });
    expect(diff.hunks[0]?.rows[700]).toEqual({ kind: "add", text: "new 1", number: 1 });
  });

  test("lines split on LF and CRLF, a final newline adds no line, and a whole file numbers from 1", () => {
    expect(linesOf("a\r\nb\n")).toEqual(["a", "b"]);
    expect(linesOf("")).toEqual([]);
    expect(wholeFileRows("x\ny", "context")).toEqual([
      { kind: "context", text: "x", number: 1 },
      { kind: "context", text: "y", number: 2 },
    ]);
  });
});

describe("wrapped line indent", () => {
  test("counts leading spaces, tabs to the next stop of 4, and stops at the first other character", () => {
    expect(indentOf("plain")).toBe(0);
    expect(indentOf("    return x;")).toBe(4);
    expect(indentOf("\tif (a) {")).toBe(4);
    expect(indentOf("  \tx")).toBe(4);
    expect(indentOf("\t\t  y  z")).toBe(10);
    expect(indentOf("   ")).toBe(3);
  });

  test("a very deep indent is capped so the wrapped part keeps room", () => {
    expect(indentOf(`${" ".repeat(80)}x`)).toBe(MAX_HANG);
  });
});
