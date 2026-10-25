import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { approvalFailureOf } from "../../src/app/approval-outcome.ts";

describe("approvalFailureOf", () => {
  test("an applied response has no failure", () => {
    expect(approvalFailureOf(ok({ applied: true }), "allow")).toBeNull();
  });

  test("the reason lets the card tell invalid answers from resolved requests", () => {
    expect(
      approvalFailureOf(
        ok({ applied: false, reason: "answer_invalid", detail: "q1: unknown option" }),
        "answer",
      ),
    ).toEqual({ kind: "invalid", detail: "q1: unknown option" });
    expect(approvalFailureOf(ok({ applied: false, reason: "answer_invalid" }), "answer")).toEqual({
      kind: "invalid",
    });
    expect(approvalFailureOf(ok({ applied: false, reason: "already_resolved" }), "allow")).toEqual({
      kind: "closed",
    });
    expect(approvalFailureOf(ok({ applied: false, reason: "unknown_approval" }), "deny")).toEqual({
      kind: "closed",
    });
    expect(approvalFailureOf(ok({ applied: false, reason: "commit_failed" }), "allow")).toEqual({
      kind: "failed",
    });
  });

  test("applied false without a reason is unapplied", () => {
    expect(approvalFailureOf(ok({ applied: false }), "answer")).toEqual({ kind: "unapplied" });
  });

  test("-32602 on an answer means the answer shape is invalid; other errors are failures", () => {
    expect(approvalFailureOf(err({ kind: "rejected", code: -32602 }), "answer")).toEqual({
      kind: "invalid",
    });
    expect(approvalFailureOf(err({ kind: "rejected", code: -32602 }), "allow")).toEqual({
      kind: "failed",
    });
    expect(approvalFailureOf(err({ kind: "rejected", code: 3002 }), "answer")).toEqual({
      kind: "failed",
    });
    expect(approvalFailureOf(err({ kind: "offline" }), "allow")).toEqual({ kind: "failed" });
    expect(approvalFailureOf(err({ kind: "failed" }), "deny")).toEqual({ kind: "failed" });
  });
});
