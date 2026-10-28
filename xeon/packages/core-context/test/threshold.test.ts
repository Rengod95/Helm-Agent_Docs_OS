import { describe, expect, test } from "bun:test";
import { shouldCompactTokens } from "../src/compaction/threshold.ts";

describe("threshold_uses_catalog_window_minus_reserve", () => {
  const settings = { enabled: true, reserveTokens: 10_000, keepRecentTokens: 20_000 };

  test("equal to window minus reserve is false and one more is true", () => {
    expect(shouldCompactTokens(90_000, 100_000, settings)).toBe(false);
    expect(shouldCompactTokens(90_001, 100_000, settings)).toBe(true);
    expect(shouldCompactTokens(89_000, 100_000, settings)).toBe(false);
  });

  test("a disabled setting is always false", () => {
    expect(shouldCompactTokens(1_000_000, 100_000, { ...settings, enabled: false })).toBe(false);
  });
});
