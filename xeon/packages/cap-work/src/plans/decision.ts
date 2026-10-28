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
 * allow는 approved, deny는 rejected(feedback은 `{ feedback }`, 없으면 `{ note }`)다. 수정 요청(`revise`)도 deny + feedback으로 기록되므로
 * 기록에서는 rejected와 구별되지 않는다. answer는 계획 승인에서 승인 서비스가 받지 않는 결정이라 이 표에는 방어 분기만 둔다:
 * 사용자의 글을 반려 사유로 남긴다. cancelled, superseded, expired로 닫힌 요청은 withdrawn이다(아무도 정하지 않았다).
 */
export function outcomeOf(
  decision: "allow" | "deny" | "answer",
  answer: JsonValue | null,
  resolvedBy: "user" | "noninteractive" | "cancelled" | "superseded" | "expired",
): PlanOutcome {
  if (resolvedBy === "cancelled" || resolvedBy === "superseded" || resolvedBy === "expired") {
    return { kind: "withdrawn" };
  }
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
      return { kind: "decided", decision: "rejected", feedback: textField(answer, "feedback") };
    default:
      return assertNever(decision, "outcomeOf");
  }
}
