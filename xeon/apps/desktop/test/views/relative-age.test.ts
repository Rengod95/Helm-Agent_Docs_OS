import { describe, expect, test } from "bun:test";
import { dueAgeOf, relativeAgeOf } from "../../src/views/pages/shared/relative-age.ts";

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

// 다음 실행(앞으로의 시각). 시각은 지역 시각 생성자로 만들어 어느 시간대에서나 같은 값이다.

/** 2026년 11월 `day`일 `hour`시 `minute`분(지역 시각)의 epoch ms */
function at(day: number, hour: number, minute: number): number {
  return new Date(2026, 10, day, hour, minute).getTime();
}

describe("dueAgeOf", () => {
  const NOW_AT = at(4, 8, 0);

  test("a time a minute or less ahead, or already past, is soon", () => {
    expect(dueAgeOf(NOW_AT + 59_000, NOW_AT, "absolute")).toEqual({
      id: "desktop.common.due.soon",
      args: {},
    });
    expect(dueAgeOf(NOW_AT - 10 * MINUTE, NOW_AT, "absolute")).toEqual({
      id: "desktop.common.due.soon",
      args: {},
    });
  });

  test("within the hour the minutes count down", () => {
    expect(dueAgeOf(NOW_AT + 3 * MINUTE + 30_000, NOW_AT, "absolute")).toEqual({
      id: "desktop.common.due.inMinutes",
      args: { count: 3 },
    });
  });

  test("later the same day it is the clock time, padded to two digits", () => {
    expect(dueAgeOf(at(4, 14, 20), NOW_AT, "absolute")).toEqual({
      id: "desktop.common.due.at",
      args: { time: "14:20" },
    });
    expect(dueAgeOf(at(4, 9, 5), NOW_AT, "absolute")).toEqual({
      id: "desktop.common.due.at",
      args: { time: "09:05" },
    });
  });

  test("the next calendar day says tomorrow with the clock time", () => {
    expect(dueAgeOf(at(5, 9, 0), NOW_AT, "absolute")).toEqual({
      id: "desktop.common.due.tomorrow",
      args: { time: "09:00" },
    });
  });

  test("further out it is the absolute text the caller gives", () => {
    expect(dueAgeOf(at(9, 9, 5), NOW_AT, "11월 9일 09:05")).toEqual({
      id: "desktop.common.due.at",
      args: { time: "11월 9일 09:05" },
    });
  });
});
