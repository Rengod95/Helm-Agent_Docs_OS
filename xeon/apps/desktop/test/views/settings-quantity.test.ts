import { describe, expect, test } from "bun:test";
import {
  numberControlOf,
  parseQuantity,
  quantityTextOf,
} from "../../src/views/pages/settings/settings-quantity.ts";

// 숫자 칸의 규칙(L4.settings-ui §4.2.1 숫자 [결정: 2026-11-11 사용자]). 작은 정수만 ± 단추를 쓰고, 큰 값은 단위가 붙은 칸에
// 줄인 글로 보이며 단위를 붙여 칠 수 있다. 값은 `toEqual`로 비교한다.

function numberWidget(over: {
  readonly min?: number | null;
  readonly max?: number | null;
  readonly integer?: boolean;
  readonly unit?: string | null;
}): {
  kind: "number";
  min: number | null;
  max: number | null;
  integer: boolean;
  unit: string | null;
} {
  return {
    kind: "number",
    min: over.min ?? null,
    max: over.max ?? null,
    integer: over.integer ?? true,
    unit: over.unit ?? null,
  };
}

describe("numberControlOf", () => {
  test("an integer up to 20 is a stepper, a bigger or open range is a unit field", () => {
    expect(
      numberControlOf("l0.sandbox.selfTestIntervalMin", numberWidget({ min: 0, max: 5 })),
    ).toEqual({
      kind: "stepper",
    });
    expect(
      numberControlOf("l9.any.big", numberWidget({ min: 0, max: 200000, unit: "tokens" })),
    ).toEqual({
      kind: "quantity",
      unit: "tokens",
      zeroIsNone: false,
    });
    expect(numberControlOf("l9.any.open", numberWidget({ min: 0 }))).toEqual({
      kind: "quantity",
      unit: "count",
      zeroIsNone: false,
    });
  });

  test("a key with a known unit is a unit field even when small, and zero means none for retention", () => {
    expect(
      numberControlOf("l1.persistence.retention.maxAgeDays", numberWidget({ min: 0, max: 20 })),
    ).toEqual({
      kind: "quantity",
      unit: "days",
      zeroIsNone: true,
    });
    expect(
      numberControlOf("l1.tools.unattended.timeoutSeconds", numberWidget({ min: 1, max: 86400 })),
    ).toEqual({ kind: "quantity", unit: "seconds", zeroIsNone: false });
  });
});

describe("quantityTextOf", () => {
  test("tokens shorten to K or M only when exact enough", () => {
    expect(quantityTextOf(200_000, "tokens", false)).toEqual({ text: "200K", suffix: "tokens" });
    expect(quantityTextOf(1_500_000, "tokens", false)).toEqual({ text: "1.5M", suffix: "tokens" });
    expect(quantityTextOf(12_345, "tokens", false)).toEqual({ text: "12,345", suffix: "tokens" });
  });

  test("seconds take the largest whole unit, bytes take the largest unit", () => {
    expect(quantityTextOf(600, "seconds", false)).toEqual({ text: "10", suffix: "minutes" });
    expect(quantityTextOf(7200, "seconds", false)).toEqual({ text: "2", suffix: "hours" });
    expect(quantityTextOf(90, "seconds", false)).toEqual({ text: "90", suffix: "seconds" });
    expect(quantityTextOf(512 * 1024, "bytes", false)).toEqual({ text: "512", suffix: "KB" });
  });

  test("zero is an empty field when zero means none", () => {
    expect(quantityTextOf(0, "days", true)).toEqual({ text: "", suffix: "days" });
    expect(quantityTextOf(0, "days", false)).toEqual({ text: "0", suffix: "days" });
  });
});

describe("parseQuantity", () => {
  test("a bare number is read in the shown unit, commas and spaces are ignored", () => {
    expect(parseQuantity("10", "seconds", "minutes", false)).toEqual({ ok: true, value: 600 });
    expect(parseQuantity("1,000", "tokens", "tokens", false)).toEqual({ ok: true, value: 1000 });
  });

  test("a typed unit wins over the shown one, in English or Korean", () => {
    expect(parseQuantity("1.5M", "tokens", "tokens", false)).toEqual({
      ok: true,
      value: 1_500_000,
    });
    expect(parseQuantity("200k", "tokens", "tokens", false)).toEqual({ ok: true, value: 200_000 });
    expect(parseQuantity("90s", "seconds", "minutes", false)).toEqual({ ok: true, value: 90 });
    expect(parseQuantity("2시간", "seconds", "minutes", false)).toEqual({ ok: true, value: 7200 });
    expect(parseQuantity("512KB", "bytes", "MB", false)).toEqual({ ok: true, value: 512 * 1024 });
  });

  test("an empty field is zero only when zero means none, and garbage is a syntax error", () => {
    expect(parseQuantity("", "days", "days", true)).toEqual({ ok: true, value: 0 });
    expect(parseQuantity("", "days", "days", false)).toEqual({ ok: false, reason: "syntax" });
    expect(parseQuantity("abc", "tokens", "tokens", false)).toEqual({
      ok: false,
      reason: "syntax",
    });
    expect(parseQuantity("5MB", "seconds", "seconds", false)).toEqual({
      ok: false,
      reason: "syntax",
    });
  });
});
