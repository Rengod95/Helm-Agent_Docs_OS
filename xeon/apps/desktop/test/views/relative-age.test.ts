import { describe, expect, test } from "bun:test";
import { relativeAgeOf } from "../../src/views/pages/shared/relative-age.ts";

// 상대 시각(spec §6.0). 분, 시간, 일 단위로 내림하고 1분 안과 미래 시각은 "방금"이다.

const NOW = 10_000_000_000;
const MINUTE = 60_000;

describe("relativeAgeOf", () => {
  test("under a minute, or a time in the future, is just now", () => {
    expect(relativeAgeOf(NOW, NOW)).toEqual({ id: "desktop.common.age.justNow", args: {} });
    expect(relativeAgeOf(NOW - 59_000, NOW)).toEqual({
      id: "desktop.common.age.justNow",
      args: {},
    });
    expect(relativeAgeOf(NOW + MINUTE, NOW)).toEqual({
      id: "desktop.common.age.justNow",
      args: {},
    });
  });

  test("minutes, hours and days round down", () => {
    expect(relativeAgeOf(NOW - 3 * MINUTE - 30_000, NOW)).toEqual({
      id: "desktop.common.age.minutes",
      args: { count: 3 },
    });
    expect(relativeAgeOf(NOW - 5 * 60 * MINUTE, NOW)).toEqual({
      id: "desktop.common.age.hours",
      args: { count: 5 },
    });
    expect(relativeAgeOf(NOW - 26 * 60 * MINUTE, NOW)).toEqual({
      id: "desktop.common.age.days",
      args: { count: 1 },
    });
  });
});
