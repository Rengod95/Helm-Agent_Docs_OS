import { describe, expect, test } from "bun:test";
import { createRedactor } from "../src/redactor.ts";
import { forms } from "./support/encode.ts";
import { nameOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

const CONTEXT = [" ", "\n", ": ", "=", "(", ")", "/", "?x=", "&y=", "\t", ", ", "[", "]"];

function context(random: () => number): string {
  const count = 1 + Math.floor(random() * 3);
  let out = "";
  for (let i = 0; i < count; i += 1) {
    out += CONTEXT[Math.floor(random() * CONTEXT.length)] ?? " ";
    if (random() < 0.5) out += fakeValue(random, 1 + Math.floor(random() * 6));
  }
  return out;
}

describe("Redactor properties (fixed seed)", () => {
  test("no registered value survives mask", () => {
    const random = seededRandom(20260105);
    const encoder = new TextEncoder();
    for (let i = 0; i < 300; i += 1) {
      const length = 8 + Math.floor(random() * 33);
      const value = fakeValue(random, length, random() < 0.5);
      const redactor = createRedactor();
      expect(redactor.registerKnown(nameOf("prop-secret"), encoder.encode(value)).ok).toBe(true);
      for (const form of forms(value)) {
        const text = `${context(random)}${form.text}${context(random)}`;
        const out = redactor.mask(text);
        expect(out.text).not.toContain(form.text);
        expect(redactor.containsKnown(out.text)).toBe(false);
      }
    }
  });

  test("text without any registered value is unchanged apart from pattern rules", () => {
    const random = seededRandom(7);
    const redactor = createRedactor();
    redactor.registerKnown(nameOf("prop-secret"), new TextEncoder().encode("Zq9-fixed-value-Zq9"));
    for (let i = 0; i < 100; i += 1) {
      const text = `${context(random)}${fakeValue(random, 6)}${context(random)}`;
      expect(redactor.mask(text).text).toBe(text);
    }
  });
});
