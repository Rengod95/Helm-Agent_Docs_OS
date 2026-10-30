import { expect, test } from "bun:test";
import { gate, readResults } from "./bench-gate.ts";
import { parseBenchLine, resultOf, SERVER_BUDGET, stats } from "./bench-server.ts";

const mk = (metric: string, verdict: string) => ({ metric, unit: "ms", median: 1, verdict });

const line = (metric: string, samples: number[]) =>
  parseBenchLine(JSON.stringify({ metric, unit: "ms", samples }));

test("a bench line is parsed; log noise and malformed lines are not bench lines", () => {
  expect(parseBenchLine('{"metric":"a","unit":"ms","samples":[1,2]}')).toEqual({
    metric: "a",
    unit: "ms",
    samples: [1, 2],
    value: undefined,
    note: undefined,
  });
  expect(parseBenchLine('{"metric":"b","unit":"chars","value":7,"note":"n"}')?.value).toBe(7);
  expect(parseBenchLine("warming up")).toBeUndefined();
  expect(() => parseBenchLine('{"metric":')).toThrow("bench line is not JSON");
  expect(parseBenchLine('{"metric":"a","unit":"ms"}')).toBeUndefined();
  expect(parseBenchLine('{"metric":"a","unit":"ms","samples":["x"]}')).toBeUndefined();
});

test("verdicts: no budget set waits for the user, informational metrics are not judged", () => {
  const sampled = line("lease_turn_overhead", [3, 1, 2]);
  expect(sampled).toBeDefined();
  if (sampled === undefined) return;
  expect(resultOf(sampled, SERVER_BUDGET).verdict).toBe("waiting for user decision");
  expect(resultOf(sampled, { lease_turn_overhead: 2 }).verdict).toBe("within");
  expect(resultOf(sampled, { lease_turn_overhead: 1 }).verdict).toBe("over");
  expect(resultOf(sampled, {}).verdict).toBe("informational");
  expect(resultOf(sampled, { lease_turn_overhead: 2 }).median).toBe(2);
});

test("every shipped server budget is still waiting for the user decision", () => {
  expect(Object.values(SERVER_BUDGET).every((budget) => budget === undefined)).toBe(true);
});

test("the gate fails on over budget, passes on waiting unless strict", () => {
  const results = readResults([
    mk("a", "within"),
    mk("b", "waiting for user decision"),
    mk("c", "informational"),
  ]);
  expect(results).toBeDefined();
  if (results === undefined) return;
  expect(gate(results, false)).toEqual({ over: [], waiting: ["b"], within: ["a"], pass: true });
  expect(gate(results, true).pass).toBe(false);
  const bad = readResults([mk("a", "within"), mk("d", "over")]);
  expect(bad && gate(bad, false)).toEqual({ over: ["d"], waiting: [], within: ["a"], pass: false });
});

test("input that is not a results array is rejected", () => {
  expect(readResults({})).toBeUndefined();
  expect(readResults([{ metric: "a" }])).toBeUndefined();
  expect(readResults([{ metric: "a", unit: "ms", median: 1, verdict: "maybe" }])).toBeUndefined();
});

test("server stats keep microsecond resolution", () => {
  expect(stats([0.011, 0.02, 0.016])?.median).toBe(0.016);
  expect(stats([])).toBeUndefined();
});
