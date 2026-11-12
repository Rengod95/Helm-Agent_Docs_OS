import { describe, expect, test } from "bun:test";
import {
  BUBBLE_CLAMP_LINES,
  bubbleClampedOf,
  bubbleLikelyClampedOf,
} from "../../src/views/convo/message-rows.tsx";
import { REWIND_POPOVER_ROOM_PX, rewindSideOf } from "../../src/views/convo/message-actions.tsx";
import { failureButtonsOf } from "../../src/views/turn-failure-row.tsx";

// 내 말 접기, 되감기 확인 자리(DP-147)와 턴 실패 띠의 단추(DP-146)

describe("내 말 접기", () => {
  test("그리기 전 어림: 줄바꿈 줄과 긴 줄의 감김을 센다", () => {
    expect(
      [
        "짧은 말",
        Array.from({ length: 12 }, () => "a").join("\n"),
        Array.from({ length: 13 }, () => "a").join("\n"),
        "가".repeat(48 * 12),
        "가".repeat(48 * 12 + 1),
      ].map(bubbleLikelyClampedOf),
    ).toEqual([false, false, true, false, true]);
  });

  test("12줄을 넘는 글만 접는다(본문 줄 높이 23 → 276px)", () => {
    expect(BUBBLE_CLAMP_LINES).toBe(12);
    expect(bubbleClampedOf(276, 23)).toBe(false);
    // 반올림 1px은 넘침으로 보지 않는다
    expect(bubbleClampedOf(277, 23)).toBe(false);
    expect(bubbleClampedOf(299, 23)).toBe(true);
    expect(bubbleClampedOf(70_000, 23)).toBe(true);
  });

  test("줄 높이를 읽지 못하면(normal → NaN) 23으로 본다", () => {
    expect(bubbleClampedOf(276, Number.NaN)).toBe(false);
    expect(bubbleClampedOf(300, Number.NaN)).toBe(true);
    expect(bubbleClampedOf(300, 0)).toBe(true);
  });
});

describe("되감기 확인을 여는 쪽", () => {
  test("단추 위에 팝오버 높이만큼 자리가 있으면 위, 없으면 왼쪽이다", () => {
    expect(REWIND_POPOVER_ROOM_PX).toBe(160);
    expect(rewindSideOf(400)).toBe("top");
    expect(rewindSideOf(160)).toBe("top");
    // 캡처 i4: 첫 말의 동작 단추가 창 위에서 100px
    expect(rewindSideOf(100)).toBe("left");
  });
});

describe("턴 실패 띠의 단추", () => {
  test("고치는 동작이면 그 단추와 다시 보내기를 함께 둔다", () => {
    expect(failureButtonsOf("open-providers", true)).toEqual({
      primary: "open-providers",
      resend: true,
    });
    expect(failureButtonsOf("change-key", false)).toEqual({ primary: "change-key", resend: false });
  });

  test("다시 보내기가 동작이면 단추는 하나이고, 보낼 글이 없으면 없다", () => {
    expect(failureButtonsOf("resend", true)).toEqual({ primary: "resend", resend: false });
    expect(failureButtonsOf("resend", false)).toEqual({ primary: null, resend: false });
  });

  test("다시 보내도 같은 실패(동작 없음)는 단추가 없다", () => {
    expect(failureButtonsOf(null, true)).toEqual({ primary: null, resend: false });
  });
});
