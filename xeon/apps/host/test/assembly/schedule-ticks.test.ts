import { expect, test } from "bun:test";
import { ticksInThisProcess } from "../../src/assembly/schedule-ticks.ts";

test("service and stdio hosts try the schedule tick, in-process does not", () => {
  expect(ticksInThisProcess("service")).toBe(true);
  expect(ticksInThisProcess("stdio")).toBe(true);
  expect(ticksInThisProcess("in-process")).toBe(false);
});
