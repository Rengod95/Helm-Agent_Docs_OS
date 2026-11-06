import { describe, expect, test } from "bun:test";
import type { UsageGauge } from "@fresnel/contracts/wire";
import { modelLabelOf, sessionUsageOf, tokenCountText } from "../../src/views/model-usage.ts";

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
    const usage = sessionUsageOf([
      gauge({ used: 41_000, limit: 100_000 }),
      gauge({ window: "day", used: 9 }),
      gauge({ unit: "usd", used: 3 }),
    ]);
    expect(usage).toEqual({ tokens: 41_000, percent: 41 });
  });
  test("한도를 모르면 비율이 없다", () => {
    expect(sessionUsageOf([gauge({ used: 500 })])).toEqual({ tokens: 500, percent: null });
  });
  test("해당 게이지가 없으면 null이다", () => {
    expect(sessionUsageOf([gauge({ window: "day" })])).toBeNull();
    expect(sessionUsageOf([])).toBeNull();
  });
});

describe("tokenCountText", () => {
  test("짧게 줄인다", () => {
    expect(tokenCountText(950)).toBe("950");
    expect(tokenCountText(41_000)).toBe("41k");
    expect(tokenCountText(1_200_000)).toBe("1.2M");
  });
});
