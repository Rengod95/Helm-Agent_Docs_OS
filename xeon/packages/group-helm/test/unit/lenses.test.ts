import { expect, test } from "bun:test";
import { BUILTIN_LENSES, LENS_PRIORITY, selectLenses } from "../../src/lenses.ts";
import type { HelmPending } from "../../src/state.ts";

const base = { inquiryId: "habcdefghijklm", topic: "캐시 무효화" } as const;

test("lenses.priority-by-signal", () => {
  const cases: readonly (readonly [HelmPending, readonly string[]])[] = [
    [{ ...base, source: "signal", signal: "stuck" }, LENS_PRIORITY.stuck],
    [{ ...base, source: "signal", signal: "repeat" }, LENS_PRIORITY.repeat],
    [{ ...base, source: "signal", signal: "newDomain" }, LENS_PRIORITY.newDomain],
    [{ ...base, source: "command" }, LENS_PRIORITY.command],
  ];
  for (const [pending, order] of cases) {
    for (const max of [1, 3, 6]) {
      const chosen = selectLenses(pending, max, BUILTIN_LENSES);
      expect(chosen.map((lens) => lens.id)).toEqual(order.slice(0, max));
      expect(chosen.every((lens) => lens.status === "pending")).toBe(true);
      expect(selectLenses(pending, max, BUILTIN_LENSES)).toEqual(chosen);
    }
  }
  expect(LENS_PRIORITY.stuck.slice(0, 3)).toEqual(["failure-modes", "first-principles", "analogy"]);
  expect(selectLenses({ ...base, source: "command" }, 8, BUILTIN_LENSES)).toHaveLength(6);
});

test("every builtin lens has one topic placeholder and a state-valid id", () => {
  expect(BUILTIN_LENSES.map((lens) => lens.id)).toEqual([
    "analogy",
    "prior-art",
    "first-principles",
    "failure-modes",
    "inversion",
    "constraints",
  ]);
  for (const lens of BUILTIN_LENSES) {
    expect(lens.taskTemplate.split("{topic}")).toHaveLength(2);
    expect(lens.id).toMatch(/^[a-z][a-z0-9-]{0,15}$/);
  }
  for (const order of Object.values(LENS_PRIORITY)) {
    expect([...order].toSorted()).toEqual(BUILTIN_LENSES.map((lens) => lens.id).toSorted());
  }
});
