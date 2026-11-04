import { describe, expect, test } from "bun:test";
import type { OrderWarning } from "@fresnel/client/workbench/canvas";
import { reorderable, rowWarningOf } from "../../../src/views/craft/strata-model.ts";

function warning(over: Partial<OrderWarning> = {}): OrderWarning {
  return {
    severity: "none",
    skipped: [],
    guardLosesFirst: [],
    guardMayBeSkipped: [],
    valueChanges: [],
    autoDisable: [],
    ...over,
  };
}

const skipped = (name: string, by: readonly string[]): OrderWarning["skipped"][number] => ({
  registrationId: name.toLowerCase(),
  name,
  reason: "first_answer",
  by,
});

describe("reorderable (the drag handle is shown only where order changes the winner or the value)", () => {
  test("a value-answer first hook or a chain hook with two handlers is reorderable", () => {
    expect(reorderable("thread.trust.before", 2)).toEqual(true);
    expect(reorderable("input.user.before", 2)).toEqual(true);
    expect(reorderable("thread.compact.before", 3)).toEqual(true);
  });

  test("fewer than two handlers is never reorderable", () => {
    expect(reorderable("thread.trust.before", 1)).toEqual(false);
    expect(reorderable("input.user.before", 0)).toEqual(false);
  });

  test("block-only first hooks, collect and tap hooks, and unknown hooks are read only", () => {
    expect(reorderable("tool.call.before", 2)).toEqual(false);
    expect(reorderable("guard.model.before", 2)).toEqual(false);
    expect(reorderable("input.agent.before", 2)).toEqual(false);
    expect(reorderable("boundary.settle.after", 4)).toEqual(false);
    expect(reorderable("no.such.hook", 5)).toEqual(false);
  });
});

describe("rowWarningOf (the one line next to 추가)", () => {
  test("no skip and no guard risk gives no line", () => {
    expect(rowWarningOf(warning())).toEqual(null);
  });

  test("value changes and auto-off alone give no line (the save dialog covers them)", () => {
    expect(
      rowWarningOf(
        warning({
          severity: "skip",
          valueChanges: ["Tap"],
          autoDisable: ["Cleanup"],
        }),
      ),
    ).toEqual(null);
  });

  test("one skipped handler names it with the earlier handler that answers first", () => {
    expect(
      rowWarningOf(warning({ severity: "skip", skipped: [skipped("Deny", ["Allow"])] })),
    ).toEqual({ k: "skip", name: "Deny", by: "Allow", more: 0 });
  });

  test("several skipped handlers show the first and count the rest", () => {
    const w = warning({
      severity: "skip",
      skipped: [skipped("Deny", ["Allow"]), skipped("Scan", ["Helm"]), skipped("Log", ["Helm"])],
    });
    expect(rowWarningOf(w)).toEqual({ k: "skip", name: "Deny", by: "Allow", more: 2 });
  });

  test("a skip note without an earlier handler has no by name", () => {
    expect(rowWarningOf(warning({ severity: "skip", skipped: [skipped("Deny", [])] }))).toEqual({
      k: "skip",
      name: "Deny",
      by: null,
      more: 0,
    });
  });

  test("a guard plugin that may be skipped, alone, gives its guard line", () => {
    expect(
      rowWarningOf(warning({ severity: "guard", guardMayBeSkipped: ["Guard", "Other"] })),
    ).toEqual({ k: "guardSkip", name: "Guard", more: 1 });
  });

  test("a guard plugin that loses the first position, alone, gives its guard line", () => {
    expect(rowWarningOf(warning({ severity: "guard", guardLosesFirst: ["Guard"] }))).toEqual({
      k: "guardFirst",
      name: "Guard",
      more: 0,
    });
  });

  test("a skip takes precedence over the guard lines", () => {
    const w = warning({
      severity: "guard",
      skipped: [skipped("Deny", ["Allow"])],
      guardMayBeSkipped: ["Guard"],
      guardLosesFirst: ["Guard"],
    });
    expect(rowWarningOf(w)).toEqual({ k: "skip", name: "Deny", by: "Allow", more: 0 });
  });
});
