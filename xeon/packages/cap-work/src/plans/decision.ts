import { assertNever, parse } from "@xeon/contracts";
import type { PlanDecision } from "@xeon/contracts/capabilities";
import { JsonObjectSchema, type JsonValue } from "@xeon/contracts/conversation";

// L2.work.spec §4.2.3. 승인 해결(approval.resolved)을 계획 상태로 옮기는 표. 투영기와 submit 응답이 같은 표를 쓴다.

/** 계획 한 판의 결정. withdrawn은 요청이 취소된 경우다 */
export type PlanOutcome =
  | { readonly kind: "decided"; readonly decision: PlanDecision; readonly feedback: string | null }
  | { readonly kind: "withdrawn" };

function textField(answer: JsonValue | null, key: string): string | null {
  const object = parse(JsonObjectSchema, answer);
  if (!object.ok) return null;
  const value = object.value[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * wire 결정 한 건을 계획 결정으로 옮긴다.
 * allow는 approved, deny는 rejected(feedback은 answer.feedback, 없으면 answer.note), answer는 revision_requested.
 * cancelled나 superseded로 닫힌 요청은 withdrawn이다.
 */
export function outcomeOf(
  decision: "allow" | "deny" | "answer",
  answer: JsonValue | null,
  resolvedBy: "user" | "noninteractive" | "cancelled" | "superseded",
): PlanOutcome {
  if (resolvedBy === "cancelled" || resolvedBy === "superseded") return { kind: "withdrawn" };
  switch (decision) {
    case "allow":
      return { kind: "decided", decision: "approved", feedback: null };
    case "deny":
      return {
        kind: "decided",
        decision: "rejected",
        feedback: textField(answer, "feedback") ?? textField(answer, "note"),
      };
    case "answer":
      return {
        kind: "decided",
        decision: "revision_requested",
        feedback: textField(answer, "feedback"),
      };
    default:
      return assertNever(decision, "outcomeOf");
  }
}
