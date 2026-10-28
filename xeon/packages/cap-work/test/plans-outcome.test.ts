import { expect, test } from "bun:test";
import { outcomeOf } from "../src/plans/decision.ts";

// 계획 승인이 사람의 결정 없이 닫힌 경우(취소, 대체, 만료)는 어느 결정이든 withdrawn이다. 만료 필드는 F.records.spec G1-11이 더했다.
test("a plan approval closed without a person is withdrawn whatever the recorded decision", () => {
  for (const resolvedBy of ["cancelled", "superseded", "expired"] as const) {
    for (const decision of ["allow", "deny", "answer"] as const) {
      expect({ resolvedBy, decision, outcome: outcomeOf(decision, null, resolvedBy) }).toEqual({
        resolvedBy,
        decision,
        outcome: { kind: "withdrawn" },
      });
    }
  }
});

test("a person's decision keeps its meaning", () => {
  expect(outcomeOf("allow", null, "user")).toEqual({
    kind: "decided",
    decision: "approved",
    feedback: null,
  });
  expect(outcomeOf("deny", { feedback: "split it" }, "user")).toEqual({
    kind: "decided",
    decision: "rejected",
    feedback: "split it",
  });
});
