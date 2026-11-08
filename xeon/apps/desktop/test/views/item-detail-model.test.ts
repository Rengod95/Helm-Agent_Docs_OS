import { describe, expect, test } from "bun:test";
import {
  thinkingModeOf,
  toolRowModeOf,
  toolRowOpenOf,
  type ThinkingMode,
  type ToolRowStatus,
} from "../../src/views/item-detail-model.ts";
import type { TranscriptDetail } from "../../src/views/transcript-detail.ts";

// 표시 정도별로 생각과 도구 줄이 어떻게 그려지는지의 표. 값을 그대로 비교한다.

const DETAILS: readonly TranscriptDetail[] = ["full", "summary", "hidden"];
const STATUSES: readonly ToolRowStatus[] = ["done", "failed", "running"];

describe("thinking mode", () => {
  test("full opens the thinking, summary closes it, hidden does not draw it", () => {
    const expected: ThinkingMode[] = ["open", "closed", "none"];
    expect(DETAILS.map((detail) => thinkingModeOf(detail))).toEqual(expected);
  });
});

describe("tool row mode", () => {
  test("full keeps every row as it is today", () => {
    expect(STATUSES.map((status) => toolRowModeOf("full", status))).toEqual([
      "default",
      "default",
      "default",
    ]);
  });

  test("summary collapses every row except a failed one, which keeps its default", () => {
    expect(STATUSES.map((status) => toolRowModeOf("summary", status))).toEqual([
      "collapsed",
      "default",
      "collapsed",
    ]);
  });

  test("hidden drops only the done rows and keeps failed and running rows as default", () => {
    expect(STATUSES.map((status) => toolRowModeOf("hidden", status))).toEqual([
      "hidden",
      "default",
      "default",
    ]);
  });
});

describe("tool row open state", () => {
  test("a default failed row opens, and a default done row opens only when it is a report", () => {
    expect(toolRowOpenOf("default", "failed", false)).toBe(true);
    expect(toolRowOpenOf("default", "done", true)).toBe(true);
    expect(toolRowOpenOf("default", "done", false)).toBe(false);
    expect(toolRowOpenOf("default", "running", false)).toBe(false);
  });

  test("a collapsed or hidden row never opens, even a failed or report row", () => {
    expect(toolRowOpenOf("collapsed", "failed", true)).toBe(false);
    expect(toolRowOpenOf("collapsed", "done", true)).toBe(false);
    expect(toolRowOpenOf("hidden", "failed", true)).toBe(false);
  });
});
