import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { RetryStatus } from "../../src/views/composer.tsx";
import { CutMarker } from "../../src/views/turn-failure-row.tsx";
import { retryLineOf, retrySecondsLeft } from "../../src/views/retry-status-model.ts";

// 입력창 재시도 상태 줄과 끊김 표시(L4 desktop-ux). 효과 없는 서버 렌더로 문구 값을 비교한다. 시각은 시험이 고정한다.

const RETRY = { attempt: 2, maxRetries: 3, waitMs: 4000, at: 1_000_000 };

describe("재시도 남은 초", () => {
  test("받은 시각에서 대기 시간을 센다. 초는 올림하고 지나면 0이다", () => {
    expect(retrySecondsLeft(RETRY, 1_000_000)).toBe(4);
    expect(retrySecondsLeft(RETRY, 1_001_000)).toBe(3);
    expect(retrySecondsLeft(RETRY, 1_003_500)).toBe(1);
    expect(retrySecondsLeft(RETRY, 1_003_999)).toBe(1);
    expect(retrySecondsLeft(RETRY, 1_004_000)).toBe(0);
    expect(retrySecondsLeft(RETRY, 1_009_000)).toBe(0);
  });

  test("문구 값: 남은 초가 있으면 초를, 0이면 곧을 고른다", () => {
    expect(retryLineOf(RETRY, 1_001_000)).toEqual({
      soon: false,
      attempt: 2,
      max: 3,
      seconds: 3,
    });
    expect(retryLineOf(RETRY, 1_004_000)).toEqual({ soon: true, attempt: 2, max: 3 });
  });
});

describe("입력창 재시도 상태 줄", () => {
  test("남은 초를 보인다", () => {
    const markup = renderToString(<RetryStatus retry={RETRY} clock={() => 1_000_000} />);
    expect(markup).toContain(">다시 시도하는 중 (2/3) · 4초<");
  });

  test("대기가 끝났으면 곧이라고 보인다", () => {
    const markup = renderToString(<RetryStatus retry={RETRY} clock={() => 1_005_000} />);
    expect(markup).toContain(">다시 시도하는 중 (2/3) · 곧<");
  });
});

describe("끊김 표시", () => {
  test("부분 답 뒤에 흐린 한 줄로 끊겼다고 보인다", () => {
    const markup = renderToString(<CutMarker />);
    expect(markup).toContain('data-cut-marker="true"');
    expect(markup).toContain(">여기서 끊겼어요<");
  });
});
