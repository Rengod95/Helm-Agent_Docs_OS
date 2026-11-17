import { describe, expect, test } from "bun:test";
import { reviewSentTextOf } from "../../../src/views/workbench/review-sent.ts";

describe("reviewSentTextOf", () => {
  test("설치와 지우기가 각자의 검토함 문장 키를 고른다", () => {
    expect(reviewSentTextOf({ kind: "install", itemId: "rvw_1" })).toBe(
      "desktop.install.requested",
    );
    expect(reviewSentTextOf({ kind: "remove", itemId: "rvw_2" })).toBe(
      "desktop.workbench.remove.requested",
    );
  });
});
