import { Type, type TUnsafe } from "typebox";
import { parse, parseJson, type SchemaProof } from "@xeon/contracts";
import { PlanStatusSchema, type PlanStatus } from "@xeon/contracts/capabilities";

// L2.work.spec §3.3 PlanErrors, §5. 계획 규칙이 거부하는 이유를 값으로 표현한다.
// 서비스 경계(errors.ts planRejection)가 CapabilityError로 바꾼다. 제출 거부는 커밋 거부(reject) 레코드의 detail에 JSON으로 남아
// 같은 requestId 재호출이 처음 거부를 되풀이한다.

export type PlanFailure =
  | { kind: "invalid_input"; message: string }
  | { kind: "not_found"; id: string }
  | { kind: "plan_pending" }
  | { kind: "plan_closed"; status: PlanStatus }
  | { kind: "plan_not_approved" }
  | { kind: "plan_mode_inactive" }
  /** 이 조립에 필요한 포트(권한 모드, 승인)가 없다 */
  | { kind: "unavailable"; message: string }
  /** 권한 모드를 바꿀 수 없다(조직 정책이 막았다) */
  | { kind: "mode_forbidden"; mode: string };

const failureShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("invalid_input"), message: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("not_found"), id: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("plan_pending") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("plan_closed"), status: PlanStatusSchema },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("plan_not_approved") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("plan_mode_inactive") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("unavailable"), message: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("mode_forbidden"), mode: Type.String() },
    { additionalProperties: false },
  ),
]);

const PlanFailureSchema: TUnsafe<PlanFailure> = Type.Unsafe<PlanFailure>(
  failureShape satisfies SchemaProof<PlanFailure, typeof failureShape>,
);

export function encodePlanFailure(value: PlanFailure): string {
  return JSON.stringify(value);
}

/** 저장된 detail을 되읽는다. 읽을 수 없으면 undefined(호출자가 internal로 보고한다) */
export function decodePlanFailure(detail: string | null): PlanFailure | undefined {
  if (detail === null) return undefined;
  const json = parseJson(detail);
  if (!json.ok) return undefined;
  const parsed = parse(PlanFailureSchema, json.value);
  return parsed.ok ? parsed.value : undefined;
}
