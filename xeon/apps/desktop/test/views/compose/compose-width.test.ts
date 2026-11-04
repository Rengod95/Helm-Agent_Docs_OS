import { describe, expect, test } from "bun:test";
import { isCompactWidth } from "../../../src/views/compose/compose-width.ts";

// 구성 화면 본문 폭의 캔버스·개요 가름. 경계 720은 셸의 compact 경계와 같다.

describe("isCompactWidth", () => {
  test("720 이하는 개요 편집기(compact), 721부터는 캔버스다", () => {
    expect(isCompactWidth(0)).toBe(true);
    expect(isCompactWidth(480)).toBe(true);
    expect(isCompactWidth(720)).toBe(true);
    expect(isCompactWidth(721)).toBe(false);
    expect(isCompactWidth(1280)).toBe(false);
  });
});
