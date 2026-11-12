import { describe, expect, test } from "bun:test";
import {
  turnCostText,
  turnDurationText,
  usageRowsOf,
  usageTotalOf,
} from "../../src/views/chat-header.tsx";

// 대화 머리 턴별 사용량(DP-103)의 순수 값: 시간·비용 글, 표에 보일 턴, 합계.

describe("turn usage text", () => {
  test("duration is seconds under a minute, minutes and seconds above, a dash when unknown", () => {
    expect(turnDurationText(null)).toBe("—");
    expect(turnDurationText(42_400)).toBe("42초");
    expect(turnDurationText(100_000)).toBe("1분 40초");
  });

  test("cost keeps four decimals under a cent and two above, a dash when unknown", () => {
    expect(turnCostText(null)).toBe("—");
    expect(turnCostText(0.0015)).toBe("$0.0015");
    expect(turnCostText(1.234)).toBe("$1.23");
    expect(turnCostText(0)).toBe("$0.00");
  });
});

describe("usage rows and total", () => {
  test("the table shows the last eight turns, newest first, numbered from the start", () => {
    const turns = Array.from({ length: 10 }, (_, i) => `t${String(i + 1)}`);
    expect(usageRowsOf(turns).map((row) => [row.index, row.turn])).toEqual([
      [10, "t10"],
      [9, "t9"],
      [8, "t8"],
      [7, "t7"],
      [6, "t6"],
      [5, "t5"],
      [4, "t4"],
      [3, "t3"],
    ]);
  });

  test("the total adds only turns with usage, and cost stays null until one is known", () => {
    expect(usageTotalOf([{ usage: null }, { usage: { totalTokens: 10, cost: null } }])).toEqual({
      tokens: 10,
      cost: null,
    });
    expect(
      usageTotalOf([
        { usage: { totalTokens: 10, cost: 0.5 } },
        { usage: null },
        { usage: { totalTokens: 5, cost: 0.25 } },
      ]),
    ).toEqual({ tokens: 15, cost: 0.75 });
  });
});
