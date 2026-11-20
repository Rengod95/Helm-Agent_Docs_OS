import { describe, expect, test } from "bun:test";
import { RAIL_GAP, railInsetOf } from "../../../src/views/craft/metrics/rail-avoid.ts";

// 1440 창의 실제 자리(m6X3 측정): 막대 x 1394~1428, y 412~506. 카드 1101~1420, 안쪽 여백 16
const rail = { top: 412, bottom: 506, left: 1394, right: 1428 };
const card = (top: number, bottom: number) => ({ top, bottom, left: 1101, right: 1420 });

describe("railInsetOf", () => {
  test("막대와 같은 높이의 카드는 내용 끝이 막대 왼쪽 − 틈에 오도록 끝 여백을 더한다", () => {
    // 내용 끝 1404, 막대 왼쪽 − 8 = 1386 → 18
    expect(railInsetOf(card(420, 650), rail, 16)).toBe(18);
  });

  test("막대보다 위나 아래에 있으면(틈 포함) 0이다", () => {
    expect(railInsetOf(card(133, 370), rail, 16)).toBe(0);
    expect(railInsetOf(card(rail.bottom + RAIL_GAP, 800), rail, 16)).toBe(0);
    expect(railInsetOf(card(100, rail.top - RAIL_GAP), rail, 16)).toBe(0);
  });

  test("틈 안쪽에 걸치면 비킨다", () => {
    expect(railInsetOf(card(100, rail.top - RAIL_GAP + 1), rail, 16)).toBe(18);
  });

  test("기본 끝 여백이 작을수록 더 많이 비킨다(접힌 줄 8 → 26)", () => {
    expect(railInsetOf(card(420, 456), rail, 8)).toBe(26);
  });

  test("내용이 이미 막대 왼쪽에서 끝나거나 막대가 없으면 0이다", () => {
    expect(railInsetOf({ top: 420, bottom: 460, left: 300, right: 1300 }, rail, 0)).toBe(0);
    expect(railInsetOf(card(420, 650), null, 16)).toBe(0);
  });
});
