import { describe, expect, test } from "bun:test";
import type { ReadSlice } from "../src/files/upstream/read.ts";
import { pageEntries, pageRead } from "../src/truncate/paging.ts";

function slice(overrides: Partial<ReadSlice>): ReadSlice {
  return {
    text: "x",
    startLine: 1,
    shownLines: 1,
    fileLines: 1,
    cutBy: null,
    firstLineCut: false,
    ...overrides,
  };
}

describe("paging", () => {
  test("a slice that reaches the end is not truncated", () => {
    expect(pageRead(slice({ shownLines: 3, fileLines: 3 }))).toEqual({
      text: "x",
      startLine: 1,
      endLine: 3,
      totalLines: 3,
    });
  });

  test("nextOffset is endLine + 1 for lines, bytes and explicit limits", () => {
    expect(
      pageRead(slice({ startLine: 5, shownLines: 10, fileLines: 40, cutBy: "lines" })),
    ).toMatchObject({
      endLine: 14,
      truncated: { by: "lines", shown: 10, total: 40, nextOffset: 15 },
    });
    expect(pageRead(slice({ shownLines: 2, fileLines: 9, cutBy: "bytes" })).truncated?.by).toBe(
      "bytes",
    );
    // 한도에 걸리지 않았지만 남은 줄이 있으면(호출자가 준 limit) 줄 한도로 본다
    expect(pageRead(slice({ shownLines: 2, fileLines: 9 })).truncated).toEqual({
      by: "lines",
      shown: 2,
      total: 9,
      nextOffset: 3,
    });
  });

  test("a cut first line points at the next line", () => {
    expect(
      pageRead(slice({ shownLines: 1, fileLines: 1, cutBy: "bytes", firstLineCut: true })),
    ).toMatchObject({
      endLine: 1,
      truncated: { by: "bytes", shown: 1, nextOffset: 2 },
    });
  });

  test("an empty selection ends before its start", () => {
    expect(pageRead(slice({ text: "", shownLines: 0, fileLines: 0 }))).toMatchObject({
      startLine: 1,
      endLine: 0,
      totalLines: 0,
    });
  });

  test("entry limits carry the total only when it is known", () => {
    expect(pageEntries("entries", 3, 9)).toEqual({ by: "entries", shown: 3, total: 9 });
    expect(pageEntries("bytes", 3, undefined)).toEqual({ by: "bytes", shown: 3 });
  });
});
