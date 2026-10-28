import { expect, test } from "bun:test";
import { displayWidth, truncateToWidth } from "../src/render/width.ts";

// L4.cli.plan C8 스파이크의 자동 확인 부분. 기대 칸 수는 UAX #11(East Asian Width)과 UTS #51(이모지)에서 정했다.
// pi-tui 1.3.0 visibleWidth도 같은 값을 냈다(plan §C8 결과). 실제 터미널의 폭은 수동 확인 목록이 따로 본다.

const CASES: readonly (readonly [string, number, string])[] = [
  ["abc", 3, "ascii"],
  ["한글", 4, "Hangul syllables"],
  ["한글".normalize("NFD"), 4, "decomposed Hangul (conjoining jamo)"],
  ["ㅎㅏㄴ", 6, "compatibility jamo"],
  ["漢字", 4, "CJK ideographs"],
  ["ひらがなカタカナ", 16, "kana"],
  ["ｱｲｳ", 3, "halfwidth katakana"],
  ["ＡＢＣ", 6, "fullwidth Latin"],
  ["😀", 2, "emoji"],
  ["👨‍👩‍👧", 2, "ZWJ sequence"],
  ["🇰🇷", 2, "flag"],
  ["❤️", 2, "text symbol with emoji variation selector"],
  ["👍🏽", 2, "skin tone modifier"],
  ["é", 1, "combining acute accent"],
  ["…", 1, "ambiguous width is narrow"],
  ["가나다 abc 漢字 😀", 18, "mixed"],
  ["a\tb", 2, "control characters take no columns"],
];

test.each(CASES)("display width of %p is %p (%s)", (text, columns) => {
  expect(displayWidth(text)).toBe(columns);
});

test("truncation never exceeds the limit and never splits a wide character", () => {
  const cases: readonly (readonly [string, number])[] = [
    ["가나다라마", 5],
    ["가나다라마", 6],
    ["漢字漢字", 3],
    ["a한b글c", 4],
    ["😀😀😀", 5],
    ["가나다".normalize("NFD"), 3],
  ];
  for (const [text, limit] of cases) {
    const cut = truncateToWidth(text, limit);
    expect(displayWidth(cut)).toBeLessThanOrEqual(limit);
    expect(cut.endsWith("…")).toBe(true);
    expect(text.normalize("NFC").startsWith(cut.slice(0, -1).normalize("NFC"))).toBe(true);
  }
});

test("text that fits is returned unchanged", () => {
  expect(truncateToWidth("한글", 4)).toBe("한글");
  expect(truncateToWidth("abc", 3)).toBe("abc");
});

test("a limit too small for the ellipsis gives just the ellipsis", () => {
  expect(truncateToWidth("한글", 1)).toBe("…");
});
