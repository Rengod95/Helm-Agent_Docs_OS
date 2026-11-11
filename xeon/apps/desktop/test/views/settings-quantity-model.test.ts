import { describe, expect, test } from "bun:test";
import {
  formatQuantity,
  numberAppearanceOf,
  numberStyleOf,
  parseQuantity,
  presetsOf,
  quantityStepOf,
  quantitySummaryOf,
  unitKindOf,
  type DurationWords,
  type SummaryEnv,
} from "../../src/views/pages/settings/settings-quantity-model.ts";

const EN_WORDS: DurationWords = {
  seconds: (n) => `${n} sec`,
  minutes: (n) => `${n} min`,
  hours: (n) => `${n} hr`,
  days: (n) => `${n} days`,
};

const KO_WORDS: DurationWords = {
  seconds: (n) => `${n}초`,
  minutes: (n) => `${n}분`,
  hours: (n) => `${n}시간`,
  days: (n) => `${n}일`,
};

const EN: SummaryEnv = { locale: "en", words: EN_WORDS };
const KO: SummaryEnv = { locale: "ko", words: KO_WORDS };

describe("numberStyleOf and numberAppearanceOf", () => {
  test("integer with both ends and a span of 20 or less keeps the stepper", () => {
    expect(numberStyleOf({ min: 0, max: 20, integer: true })).toBe("stepper");
    expect(numberStyleOf({ min: 1, max: 21, integer: true })).toBe("stepper");
  });

  test("a span of 21 or more, a missing end, or a fraction is a quantity", () => {
    expect(numberStyleOf({ min: 0, max: 21, integer: true })).toBe("quantity");
    expect(numberStyleOf({ min: 1, max: null, integer: true })).toBe("quantity");
    expect(numberStyleOf({ min: null, max: 10, integer: true })).toBe("quantity");
    expect(numberStyleOf({ min: null, max: null, integer: true })).toBe("quantity");
    expect(numberStyleOf({ min: 0, max: 10, integer: false })).toBe("quantity");
  });

  test("the appearance is stepper for a stepper and scrub for a quantity", () => {
    expect(numberAppearanceOf({ min: 0, max: 10, integer: true })).toBe("stepper");
    expect(numberAppearanceOf({ min: 0, max: 1000, integer: true })).toBe("scrub");
  });
});

describe("unitKindOf", () => {
  test("classifies the raw unit ids", () => {
    expect(unitKindOf("tokens")).toBe("count");
    expect(unitKindOf("steps")).toBe("count");
    expect(unitKindOf("B")).toBe("bytes");
    expect(unitKindOf("ms")).toBe("duration");
    expect(unitKindOf("min")).toBe("duration");
    expect(unitKindOf("USD")).toBe("money");
    expect(unitKindOf("px")).toBe("other");
    expect(unitKindOf("constructor")).toBe("other");
    expect(unitKindOf(null)).toBe("other");
  });
});

describe("parseQuantity", () => {
  test("K, M and G scale counts by 1000", () => {
    expect(parseQuantity("200K", "tokens")).toBe(200_000);
    expect(parseQuantity("200k", "tokens")).toBe(200_000);
    expect(parseQuantity("1.5M", "tokens")).toBe(1_500_000);
    expect(parseQuantity("2G", "chars")).toBe(2_000_000_000);
    expect(parseQuantity("1.1K", "tokens")).toBe(1_100);
  });

  test("KB, MB and GB scale bytes by 1024", () => {
    expect(parseQuantity("256KB", "B")).toBe(262_144);
    expect(parseQuantity("1 MiB", "B")).toBe(1_048_576);
    expect(parseQuantity("2G", "B")).toBe(2_147_483_648);
  });

  test("commas and spaces are ignored", () => {
    expect(parseQuantity("1,000", "tokens")).toBe(1_000);
    expect(parseQuantity("1 000", "tokens")).toBe(1_000);
    expect(parseQuantity("1,234,567", "tokens")).toBe(1_234_567);
  });

  test("a duration suffix converts into the field's unit", () => {
    expect(parseQuantity("30s", "ms")).toBe(30_000);
    expect(parseQuantity("2m", "s")).toBe(120);
    expect(parseQuantity("2min", "ms")).toBe(120_000);
    expect(parseQuantity("1.5h", "ms")).toBe(5_400_000);
    expect(parseQuantity("1.5h", "min")).toBe(90);
    expect(parseQuantity("45", "s")).toBe(45);
  });

  test("an integer field rejects a fraction", () => {
    expect(parseQuantity("1.5", "tokens", true)).toBeNull();
    expect(parseQuantity("1.5K", "tokens", true)).toBe(1_500);
  });

  test("a plain number needs no suffix on a unit without one", () => {
    expect(parseQuantity("12", "px")).toBe(12);
    expect(parseQuantity("12k", "px")).toBeNull();
    expect(parseQuantity("50%", "px")).toBe(50);
  });

  test("unknown or broken text is null", () => {
    expect(parseQuantity("abc", "tokens")).toBeNull();
    expect(parseQuantity("", "tokens")).toBeNull();
    expect(parseQuantity("5 tokens", "tokens")).toBeNull();
    expect(parseQuantity("1e3", "tokens")).toBeNull();
    expect(parseQuantity("10x", "ms")).toBeNull();
  });
});

describe("formatQuantity", () => {
  test("groups thousands in both locales", () => {
    expect(formatQuantity(200_000, "en")).toBe("200,000");
    expect(formatQuantity(200_000, "ko")).toBe("200,000");
  });
});

describe("quantitySummaryOf", () => {
  test("counts read as K and M with the unit label", () => {
    expect(quantitySummaryOf(200_000, { id: "tokens", label: "tokens" }, EN)).toBe("200K tokens");
    expect(quantitySummaryOf(200_000, { id: "tokens", label: "토큰" }, KO)).toBe("200K 토큰");
    expect(quantitySummaryOf(1_500_000, { id: "tokens", label: "tokens" }, EN)).toBe("1.5M tokens");
    expect(quantitySummaryOf(999, { id: "items", label: "개" }, KO)).toBe("999 개");
  });

  test("bytes read as KB, MB and GB", () => {
    expect(quantitySummaryOf(2_097_152, { id: "B", label: "B" }, EN)).toBe("2 MB");
    expect(quantitySummaryOf(2_097_152, { id: "B", label: "B" }, KO)).toBe("2 MB");
    expect(quantitySummaryOf(512, { id: "B", label: "B" }, EN)).toBe("512 B");
    expect(quantitySummaryOf(1_536, { id: "B", label: "B" }, EN)).toBe("1.5 KB");
  });

  test("durations pick seconds, minutes or hours in the words of each language", () => {
    expect(quantitySummaryOf(90_000, { id: "ms", label: "ms" }, EN)).toBe("90 sec");
    expect(quantitySummaryOf(90_000, { id: "ms", label: "ms" }, KO)).toBe("90초");
    expect(quantitySummaryOf(1_800_000, { id: "ms", label: "ms" }, KO)).toBe("30분");
    expect(quantitySummaryOf(30, { id: "min", label: "분" }, EN)).toBe("30 min");
    expect(quantitySummaryOf(5_400_000, { id: "ms", label: "ms" }, EN)).toBe("1.5 hr");
    expect(quantitySummaryOf(500, { id: "ms", label: "ms" }, EN)).toBe("500 ms");
  });

  test("money uses the currency format", () => {
    expect(quantitySummaryOf(12.5, { id: "USD", label: "USD" }, EN)).toBe("$12.50");
  });

  test("other units show the grouped number and the label", () => {
    expect(quantitySummaryOf(1_200, { id: "px", label: "px" }, EN)).toBe("1,200 px");
  });
});

describe("quantityStepOf", () => {
  test("an arrow step is one place below the value's leading digit", () => {
    expect(quantityStepOf(200_000)).toBe(10_000);
    expect(quantityStepOf(1_500)).toBe(100);
    expect(quantityStepOf(7)).toBe(1);
    expect(quantityStepOf(0)).toBe(1);
    expect(quantityStepOf(null)).toBe(1);
  });
});

describe("presetsOf", () => {
  test("half, default and double, in ascending order", () => {
    expect(presetsOf({ min: 1, max: 1_000_000, integer: true }, 200_000)).toEqual([
      100_000, 200_000, 400_000,
    ]);
  });

  test("values outside the range are dropped", () => {
    expect(presetsOf({ min: 1, max: 300_000, integer: true }, 200_000)).toEqual([100_000, 200_000]);
    expect(presetsOf({ min: 1, max: null, integer: true }, 1)).toEqual([1, 2]);
  });

  test("an integer field floors the halves", () => {
    expect(presetsOf({ min: null, max: null, integer: true }, 5)).toEqual([2, 5, 10]);
    expect(presetsOf({ min: null, max: null, integer: false }, 5)).toEqual([2.5, 5, 10]);
  });
});
