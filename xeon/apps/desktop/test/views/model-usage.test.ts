import { describe, expect, test } from "bun:test";
import type { ModelEntry, UsageGauge } from "@fresnel/contracts/wire";
import {
  modelLabelOf,
  modelOptionsOf,
  priceNumberText,
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

const entry = (ref: string, contextWindow: number, over: Partial<ModelEntry> = {}): ModelEntry => ({
  ref,
  name: "",
  contextWindow,
  reasoning: false,
  inputPrice: null,
  outputPrice: null,
  ...over,
});

describe("modelOptionsOf", () => {
  test("카탈로그 모델을 이름·문맥 창·가격으로 제공자순으로 줄 세운다", () => {
    expect(
      modelOptionsOf(
        [
          entry("openai/b", 128_000),
          entry("anthropic/a", 200_000, { inputPrice: 1, outputPrice: 5 }),
        ],
        "anthropic/a",
        null,
      ),
    ).toEqual([
      { value: "anthropic/a", label: "a", contextWindow: 200_000, price: { input: 1, output: 5 } },
      { value: "openai/b", label: "b", contextWindow: 128_000, price: "unknown" },
    ]);
  });
  test("지금 쓰는 모델이 카탈로그에 없으면 맨 앞에 가격 없이 더한다", () => {
    expect(modelOptionsOf([entry("openai/b", 128_000)], "gone/x", null)).toEqual([
      { value: "gone/x", label: "x", contextWindow: null, price: null },
      { value: "openai/b", label: "b", contextWindow: 128_000, price: "unknown" },
    ]);
  });
  test("모르는 현재 모델은 줄을 더하지 않는다", () => {
    expect(modelOptionsOf([], null, null)).toEqual([]);
  });
  test("대화가 모델을 정했으면 끝에 기본 모델로 돌아가는 줄이 있다", () => {
    expect(modelOptionsOf([entry("a/x", 1)], "a/x", "a/base")).toEqual([
      { value: "a/x", label: "x", contextWindow: 1, price: "unknown" },
      { value: "default", label: "base", contextWindow: null, price: null },
    ]);
  });
  test("날짜 붙은 중복은 감추고 새 버전을 앞에 두며 (latest)를 뗀다", () => {
    const options = modelOptionsOf(
      [
        entry("anthropic/claude-haiku-4-5-20251001", 1, { name: "Claude Haiku 4.5" }),
        entry("anthropic/claude-haiku-4-5", 1, { name: "Claude Haiku 4.5 (latest)" }),
        entry("anthropic/claude-haiku-5-5", 1, { name: "Claude Haiku 5.5" }),
        entry("anthropic/claude-haiku-5", 1, { name: "Claude Haiku 5" }),
      ],
      null,
      null,
    );
    expect(options.map((o) => [o.value, o.label])).toEqual([
      ["anthropic/claude-haiku-5-5", "Claude Haiku 5.5"],
      ["anthropic/claude-haiku-5", "Claude Haiku 5"],
      ["anthropic/claude-haiku-4-5", "Claude Haiku 4.5"],
    ]);
  });
  test("지금 쓰는 모델이 날짜 붙은 사본이면 그 줄은 남는다", () => {
    const options = modelOptionsOf(
      [entry("a/m-20251001", 1), entry("a/m", 1)],
      "a/m-20251001",
      null,
    );
    expect(options.map((o) => o.value)).toEqual(["a/m-20251001", "a/m"]);
  });
});

describe("priceNumberText", () => {
  test("작은 값은 의미 있는 자리까지, 큰 값은 둘째 자리까지", () => {
    expect(priceNumberText(0.1)).toBe("0.1");
    expect(priceNumberText(0.125)).toBe("0.125");
    expect(priceNumberText(12.5)).toBe("12.5");
    expect(priceNumberText(3)).toBe("3");
  });
});

describe("tokenCountText", () => {
  test("짧게 줄인다", () => {
    expect(tokenCountText(950)).toBe("950");
    expect(tokenCountText(41_000)).toBe("41k");
    expect(tokenCountText(1_200_000)).toBe("1.2M");
  });
});
