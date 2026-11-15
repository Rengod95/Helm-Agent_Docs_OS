import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  maskApprovalRequest,
} from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

// 계획 승인은 은퇴했다 [결정: 2026-11-13 사용자]. 옛 계획 승인 기록(요청 한 건, 해결 한 건)은 지금도 디코드되어
// 기록한 값 그대로 나와야 한다. 기록은 unknown으로 두고 디코드한 값을 기록과 toEqual로 비교한다 [결정: 2026-11-15 사용자].

const THREAD = rawId("thr", 1);
const REQUEST_EVENT = rawId("evt", 3);
const PLAN_TEXT = "1. Back up the store\n2. Migrate";

/** 옛 계획 승인 요청의 본문(kind `plan`). nextModes에는 옛 `plan` 모드가 들어 있다 */
const OLD_PLAN_BODY: unknown = {
  kind: "plan",
  plan: { plan: PLAN_TEXT, planRef: "p1", nextModes: ["plan", "acceptEdits"] },
};

/** 옛 계획 승인 요청 기록 */
const OLD_PLAN_REQUEST: unknown = {
  origin: {
    threadId: THREAD,
    turnId: null,
    stepId: null,
    toolCallId: "call_plan_1",
    caller: "main",
  },
  requestKey: "call_plan_1",
  title: "Approve the plan",
  body: OLD_PLAN_BODY,
  remember: ["once"],
  surfaceThreadId: THREAD,
  requestedAt: 1_000,
};

/** 옛 계획 승인의 해결 기록(`allow`). answer는 옛 PlanAnswer 모양이었다 */
const OLD_PLAN_RESOLVED: unknown = {
  approvalId: REQUEST_EVENT,
  decision: "allow",
  answer: { mode: "acceptEdits", note: "go ahead" },
  remember: "once",
  requestedRemember: null,
  resolvedBy: "user",
};

/** 기록을 디코드한 값이 기록과 같은지 본다. dialog-area 시험의 roundTrip과 같은 방식이다 */
function decodesAsWritten(schema: TSchema, written: unknown): void {
  const result = parse(schema, written);
  expect(result.ok ? result.value : result.error).toEqual(written);
}

describe("legacy plan approval records", () => {
  test("the old plan request decodes to the value it was written with", () => {
    decodesAsWritten(ApprovalRequestedPayloadSchema, OLD_PLAN_REQUEST);
  });

  test("the old plan resolution decodes to the value it was written with", () => {
    decodesAsWritten(ApprovalResolvedPayloadSchema, OLD_PLAN_RESOLVED);
  });

  test("masking leaves the old plan body as it is", () => {
    const result = parse(ApprovalRequestedPayloadSchema, OLD_PLAN_REQUEST);
    if (!result.ok) throw new Error("the old plan request must decode");
    const masked = maskApprovalRequest(result.value, [
      {
        pointer: "/body/plan/plan",
        len: PLAN_TEXT.length,
        ranges: [{ start: 0, end: 1, label: "kv" }],
      },
    ]);
    const maskedBody: unknown = masked?.body;
    expect(maskedBody).toEqual(OLD_PLAN_BODY);
  });
});
