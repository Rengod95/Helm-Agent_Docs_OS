import { describe, expect, test } from "bun:test";
import { railCutOf, RAIL_GAP, type Box } from "../../../src/views/shell/rail-avoid.ts";

// 끝까지 쓰는 화면이 막대를 비키는 폭(m6R5). 1440 창의 막대: 창 끝에서 12px, 폭 34, 본문 세로 가운데의 세 칸(높이 100 안팎)
const BAR: Box = { top: 400, bottom: 500, left: 1394, right: 1428 };
const row = (top: number, bottom: number, right: number): Box => ({
  top,
  bottom,
  left: 1100,
  right,
});

describe("rail cut", () => {
  test("a row that reaches under the bar at the bar's height stops 12px before the bar", () => {
    // 열 끝(창 끝 − 20 = 1420)까지 가는 줄: 막대 왼쪽 − 12 = 1382에서 끝나도록 38px 줄인다
    expect(railCutOf(row(440, 460, 1420), BAR, RAIL_GAP)).toBe(38);
  });

  test("rows above or below the bar (beyond the 12px gap) keep the full width", () => {
    expect(railCutOf(row(360, 388, 1420), BAR, RAIL_GAP)).toBe(0);
    expect(railCutOf(row(512, 540, 1420), BAR, RAIL_GAP)).toBe(0);
    // 틈 안에 드는 줄은 비킨다
    expect(railCutOf(row(370, 392, 1420), BAR, RAIL_GAP)).toBe(38);
  });

  test("a row that ends before the bar, or a screen without a bar, is left alone", () => {
    expect(railCutOf(row(440, 460, 1380), BAR, RAIL_GAP)).toBe(0);
    expect(railCutOf(row(440, 460, 1420), null, RAIL_GAP)).toBe(0);
    expect(railCutOf(row(440, 460, 1420), { ...BAR, bottom: BAR.top }, RAIL_GAP)).toBe(0);
  });

  test("the gap follows the app zoom (screen px)", () => {
    expect(railCutOf(row(440, 460, 1420), BAR, RAIL_GAP * 1.25)).toBe(41);
  });
});
