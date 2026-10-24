import { describe, expect, test } from "bun:test";
import { toJsonValue } from "../../src/conversation/index.ts";

describe("toJsonValue", () => {
  test("keeps JSON values and copies containers", () => {
    const input = { a: [1, "x", null, true], b: { c: 2 } };
    const out = toJsonValue(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  test("refuses values JSON cannot carry", () => {
    expect(toJsonValue(Number.NaN)).toBeUndefined();
    expect(toJsonValue(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toJsonValue(undefined)).toBeUndefined();
    expect(toJsonValue(() => 1)).toBeUndefined();
    expect(toJsonValue({ a: undefined })).toBeUndefined();
    expect(toJsonValue([1, Number.NaN])).toBeUndefined();
  });
});
