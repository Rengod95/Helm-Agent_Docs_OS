import { expect, test } from "bun:test";
import { createBoundedList, DEFAULT_DIAGNOSTICS_CAP } from "../src/bounded.ts";

test("default diagnostics cap is 256", () => {
  expect(DEFAULT_DIAGNOSTICS_CAP).toBe(256);
});

test("the oldest items are dropped past the cap and counted", () => {
  const list = createBoundedList<number>(3);
  for (const n of [1, 2, 3, 4, 5]) list.push(n);
  expect(list.items()).toEqual([3, 4, 5]);
  expect(list.dropped()).toBe(2);
});
