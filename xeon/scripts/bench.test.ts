import { expect, test } from "bun:test";
import { BUDGET_MS, formatRow, isStreamChunk, judgeBudget, planBench, stats } from "./bench.ts";

test("stats gives min, median, p90 and max of the samples", () => {
  expect(stats([30, 10, 20, 50, 40])).toEqual({ runs: 5, min: 10, median: 30, p90: 50, max: 50 });
  expect(stats([131.24])).toEqual({ runs: 1, min: 131.2, median: 131.2, p90: 131.2, max: 131.2 });
  expect(stats([])).toBeUndefined();
});

test("a budget is judged against the median; no budget yet is reported as such", () => {
  expect(judgeBudget(120, 150)).toBe("within");
  expect(judgeBudget(151, 150)).toBe("over");
  expect(judgeBudget(151, undefined)).toBe("no budget");
  expect(BUDGET_MS).toEqual({
    cold_start_cli: undefined,
    cold_start_sidecar: undefined,
    first_token: undefined,
  });
});

test("first-token without --yes asks (exit 3 path); --runs is checked", () => {
  expect(planBench({ runs: undefined, firstToken: false, yes: false })).toEqual({
    ok: true,
    plan: { runs: 5, firstToken: "off" },
  });
  expect(planBench({ runs: "3", firstToken: true, yes: false })).toEqual({
    ok: true,
    plan: { runs: 3, firstToken: "ask" },
  });
  expect(planBench({ runs: "3", firstToken: true, yes: true })).toEqual({
    ok: true,
    plan: { runs: 3, firstToken: "run" },
  });
  expect(planBench({ runs: "0", firstToken: false, yes: false })).toEqual({
    ok: false,
    error: "--runs must be an integer from 1 to 50",
  });
});

test("only stream.chunk notifications count as the first token", () => {
  expect(isStreamChunk('{"jsonrpc":"2.0","method":"stream.chunk","params":{}}')).toBe(true);
  expect(isStreamChunk('{"jsonrpc":"2.0","method":"events.batch","params":{}}')).toBe(false);
});

test("rows show the measurement and the budget verdict, or why it was skipped", () => {
  expect(formatRow("cold_start_cli", { runs: 5, min: 10, median: 30, p90: 50, max: 50 })).toBe(
    "cold_start_cli\tmedian 30 ms\tp90 50 ms\tmin 10\tmax 50\truns 5\tno budget",
  );
  expect(formatRow("first_token", "skipped: needs --first-token --yes (real model call)")).toBe(
    "first_token\tskipped: needs --first-token --yes (real model call)",
  );
});
