import { describe, expect, test } from "bun:test";
import { AURORA_SITE, auroraOn } from "../../../src/views/effects/fx-config.ts";

// 오로라 자리(dzE 시안 §2.5, DP-126)

describe("auroraOn", () => {
  test("제품 기본은 입력창이다", () => {
    expect(AURORA_SITE).toBe("composer");
    expect([auroraOn("composer", "composer"), auroraOn("strip", "composer")]).toEqual([
      true,
      false,
    ]);
  });

  test("both는 두 곳, off는 아무 데도", () => {
    expect([auroraOn("composer", "both"), auroraOn("strip", "both")]).toEqual([true, true]);
    expect([auroraOn("composer", "off"), auroraOn("strip", "off")]).toEqual([false, false]);
  });
});
