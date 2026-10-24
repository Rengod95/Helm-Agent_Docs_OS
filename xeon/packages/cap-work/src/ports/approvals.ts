import { Bug, parse } from "@xeon/contracts";
import { PlanApprovalAnswerSchema, toJsonSchema } from "@xeon/contracts/capabilities";
import { JsonObjectSchema, type JsonObject, type JsonValue } from "@xeon/contracts/conversation";
import type { ApprovalOrigin, L2ApprovalsPort, PermissionMode } from "@xeon/contracts/services";
import { sha256Hex } from "../hash.ts";
import { planRefOf } from "../plans/refs.ts";

// L2.work.spec §4.2.2. 계획 승인은 F `L2ApprovalsPort`(L2.readme §5.7)로 kind "plan" 요청을 낸다.
// 호출마다 출처(origin)가 달라 포트는 출처를 받아 만든다. 실제 어댑터는 core-tools의 ApprovalService를 감싸 조립 루트가 넘긴다.

/** 출처(스레드, 턴, 도구 호출, 호출자)를 받아 승인 포트를 만드는 함수 */
export type PlanApprovalsFactory = (origin: ApprovalOrigin) => L2ApprovalsPort;

/** decision "answer"의 answer를 검사하는 JSON Schema(수정 요청 PlanApprovalAnswer) */
export const PLAN_ANSWER_JSON_SCHEMA: JsonObject = jsonObjectOf(
  toJsonSchema(PlanApprovalAnswerSchema),
);

/** 스키마 문서는 항상 객체다. 아니면 정의 결함이다 */
function jsonObjectOf(value: JsonValue): JsonObject {
  const parsed = parse(JsonObjectSchema, value);
  return parsed.ok ? parsed.value : notAnObject();
}

function notAnObject(): never {
  throw new Bug("work.plan answer schema is not a JSON object");
}

const REQUEST_ID_MAX = 48;

/** 승인 응답에 쓰는 requestId(1~48자). 길면 해시로 줄인다(같은 입력은 같은 값) */
export function approvalRequestId(raw: string): string {
  return raw.length <= REQUEST_ID_MAX ? raw : `h_${sha256Hex(raw).slice(0, 40)}`;
}

/** 계획 승인 요청의 대상. F PlanApprovalBody(`plan`, `planRef`, `nextModes`)와 같은 모양이다 */
export function planSubject(
  plan: { readonly planId: string; readonly version: number; readonly body: string },
  nextModes: readonly PermissionMode[],
): JsonValue {
  return {
    plan: plan.body,
    planRef: planRefOf(plan.planId, plan.version),
    nextModes: [...nextModes],
  };
}

/**
 * 승인할 때 고를 수 있는 다음 권한 모드: 계획 모드 직전 모드를 맨 앞에 두고 default, acceptEdits를 더한다.
 * bypass는 직전 모드였을 때만 낸다
 */
export function nextModesFor(previous: PermissionMode | null): PermissionMode[] {
  const modes: PermissionMode[] = [];
  for (const mode of [previous, "default", "acceptEdits"] as const) {
    if (mode !== null && mode !== "plan" && !modes.includes(mode)) modes.push(mode);
  }
  return modes;
}
