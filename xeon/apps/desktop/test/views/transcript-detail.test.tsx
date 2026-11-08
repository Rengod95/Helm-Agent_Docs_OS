import { afterEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  getTranscriptDetail,
  setTranscriptDetailValue,
  subscribeTranscriptDetail,
  transcriptDetailOf,
  TRANSCRIPT_DETAILS,
  useTranscriptDetail,
} from "../../src/views/transcript-detail.ts";

// 대화 기록 표시 정도의 값 읽기, 저장소의 구독 알림, 훅이 저장소 값을 읽는지 본다. 저장소는 모듈 상태라 시험마다 "full"로 되돌린다.

afterEach(() => setTranscriptDetailValue("full"));

function Probe(): ReactNode {
  return useTranscriptDetail();
}

describe("transcript detail", () => {
  test("the store starts at full and the value list is the three values in order", () => {
    expect(getTranscriptDetail()).toBe("full");
    expect(TRANSCRIPT_DETAILS).toEqual(["full", "summary", "hidden"]);
  });

  test("a stored value is kept when it is one of the three, and anything else is full", () => {
    for (const detail of TRANSCRIPT_DETAILS) expect(transcriptDetailOf(detail)).toBe(detail);
    expect(transcriptDetailOf(undefined)).toBe("full");
    expect(transcriptDetailOf(null)).toBe("full");
    expect(transcriptDetailOf("")).toBe("full");
    expect(transcriptDetailOf("verbose")).toBe("full");
    expect(transcriptDetailOf(1)).toBe("full");
  });

  test("subscribers hear each change once, not for the same value, and not after unsubscribe", () => {
    let calls = 0;
    const off = subscribeTranscriptDetail(() => {
      calls += 1;
    });
    setTranscriptDetailValue("summary");
    expect(calls).toBe(1);
    expect(getTranscriptDetail()).toBe("summary");

    setTranscriptDetailValue("summary");
    expect(calls).toBe(1);

    off();
    setTranscriptDetailValue("hidden");
    expect(calls).toBe(1);
    expect(getTranscriptDetail()).toBe("hidden");
  });

  test("the hook reads the value the store holds", () => {
    expect(renderToString(<Probe />)).toBe("full");
    setTranscriptDetailValue("hidden");
    expect(renderToString(<Probe />)).toBe("hidden");
  });
});
