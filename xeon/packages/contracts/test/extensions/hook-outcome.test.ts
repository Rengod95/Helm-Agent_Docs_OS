import { describe, expect, test } from "bun:test";
import { hookOutcomeOf, type HookOutcomeOrSkipped } from "../../src/extensions/index.ts";

// M5e 스펙 §4.5 변환표의 행 하나씩. 기록된 값(result / reason / decision)을 표시값으로 옮긴다.
describe("hookOutcomeOf: the §4.5 conversion table", () => {
  test("passed with no decision is pass", () => {
    expect(hookOutcomeOf({ result: "passed", decision: "none" })).toEqual("pass");
  });

  test("modified with no decision is modified", () => {
    expect(hookOutcomeOf({ result: "modified", decision: "none" })).toEqual("modified");
  });

  test("passed with replace is modified (the result was given instead)", () => {
    expect(hookOutcomeOf({ result: "passed", decision: "replace" })).toEqual("modified");
  });

  test("passed with answer is modified (the question was answered)", () => {
    expect(hookOutcomeOf({ result: "passed", decision: "answer" })).toEqual("modified");
  });

  test("passed with ask is asked, whatever the ask metadata says", () => {
    expect(hookOutcomeOf({ result: "passed", decision: "ask" })).toEqual("asked");
  });

  test("blocked with block is blocked", () => {
    expect(hookOutcomeOf({ result: "blocked", decision: "block" })).toEqual("blocked");
  });

  test("passed with cancel is blocked (the card was cancelled)", () => {
    expect(hookOutcomeOf({ result: "passed", decision: "cancel" })).toEqual("blocked");
  });

  test("failed by timeout with no decision is timeout", () => {
    expect(hookOutcomeOf({ result: "failed", reason: "timeout", decision: "none" })).toEqual(
      "timeout",
    );
  });

  test("failed by a throw, a bad result, a rejected merge, or a process exit is error", () => {
    for (const reason of [
      "threw",
      "result_invalid",
      "merge_rejected",
      "process_exit",
      "process_killed",
    ] as const) {
      expect(hookOutcomeOf({ result: "failed", reason, decision: "none" })).toEqual("error");
    }
  });

  test("skipped has no six-value and is the seventh member", () => {
    expect(hookOutcomeOf({ result: "skipped", decision: "none" })).toEqual("skipped");
  });
});

describe("hookOutcomeOf: the cases the table names in prose", () => {
  test("failed with threw and no decision is error", () => {
    expect(hookOutcomeOf({ result: "failed", reason: "threw", decision: "none" })).toEqual("error");
  });

  test("failed with timeout and no decision is timeout", () => {
    expect(hookOutcomeOf({ result: "failed", reason: "timeout", decision: "none" })).toEqual(
      "timeout",
    );
  });

  test("a record with no decision field reads as no decision", () => {
    expect(hookOutcomeOf({ result: "passed" })).toEqual("pass");
    expect(hookOutcomeOf({ result: "modified" })).toEqual("modified");
  });

  test("a block (blocked) and a timeout are different values", () => {
    const blocked = hookOutcomeOf({ result: "blocked", decision: "block" });
    const timedOut = hookOutcomeOf({ result: "failed", reason: "timeout", decision: "none" });
    expect(blocked).toEqual("blocked");
    expect(timedOut).toEqual("timeout");
    expect(blocked).not.toEqual(timedOut);
  });

  test("a passed record with block is read as blocked, though the table does not list it", () => {
    expect(hookOutcomeOf({ result: "passed", decision: "block" })).toEqual("blocked");
  });

  test("the six values are all reachable, and skipped is the only seventh", () => {
    const reached = new Set<HookOutcomeOrSkipped>([
      hookOutcomeOf({ result: "passed", decision: "none" }),
      hookOutcomeOf({ result: "modified", decision: "none" }),
      hookOutcomeOf({ result: "passed", decision: "ask" }),
      hookOutcomeOf({ result: "blocked", decision: "block" }),
      hookOutcomeOf({ result: "failed", reason: "threw", decision: "none" }),
      hookOutcomeOf({ result: "failed", reason: "timeout", decision: "none" }),
      hookOutcomeOf({ result: "skipped", decision: "none" }),
    ]);
    expect([...reached].toSorted()).toEqual([
      "asked",
      "blocked",
      "error",
      "modified",
      "pass",
      "skipped",
      "timeout",
    ]);
  });
});
