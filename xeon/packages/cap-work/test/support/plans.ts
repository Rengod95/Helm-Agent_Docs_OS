import { Bug, parse } from "@xeon/contracts";
import { PlanIdSchema, type PlanId as PlanIdType } from "@xeon/contracts/capabilities";

/** 문자열을 계획 ID로 좁힌다. 형식이 틀리면 시험 입력의 결함이다 */
export function PlanId(raw: string): PlanIdType {
  const parsed = parse(PlanIdSchema, raw);
  if (!parsed.ok) throw new Bug(`test input ${raw} is not a plan id`);
  return parsed.value;
}
