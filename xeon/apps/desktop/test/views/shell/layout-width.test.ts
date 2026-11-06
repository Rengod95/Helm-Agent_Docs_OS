import { describe, expect, test } from "bun:test";
import { layoutWidthOf } from "../../../src/views/shell/shell.tsx";

// 앱 확대(`<html style="zoom">`)는 innerWidth를 바꾸지 않으므로 폭 판정은 확대로 나눈 CSS 폭을 쓴다.
describe("layoutWidthOf", () => {
  test("확대가 없으면 창 폭 그대로", () => {
    expect(layoutWidthOf(1100, "")).toBe(1100);
  });
  test("125/150/200% 확대", () => {
    expect(layoutWidthOf(1100, "1.25")).toBe(880);
    expect(layoutWidthOf(1100, "1.5")).toBeCloseTo(733.33, 1);
    expect(layoutWidthOf(1100, "2")).toBe(550);
  });
  test("읽을 수 없는 값은 무시", () => {
    expect(layoutWidthOf(900, "abc")).toBe(900);
    expect(layoutWidthOf(900, "0")).toBe(900);
  });
});
