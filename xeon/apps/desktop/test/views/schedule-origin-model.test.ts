import { describe, expect, test } from "bun:test";
import { scheduleOriginTextOf } from "../../src/views/schedule-origin-model.ts";

// 대화 머리의 예약 줄 글: "예약 · <제목> · <n>번째 실행". 모르는 부분은 빠진다.

describe("scheduleOriginTextOf", () => {
  test("shows the schedule title and the run ordinal", () => {
    expect(scheduleOriginTextOf("캐시 정리", 2)).toBe("예약 · 캐시 정리 · 2번째 실행");
  });
  test("drops the ordinal while the run is not in the run list yet", () => {
    expect(scheduleOriginTextOf("캐시 정리", null)).toBe("예약 · 캐시 정리");
  });
  test("drops the title when there is none, keeping the ordinal", () => {
    expect(scheduleOriginTextOf(null, 3)).toBe("예약 · 3번째 실행");
  });
  test("is just the label when the schedule is gone or its list could not be read", () => {
    expect(scheduleOriginTextOf(null, null)).toBe("예약");
  });
});
