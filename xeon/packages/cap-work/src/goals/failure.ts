import { Type, type TUnsafe } from "typebox";
import { parse, parseJson, type SchemaProof } from "@xeon/contracts";
import { GoalIdSchema, type GoalId } from "@xeon/contracts/capabilities";

// L2.work.spec §3.4 GoalErrors, §4.3.4. 목표 규칙이 거부하는 이유를 값으로 표현한다. 서비스 경계(errors.ts goalRejection)가
// CapabilityError로 바꾼다. 거부는 커밋 거부(reject) 레코드의 detail에 JSON으로 남아 같은 requestId 재호출이 처음 거부를 되풀이한다.

export type GoalFailure =
  | { kind: "invalid_input"; message: string }
  | { kind: "not_found"; id: string }
  | { kind: "goal_active"; goalId: GoalId }
  | { kind: "goal_closed" }
  | { kind: "goal_not_delegated" }
  | { kind: "goal_turn_stale" }
  /** 위임 판정자가 아닌 주체가 판정을 넣으려 함 */
  | { kind: "denied"; message: string };

const failureShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("invalid_input"), message: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("not_found"), id: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("goal_active"), goalId: GoalIdSchema },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("goal_closed") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("goal_not_delegated") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("goal_turn_stale") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("denied"), message: Type.String() },
    { additionalProperties: false },
  ),
]);

const GoalFailureSchema: TUnsafe<GoalFailure> = Type.Unsafe<GoalFailure>(
  failureShape satisfies SchemaProof<GoalFailure, typeof failureShape>,
);

export function encodeGoalFailure(value: GoalFailure): string {
  return JSON.stringify(value);
}

/** 저장된 detail을 되읽는다. 읽을 수 없으면 undefined(호출자가 internal로 보고한다) */
export function decodeGoalFailure(detail: string | null): GoalFailure | undefined {
  if (detail === null) return undefined;
  const json = parseJson(detail);
  if (!json.ok) return undefined;
  const parsed = parse(GoalFailureSchema, json.value);
  return parsed.ok ? parsed.value : undefined;
}
