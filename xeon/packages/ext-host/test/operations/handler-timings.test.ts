import { expect, test } from "bun:test";
import { timingsOf, type HandlerRun } from "../../src/operations/handler-timings.ts";

function run(
  hook: string,
  registrationId: string,
  ms: number,
  result: HandlerRun["result"],
): HandlerRun {
  return { hook, registrationId, ms, result };
}

test("timings: one sample is every percentile and the maximum", () => {
  expect(timingsOf([run("tool.call.before", "ext-a", 7, "ok")], {})).toEqual([
    {
      hook: "tool.call.before",
      registrationId: "ext-a",
      count: 1,
      p50Ms: 7,
      p95Ms: 7,
      maxMs: 7,
      failures: 0,
    },
  ]);
});

test("timings: nearest rank over twenty samples", () => {
  // 1부터 20까지를 섞어 넣는다. p50은 ceil(50·20/100)=10번째 값, p95는 ceil(95·20/100)=19번째 값이다
  const samples = [13, 1, 20, 7, 2, 18, 9, 4, 16, 11, 5, 19, 3, 14, 8, 17, 6, 15, 10, 12];
  expect(
    timingsOf(
      samples.map((ms) => run("h", "r", ms, "ok")),
      {},
    ),
  ).toEqual([
    { hook: "h", registrationId: "r", count: 20, p50Ms: 10, p95Ms: 19, maxMs: 20, failures: 0 },
  ]);
});

test("timings: the rank rounds up for a small set", () => {
  // 정렬하면 1, 5, 9다. p50은 ceil(1.5)=2번째 값 5, p95는 ceil(2.85)=3번째 값 9다
  expect(
    timingsOf(
      [5, 1, 9].map((ms) => run("h", "r", ms, "ok")),
      {},
    ),
  ).toEqual([
    { hook: "h", registrationId: "r", count: 3, p50Ms: 5, p95Ms: 9, maxMs: 9, failures: 0 },
  ]);
});

test("timings: error, over_budget and denied count as failures and skipped does not", () => {
  const runs = [
    run("h", "r", 1, "ok"),
    run("h", "r", 2, "error"),
    run("h", "r", 3, "over_budget"),
    run("h", "r", 4, "denied"),
    run("h", "r", 5, "skipped"),
  ];
  expect(timingsOf(runs, {})).toEqual([
    { hook: "h", registrationId: "r", count: 5, p50Ms: 3, p95Ms: 5, maxMs: 5, failures: 3 },
  ]);
});

test("timings: groups sort by hook then registration and filters narrow them", () => {
  const runs = [
    run("tool.call.before", "ext-b", 4, "ok"),
    run("boundary.settle.after", "ext-b", 2, "ok"),
    run("tool.call.before", "ext-a", 6, "error"),
    run("boundary.settle.after", "ext-a", 1, "ok"),
    run("tool.call.before", "ext-a", 8, "ok"),
  ];
  const boundaryA = {
    hook: "boundary.settle.after",
    registrationId: "ext-a",
    count: 1,
    p50Ms: 1,
    p95Ms: 1,
    maxMs: 1,
    failures: 0,
  };
  const boundaryB = {
    hook: "boundary.settle.after",
    registrationId: "ext-b",
    count: 1,
    p50Ms: 2,
    p95Ms: 2,
    maxMs: 2,
    failures: 0,
  };
  const toolA = {
    hook: "tool.call.before",
    registrationId: "ext-a",
    count: 2,
    p50Ms: 6,
    p95Ms: 8,
    maxMs: 8,
    failures: 1,
  };
  const toolB = {
    hook: "tool.call.before",
    registrationId: "ext-b",
    count: 1,
    p50Ms: 4,
    p95Ms: 4,
    maxMs: 4,
    failures: 0,
  };
  expect(timingsOf(runs, {})).toEqual([boundaryA, boundaryB, toolA, toolB]);
  expect(timingsOf(runs, { hook: "tool.call.before" })).toEqual([toolA, toolB]);
  expect(timingsOf(runs, { registrationId: "ext-b" })).toEqual([boundaryB, toolB]);
  expect(timingsOf(runs, { hook: "tool.call.before", registrationId: "ext-a" })).toEqual([toolA]);
  expect(timingsOf([], {})).toEqual([]);
});
