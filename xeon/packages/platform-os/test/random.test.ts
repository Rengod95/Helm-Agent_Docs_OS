import { expect, test } from "bun:test";
import { systemRandom } from "../src/time/random.ts";

test("systemRandom: 범위", () => {
  const random = systemRandom();
  const seen = new Set<number>();
  for (let i = 0; i < 10_000; i += 1) {
    const value = random();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    seen.add(value);
  }
  // 상수만 내는 구현을 걸러낸다
  expect(seen.size).toBeGreaterThan(9_990);
});

test("systemRandom: 32비트보다 가는 값이 나온다(53비트 구성)", () => {
  const random = systemRandom();
  let hasFineBits = false;
  for (let i = 0; i < 100; i += 1) {
    const scaled = random() * 2 ** 32;
    if (scaled !== Math.floor(scaled)) hasFineBits = true;
  }
  expect(hasFineBits).toBe(true);
});
