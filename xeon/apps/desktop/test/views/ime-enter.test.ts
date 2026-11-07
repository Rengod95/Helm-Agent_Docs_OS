import { describe, expect, test } from "bun:test";
import { isCommitEnter, isImeEnter, type ImeKeyEvent } from "../../src/views/ime-enter.ts";

function key(key: string, isComposing: boolean, keyCode: number): ImeKeyEvent {
  return { key, keyCode, nativeEvent: { isComposing } };
}

describe("isCommitEnter", () => {
  test("조합 중 Enter(isComposing 참)는 저장하지 않는다", () => {
    expect(isCommitEnter(key("Enter", true, 13))).toBe(false);
    expect(isImeEnter(key("Enter", true, 13))).toBe(true);
  });

  test("조합을 확정한 keydown(keyCode 229)은 저장하지 않는다", () => {
    expect(isCommitEnter(key("Enter", false, 229))).toBe(false);
    expect(isImeEnter(key("Enter", false, 229))).toBe(true);
  });

  test("조합이 끝난 Enter는 저장한다", () => {
    expect(isCommitEnter(key("Enter", false, 13))).toBe(true);
    expect(isImeEnter(key("Enter", false, 13))).toBe(false);
  });

  test("Enter가 아닌 키는 어느 쪽도 아니다", () => {
    expect(isCommitEnter(key("a", false, 65))).toBe(false);
    expect(isImeEnter(key("a", true, 229))).toBe(false);
  });
});
