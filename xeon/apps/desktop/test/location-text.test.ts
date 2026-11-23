import { describe, expect, test } from "bun:test";
import { middleEllipsisOf, revealablePathOf } from "../src/views/workbench/location-text.ts";

// 설치 위치 칸(AGE-77 S-09 라): 가운데 말줄임과 "폴더에서 보기"를 달 수 있는 경로인지.

describe("middleEllipsisOf", () => {
  test("keeps a text that already fits", () => {
    expect(middleEllipsisOf("short", 48)).toBe("short");
    expect(middleEllipsisOf("abcdefghij", 10)).toBe("abcdefghij");
  });

  test("keeps the head and the tail and joins them with one ellipsis", () => {
    // 상한 12: 말줄임 한 자를 뺀 11자를 앞 6자와 뒤 5자로 나눈다
    expect(middleEllipsisOf("0123456789ABCDEFGHIJ", 12)).toBe("012345…FGHIJ");
    expect(middleEllipsisOf("0123456789ABCDEFGHIJ", 12)).toHaveLength(12);
  });

  test("counts characters, not UTF-16 units, so Korean text is not cut in half", () => {
    expect(middleEllipsisOf("가나다라마바사아", 5)).toBe("가나…사아");
  });
});

describe("revealablePathOf", () => {
  test("an absolute path can be shown in the folder", () => {
    expect(revealablePathOf("/Users/u/Library/Application Support/fresnel/x")).toBe(
      "/Users/u/Library/Application Support/fresnel/x",
    );
  });

  test("a source label such as builtin is not a path", () => {
    expect(revealablePathOf("builtin")).toBeNull();
    expect(revealablePathOf("")).toBeNull();
  });
});
