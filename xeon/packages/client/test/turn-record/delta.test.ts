import { describe, expect, test } from "bun:test";
import type { HookOutcomeOrSkipped } from "@fresnel/contracts/extensions";
import type { DeltaRow, HookRun } from "@fresnel/contracts/wire";
import {
  applyDeltaRow,
  applyDeltaRows,
  hookDisplayOutcomeOf,
} from "../../src/turn-record/index.ts";
import { callOf, childOf, frameOf, hookRunOf, stepOf, turnOf } from "./fixtures.ts";

describe("hookDisplayOutcomeOf (F §4.5 table)", () => {
  test("the stored result, reason and decision give the six display values and skipped", () => {
    const cases: readonly [
      Pick<HookRun, "result" | "reason" | "decision">,
      HookOutcomeOrSkipped,
    ][] = [
      [{ result: "passed", reason: null, decision: "none" }, "pass"],
      [{ result: "modified", reason: null, decision: "none" }, "modified"],
      [{ result: "passed", reason: null, decision: "replace" }, "modified"],
      [{ result: "passed", reason: null, decision: "answer" }, "modified"],
      [{ result: "passed", reason: null, decision: "ask" }, "asked"],
      [{ result: "blocked", reason: null, decision: "block" }, "blocked"],
      [{ result: "passed", reason: null, decision: "cancel" }, "blocked"],
      [{ result: "failed", reason: "timeout", decision: "none" }, "timeout"],
      [{ result: "failed", reason: "threw", decision: "none" }, "error"],
      [{ result: "failed", reason: "process_killed", decision: "none" }, "error"],
      [{ result: "skipped", reason: null, decision: "none" }, "skipped"],
    ];
    for (const [run, expected] of cases) {
      expect(hookDisplayOutcomeOf(run)).toBe(expected);
    }
  });

  test("the ask metadata does not change the display value, only the decision does", () => {
    const asked = hookRunOf({
      result: "passed",
      decision: "none",
      ask: {
        via: "awaitUser",
        waits: 1,
        waitMs: 800,
        approvalId: null,
        answer: "allow",
      },
    });
    expect(hookDisplayOutcomeOf(asked)).toBe("pass");
    expect(hookDisplayOutcomeOf(hookRunOf({ result: "passed", decision: "ask" }))).toBe("asked");
  });
});

describe("applyDeltaRow", () => {
  test("a step row is added in step order and replaces a step with the same index", () => {
    const base = turnOf({ steps: [stepOf(1, { stepId: "stp_1" })] });
    const added = applyDeltaRow(base, { kind: "step", stepIndex: 0, step: stepOf(0) });
    expect(added.orphan).toBe(false);
    expect(added.record.steps.map((step) => step.stepIndex)).toEqual([0, 1]);

    const replaced = applyDeltaRow(added.record, {
      kind: "step",
      stepIndex: 1,
      step: stepOf(1, { stepId: "stp_1b" }),
    });
    expect(replaced.record.steps.map((step) => step.stepId)).toEqual(["stp_0", "stp_1b"]);
  });

  test("a step-level hook row is added once even when it repeats", () => {
    const base = turnOf({ steps: [stepOf(0)] });
    const hook = hookRunOf({ toolCallId: null, subject: {}, seq: 2, hook: "context.request" });
    const row: DeltaRow = { kind: "hook", stepIndex: 0, hook };
    const once = applyDeltaRow(base, row);
    const twice = applyDeltaRow(once.record, row);
    expect(twice.record.steps[0]?.hooks).toEqual([hook]);
    expect(twice.orphan).toBe(false);
  });

  test("a hook row with a tool call id attaches to that call and leaves the step hooks alone", () => {
    const base = turnOf({ steps: [stepOf(0, { calls: [callOf({ toolCallId: "tc_1" })] })] });
    const hook = hookRunOf({ toolCallId: "tc_1", seq: 3 });
    const applied = applyDeltaRow(base, { kind: "hook", stepIndex: 0, hook });
    expect(applied.record.steps[0]?.calls[0]?.hooks).toEqual([hook]);
    expect(applied.record.steps[0]?.hooks).toEqual([]);
  });

  test("a hook row with no step index goes to the turn hooks", () => {
    const hook = hookRunOf({ toolCallId: null, seq: 0, hook: "boundary.turn.before" });
    const applied = applyDeltaRow(turnOf(), { kind: "hook", stepIndex: null, hook });
    expect(applied.orphan).toBe(false);
    expect(applied.record.turnHooks).toEqual([hook]);
  });

  test("a call row replaces the call with the same tool call id", () => {
    const first = callOf({ toolCallId: "tc_1", verdict: "allowed" });
    const base = turnOf({ steps: [stepOf(0, { calls: [first] })] });
    const updated = callOf({ toolCallId: "tc_1", verdict: "blocked_hook" });
    const applied = applyDeltaRow(base, { kind: "call", stepIndex: 0, call: updated });
    expect(applied.record.steps[0]?.calls).toEqual([updated]);
  });

  test("a row for a step that is not in the record is orphaned and changes nothing", () => {
    const base = turnOf({ steps: [stepOf(0)] });
    const before = turnOf({ steps: [stepOf(0)] });
    const hook = hookRunOf({ toolCallId: null, seq: 5 });
    const hookRow = applyDeltaRow(base, { kind: "hook", stepIndex: 4, hook });
    expect(hookRow.orphan).toBe(true);
    expect(hookRow.record).toEqual(before);
    const callRow = applyDeltaRow(base, { kind: "call", stepIndex: 4, call: callOf() });
    expect(callRow.orphan).toBe(true);
    expect(callRow.record).toEqual(before);
  });

  test("a tool-bound hook whose call is not in the step is orphaned", () => {
    const base = turnOf({ steps: [stepOf(0)] });
    const applied = applyDeltaRow(base, {
      kind: "hook",
      stepIndex: 0,
      hook: hookRunOf({ toolCallId: "tc_missing" }),
    });
    expect(applied.orphan).toBe(true);
    expect(applied.record).toEqual(base);
  });

  test("frame rows are matched by lease id and child rows by child thread id", () => {
    const base = turnOf({ frames: [frameOf({ leaseId: "lease_1", exitedAtMs: null })] });
    const closed = applyDeltaRow(base, {
      kind: "frame",
      frame: frameOf({ leaseId: "lease_1", exitedAtMs: 90, exitReason: "done" }),
    });
    expect(closed.record.frames).toEqual([
      frameOf({ leaseId: "lease_1", exitedAtMs: 90, exitReason: "done" }),
    ]);

    const child = childOf("thr_child", { status: "running" });
    const withChild = applyDeltaRow(base, { kind: "child", child });
    const finished = applyDeltaRow(withChild.record, {
      kind: "child",
      child: childOf("thr_child", { status: "completed", used: { turns: 2, tokens: 900 } }),
    });
    expect(finished.record.children).toEqual([
      childOf("thr_child", { status: "completed", used: { turns: 2, tokens: 900 } }),
    ]);
  });

  test("a turn row sets the status and the complete flag", () => {
    const applied = applyDeltaRow(turnOf(), {
      kind: "turn",
      status: "completed",
      complete: true,
    });
    expect(applied.record.status).toBe("completed");
    expect(applied.record.complete).toBe(true);
    expect(applied.record.endedAt).toBeNull();
  });

  test("the input record is not changed", () => {
    const base = turnOf({ steps: [stepOf(0)] });
    applyDeltaRow(base, { kind: "step", stepIndex: 0, step: stepOf(0, { stepId: "stp_x" }) });
    applyDeltaRow(base, { kind: "turn", status: "completed", complete: true });
    expect(base).toEqual(turnOf({ steps: [stepOf(0)] }));
  });
});

describe("applyDeltaRows", () => {
  test("folds the rows in order and counts the orphaned ones", () => {
    const base = turnOf({ steps: [stepOf(0)] });
    const rows: DeltaRow[] = [
      { kind: "step", stepIndex: 1, step: stepOf(1) },
      { kind: "call", stepIndex: 1, call: callOf({ toolCallId: "tc_1" }) },
      { kind: "hook", stepIndex: 9, hook: hookRunOf({ toolCallId: null }) },
      { kind: "turn", status: "completed", complete: true },
    ];
    const folded = applyDeltaRows(base, rows);
    expect(folded.orphans).toBe(1);
    expect(folded.record.steps.map((step) => step.stepIndex)).toEqual([0, 1]);
    expect(folded.record.steps[1]?.calls.map((call) => call.toolCallId)).toEqual(["tc_1"]);
    expect(folded.record.status).toBe("completed");
  });
});
