import { describe, expect, test } from "bun:test";
import type { ModelEntry, UsageGauge } from "@fresnel/contracts/wire";
import {
  modelLabelOf,
  modelOptionsOf,
  sessionUsageOf,
  tokenCountText,
} from "../../src/views/model-usage.ts";

function gauge(over: Partial<UsageGauge>): UsageGauge {
  return {
    id: "anthropic::session:tokens",
    providerId: "anthropic",
    account: null,
    window: "session",
    unit: "tokens",
    used: 0,
    limit: null,
    resetsAt: null,
    ...over,
  };
}

describe("modelLabelOf", () => {
  test("provider 접두사를 뗀다", () => {
    expect(modelLabelOf("anthropic/claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(modelLabelOf("sonnet-5-5")).toBe("sonnet-5-5");
  });
});

describe("sessionUsageOf", () => {
  test("session 토큰 게이지만 더한다", () => {
    const usage = sessionUsageOf({
      gauges: [
        gauge({ used: 41_000, limit: 100_000 }),
        gauge({ window: "day", used: 9 }),
        gauge({ unit: "usd", used: 3 }),
      ],
    });
    expect(usage).toEqual({ tokens: 41_000, percent: 41, limit: null });
  });
  test("한도를 모르면 비율이 없다", () => {
    expect(sessionUsageOf({ gauges: [gauge({ used: 500 })] })).toEqual({
      tokens: 500,
      percent: null,
      limit: null,
    });
  });
  test("해당 게이지가 없으면 null이다", () => {
    expect(sessionUsageOf({ gauges: [gauge({ window: "day" })] })).toBeNull();
    expect(sessionUsageOf({ gauges: [] })).toBeNull();
  });
  test("호스트가 문맥을 주면 그 토큰과 문맥 창으로 비율을 낸다", () => {
    const usage = sessionUsageOf({
      gauges: [gauge({ used: 900_000 })],
      context: { model: "anthropic/claude-haiku-5-5", used: 50_000, limit: 200_000 },
    });
    expect(usage).toEqual({ tokens: 50_000, percent: 25, limit: 200_000 });
  });
  test("문맥이 창을 넘으면 비율은 100에서 멈춘다", () => {
    const usage = sessionUsageOf({
      gauges: [],
      context: { model: "a/b", used: 300, limit: 200 },
    });
    expect(usage).toEqual({ tokens: 300, percent: 100, limit: 200 });
  });
});

const entry = (ref: string, contextWindow: number): ModelEntry => ({
  ref,
  name: ref,
  contextWindow,
  reasoning: false,
});

describe("modelOptionsOf", () => {
  test("카탈로그 모델을 이름과 문맥 창으로 줄 세운다", () => {
    expect(
      modelOptionsOf(
        [entry("anthropic/a", 200_000), entry("openai/b", 128_000)],
        "anthropic/a",
        null,
      ),
    ).toEqual([
      { value: "anthropic/a", label: "a", contextWindow: 200_000 },
      { value: "openai/b", label: "b", contextWindow: 128_000 },
    ]);
  });
  test("지금 쓰는 모델이 카탈로그에 없으면 맨 앞에 더한다", () => {
    expect(modelOptionsOf([entry("openai/b", 128_000)], "gone/x", null)).toEqual([
      { value: "gone/x", label: "x", contextWindow: null },
      { value: "openai/b", label: "b", contextWindow: 128_000 },
    ]);
  });
  test("모르는 현재 모델은 줄을 더하지 않는다", () => {
    expect(modelOptionsOf([], null, null)).toEqual([]);
  });
  test("대화가 모델을 정했으면 끝에 기본 모델로 돌아가는 줄이 있다", () => {
    expect(modelOptionsOf([entry("a/x", 1)], "a/x", "a/base")).toEqual([
      { value: "a/x", label: "x", contextWindow: 1 },
      { value: "default", label: "base", contextWindow: null },
    ]);
  });
});

describe("tokenCountText", () => {
  test("짧게 줄인다", () => {
    expect(tokenCountText(950)).toBe("950");
    expect(tokenCountText(41_000)).toBe("41k");
    expect(tokenCountText(1_200_000)).toBe("1.2M");
  });
});
